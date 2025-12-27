# Database Service

The Database Service provides database connectivity, query execution, and schema browsing for Postgres/Supabase databases.

## Overview

This service enables Ultra to function as a database client, replacing most interactions with Supabase Studio or other database tools. It includes:

- Connection management (multiple simultaneous connections)
- Query execution with transaction support
- Schema browsing (tables, views, functions, triggers, indexes, RLS policies)
- Query history (git-backed)
- Integration with postgres_lsp for SQL intelligence
- Supabase-specific features (auth, RLS, edge functions)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           TUI LAYER                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐  │
│  │   SQL Editor    │  │  Query Results  │  │    Schema Browser       │  │
│  │  (postgres_lsp) │  │  (grid/json/txt)│  │  (tables/funcs/policies)│  │
│  └────────┬────────┘  └────────┬────────┘  └────────────┬────────────┘  │
└───────────┼────────────────────┼───────────────────────┼────────────────┘
            │                    │                       │
            └────────────────────┼───────────────────────┘
                                 │
                           ECP (JSON-RPC)
                                 │
┌────────────────────────────────┼────────────────────────────────────────┐
│                      DATABASE SERVICE                                    │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    DatabaseService                               │    │
│  │  - connections: Map<connectionId, DatabaseConnection>            │    │
│  │  - queryHistory: QueryHistoryManager                             │    │
│  │  - schemaCache: Map<connectionId, SchemaInfo>                    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                 │                                        │
│         ┌───────────────────────┼───────────────────────┐               │
│         ▼                       ▼                       ▼               │
│  ┌─────────────┐         ┌─────────────┐         ┌─────────────┐       │
│  │  Postgres   │         │  Supabase   │         │   Future    │       │
│  │  Backend    │         │  Backend    │         │  (MySQL?)   │       │
│  └──────┬──────┘         └──────┬──────┘         └─────────────┘       │
└─────────┼───────────────────────┼───────────────────────────────────────┘
          │                       │
          ▼                       ▼
    Direct Postgres          Supabase API
    (via pg/postgres.js)     + Management API
```

## Dependencies

### Required Services

| Service | Purpose |
|---------|---------|
| SecretService | Credential storage and retrieval (new service) |
| SessionService | Connection configs, settings |
| LSPService | postgres_lsp integration |
| GitService | Query history versioning |

### External Dependencies

```json
{
  "postgres": "^3.4.0",        // Postgres.js client
  "@supabase/supabase-js": "^2.x",  // Supabase client
}
```

### Language Server

- **postgres_lsp** from Supabase for SQL intelligence
- Connects to live database for schema-aware completions

---

## Phase 1: Foundation (MVP)

### Goals
- Connection management with secure credential storage
- Basic query execution with results display
- Query history
- Simple schema browsing

### New Services

#### 1. SecretService (Reusable)

```
src/services/secret/
├── interface.ts      # SecretService contract
├── types.ts          # SecretEntry, SecretProvider types
├── local.ts          # LocalSecretService (keychain integration)
├── env.ts            # EnvironmentSecretProvider (env vars)
├── adapter.ts        # ECP adapter
└── index.ts          # Exports
```

```typescript
// services/secret/interface.ts
interface SecretService {
  // Core operations
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: SecretOptions): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(prefix?: string): Promise<string[]>;
  has(key: string): Promise<boolean>;

  // Provider management
  addProvider(provider: SecretProvider, priority: number): void;
  removeProvider(providerId: string): void;

  // Events
  onSecretChange(callback: SecretChangeCallback): Unsubscribe;
}

interface SecretProvider {
  id: string;
  name: string;

  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(prefix?: string): Promise<string[]>;

  // Capability flags
  readonly isReadOnly: boolean;
  readonly supportsExpiry: boolean;
}

interface SecretOptions {
  expiresAt?: Date;
  description?: string;
  provider?: string;  // Force specific provider
}

// Built-in providers (priority order):
// 1. System Keychain (macOS Keychain, Linux Secret Service, Windows Credential Manager)
// 2. Environment Variables (read-only)
// 3. Encrypted file (~/.ultra/secrets.enc) - fallback
```

**ECP Methods:**
```typescript
"secret/get": { key: string } => { value: string | null }
"secret/set": { key: string, value: string, options?: SecretOptions } => { success: boolean }
"secret/delete": { key: string } => { deleted: boolean }
"secret/list": { prefix?: string } => { keys: string[] }
"secret/has": { key: string } => { exists: boolean }
```

#### 2. DatabaseService (Phase 1)

```
src/services/database/
├── interface.ts      # DatabaseService contract
├── types.ts          # Connection, Query, Result types
├── local.ts          # LocalDatabaseService
├── postgres.ts       # PostgresBackend
├── history.ts        # QueryHistoryManager
├── adapter.ts        # ECP adapter
└── index.ts          # Exports
```

```typescript
// services/database/interface.ts
interface DatabaseService {
  // Connection management
  createConnection(config: ConnectionConfig): Promise<string>;  // returns connectionId
  connect(connectionId: string): Promise<void>;
  disconnect(connectionId: string): Promise<void>;
  deleteConnection(connectionId: string): Promise<void>;
  getConnection(connectionId: string): ConnectionInfo | null;
  listConnections(): ConnectionInfo[];
  testConnection(config: ConnectionConfig): Promise<TestResult>;

  // Query execution
  executeQuery(connectionId: string, sql: string, params?: unknown[]): Promise<QueryResult>;
  executeTransaction(connectionId: string, queries: TransactionQuery[]): Promise<TransactionResult>;
  cancelQuery(queryId: string): Promise<void>;

  // Schema browsing (Phase 1 - basic)
  listSchemas(connectionId: string): Promise<SchemaInfo[]>;
  listTables(connectionId: string, schema?: string): Promise<TableInfo[]>;
  describeTable(connectionId: string, schema: string, table: string): Promise<TableDetails>;

  // Query history
  getQueryHistory(connectionId?: string, limit?: number): Promise<QueryHistoryEntry[]>;
  searchHistory(query: string): Promise<QueryHistoryEntry[]>;
  clearHistory(connectionId?: string): Promise<void>;

  // Events
  onConnectionChange(callback: ConnectionChangeCallback): Unsubscribe;
  onQueryStart(callback: QueryStartCallback): Unsubscribe;
  onQueryComplete(callback: QueryCompleteCallback): Unsubscribe;
}
```

### Types (Phase 1)

```typescript
// services/database/types.ts

interface ConnectionConfig {
  id?: string;  // Auto-generated if not provided
  name: string;
  type: 'postgres' | 'supabase';

  // Connection details
  host: string;
  port: number;
  database: string;

  // Credentials (reference to SecretService)
  username: string;
  passwordSecret: string;  // Key in SecretService, e.g., "db.myproject.password"

  // Or for Supabase
  supabaseUrl?: string;
  supabaseKeySecret?: string;  // Key in SecretService

  // Options
  ssl?: boolean | SSLConfig;
  connectionTimeout?: number;
  queryTimeout?: number;
  readOnly?: boolean;  // Safe mode - prevents mutations

  // Scope
  scope: 'global' | 'project';
  projectPath?: string;  // For project-scoped connections
}

interface ConnectionInfo {
  id: string;
  name: string;
  type: 'postgres' | 'supabase';
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  host: string;
  database: string;
  error?: string;
  readOnly: boolean;
  scope: 'global' | 'project';
}

interface QueryResult {
  queryId: string;
  connectionId: string;
  sql: string;

  // Result data
  rows: Record<string, unknown>[];
  fields: FieldInfo[];
  rowCount: number;

  // Timing
  startedAt: Date;
  completedAt: Date;
  durationMs: number;

  // For mutations
  affectedRows?: number;

  // Notices/warnings from Postgres
  notices?: string[];
}

interface FieldInfo {
  name: string;
  dataType: string;
  dataTypeId: number;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey?: boolean;
}

interface TableInfo {
  schema: string;
  name: string;
  type: 'table' | 'view' | 'materialized_view';
  rowCount?: number;  // Approximate from pg_stat
  sizeBytes?: number;
}

interface TableDetails {
  schema: string;
  name: string;
  type: 'table' | 'view' | 'materialized_view';

  columns: ColumnInfo[];
  primaryKey?: PrimaryKeyInfo;
  foreignKeys: ForeignKeyInfo[];
  indexes: IndexInfo[];

  // Approximate stats
  rowCount?: number;
  sizeBytes?: number;
}

interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  references?: { schema: string; table: string; column: string };
  comment?: string;
}

interface QueryHistoryEntry {
  id: string;
  connectionId: string;
  connectionName: string;
  sql: string;
  executedAt: Date;
  durationMs: number;
  rowCount: number;
  status: 'success' | 'error';
  error?: string;
}

interface TransactionQuery {
  sql: string;
  params?: unknown[];
  label?: string;  // For identifying in results
}

interface TransactionResult {
  success: boolean;
  results: (QueryResult | { error: string })[];
  committedAt?: Date;
  rolledBackAt?: Date;
  error?: string;
}
```

### ECP Methods (Phase 1)

```typescript
// Connection management
"database/createConnection": { config: ConnectionConfig } => { connectionId: string }
"database/connect": { connectionId: string } => { success: boolean }
"database/disconnect": { connectionId: string } => { success: boolean }
"database/deleteConnection": { connectionId: string } => { success: boolean }
"database/listConnections": {} => { connections: ConnectionInfo[] }
"database/testConnection": { config: ConnectionConfig } => { success: boolean, error?: string, latencyMs?: number }

// Query execution
"database/query": { connectionId: string, sql: string, params?: unknown[] } => QueryResult
"database/transaction": { connectionId: string, queries: TransactionQuery[] } => TransactionResult
"database/cancel": { queryId: string } => { cancelled: boolean }

// Schema browsing
"database/listSchemas": { connectionId: string } => { schemas: SchemaInfo[] }
"database/listTables": { connectionId: string, schema?: string } => { tables: TableInfo[] }
"database/describeTable": { connectionId: string, schema: string, table: string } => TableDetails

// Query history
"database/history": { connectionId?: string, limit?: number } => { entries: QueryHistoryEntry[] }
"database/searchHistory": { query: string } => { entries: QueryHistoryEntry[] }
"database/clearHistory": { connectionId?: string } => { cleared: number }

// Notifications
"database/connectionStatusChanged": { connectionId: string, status: string, error?: string }
"database/queryStarted": { queryId: string, connectionId: string, sql: string }
"database/queryCompleted": { queryId: string, result: QueryResult }
```

### TUI Components (Phase 1)

#### SQL Editor Element

```typescript
// clients/tui/elements/sql-editor.ts
class SQLEditor extends BaseElement {
  private connectionId: string | null = null;
  private documentId: string;  // Uses DocumentService for buffer

  // Integrates with postgres_lsp for completions
  // Renders SQL with syntax highlighting
  // Ctrl+Enter to execute query
  // Transaction controls (BEGIN/COMMIT/ROLLBACK buttons in status)
}
```

#### Query Results Element

```typescript
// clients/tui/elements/query-results.ts
class QueryResults extends BaseElement {
  private result: QueryResult | null = null;
  private viewMode: 'table' | 'json' | 'text' = 'table';

  // Table view: scrollable grid with column sorting
  // JSON view: formatted JSON for each row
  // Text view: psql-style output

  // Export functionality
  exportToCsv(): void;
  exportToJson(): void;
}
```

#### Connection Picker Overlay

```typescript
// clients/tui/overlays/connection-picker.ts
class ConnectionPicker extends SearchableDialog<ConnectionInfo> {
  // Shows available connections
  // Quick filter by name
  // Shows connection status
  // Option to create new connection
}
```

### Storage

#### Connection Configs

```
~/.ultra/connections.json          # Global connections
.ultra/connections.json            # Project connections (gitignored)
```

```typescript
// Connection config storage (credentials stored separately in SecretService)
{
  "connections": [
    {
      "id": "conn-abc123",
      "name": "Production DB",
      "type": "supabase",
      "host": "db.xyz.supabase.co",
      "port": 5432,
      "database": "postgres",
      "username": "postgres",
      "passwordSecret": "database.conn-abc123.password",
      "supabaseUrl": "https://xyz.supabase.co",
      "supabaseKeySecret": "database.conn-abc123.supabase-key",
      "ssl": true,
      "scope": "global"
    }
  ]
}
```

#### Query History (Git-backed)

```
~/.ultra/query-history/
├── .git/                          # Git repo for versioning
├── history.jsonl                  # Append-only query log
└── favorites.json                 # Saved/favorite queries
```

```typescript
// Each line in history.jsonl
{
  "id": "qry-xxx",
  "connectionId": "conn-abc123",
  "sql": "SELECT * FROM users WHERE...",
  "executedAt": "2025-01-15T10:30:00Z",
  "durationMs": 45,
  "rowCount": 100,
  "status": "success"
}
```

Git commits are made periodically (e.g., every 10 queries or on shutdown) to version history.

---

## Phase 2: Advanced Schema & Supabase

### Goals
- Full schema browsing (functions, triggers, indexes, views)
- RLS policy viewing and editing
- Supabase-specific features
- Function editing

### Additional Types

```typescript
interface FunctionInfo {
  schema: string;
  name: string;
  returnType: string;
  arguments: FunctionArgument[];
  language: 'sql' | 'plpgsql' | 'plv8' | 'other';
  volatility: 'immutable' | 'stable' | 'volatile';
  security: 'invoker' | 'definer';
  source?: string;  // Function body
}

interface TriggerInfo {
  schema: string;
  table: string;
  name: string;
  timing: 'before' | 'after' | 'instead_of';
  events: ('insert' | 'update' | 'delete' | 'truncate')[];
  forEach: 'row' | 'statement';
  function: string;
  condition?: string;
  enabled: boolean;
}

interface RLSPolicy {
  schema: string;
  table: string;
  name: string;
  command: 'all' | 'select' | 'insert' | 'update' | 'delete';
  roles: string[];
  using?: string;      // USING expression
  withCheck?: string;  // WITH CHECK expression
  permissive: boolean;
}

interface IndexInfo {
  schema: string;
  table: string;
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
  method: 'btree' | 'hash' | 'gin' | 'gist' | 'spgist' | 'brin';
  sizeBytes?: number;
}
```

### Additional ECP Methods (Phase 2)

```typescript
// Functions
"database/listFunctions": { connectionId: string, schema?: string } => { functions: FunctionInfo[] }
"database/getFunction": { connectionId: string, schema: string, name: string } => FunctionInfo
"database/createFunction": { connectionId: string, definition: string } => { success: boolean }
"database/updateFunction": { connectionId: string, schema: string, name: string, definition: string } => { success: boolean }
"database/dropFunction": { connectionId: string, schema: string, name: string, cascade?: boolean } => { success: boolean }

// Triggers
"database/listTriggers": { connectionId: string, schema?: string, table?: string } => { triggers: TriggerInfo[] }
"database/createTrigger": { connectionId: string, definition: string } => { success: boolean }
"database/dropTrigger": { connectionId: string, schema: string, table: string, name: string } => { success: boolean }
"database/enableTrigger": { connectionId: string, schema: string, table: string, name: string, enabled: boolean } => { success: boolean }

// RLS Policies
"database/listPolicies": { connectionId: string, schema?: string, table?: string } => { policies: RLSPolicy[] }
"database/getPolicy": { connectionId: string, schema: string, table: string, name: string } => RLSPolicy
"database/createPolicy": { connectionId: string, definition: string } => { success: boolean }
"database/updatePolicy": { connectionId: string, schema: string, table: string, name: string, definition: string } => { success: boolean }
"database/dropPolicy": { connectionId: string, schema: string, table: string, name: string } => { success: boolean }
"database/enableRLS": { connectionId: string, schema: string, table: string, enabled: boolean } => { success: boolean }

// Indexes
"database/listIndexes": { connectionId: string, schema?: string, table?: string } => { indexes: IndexInfo[] }
"database/createIndex": { connectionId: string, definition: string } => { success: boolean }
"database/dropIndex": { connectionId: string, schema: string, name: string, cascade?: boolean } => { success: boolean }

// Views
"database/listViews": { connectionId: string, schema?: string } => { views: ViewInfo[] }
"database/getViewDefinition": { connectionId: string, schema: string, name: string } => { definition: string }
```

### TUI Components (Phase 2)

#### Schema Browser Overlay

```typescript
// clients/tui/overlays/schema-browser.ts
class SchemaBrowser extends BaseDialog {
  // Tree view of database objects:
  // └── Database
  //     └── Schemas
  //         └── public
  //             ├── Tables
  //             │   ├── users
  //             │   └── posts
  //             ├── Views
  //             ├── Functions
  //             ├── Triggers
  //             └── RLS Policies

  // Actions on selection:
  // - Tables: View data, describe, show DDL
  // - Functions: Edit, show source
  // - Policies: Edit, enable/disable
}
```

#### Function Editor Element

```typescript
// clients/tui/elements/function-editor.ts
class FunctionEditor extends BaseElement {
  // Extended SQL editor for CREATE FUNCTION
  // Preview mode to see full function
  // Deploy button to update function
}
```

#### RLS Policy Editor

```typescript
// clients/tui/overlays/rls-policy-editor.ts
class RLSPolicyEditor extends BaseDialog {
  // Form for editing RLS policies
  // USING expression editor
  // WITH CHECK expression editor
  // Role selector
}
```

---

## Phase 3: Supabase Integration

### Goals
- Supabase auth integration
- Edge functions management
- Storage browser
- Realtime subscriptions

### Supabase-Specific Types

```typescript
interface SupabaseConnection extends ConnectionConfig {
  type: 'supabase';
  supabaseUrl: string;
  supabaseKeySecret: string;  // Service role key

  // Optional management API access
  managementKeySecret?: string;
}

interface SupabaseAuthUser {
  id: string;
  email?: string;
  phone?: string;
  createdAt: Date;
  lastSignIn?: Date;
  providers: string[];
  metadata: Record<string, unknown>;
}

interface EdgeFunction {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'inactive';
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

interface StorageBucket {
  id: string;
  name: string;
  public: boolean;
  fileSizeLimit?: number;
  allowedMimeTypes?: string[];
  createdAt: Date;
}

interface StorageObject {
  id: string;
  bucket: string;
  name: string;
  path: string;
  size: number;
  mimeType: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### Additional ECP Methods (Phase 3)

```typescript
// Supabase Auth
"supabase/listUsers": { connectionId: string, page?: number, perPage?: number } => { users: SupabaseAuthUser[], total: number }
"supabase/getUser": { connectionId: string, userId: string } => SupabaseAuthUser
"supabase/deleteUser": { connectionId: string, userId: string } => { success: boolean }
"supabase/inviteUser": { connectionId: string, email: string } => { success: boolean }

// Edge Functions
"supabase/listEdgeFunctions": { connectionId: string } => { functions: EdgeFunction[] }
"supabase/deployEdgeFunction": { connectionId: string, name: string, code: string } => { success: boolean, version: number }
"supabase/deleteEdgeFunction": { connectionId: string, name: string } => { success: boolean }
"supabase/invokeEdgeFunction": { connectionId: string, name: string, body?: unknown } => { response: unknown, status: number }

// Storage
"supabase/listBuckets": { connectionId: string } => { buckets: StorageBucket[] }
"supabase/createBucket": { connectionId: string, name: string, options?: BucketOptions } => { bucket: StorageBucket }
"supabase/deleteBucket": { connectionId: string, name: string } => { success: boolean }
"supabase/listObjects": { connectionId: string, bucket: string, path?: string } => { objects: StorageObject[] }
"supabase/uploadObject": { connectionId: string, bucket: string, path: string, content: string } => { object: StorageObject }
"supabase/deleteObject": { connectionId: string, bucket: string, path: string } => { success: boolean }
"supabase/getObjectUrl": { connectionId: string, bucket: string, path: string, expiresIn?: number } => { url: string }

// Realtime (subscriptions)
"supabase/subscribe": { connectionId: string, channel: string, event?: string } => { subscriptionId: string }
"supabase/unsubscribe": { subscriptionId: string } => { success: boolean }
// Notification: "supabase/realtimeEvent": { subscriptionId: string, event: unknown }
```

### TUI Components (Phase 3)

#### Auth Users Browser

```typescript
// clients/tui/overlays/supabase-users.ts
class SupabaseUsersBrowser extends SearchableDialog<SupabaseAuthUser> {
  // Paginated user list
  // Search by email/id
  // View user details
  // Delete user action
  // Invite user action
}
```

#### Storage Browser

```typescript
// clients/tui/overlays/storage-browser.ts
class StorageBrowser extends BaseDialog {
  // Bucket list
  // Object browser (folder navigation)
  // Upload/download actions
  // Generate signed URLs
}
```

#### Edge Function Editor

```typescript
// clients/tui/elements/edge-function-editor.ts
class EdgeFunctionEditor extends BaseElement {
  // TypeScript editor with Deno runtime hints
  // Deploy button
  // Test invocation panel
  // Logs viewer
}
```

---

## postgres_lsp Integration

The Supabase postgres_lsp provides SQL intelligence:

### Configuration

```typescript
// In settings
{
  "lsp.servers": {
    "sql": {
      "command": "postgres_lsp",
      "args": [],
      "initializationOptions": {
        "connectionString": "${secret:database.current.connection-string}"
      }
    }
  }
}
```

### Live Schema Integration

postgres_lsp needs database connection for schema-aware completions:

```typescript
class SQLEditor {
  private async updateLspConnection(connectionId: string): Promise<void> {
    const conn = this.databaseService.getConnection(connectionId);
    if (!conn) return;

    // Get connection string from secrets
    const password = await this.secretService.get(conn.passwordSecret);
    const connString = buildConnectionString(conn, password);

    // Update postgres_lsp configuration
    await this.lspService.sendNotification('workspace/didChangeConfiguration', {
      settings: {
        postgres_lsp: {
          connectionString: connString
        }
      }
    });
  }
}
```

### LSP Features Used

| Feature | Usage |
|---------|-------|
| textDocument/completion | Column names, table names, keywords |
| textDocument/hover | Column types, table info |
| textDocument/formatting | SQL formatting |
| textDocument/signatureHelp | Function signatures |
| textDocument/diagnostic | Syntax errors |

---

## Settings

```typescript
// In EditorSettings
interface DatabaseSettings {
  // General
  'database.defaultConnection'?: string;
  'database.queryTimeout': number;  // Default: 30000ms
  'database.maxRowsPreview': number;  // Default: 1000

  // History
  'database.history.maxEntries': number;  // Default: 10000
  'database.history.gitSync': boolean;  // Default: true

  // Display
  'database.results.defaultView': 'table' | 'json' | 'text';  // Default: 'table'
  'database.results.nullDisplay': string;  // Default: 'NULL'
  'database.results.truncateLength': number;  // Default: 100

  // Safety
  'database.confirmDestructive': boolean;  // Confirm DELETE/DROP etc. Default: true
  'database.defaultReadOnly': boolean;  // Default: false
}
```

---

## Implementation Phases Summary

### Phase 1: Foundation (MVP)
- [ ] Create SecretService with keychain + env var support
- [ ] Create DatabaseService interface
- [ ] Implement PostgresBackend using postgres.js
- [ ] Implement connection management
- [ ] Implement query execution
- [ ] Implement basic schema browsing (schemas, tables, columns)
- [ ] Implement query history with git versioning
- [ ] Create SQL Editor element
- [ ] Create Query Results element (table/json/text views)
- [ ] Create Connection Picker overlay
- [ ] Integrate postgres_lsp
- [ ] Add export to CSV/JSON

### Phase 2: Advanced Schema & Supabase Basics
- [ ] Functions browsing and editing
- [ ] Triggers management
- [ ] Indexes browsing
- [ ] Views browsing
- [ ] RLS policy viewing and editing
- [ ] Schema Browser overlay (tree view)
- [ ] Function Editor element

### Phase 3: Full Supabase Integration
- [ ] SupabaseBackend using Supabase APIs
- [ ] Auth user management
- [ ] Edge functions deployment
- [ ] Storage browser
- [ ] Realtime subscriptions

---

## File Structure

```
src/services/
├── secret/
│   ├── interface.ts
│   ├── types.ts
│   ├── local.ts              # Multi-provider implementation
│   ├── providers/
│   │   ├── keychain.ts       # System keychain (macOS/Linux/Windows)
│   │   ├── env.ts            # Environment variables
│   │   └── encrypted-file.ts # Fallback encrypted storage
│   ├── adapter.ts
│   └── index.ts
│
├── database/
│   ├── interface.ts
│   ├── types.ts
│   ├── local.ts              # LocalDatabaseService
│   ├── backends/
│   │   ├── postgres.ts       # Direct Postgres backend
│   │   └── supabase.ts       # Supabase backend (Phase 3)
│   ├── history.ts            # QueryHistoryManager
│   ├── adapter.ts
│   └── index.ts

src/clients/tui/
├── elements/
│   ├── sql-editor.ts         # SQL query editor
│   ├── query-results.ts      # Results display
│   └── function-editor.ts    # Function editing (Phase 2)
│
├── overlays/
│   ├── connection-picker.ts  # Connection selection
│   ├── schema-browser.ts     # Database object browser (Phase 2)
│   ├── rls-policy-editor.ts  # RLS policy editing (Phase 2)
│   ├── supabase-users.ts     # Auth users (Phase 3)
│   └── storage-browser.ts    # Storage files (Phase 3)
```

---

## Security Considerations

1. **Credential Storage**
   - Never store passwords in plain text config files
   - Use system keychain as primary storage
   - Environment variables for CI/CD scenarios
   - Encrypted file as last resort fallback

2. **Connection Strings**
   - Never log connection strings with passwords
   - Mask passwords in debug output
   - Clear credentials from memory when not needed

3. **Query Execution**
   - Optional read-only mode per connection
   - Confirmation dialogs for destructive operations
   - Query timeout to prevent runaway queries

4. **Project-Scoped Connections**
   - Store in `.ultra/connections.json` (gitignored by default)
   - Warn if attempting to commit connection files

---

## Testing Strategy

### Unit Tests
- SecretService providers (mock keychain)
- Connection config parsing
- Query result parsing
- History management

### Integration Tests
```typescript
// Test with real Postgres (Docker)
describe('DatabaseService', () => {
  let client: TestECPClient;
  let containerId: string;

  beforeAll(async () => {
    containerId = await startPostgresContainer();
    client = new TestECPClient();
  });

  test('connect and query', async () => {
    const { connectionId } = await client.request('database/createConnection', {
      name: 'Test',
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      database: 'test',
      username: 'postgres',
      passwordSecret: 'test-password'
    });

    await client.request('database/connect', { connectionId });

    const result = await client.request('database/query', {
      connectionId,
      sql: 'SELECT 1 + 1 AS sum'
    });

    expect(result.rows[0].sum).toBe(2);
  });
});
```

---

## Design Decisions

| Question | Decision | Notes |
|----------|----------|-------|
| Query result streaming | **Paginate** (stream later) | Reusable pagination for other document types. Streaming added to BACKLOG.md |
| Connection pooling | **Shared pool** | Multiple tabs using same connection share a pool |
| Offline schema cache | **Yes, in config folder** | Cache in `~/.ultra/database/` for offline completions |
| Migration tools | **Drizzle (Phase 4)** | SQL-first, TypeScript-native, good Supabase support |

---

## Config Folder Structure

Database-related configuration and caches are stored in `~/.ultra/database/`:

```
~/.ultra/
├── settings.jsonc              # Global settings (includes database.* keys)
├── connections.json            # Global database connections
├── secrets.enc                 # Encrypted secrets (fallback if no keychain)
│
├── database/
│   ├── schema-cache/           # Cached schemas for offline LSP completions
│   │   ├── conn-abc123.json    # Schema cache per connection
│   │   └── conn-def456.json
│   │
│   └── query-history/          # Git-backed query history
│       ├── .git/
│       ├── history.jsonl       # Append-only query log
│       └── favorites.json      # Saved/starred queries
│
└── new-tui/
    └── sessions/               # Session files (existing)
```

### Project-Scoped Storage

```
<project>/
└── .ultra/
    ├── connections.json        # Project-specific connections (gitignored)
    └── database/
        └── schema-cache/       # Project-specific schema cache
```

---

## Pagination Component (Reusable)

The pagination system will be designed as a reusable component for any large data display:

```typescript
// src/clients/tui/components/paginator.ts
interface PaginatorConfig<T> {
  pageSize: number;
  totalItems: number;
  fetchPage: (offset: number, limit: number) => Promise<T[]>;
}

interface PaginatorState {
  currentPage: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

class Paginator<T> {
  // Navigation
  nextPage(): Promise<T[]>;
  prevPage(): Promise<T[]>;
  goToPage(page: number): Promise<T[]>;

  // State
  getState(): PaginatorState;

  // Events
  onPageChange(callback: (state: PaginatorState) => void): Unsubscribe;
}
```

**Usage in Query Results:**
```typescript
const paginator = new Paginator<Record<string, unknown>>({
  pageSize: settings.get('database.results.pageSize') ?? 100,
  totalItems: result.totalRows,
  fetchPage: (offset, limit) => databaseService.fetchRows(queryId, offset, limit)
});
```

**Reusable for:**
- Query results
- Log viewers
- Large file previews
- Search results
- Git history

---

## Phase 4: Migrations (Future)

Integration with **Drizzle ORM** for schema migrations.

### Why Drizzle over Prisma

| Factor | Drizzle | Prisma |
|--------|---------|--------|
| SQL-first | Yes - SQL syntax in TypeScript | No - custom DSL |
| Type inference | From schema, no generation step | Requires `prisma generate` |
| Bundle size | ~50KB | ~2MB+ |
| Supabase | First-class support | Supported but heavier |
| Learning curve | Low (just SQL) | Medium (Prisma schema) |

### Drizzle Integration Scope

```typescript
// ECP Methods (Phase 4)
"database/migrations/list": { connectionId: string } => { migrations: MigrationInfo[] }
"database/migrations/status": { connectionId: string } => { pending: string[], applied: string[] }
"database/migrations/run": { connectionId: string, target?: string } => { applied: string[] }
"database/migrations/rollback": { connectionId: string, steps?: number } => { reverted: string[] }
"database/migrations/generate": { connectionId: string, name: string } => { path: string }

// TUI Component
// Migration Manager overlay showing:
// - List of migrations (applied/pending status)
// - Run/rollback buttons
// - Generate new migration
// - View migration SQL
```

---

## Open Questions (Remaining)

1. **Prepared statements**: Should we expose prepared statement APIs for performance?
2. **Query result caching**: Cache recent query results for quick re-display?
3. **Explain/analyze**: Built-in EXPLAIN ANALYZE visualization?
