/**
 * Database Service ECP Adapter
 *
 * Maps ECP JSON-RPC methods to DatabaseService operations.
 */

import { debugLog } from '../../debug.ts';
import type { DatabaseService } from './interface.ts';
import type { ConnectionConfig, TransactionQuery } from './types.ts';

/**
 * Database Service ECP Adapter.
 */
export class DatabaseServiceAdapter {
  constructor(private service: DatabaseService) {}

  /**
   * Handle an ECP request.
   */
  async handleRequest(method: string, params: unknown): Promise<unknown> {
    const p = params as Record<string, unknown>;

    switch (method) {
      // Connection management
      case 'database/createConnection':
        return { connectionId: await this.service.createConnection(p.config as ConnectionConfig) };

      case 'database/connect':
        await this.service.connect(p.connectionId as string);
        return { success: true };

      case 'database/disconnect':
        await this.service.disconnect(p.connectionId as string);
        return { success: true };

      case 'database/deleteConnection':
        await this.service.deleteConnection(p.connectionId as string);
        return { success: true };

      case 'database/listConnections':
        return { connections: this.service.listConnections(p.scope as 'global' | 'project' | undefined) };

      case 'database/getConnection':
        return { connection: this.service.getConnection(p.connectionId as string) };

      case 'database/testConnection':
        return this.service.testConnection(p.config as ConnectionConfig);

      case 'database/updateConnection':
        await this.service.updateConnection(
          p.connectionId as string,
          p.config as Partial<ConnectionConfig>
        );
        return { success: true };

      // Query execution
      case 'database/query':
        return this.service.executeQuery(
          p.connectionId as string,
          p.sql as string,
          p.params as unknown[] | undefined
        );

      case 'database/transaction':
        return this.service.executeTransaction(
          p.connectionId as string,
          p.queries as TransactionQuery[]
        );

      case 'database/cancel':
        await this.service.cancelQuery(p.queryId as string);
        return { cancelled: true };

      case 'database/fetchRows':
        return this.service.fetchRows(
          p.queryId as string,
          p.offset as number,
          p.limit as number
        );

      // Schema browsing
      case 'database/listSchemas':
        return { schemas: await this.service.listSchemas(
          p.connectionId as string,
          p.includeSystem as boolean | undefined
        )};

      case 'database/listTables':
        return { tables: await this.service.listTables(
          p.connectionId as string,
          p.schema as string | undefined
        )};

      case 'database/describeTable':
        return this.service.describeTable(
          p.connectionId as string,
          p.schema as string,
          p.table as string
        );

      case 'database/getTableDDL':
        return { ddl: await this.service.getTableDDL(
          p.connectionId as string,
          p.schema as string,
          p.table as string
        )};

      // Query history
      case 'database/history':
        return { entries: await this.service.getQueryHistory(
          p.connectionId as string | undefined,
          p.limit as number | undefined,
          p.offset as number | undefined
        )};

      case 'database/searchHistory':
        return { entries: await this.service.searchHistory(
          p.query as string,
          p.connectionId as string | undefined
        )};

      case 'database/clearHistory':
        await this.service.clearHistory(p.connectionId as string | undefined);
        return { cleared: true };

      case 'database/favoriteQuery':
        await this.service.favoriteQuery(
          p.historyId as string,
          p.favorite as boolean
        );
        return { success: true };

      case 'database/getFavorites':
        return { entries: await this.service.getFavorites(
          p.connectionId as string | undefined
        )};

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  /**
   * Get list of methods this adapter handles.
   */
  getMethods(): string[] {
    return [
      // Connection management
      'database/createConnection',
      'database/connect',
      'database/disconnect',
      'database/deleteConnection',
      'database/listConnections',
      'database/getConnection',
      'database/testConnection',
      'database/updateConnection',

      // Query execution
      'database/query',
      'database/transaction',
      'database/cancel',
      'database/fetchRows',

      // Schema browsing
      'database/listSchemas',
      'database/listTables',
      'database/describeTable',
      'database/getTableDDL',

      // Query history
      'database/history',
      'database/searchHistory',
      'database/clearHistory',
      'database/favoriteQuery',
      'database/getFavorites',
    ];
  }
}
