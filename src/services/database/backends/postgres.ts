/**
 * PostgreSQL Backend
 *
 * Implements DatabaseBackend using the postgres.js library.
 * Supports connection pooling, query execution, and transactions.
 */

import postgres from 'postgres';
import { randomUUID } from 'crypto';
import { debugLog } from '../../../debug.ts';
import type {
  DatabaseBackend,
  ConnectionConfig,
  QueryResult,
  TransactionQuery,
  TransactionResult,
  ConnectionTestResult,
  FieldInfo,
} from '../types.ts';
import { DatabaseError } from '../errors.ts';

/**
 * Map Postgres type OIDs to readable type names.
 */
const PG_TYPE_NAMES: Record<number, string> = {
  16: 'boolean',
  17: 'bytea',
  20: 'bigint',
  21: 'smallint',
  23: 'integer',
  25: 'text',
  114: 'json',
  700: 'real',
  701: 'double precision',
  1042: 'char',
  1043: 'varchar',
  1082: 'date',
  1083: 'time',
  1114: 'timestamp',
  1184: 'timestamptz',
  1700: 'numeric',
  2950: 'uuid',
  3802: 'jsonb',
  3904: 'int4range',
  3906: 'numrange',
  3908: 'tsrange',
  3910: 'tstzrange',
  3912: 'daterange',
  3926: 'int8range',
};

/**
 * Get type name from OID.
 */
function getTypeName(typeId: number): string {
  return PG_TYPE_NAMES[typeId] || `oid:${typeId}`;
}

/**
 * PostgreSQL backend implementation.
 */
export class PostgresBackend implements DatabaseBackend {
  readonly type = 'postgres' as const;

  private sql: postgres.Sql | null = null;
  private config: ConnectionConfig | null = null;
  private connectionId: string | null = null;
  private runningQueries = new Map<string, AbortController>();

  /**
   * Connect to the database.
   */
  async connect(config: ConnectionConfig, password: string): Promise<void> {
    if (this.sql) {
      await this.disconnect();
    }

    this.config = config;
    this.connectionId = config.id || randomUUID();

    const sslConfig = config.ssl === true
      ? { rejectUnauthorized: true }
      : config.ssl === false
        ? false
        : config.ssl;

    try {
      this.sql = postgres({
        host: config.host,
        port: config.port,
        database: config.database,
        username: config.username,
        password: password,
        ssl: sslConfig || false,
        connect_timeout: (config.connectionTimeout || 30000) / 1000,
        idle_timeout: 60,
        max_lifetime: 60 * 30, // 30 minutes
        max: 10, // Connection pool size
        onnotice: (notice) => {
          debugLog(`[PostgresBackend] Notice: ${notice.message}`);
        },
      });

      // Test the connection
      await this.sql`SELECT 1`;
      debugLog(`[PostgresBackend] Connected to ${config.host}:${config.port}/${config.database}`);
    } catch (error) {
      this.sql = null;
      this.config = null;
      throw DatabaseError.wrap(error, this.connectionId);
    }
  }

  /**
   * Disconnect from the database.
   */
  async disconnect(): Promise<void> {
    if (this.sql) {
      try {
        // Cancel any running queries
        for (const controller of this.runningQueries.values()) {
          controller.abort();
        }
        this.runningQueries.clear();

        await this.sql.end();
        debugLog('[PostgresBackend] Disconnected');
      } catch (error) {
        debugLog(`[PostgresBackend] Error during disconnect: ${error}`);
      }

      this.sql = null;
      this.config = null;
    }
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.sql !== null;
  }

  /**
   * Execute a query.
   */
  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.sql) {
      throw DatabaseError.notConnected(this.connectionId || 'unknown');
    }

    // Check for write operations in read-only mode
    if (this.config?.readOnly) {
      const normalizedSql = sql.trim().toUpperCase();
      const writeCommands = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE'];
      if (writeCommands.some(cmd => normalizedSql.startsWith(cmd))) {
        throw DatabaseError.readOnlyViolation(this.connectionId!);
      }
    }

    const queryId = randomUUID();
    const controller = new AbortController();
    this.runningQueries.set(queryId, controller);

    const startedAt = new Date();
    const notices: string[] = [];

    try {
      // Execute the query
      let result: postgres.RowList<postgres.Row[]>;

      if (params && params.length > 0) {
        // Parameterized query using tagged template
        // Note: postgres.js uses $1, $2, etc. syntax
        result = await this.sql.unsafe(sql, params as any[]);
      } else {
        result = await this.sql.unsafe(sql);
      }

      const completedAt = new Date();

      // Extract field info from the result columns
      const fields: FieldInfo[] = result.columns?.map(col => ({
        name: col.name,
        dataType: getTypeName(col.type),
        dataTypeId: col.type,
        nullable: true, // postgres.js doesn't provide this info directly
      })) || [];

      // Convert rows to plain objects
      const rows = result.map(row => ({ ...row }));

      return {
        queryId,
        connectionId: this.connectionId!,
        sql,
        rows,
        fields,
        rowCount: rows.length,
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        affectedRows: result.count,
        notices: notices.length > 0 ? notices : undefined,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw DatabaseError.queryCancelled(this.connectionId!, queryId);
      }
      throw DatabaseError.wrap(error, this.connectionId || undefined);
    } finally {
      this.runningQueries.delete(queryId);
    }
  }

  /**
   * Execute a transaction.
   */
  async transaction(queries: TransactionQuery[]): Promise<TransactionResult> {
    if (!this.sql) {
      throw DatabaseError.notConnected(this.connectionId || 'unknown');
    }

    const results: Array<QueryResult | { error: string; label?: string }> = [];

    try {
      await this.sql.begin(async (tx) => {
        for (const q of queries) {
          try {
            const startedAt = new Date();
            const result = q.params && q.params.length > 0
              ? await tx.unsafe(q.sql, q.params as any[])
              : await tx.unsafe(q.sql);
            const completedAt = new Date();

            const fields: FieldInfo[] = result.columns?.map(col => ({
              name: col.name,
              dataType: getTypeName(col.type),
              dataTypeId: col.type,
              nullable: true,
            })) || [];

            const rows = result.map(row => ({ ...row }));

            results.push({
              queryId: randomUUID(),
              connectionId: this.connectionId!,
              sql: q.sql,
              rows,
              fields,
              rowCount: rows.length,
              startedAt,
              completedAt,
              durationMs: completedAt.getTime() - startedAt.getTime(),
              affectedRows: result.count,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            results.push({
              error: message,
              label: q.label,
            });
            throw error; // Re-throw to trigger rollback
          }
        }
      });

      return {
        success: true,
        results,
        committedAt: new Date(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return {
        success: false,
        results,
        rolledBackAt: new Date(),
        error: message,
      };
    }
  }

  /**
   * Cancel a running query.
   */
  async cancelQuery(queryId: string): Promise<void> {
    const controller = this.runningQueries.get(queryId);
    if (controller) {
      controller.abort();
      this.runningQueries.delete(queryId);
      debugLog(`[PostgresBackend] Cancelled query ${queryId}`);
    }
  }

  /**
   * Test the connection.
   */
  async testConnection(): Promise<ConnectionTestResult> {
    if (!this.sql) {
      return {
        success: false,
        error: 'Not connected',
      };
    }

    const startTime = Date.now();

    try {
      const result = await this.sql`SELECT version()`;
      const latencyMs = Date.now() - startTime;

      return {
        success: true,
        latencyMs,
        serverVersion: result[0]?.version as string,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Get server version.
   */
  async getServerVersion(): Promise<string> {
    if (!this.sql) {
      throw DatabaseError.notConnected(this.connectionId || 'unknown');
    }

    const result = await this.sql`SHOW server_version`;
    return result[0]?.server_version as string || 'unknown';
  }
}

export default PostgresBackend;
