/**
 * Database Service
 *
 * Provides database connectivity, query execution, and schema browsing.
 */

// Interface
export type { DatabaseService } from './interface.ts';

// Types
export type {
  SSLConfig,
  ConnectionConfig,
  ConnectionStatus,
  ConnectionInfo,
  ConnectionTestResult,
  FieldInfo,
  QueryResult,
  TransactionQuery,
  TransactionResult,
  SchemaInfo,
  TableType,
  TableInfo,
  ColumnInfo,
  PrimaryKeyInfo,
  ForeignKeyInfo,
  IndexInfo,
  FunctionInfo,
  TriggerInfo,
  PolicyInfo,
  TableDetails,
  QueryHistoryEntry,
  ConnectionChangeType,
  ConnectionChangeEvent,
  QueryEventType,
  QueryStartEvent,
  QueryCompleteEvent,
  ConnectionChangeCallback,
  QueryStartCallback,
  QueryCompleteCallback,
  Unsubscribe,
  DatabaseBackend,
} from './types.ts';

// Errors
export { DatabaseError, DatabaseErrorCode } from './errors.ts';

// Implementation
export { LocalDatabaseService, localDatabaseService } from './local.ts';

// Adapter
export { DatabaseServiceAdapter } from './adapter.ts';

// Backends
export { PostgresBackend } from './backends/postgres.ts';

// History
export { QueryHistoryManager, queryHistoryManager } from './history.ts';

// SQL Completion
export {
  SQLCompletionProvider,
  SQLCompletionKind,
  getSQLCompletionProvider,
  clearSQLCompletionProvider,
  type SQLCompletionItem,
} from './sql-completion.ts';

// SQL Utilities
export { parseTableInfoFromSql, type ParsedTableInfo } from './sql-utils.ts';

// Default export
export { localDatabaseService as default } from './local.ts';
