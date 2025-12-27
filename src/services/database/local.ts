/**
 * Local Database Service Implementation
 *
 * Implements DatabaseService using local storage and connection backends.
 */

import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';
import { debugLog } from '../../debug.ts';
import type { DatabaseService } from './interface.ts';
import type {
  ConnectionConfig,
  ConnectionInfo,
  ConnectionTestResult,
  QueryResult,
  TransactionQuery,
  TransactionResult,
  SchemaInfo,
  TableInfo,
  TableDetails,
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
  QueryHistoryEntry,
  DatabaseBackend,
  ConnectionChangeCallback,
  ConnectionChangeEvent,
  QueryStartCallback,
  QueryStartEvent,
  QueryCompleteCallback,
  QueryCompleteEvent,
  Unsubscribe,
} from './types.ts';
import { DatabaseError } from './errors.ts';
import { PostgresBackend } from './backends/postgres.ts';
import { QueryHistoryManager } from './history.ts';
import { localSecretService } from '../secret/local.ts';

const GLOBAL_CONNECTIONS_FILE = join(homedir(), '.ultra', 'connections.json');
const PROJECT_CONNECTIONS_FILE = '.ultra/connections.json';

/**
 * Stored connection configuration (excludes runtime state).
 */
interface StoredConnections {
  connections: ConnectionConfig[];
}

/**
 * Active connection with backend.
 */
interface ActiveConnection {
  config: ConnectionConfig;
  backend: DatabaseBackend;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error?: string;
  connectedAt?: Date;
  refCount: number; // Number of clients using this connection
}

/**
 * Local Database Service.
 */
export class LocalDatabaseService implements DatabaseService {
  private connections = new Map<string, ActiveConnection>();
  private workspaceRoot: string | null = null;
  private historyManager = new QueryHistoryManager();
  private initialized = false;

  // Running queries for cancellation support
  private runningQueries = new Map<string, { connectionId: string; startedAt: Date }>();

  // Event callbacks
  private connectionChangeCallbacks = new Set<ConnectionChangeCallback>();
  private queryStartCallbacks = new Set<QueryStartCallback>();
  private queryCompleteCallbacks = new Set<QueryCompleteCallback>();

  // ─────────────────────────────────────────────────────────────────────────
  // Connection Management
  // ─────────────────────────────────────────────────────────────────────────

  async createConnection(config: ConnectionConfig): Promise<string> {
    const id = config.id || randomUUID();

    // Validate config
    if (!config.name?.trim()) {
      throw DatabaseError.invalidConfig('name', 'Name is required');
    }
    if (!config.host?.trim()) {
      throw DatabaseError.invalidConfig('host', 'Host is required');
    }
    if (!config.port || config.port < 1 || config.port > 65535) {
      throw DatabaseError.invalidConfig('port', 'Port must be between 1 and 65535');
    }
    if (!config.database?.trim()) {
      throw DatabaseError.invalidConfig('database', 'Database is required');
    }

    // Check for duplicate
    if (this.connections.has(id)) {
      throw DatabaseError.connectionExists(id);
    }

    const fullConfig: ConnectionConfig = {
      ...config,
      id,
    };

    // Create inactive connection entry
    this.connections.set(id, {
      config: fullConfig,
      backend: this.createBackend(config.type),
      status: 'disconnected',
      refCount: 0,
    });

    // Save to file
    await this.saveConnections();

    this.emitConnectionChange({
      connectionId: id,
      type: 'created',
      connection: this.getConnection(id)!,
    });

    debugLog(`[DatabaseService] Created connection: ${config.name} (${id})`);
    return id;
  }

  async connect(connectionId: string): Promise<void> {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      throw DatabaseError.connectionNotFound(connectionId);
    }

    // If already connected, just increment ref count
    if (conn.status === 'connected') {
      conn.refCount++;
      debugLog(`[DatabaseService] Reusing connection ${connectionId} (refs: ${conn.refCount})`);
      return;
    }

    // If connecting, wait for it
    if (conn.status === 'connecting') {
      // Wait for connection to complete
      await new Promise<void>((resolve, reject) => {
        const check = () => {
          if (conn.status === 'connected') {
            conn.refCount++;
            resolve();
          } else if (conn.status === 'error') {
            reject(new Error(conn.error));
          } else {
            setTimeout(check, 100);
          }
        };
        check();
      });
      return;
    }

    conn.status = 'connecting';
    this.emitConnectionChange({
      connectionId,
      type: 'connected',
      connection: this.getConnection(connectionId)!,
    });

    try {
      // Get password from secret service
      const password = await localSecretService.get(conn.config.passwordSecret);
      if (!password) {
        throw DatabaseError.secretNotFound(conn.config.passwordSecret);
      }

      await conn.backend.connect(conn.config, password);

      conn.status = 'connected';
      conn.connectedAt = new Date();
      conn.refCount = 1;
      conn.error = undefined;

      this.emitConnectionChange({
        connectionId,
        type: 'connected',
        connection: this.getConnection(connectionId)!,
      });

      debugLog(`[DatabaseService] Connected: ${conn.config.name}`);
    } catch (error) {
      conn.status = 'error';
      conn.error = error instanceof Error ? error.message : String(error);

      this.emitConnectionChange({
        connectionId,
        type: 'error',
        connection: this.getConnection(connectionId)!,
        error: conn.error,
      });

      throw DatabaseError.wrap(error, connectionId);
    }
  }

  async disconnect(connectionId: string): Promise<void> {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      return;
    }

    // Decrement ref count
    if (conn.refCount > 1) {
      conn.refCount--;
      debugLog(`[DatabaseService] Decremented refs for ${connectionId} (refs: ${conn.refCount})`);
      return;
    }

    // Actually disconnect
    if (conn.backend.isConnected()) {
      await conn.backend.disconnect();
    }

    conn.status = 'disconnected';
    conn.refCount = 0;
    conn.connectedAt = undefined;

    this.emitConnectionChange({
      connectionId,
      type: 'disconnected',
      connection: this.getConnection(connectionId)!,
    });

    debugLog(`[DatabaseService] Disconnected: ${conn.config.name}`);
  }

  async deleteConnection(connectionId: string): Promise<void> {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      throw DatabaseError.connectionNotFound(connectionId);
    }

    // Disconnect if connected
    if (conn.backend.isConnected()) {
      await conn.backend.disconnect();
    }

    this.connections.delete(connectionId);
    await this.saveConnections();

    this.emitConnectionChange({
      connectionId,
      type: 'deleted',
    });

    debugLog(`[DatabaseService] Deleted connection: ${connectionId}`);
  }

  getConnection(connectionId: string): ConnectionInfo | null {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      return null;
    }

    return {
      id: conn.config.id!,
      name: conn.config.name,
      type: conn.config.type,
      status: conn.status,
      host: conn.config.host,
      database: conn.config.database,
      error: conn.error,
      readOnly: conn.config.readOnly || false,
      scope: conn.config.scope,
      connectedAt: conn.connectedAt,
    };
  }

  listConnections(scope?: 'global' | 'project'): ConnectionInfo[] {
    const connections: ConnectionInfo[] = [];

    for (const [id, conn] of this.connections) {
      if (scope && conn.config.scope !== scope) {
        continue;
      }

      connections.push({
        id,
        name: conn.config.name,
        type: conn.config.type,
        status: conn.status,
        host: conn.config.host,
        database: conn.config.database,
        error: conn.error,
        readOnly: conn.config.readOnly || false,
        scope: conn.config.scope,
        connectedAt: conn.connectedAt,
      });
    }

    return connections.sort((a, b) => a.name.localeCompare(b.name));
  }

  async testConnection(config: ConnectionConfig): Promise<ConnectionTestResult> {
    const backend = this.createBackend(config.type);

    try {
      // Get password
      const password = await localSecretService.get(config.passwordSecret);
      if (!password) {
        return {
          success: false,
          error: `Password secret not found: ${config.passwordSecret}`,
        };
      }

      await backend.connect(config, password);
      const result = await backend.testConnection();
      await backend.disconnect();

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: message,
      };
    }
  }

  async updateConnection(connectionId: string, config: Partial<ConnectionConfig>): Promise<void> {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      throw DatabaseError.connectionNotFound(connectionId);
    }

    const wasConnected = conn.backend.isConnected();

    // Disconnect if connected
    if (wasConnected) {
      await conn.backend.disconnect();
    }

    // Update config
    conn.config = {
      ...conn.config,
      ...config,
      id: connectionId, // Keep the same ID
    };

    await this.saveConnections();

    // Reconnect if was connected
    if (wasConnected) {
      await this.connect(connectionId);
    }

    this.emitConnectionChange({
      connectionId,
      type: 'updated',
      connection: this.getConnection(connectionId)!,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Query Execution
  // ─────────────────────────────────────────────────────────────────────────

  async executeQuery(connectionId: string, sql: string, params?: unknown[]): Promise<QueryResult> {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      throw DatabaseError.connectionNotFound(connectionId);
    }
    if (!conn.backend.isConnected()) {
      throw DatabaseError.notConnected(connectionId);
    }

    const queryId = randomUUID();
    const startedAt = new Date();

    this.runningQueries.set(queryId, { connectionId, startedAt });

    this.emitQueryStart({
      queryId,
      connectionId,
      sql,
      startedAt,
    });

    try {
      const result = await conn.backend.query(sql, params);

      // Add to history
      await this.historyManager.addEntry({
        connectionId,
        connectionName: conn.config.name,
        sql,
        executedAt: startedAt,
        durationMs: result.durationMs,
        rowCount: result.rowCount,
        status: 'success',
      });

      this.emitQueryComplete({ queryId, result });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Add failed query to history
      await this.historyManager.addEntry({
        connectionId,
        connectionName: conn.config.name,
        sql,
        executedAt: startedAt,
        durationMs: Date.now() - startedAt.getTime(),
        rowCount: 0,
        status: 'error',
        error: message,
      });

      throw error;
    } finally {
      this.runningQueries.delete(queryId);
    }
  }

  async executeTransaction(connectionId: string, queries: TransactionQuery[]): Promise<TransactionResult> {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      throw DatabaseError.connectionNotFound(connectionId);
    }
    if (!conn.backend.isConnected()) {
      throw DatabaseError.notConnected(connectionId);
    }

    return conn.backend.transaction(queries);
  }

  async cancelQuery(queryId: string): Promise<void> {
    const query = this.runningQueries.get(queryId);
    if (!query) {
      throw DatabaseError.queryNotFound(queryId);
    }

    const conn = this.connections.get(query.connectionId);
    if (conn) {
      await conn.backend.cancelQuery(queryId);
    }

    this.runningQueries.delete(queryId);
  }

  async fetchRows(queryId: string, offset: number, limit: number): Promise<QueryResult> {
    // For pagination, we'd need to store the original query and re-run with OFFSET/LIMIT
    // This is a simplified implementation - full implementation would cache queries
    throw new Error('fetchRows not yet implemented - use executeQuery with LIMIT/OFFSET');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Schema Browsing
  // ─────────────────────────────────────────────────────────────────────────

  async listSchemas(connectionId: string, includeSystem = false): Promise<SchemaInfo[]> {
    const result = await this.executeQuery(connectionId, `
      SELECT nspname as name, nspowner::regrole::text as owner
      FROM pg_namespace
      ${includeSystem ? '' : "WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND nspname NOT LIKE 'pg_temp%'"}
      ORDER BY nspname
    `);

    return result.rows.map(row => ({
      name: row.name as string,
      owner: row.owner as string,
      isSystem: ['pg_catalog', 'information_schema', 'pg_toast'].includes(row.name as string) ||
                (row.name as string).startsWith('pg_temp'),
    }));
  }

  async listTables(connectionId: string, schema = 'public'): Promise<TableInfo[]> {
    const result = await this.executeQuery(connectionId, `
      SELECT
        schemaname as schema,
        tablename as name,
        'table' as type,
        n_live_tup as row_count,
        pg_total_relation_size(schemaname || '.' || tablename) as size_bytes,
        obj_description((schemaname || '.' || tablename)::regclass) as comment
      FROM pg_stat_user_tables
      WHERE schemaname = $1

      UNION ALL

      SELECT
        schemaname as schema,
        viewname as name,
        'view' as type,
        NULL as row_count,
        NULL as size_bytes,
        obj_description((schemaname || '.' || viewname)::regclass) as comment
      FROM pg_views
      WHERE schemaname = $1

      UNION ALL

      SELECT
        schemaname as schema,
        matviewname as name,
        'materialized_view' as type,
        NULL as row_count,
        pg_total_relation_size(schemaname || '.' || matviewname) as size_bytes,
        obj_description((schemaname || '.' || matviewname)::regclass) as comment
      FROM pg_matviews
      WHERE schemaname = $1

      ORDER BY name
    `, [schema]);

    return result.rows.map(row => ({
      schema: row.schema as string,
      name: row.name as string,
      type: row.type as any,
      rowCount: row.row_count as number | undefined,
      sizeBytes: row.size_bytes as number | undefined,
      comment: row.comment as string | undefined,
    }));
  }

  async describeTable(connectionId: string, schema: string, table: string): Promise<TableDetails> {
    // Get columns
    const columnsResult = await this.executeQuery(connectionId, `
      SELECT
        c.column_name as name,
        c.data_type as data_type,
        c.is_nullable = 'YES' as nullable,
        c.column_default as default_value,
        c.ordinal_position as position,
        col_description((c.table_schema || '.' || c.table_name)::regclass, c.ordinal_position) as comment,
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key,
        CASE WHEN fk.column_name IS NOT NULL THEN true ELSE false END as is_foreign_key,
        fk.foreign_schema,
        fk.foreign_table,
        fk.foreign_column
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'PRIMARY KEY'
      ) pk ON pk.column_name = c.column_name
      LEFT JOIN (
        SELECT
          kcu.column_name,
          ccu.table_schema as foreign_schema,
          ccu.table_name as foreign_table,
          ccu.column_name as foreign_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'FOREIGN KEY'
      ) fk ON fk.column_name = c.column_name
      WHERE c.table_schema = $1 AND c.table_name = $2
      ORDER BY c.ordinal_position
    `, [schema, table]);

    const columns: ColumnInfo[] = columnsResult.rows.map(row => ({
      name: row.name as string,
      dataType: row.data_type as string,
      nullable: row.nullable as boolean,
      defaultValue: row.default_value as string | undefined,
      isPrimaryKey: row.is_primary_key as boolean,
      isForeignKey: row.is_foreign_key as boolean,
      position: row.position as number,
      comment: row.comment as string | undefined,
      references: row.is_foreign_key ? {
        schema: row.foreign_schema as string,
        table: row.foreign_table as string,
        column: row.foreign_column as string,
      } : undefined,
    }));

    // Get foreign keys
    const fkResult = await this.executeQuery(connectionId, `
      SELECT
        tc.constraint_name as name,
        array_agg(kcu.column_name ORDER BY kcu.ordinal_position) as columns,
        ccu.table_schema as referenced_schema,
        ccu.table_name as referenced_table,
        array_agg(ccu.column_name ORDER BY kcu.ordinal_position) as referenced_columns,
        rc.update_rule as on_update,
        rc.delete_rule as on_delete
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
      WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'FOREIGN KEY'
      GROUP BY tc.constraint_name, ccu.table_schema, ccu.table_name, rc.update_rule, rc.delete_rule
    `, [schema, table]);

    const foreignKeys: ForeignKeyInfo[] = fkResult.rows.map(row => ({
      name: row.name as string,
      columns: row.columns as string[],
      referencedSchema: row.referenced_schema as string,
      referencedTable: row.referenced_table as string,
      referencedColumns: row.referenced_columns as string[],
      onUpdate: row.on_update as any,
      onDelete: row.on_delete as any,
    }));

    // Get indexes
    const indexResult = await this.executeQuery(connectionId, `
      SELECT
        i.relname as name,
        array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) as columns,
        ix.indisunique as is_unique,
        ix.indisprimary as is_primary,
        am.amname as method,
        pg_relation_size(i.oid) as size_bytes,
        pg_get_indexdef(i.oid) as definition
      FROM pg_index ix
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_am am ON am.oid = i.relam
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE n.nspname = $1 AND t.relname = $2
      GROUP BY i.relname, ix.indisunique, ix.indisprimary, am.amname, i.oid
      ORDER BY i.relname
    `, [schema, table]);

    const indexes: IndexInfo[] = indexResult.rows.map(row => ({
      schema,
      table,
      name: row.name as string,
      columns: row.columns as string[],
      isUnique: row.is_unique as boolean,
      isPrimary: row.is_primary as boolean,
      method: row.method as any,
      sizeBytes: row.size_bytes as number | undefined,
      definition: row.definition as string | undefined,
    }));

    // Get table stats
    const statsResult = await this.executeQuery(connectionId, `
      SELECT
        n_live_tup as row_count,
        pg_total_relation_size($1 || '.' || $2) as size_bytes,
        obj_description(($1 || '.' || $2)::regclass) as comment
      FROM pg_stat_user_tables
      WHERE schemaname = $1 AND relname = $2
    `, [schema, table]);

    const stats = statsResult.rows[0] || {};

    // Determine table type
    const typeResult = await this.executeQuery(connectionId, `
      SELECT relkind FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2
    `, [schema, table]);

    const relkind = typeResult.rows[0]?.relkind as string || 'r';
    const typeMap: Record<string, TableDetails['type']> = {
      'r': 'table',
      'v': 'view',
      'm': 'materialized_view',
      'f': 'foreign_table',
    };

    return {
      schema,
      name: table,
      type: typeMap[relkind] || 'table',
      columns,
      primaryKey: columns.some(c => c.isPrimaryKey) ? {
        name: `${table}_pkey`,
        columns: columns.filter(c => c.isPrimaryKey).map(c => c.name),
      } : undefined,
      foreignKeys,
      indexes,
      rowCount: stats.row_count as number | undefined,
      sizeBytes: stats.size_bytes as number | undefined,
      comment: stats.comment as string | undefined,
    };
  }

  async getTableDDL(connectionId: string, schema: string, table: string): Promise<string> {
    // This is a simplified DDL generator - full implementation would handle all edge cases
    const details = await this.describeTable(connectionId, schema, table);

    const columnDefs = details.columns.map(col => {
      let def = `  "${col.name}" ${col.dataType}`;
      if (!col.nullable) def += ' NOT NULL';
      if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`;
      return def;
    }).join(',\n');

    const pkCols = details.columns.filter(c => c.isPrimaryKey).map(c => `"${c.name}"`).join(', ');
    const pkDef = pkCols ? `,\n  PRIMARY KEY (${pkCols})` : '';

    return `CREATE TABLE "${schema}"."${table}" (\n${columnDefs}${pkDef}\n);`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Query History
  // ─────────────────────────────────────────────────────────────────────────

  async getQueryHistory(connectionId?: string, limit = 100, offset = 0): Promise<QueryHistoryEntry[]> {
    return this.historyManager.getHistory(connectionId, limit, offset);
  }

  async searchHistory(query: string, connectionId?: string): Promise<QueryHistoryEntry[]> {
    return this.historyManager.search(query, connectionId);
  }

  async clearHistory(connectionId?: string): Promise<void> {
    await this.historyManager.clear(connectionId);
  }

  async favoriteQuery(historyId: string, favorite: boolean): Promise<void> {
    await this.historyManager.setFavorite(historyId, favorite);
  }

  async getFavorites(connectionId?: string): Promise<QueryHistoryEntry[]> {
    return this.historyManager.getFavorites(connectionId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Events
  // ─────────────────────────────────────────────────────────────────────────

  onConnectionChange(callback: ConnectionChangeCallback): Unsubscribe {
    this.connectionChangeCallbacks.add(callback);
    return () => this.connectionChangeCallbacks.delete(callback);
  }

  onQueryStart(callback: QueryStartCallback): Unsubscribe {
    this.queryStartCallbacks.add(callback);
    return () => this.queryStartCallbacks.delete(callback);
  }

  onQueryComplete(callback: QueryCompleteCallback): Unsubscribe {
    this.queryCompleteCallbacks.add(callback);
    return () => this.queryCompleteCallbacks.delete(callback);
  }

  private emitConnectionChange(event: ConnectionChangeEvent): void {
    for (const callback of this.connectionChangeCallbacks) {
      try {
        callback(event);
      } catch (error) {
        debugLog(`[DatabaseService] Error in connection change callback: ${error}`);
      }
    }
  }

  private emitQueryStart(event: QueryStartEvent): void {
    for (const callback of this.queryStartCallbacks) {
      try {
        callback(event);
      } catch (error) {
        debugLog(`[DatabaseService] Error in query start callback: ${error}`);
      }
    }
  }

  private emitQueryComplete(event: QueryCompleteEvent): void {
    for (const callback of this.queryCompleteCallbacks) {
      try {
        callback(event);
      } catch (error) {
        debugLog(`[DatabaseService] Error in query complete callback: ${error}`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  async init(workspaceRoot?: string): Promise<void> {
    if (this.initialized) {
      return;
    }

    debugLog('[DatabaseService] Initializing...');

    // Initialize secret service
    await localSecretService.init();

    // Initialize history manager
    await this.historyManager.init();

    // Load global connections
    await this.loadConnections(GLOBAL_CONNECTIONS_FILE, 'global');

    // Load project connections if workspace is set
    if (workspaceRoot) {
      this.workspaceRoot = workspaceRoot;
      await this.loadConnections(join(workspaceRoot, PROJECT_CONNECTIONS_FILE), 'project');
    }

    this.initialized = true;
    debugLog(`[DatabaseService] Initialized with ${this.connections.size} connections`);
  }

  async shutdown(): Promise<void> {
    debugLog('[DatabaseService] Shutting down...');

    // Disconnect all connections
    for (const [id, conn] of this.connections) {
      if (conn.backend.isConnected()) {
        try {
          await conn.backend.disconnect();
        } catch (error) {
          debugLog(`[DatabaseService] Error disconnecting ${id}: ${error}`);
        }
      }
    }

    // Save state
    await this.saveConnections();
    await this.historyManager.shutdown();

    this.connections.clear();
    this.initialized = false;
  }

  getWorkspaceRoot(): string | null {
    return this.workspaceRoot;
  }

  async setWorkspaceRoot(path: string): Promise<void> {
    this.workspaceRoot = path;

    // Load project connections
    await this.loadConnections(join(path, PROJECT_CONNECTIONS_FILE), 'project');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────────────────

  private createBackend(type: 'postgres' | 'supabase'): DatabaseBackend {
    // For now, both postgres and supabase use the PostgresBackend
    // Supabase is just Postgres with extra features we'll add later
    return new PostgresBackend();
  }

  private async loadConnections(filePath: string, scope: 'global' | 'project'): Promise<void> {
    try {
      const file = Bun.file(filePath);
      const exists = await file.exists();

      if (!exists) {
        return;
      }

      const data = await file.json() as StoredConnections;

      for (const config of data.connections) {
        const id = config.id || randomUUID();
        config.id = id;
        config.scope = scope;

        if (!this.connections.has(id)) {
          this.connections.set(id, {
            config,
            backend: this.createBackend(config.type),
            status: 'disconnected',
            refCount: 0,
          });
        }
      }

      debugLog(`[DatabaseService] Loaded ${data.connections.length} ${scope} connections`);
    } catch (error) {
      debugLog(`[DatabaseService] Failed to load connections from ${filePath}: ${error}`);
    }
  }

  private async saveConnections(): Promise<void> {
    const global: ConnectionConfig[] = [];
    const project: ConnectionConfig[] = [];

    for (const conn of this.connections.values()) {
      if (conn.config.scope === 'global') {
        global.push(conn.config);
      } else {
        project.push(conn.config);
      }
    }

    // Save global connections
    if (global.length > 0 || await Bun.file(GLOBAL_CONNECTIONS_FILE).exists()) {
      await Bun.$`mkdir -p ${join(homedir(), '.ultra')}`.quiet();
      await Bun.write(GLOBAL_CONNECTIONS_FILE, JSON.stringify({ connections: global }, null, 2));
    }

    // Save project connections
    if (this.workspaceRoot && (project.length > 0 || await Bun.file(join(this.workspaceRoot, PROJECT_CONNECTIONS_FILE)).exists())) {
      const projectFile = join(this.workspaceRoot, PROJECT_CONNECTIONS_FILE);
      await Bun.$`mkdir -p ${join(this.workspaceRoot, '.ultra')}`.quiet();
      await Bun.write(projectFile, JSON.stringify({ connections: project }, null, 2));
    }
  }
}

export const localDatabaseService = new LocalDatabaseService();
export default localDatabaseService;
