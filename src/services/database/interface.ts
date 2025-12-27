/**
 * Database Service Interface
 *
 * Defines the contract for database operations.
 */

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
  QueryHistoryEntry,
  ConnectionChangeCallback,
  QueryStartCallback,
  QueryCompleteCallback,
  Unsubscribe,
} from './types.ts';

/**
 * Database Service interface.
 *
 * Provides database connectivity, query execution, and schema browsing.
 * Supports multiple simultaneous connections with shared pooling.
 */
export interface DatabaseService {
  // ─────────────────────────────────────────────────────────────────────────
  // Connection Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a new connection configuration.
   * Does not establish the connection - call connect() to do that.
   * @returns The connection ID
   */
  createConnection(config: ConnectionConfig): Promise<string>;

  /**
   * Establish a connection.
   * Uses shared connection pool if same connection is already active.
   */
  connect(connectionId: string): Promise<void>;

  /**
   * Close a connection.
   * If other tabs are using the same connection, it remains open.
   */
  disconnect(connectionId: string): Promise<void>;

  /**
   * Delete a connection configuration.
   * Disconnects if currently connected.
   */
  deleteConnection(connectionId: string): Promise<void>;

  /**
   * Get connection information.
   */
  getConnection(connectionId: string): ConnectionInfo | null;

  /**
   * List all configured connections.
   * @param scope Optional filter by scope ('global' or 'project')
   */
  listConnections(scope?: 'global' | 'project'): ConnectionInfo[];

  /**
   * Test a connection without saving it.
   */
  testConnection(config: ConnectionConfig): Promise<ConnectionTestResult>;

  /**
   * Update a connection configuration.
   * Reconnects if the connection was active.
   */
  updateConnection(connectionId: string, config: Partial<ConnectionConfig>): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────
  // Query Execution
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Execute a SQL query.
   * @param connectionId Connection to use
   * @param sql SQL statement
   * @param params Query parameters (for parameterized queries)
   */
  executeQuery(connectionId: string, sql: string, params?: unknown[]): Promise<QueryResult>;

  /**
   * Execute multiple queries in a transaction.
   */
  executeTransaction(connectionId: string, queries: TransactionQuery[]): Promise<TransactionResult>;

  /**
   * Cancel a running query.
   */
  cancelQuery(queryId: string): Promise<void>;

  /**
   * Fetch additional rows for a paginated query.
   * @param queryId The query ID from the original result
   * @param offset Row offset
   * @param limit Number of rows to fetch
   */
  fetchRows(queryId: string, offset: number, limit: number): Promise<QueryResult>;

  // ─────────────────────────────────────────────────────────────────────────
  // Schema Browsing
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * List database schemas.
   * @param connectionId Connection to use
   * @param includeSystem Include system schemas (pg_catalog, information_schema)
   */
  listSchemas(connectionId: string, includeSystem?: boolean): Promise<SchemaInfo[]>;

  /**
   * List tables in a schema.
   * @param connectionId Connection to use
   * @param schema Schema name (default: 'public')
   */
  listTables(connectionId: string, schema?: string): Promise<TableInfo[]>;

  /**
   * Get detailed table information.
   */
  describeTable(connectionId: string, schema: string, table: string): Promise<TableDetails>;

  /**
   * Get the CREATE TABLE statement for a table.
   */
  getTableDDL(connectionId: string, schema: string, table: string): Promise<string>;

  // ─────────────────────────────────────────────────────────────────────────
  // Query History
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get query history.
   * @param connectionId Optional filter by connection
   * @param limit Maximum entries to return
   * @param offset Offset for pagination
   */
  getQueryHistory(connectionId?: string, limit?: number, offset?: number): Promise<QueryHistoryEntry[]>;

  /**
   * Search query history.
   */
  searchHistory(query: string, connectionId?: string): Promise<QueryHistoryEntry[]>;

  /**
   * Clear query history.
   * @param connectionId Optional filter to clear only specific connection's history
   */
  clearHistory(connectionId?: string): Promise<void>;

  /**
   * Mark a query as favorite.
   */
  favoriteQuery(historyId: string, favorite: boolean): Promise<void>;

  /**
   * Get favorite queries.
   */
  getFavorites(connectionId?: string): Promise<QueryHistoryEntry[]>;

  // ─────────────────────────────────────────────────────────────────────────
  // Events
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Subscribe to connection changes.
   */
  onConnectionChange(callback: ConnectionChangeCallback): Unsubscribe;

  /**
   * Subscribe to query start events.
   */
  onQueryStart(callback: QueryStartCallback): Unsubscribe;

  /**
   * Subscribe to query completion events.
   */
  onQueryComplete(callback: QueryCompleteCallback): Unsubscribe;

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Initialize the service.
   * Loads saved connections from config.
   */
  init(workspaceRoot?: string): Promise<void>;

  /**
   * Shutdown the service.
   * Closes all connections and saves state.
   */
  shutdown(): Promise<void>;

  /**
   * Get the current workspace root.
   */
  getWorkspaceRoot(): string | null;

  /**
   * Set the workspace root.
   * Loads project-specific connections.
   */
  setWorkspaceRoot(path: string): Promise<void>;
}
