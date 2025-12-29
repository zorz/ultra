/**
 * Database Service Types
 *
 * Type definitions for database operations.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Connection Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SSL configuration for database connections.
 */
export interface SSLConfig {
  /** Reject unauthorized certificates */
  rejectUnauthorized?: boolean;
  /** CA certificate path or content */
  ca?: string;
  /** Client certificate path or content */
  cert?: string;
  /** Client key path or content */
  key?: string;
}

/**
 * Database connection configuration.
 */
export interface ConnectionConfig {
  /** Connection ID (auto-generated if not provided) */
  id?: string;
  /** Human-readable connection name */
  name: string;
  /** Database type */
  type: 'postgres' | 'supabase';

  // Connection details
  /** Database host */
  host: string;
  /** Database port */
  port: number;
  /** Database name */
  database: string;

  // Credentials (references to SecretService keys)
  /** Database username */
  username: string;
  /** Secret key for password in SecretService (optional for passwordless connections) */
  passwordSecret?: string;

  // Supabase-specific
  /** Supabase project URL */
  supabaseUrl?: string;
  /** Secret key for Supabase API key in SecretService */
  supabaseKeySecret?: string;

  // Connection options
  /** SSL configuration (true for default SSL, object for custom) */
  ssl?: boolean | SSLConfig;
  /** Connection timeout in milliseconds */
  connectionTimeout?: number;
  /** Query timeout in milliseconds */
  queryTimeout?: number;
  /** Read-only mode (prevents mutations) */
  readOnly?: boolean;

  // Scope
  /** Whether this is a global or project-specific connection */
  scope: 'global' | 'project';
  /** Project path for project-scoped connections */
  projectPath?: string;
}

/**
 * Connection status.
 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Connection information (runtime state).
 */
export interface ConnectionInfo {
  /** Connection ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Database type */
  type: 'postgres' | 'supabase';
  /** Current connection status */
  status: ConnectionStatus;
  /** Database host */
  host: string;
  /** Database name */
  database: string;
  /** Error message if status is 'error' */
  error?: string;
  /** Whether read-only mode is enabled */
  readOnly: boolean;
  /** Connection scope */
  scope: 'global' | 'project';
  /** When the connection was established */
  connectedAt?: Date;
}

/**
 * Connection test result.
 */
export interface ConnectionTestResult {
  /** Whether the test succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Connection latency in milliseconds */
  latencyMs?: number;
  /** Server version string */
  serverVersion?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Query Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Field/column information from query result.
 */
export interface FieldInfo {
  /** Column name */
  name: string;
  /** Data type name (e.g., "integer", "text", "jsonb") */
  dataType: string;
  /** PostgreSQL data type OID */
  dataTypeId: number;
  /** Whether the column is nullable */
  nullable: boolean;
  /** Default value expression */
  defaultValue?: string;
  /** Whether this is a primary key column */
  isPrimaryKey?: boolean;
}

/**
 * Query execution result.
 */
export interface QueryResult {
  /** Unique query ID */
  queryId: string;
  /** Connection ID used for this query */
  connectionId: string;
  /** The SQL that was executed */
  sql: string;

  // Result data
  /** Result rows */
  rows: Record<string, unknown>[];
  /** Field definitions */
  fields: FieldInfo[];
  /** Number of rows returned */
  rowCount: number;
  /** Total rows available (for paginated queries) */
  totalRows?: number;

  // Timing
  /** When query started */
  startedAt: Date;
  /** When query completed */
  completedAt: Date;
  /** Query duration in milliseconds */
  durationMs: number;

  // For mutations
  /** Number of rows affected by INSERT/UPDATE/DELETE */
  affectedRows?: number;

  // Notices/warnings
  /** PostgreSQL NOTICE messages */
  notices?: string[];
}

/**
 * A single query in a transaction.
 */
export interface TransactionQuery {
  /** SQL statement */
  sql: string;
  /** Query parameters */
  params?: unknown[];
  /** Label for identifying in results */
  label?: string;
}

/**
 * Transaction execution result.
 */
export interface TransactionResult {
  /** Whether the transaction succeeded */
  success: boolean;
  /** Results for each query in the transaction */
  results: Array<QueryResult | { error: string; label?: string }>;
  /** When the transaction was committed */
  committedAt?: Date;
  /** When the transaction was rolled back */
  rolledBackAt?: Date;
  /** Error message if failed */
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Database schema information.
 */
export interface SchemaInfo {
  /** Schema name */
  name: string;
  /** Whether this is a system schema */
  isSystem: boolean;
  /** Schema owner */
  owner?: string;
}

/**
 * Table type.
 */
export type TableType = 'table' | 'view' | 'materialized_view' | 'foreign_table';

/**
 * Basic table information.
 */
export interface TableInfo {
  /** Schema name */
  schema: string;
  /** Table name */
  name: string;
  /** Table type */
  type: TableType;
  /** Approximate row count (from pg_stat) */
  rowCount?: number;
  /** Table size in bytes */
  sizeBytes?: number;
  /** Table comment/description */
  comment?: string;
}

/**
 * Column information.
 */
export interface ColumnInfo {
  /** Column name */
  name: string;
  /** Data type */
  dataType: string;
  /** Whether nullable */
  nullable: boolean;
  /** Default value expression */
  defaultValue?: string;
  /** Whether this is a primary key column */
  isPrimaryKey: boolean;
  /** Whether this is a foreign key column */
  isForeignKey: boolean;
  /** Foreign key reference */
  references?: {
    schema: string;
    table: string;
    column: string;
  };
  /** Column position (1-based) */
  position: number;
  /** Column comment */
  comment?: string;
}

/**
 * Primary key information.
 */
export interface PrimaryKeyInfo {
  /** Constraint name */
  name: string;
  /** Columns in the primary key */
  columns: string[];
}

/**
 * Foreign key information.
 */
export interface ForeignKeyInfo {
  /** Constraint name */
  name: string;
  /** Local columns */
  columns: string[];
  /** Referenced schema */
  referencedSchema: string;
  /** Referenced table */
  referencedTable: string;
  /** Referenced columns */
  referencedColumns: string[];
  /** ON UPDATE action */
  onUpdate: 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION';
  /** ON DELETE action */
  onDelete: 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION';
}

/**
 * Index information.
 */
export interface IndexInfo {
  /** Schema name */
  schema: string;
  /** Table name */
  table: string;
  /** Index name */
  name: string;
  /** Indexed columns */
  columns: string[];
  /** Whether index enforces uniqueness */
  isUnique: boolean;
  /** Whether this is the primary key index */
  isPrimary: boolean;
  /** Index method */
  method: 'btree' | 'hash' | 'gin' | 'gist' | 'spgist' | 'brin';
  /** Index size in bytes */
  sizeBytes?: number;
  /** Index definition */
  definition?: string;
}

/**
 * Function/procedure information.
 */
export interface FunctionInfo {
  /** Schema name */
  schema: string;
  /** Function name */
  name: string;
  /** Function kind: f=function, p=procedure, a=aggregate, w=window */
  kind: 'function' | 'procedure' | 'aggregate' | 'window';
  /** Return type */
  returnType: string;
  /** Argument types as string */
  arguments: string;
  /** Language (plpgsql, sql, etc) */
  language: string;
  /** Whether it's a security definer */
  securityDefiner: boolean;
  /** Volatility: immutable, stable, volatile */
  volatility: 'immutable' | 'stable' | 'volatile';
  /** Function comment */
  comment?: string;
  /** Full function definition (source) */
  definition?: string;
}

/**
 * Trigger information.
 */
export interface TriggerInfo {
  /** Schema containing the trigger */
  schema: string;
  /** Table the trigger is on */
  table: string;
  /** Trigger name */
  name: string;
  /** When: BEFORE, AFTER, INSTEAD OF */
  timing: 'BEFORE' | 'AFTER' | 'INSTEAD OF';
  /** Events: INSERT, UPDATE, DELETE, TRUNCATE */
  events: string[];
  /** Row or statement level */
  level: 'ROW' | 'STATEMENT';
  /** Function called by trigger */
  functionName: string;
  /** Whether trigger is enabled */
  enabled: boolean;
  /** Full trigger definition */
  definition?: string;
}

/**
 * Row Level Security policy information.
 */
export interface PolicyInfo {
  /** Schema name */
  schema: string;
  /** Table name */
  table: string;
  /** Policy name */
  name: string;
  /** Policy command: ALL, SELECT, INSERT, UPDATE, DELETE */
  command: 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  /** Permissive or restrictive */
  type: 'PERMISSIVE' | 'RESTRICTIVE';
  /** Roles the policy applies to */
  roles: string[];
  /** USING expression */
  usingExpr?: string;
  /** WITH CHECK expression */
  checkExpr?: string;
}

/**
 * Detailed table information.
 */
export interface TableDetails {
  /** Schema name */
  schema: string;
  /** Table name */
  name: string;
  /** Table type */
  type: TableType;

  /** Column definitions */
  columns: ColumnInfo[];
  /** Primary key info */
  primaryKey?: PrimaryKeyInfo;
  /** Foreign keys */
  foreignKeys: ForeignKeyInfo[];
  /** Indexes */
  indexes: IndexInfo[];

  // Stats
  /** Approximate row count */
  rowCount?: number;
  /** Table size in bytes */
  sizeBytes?: number;
  /** Table comment */
  comment?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Query History Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Query history entry.
 */
export interface QueryHistoryEntry {
  /** Unique entry ID */
  id: string;
  /** Connection ID used */
  connectionId: string;
  /** Connection name at time of execution */
  connectionName: string;
  /** SQL statement */
  sql: string;
  /** When executed */
  executedAt: Date;
  /** Query duration in milliseconds */
  durationMs: number;
  /** Number of rows returned/affected */
  rowCount: number;
  /** Execution status */
  status: 'success' | 'error';
  /** Error message if failed */
  error?: string;
  /** Whether this is a favorite */
  isFavorite?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Connection change event types.
 */
export type ConnectionChangeType = 'created' | 'updated' | 'deleted' | 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * Connection change event.
 */
export interface ConnectionChangeEvent {
  /** Connection ID */
  connectionId: string;
  /** Type of change */
  type: ConnectionChangeType;
  /** New connection info (if applicable) */
  connection?: ConnectionInfo;
  /** Error message (if type is 'error') */
  error?: string;
}

/**
 * Query lifecycle event types.
 */
export type QueryEventType = 'started' | 'completed' | 'error' | 'cancelled';

/**
 * Query start event.
 */
export interface QueryStartEvent {
  /** Query ID */
  queryId: string;
  /** Connection ID */
  connectionId: string;
  /** SQL being executed */
  sql: string;
  /** When query started */
  startedAt: Date;
}

/**
 * Query complete event.
 */
export interface QueryCompleteEvent {
  /** Query ID */
  queryId: string;
  /** Query result */
  result: QueryResult;
}

/**
 * Callback types.
 */
export type ConnectionChangeCallback = (event: ConnectionChangeEvent) => void;
export type QueryStartCallback = (event: QueryStartEvent) => void;
export type QueryCompleteCallback = (event: QueryCompleteEvent) => void;

/**
 * Unsubscribe function.
 */
export type Unsubscribe = () => void;

// ─────────────────────────────────────────────────────────────────────────────
// Backend Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Database backend interface.
 *
 * Backends implement the actual database communication.
 */
export interface DatabaseBackend {
  /** Backend type identifier */
  readonly type: 'postgres' | 'supabase';

  /**
   * Connect to the database.
   */
  connect(config: ConnectionConfig, password: string): Promise<void>;

  /**
   * Disconnect from the database.
   */
  disconnect(): Promise<void>;

  /**
   * Check if connected.
   */
  isConnected(): boolean;

  /**
   * Execute a query.
   */
  query(sql: string, params?: unknown[]): Promise<QueryResult>;

  /**
   * Execute a transaction.
   */
  transaction(queries: TransactionQuery[]): Promise<TransactionResult>;

  /**
   * Cancel a running query.
   */
  cancelQuery(queryId: string): Promise<void>;

  /**
   * Test the connection.
   */
  testConnection(): Promise<ConnectionTestResult>;

  /**
   * Get server version.
   */
  getServerVersion(): Promise<string>;
}
