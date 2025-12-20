# LSP Service

The LSP Service provides Language Server Protocol integration for code intelligence features.

## Current State

### Location
- `src/features/lsp/client.ts` - LSP client (JSON-RPC communication)
- `src/features/lsp/manager.ts` - Multi-language server manager
- `src/features/lsp/providers.ts` - Placeholder providers (unused)
- `src/features/lsp/autocomplete-popup.ts` - Autocomplete UI
- `src/features/lsp/hover-tooltip.ts` - Hover UI
- `src/features/lsp/signature-help.ts` - Signature help UI
- `src/features/lsp/diagnostics-renderer.ts` - Diagnostics UI

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        LSPManager                                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  clients: Map<languageId, LSPClient>                      │  │
│  │  documentVersions: Map<uri, version>                      │  │
│  │  diagnosticsStore: Map<uri, LSPDiagnostic[]>              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│         ┌────────────────────┼────────────────────┐              │
│         ▼                    ▼                    ▼              │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐      │
│  │ LSPClient   │      │ LSPClient   │      │ LSPClient   │      │
│  │ (typescript)│      │ (rust)      │      │ (python)    │      │
│  └──────┬──────┘      └──────┬──────┘      └──────┬──────┘      │
└─────────┼────────────────────┼────────────────────┼─────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
    typescript-            rust-                pylsp
    language-server        analyzer
```

### LSPClient (`client.ts`)

```typescript
class LSPClient {
  // Factory
  static async create(command: string, args: string[], workspaceRoot: string): Promise<LSPClient | null>

  // Lifecycle
  async start(): Promise<boolean>
  async shutdown(): Promise<void>
  isInitialized(): boolean
  getCapabilities(): Record<string, unknown>

  // Document sync
  didOpen(uri: string, languageId: string, version: number, text: string): void
  didChange(uri: string, version: number, text: string): void
  didSave(uri: string, text?: string): void
  didClose(uri: string): void

  // Features
  async getCompletions(uri: string, position: Position): Promise<LSPCompletionItem[]>
  async getHover(uri: string, position: Position): Promise<LSPHover | null>
  async getSignatureHelp(uri: string, position: Position): Promise<LSPSignatureHelp | null>
  async getDocumentSymbols(uri: string): Promise<LSPDocumentSymbol[] | LSPSymbolInformation[]>
  async getDefinition(uri: string, position: Position): Promise<LSPLocation | LSPLocation[] | null>
  async getReferences(uri: string, position: Position, includeDeclaration?: boolean): Promise<LSPLocation[]>
  async rename(uri: string, position: Position, newName: string): Promise<WorkspaceEdit | null>

  // Notifications
  onNotification(handler: NotificationHandler): void
}
```

**Protocol Details:**
- JSON-RPC 2.0 over stdio
- Content-Length headers for message framing
- 30-second request timeout
- Binary-safe buffering with Uint8Array

### LSPManager (`manager.ts`)

```typescript
class LSPManager {
  // Configuration
  setWorkspaceRoot(root: string): void
  setDebugEnabled(enabled: boolean): void
  setEnabled(enabled: boolean): void

  // Document lifecycle
  async documentOpened(filePath: string, content: string): Promise<void>
  async documentChanged(filePath: string, content: string): Promise<void>
  async documentSaved(filePath: string, content?: string): Promise<void>
  async documentClosed(filePath: string): Promise<void>

  // Features
  async getCompletions(filePath: string, line: number, character: number): Promise<LSPCompletionItem[]>
  async getHover(filePath: string, line: number, character: number): Promise<LSPHover | null>
  async getSignatureHelp(filePath: string, line: number, character: number): Promise<LSPSignatureHelp | null>
  async getDefinition(filePath: string, line: number, character: number): Promise<LSPLocation | LSPLocation[] | null>
  async getReferences(filePath: string, line: number, character: number): Promise<LSPLocation[]>
  async rename(filePath: string, line: number, character: number, newName: string): Promise<WorkspaceEdit | null>
  async getDocumentSymbols(filePath: string): Promise<LSPDocumentSymbol[] | LSPSymbolInformation[]>

  // Diagnostics
  onDiagnostics(callback: DiagnosticsCallback): void
  getDiagnostics(uri: string): LSPDiagnostic[]
  getAllDiagnostics(): Map<string, LSPDiagnostic[]>
  getDiagnosticsSummary(): { errors: number, warnings: number }

  // Lifecycle
  async shutdown(): Promise<void>
  async shutdownLanguage(languageId: string): Promise<void>
}
```

### Supported Languages

| Language | Server Command | Extensions |
|----------|----------------|------------|
| TypeScript/JavaScript | `typescript-language-server` | .ts, .tsx, .js, .jsx |
| Rust | `rust-analyzer` | .rs |
| Python | `pylsp` | .py |
| Go | `gopls` | .go |
| Ruby | `solargraph` | .rb |
| C/C++ | `clangd` | .c, .cpp, .h |
| JSON | `vscode-json-language-server` | .json |
| HTML | `vscode-html-language-server` | .html |
| CSS | `vscode-css-language-server` | .css, .scss |

### Current Issues

| Issue | Location | Description |
|-------|----------|-------------|
| Console.error usage | client.ts:313,385,447 | Uses console.error instead of debugLog |
| No custom servers | manager.ts:193-196 | User can't configure custom servers |
| No incremental sync | client.ts:626-630 | Always sends full document, not deltas |
| No capability checking | Various | Requests features server might not support |
| Silent failures | Various | Catch blocks swallow errors |
| URI encoding | Various | No proper encoding for special chars |
| Memory leaks | client.ts | Request timeouts may fire after shutdown |
| No reconnection | N/A | Dead servers stay dead |
| Placeholder providers | providers.ts | 4 stub classes never used |

---

## Target State

### ECP Interface

```typescript
// Server lifecycle
"lsp/start": { languageId: string, workspaceUri: string } => { success: boolean, capabilities: object }
"lsp/stop": { languageId: string } => { success: boolean }
"lsp/status": { languageId?: string } => { servers: ServerStatus[] }

// Document sync (passthrough to appropriate server)
"lsp/documentOpen": { uri: string, languageId: string, content: string } => { success: boolean }
"lsp/documentChange": { uri: string, content: string } => { success: boolean }
"lsp/documentSave": { uri: string, content?: string } => { success: boolean }
"lsp/documentClose": { uri: string } => { success: boolean }

// Code intelligence (passthrough)
"lsp/completion": { uri: string, position: Position } => { items: CompletionItem[] }
"lsp/hover": { uri: string, position: Position } => { contents: string | MarkupContent, range?: Range }
"lsp/signatureHelp": { uri: string, position: Position } => SignatureHelp
"lsp/definition": { uri: string, position: Position } => { locations: Location[] }
"lsp/references": { uri: string, position: Position, includeDeclaration?: boolean } => { locations: Location[] }
"lsp/documentSymbol": { uri: string } => { symbols: DocumentSymbol[] | SymbolInformation[] }
"lsp/rename": { uri: string, position: Position, newName: string } => { edit: WorkspaceEdit }

// Workspace features
"lsp/workspaceSymbol": { query: string } => { symbols: SymbolInformation[] }

// Diagnostics
"lsp/diagnostics": { uri: string } => { diagnostics: Diagnostic[] }
"lsp/allDiagnostics": {} => { diagnostics: Map<string, Diagnostic[]> }

// Notifications
"lsp/didPublishDiagnostics": { uri: string, diagnostics: Diagnostic[] }
```

### Service Architecture

```typescript
// services/lsp/interface.ts
interface LSPService {
  // Server lifecycle
  startServer(languageId: string, workspaceUri: string): Promise<ServerInfo>
  stopServer(languageId: string): Promise<void>
  getServerStatus(languageId?: string): ServerStatus[]

  // Document sync
  documentOpened(uri: string, languageId: string, content: string): Promise<void>
  documentChanged(uri: string, content: string, version: number): Promise<void>
  documentSaved(uri: string, content?: string): Promise<void>
  documentClosed(uri: string): Promise<void>

  // Code intelligence
  getCompletions(uri: string, position: Position): Promise<CompletionItem[]>
  getHover(uri: string, position: Position): Promise<Hover | null>
  getSignatureHelp(uri: string, position: Position): Promise<SignatureHelp | null>
  getDefinition(uri: string, position: Position): Promise<Location[]>
  getReferences(uri: string, position: Position, includeDeclaration?: boolean): Promise<Location[]>
  getDocumentSymbols(uri: string): Promise<DocumentSymbol[] | SymbolInformation[]>
  rename(uri: string, position: Position, newName: string): Promise<WorkspaceEdit>

  // Diagnostics
  getDiagnostics(uri: string): Diagnostic[]
  onDiagnostics(callback: DiagnosticsCallback): Unsubscribe

  // Configuration
  setServerConfig(languageId: string, config: ServerConfig): void
  getServerConfig(languageId: string): ServerConfig | null

  // Events
  onServerStatusChange(callback: ServerStatusCallback): Unsubscribe
}

interface ServerConfig {
  command: string;
  args: string[];
  initializationOptions?: object;
  settings?: object;
}

interface ServerStatus {
  languageId: string;
  status: 'starting' | 'ready' | 'error' | 'stopped';
  capabilities?: object;
  error?: string;
}
```

### Custom Server Configuration

```typescript
// In settings
{
  "lsp.servers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "initializationOptions": {
        "preferences": {
          "quotePreference": "single"
        }
      }
    },
    "custom-lang": {
      "command": "/path/to/custom-server",
      "args": ["--mode", "lsp"]
    }
  }
}
```

### Incremental Sync Support

```typescript
// When server supports textDocument/didChange with incremental sync
interface TextDocumentContentChangeEvent {
  range: Range;
  rangeLength: number;
  text: string;
}

// Track document state for computing deltas
class DocumentState {
  uri: string;
  version: number;
  content: string;

  computeChanges(newContent: string): TextDocumentContentChangeEvent[] {
    // Compute minimal diff between old and new content
    // Return array of change events
  }
}
```

---

## Migration Steps

### Phase 1: Interface Extraction

1. **Create LSPService interface**
   - All current public methods
   - Add server configuration
   - Add event types

2. **Refactor LSPClient**
   - Fix console.error usage
   - Add capability checking
   - Add reconnection logic

3. **Refactor LSPManager to implement interface**
   - Keep current implementation
   - Add custom server support
   - Add proper error handling

### Phase 2: Improvements

1. **Add custom server configuration**
   - Read from settings.json
   - Validate server configs
   - Fall back to defaults

2. **Add incremental sync**
   - Track document state
   - Compute deltas
   - Use when server supports it

3. **Add capability checking**
   - Check server capabilities before requests
   - Return appropriate errors

### Phase 3: ECP Adapter

1. **Create LSPServiceAdapter**
   - Map JSON-RPC methods
   - Handle passthrough to appropriate server
   - Emit diagnostic notifications

### Migration Checklist

```markdown
- [ ] Create services/lsp/ directory
- [ ] Define LSPService interface
- [ ] Refactor LSPClient (fix console.error, add reconnection)
- [ ] Refactor LSPManager to implement interface
- [ ] Add custom server configuration support
- [ ] Add server capability checking
- [ ] Add incremental document sync
- [ ] Remove placeholder providers.ts
- [ ] Create LSPServiceAdapter for ECP
- [ ] Add tests
- [ ] Update app.ts to use service
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/features/lsp/client.ts` | Fix console.error, add reconnection |
| `src/features/lsp/manager.ts` | Implement interface, add custom servers |
| `src/features/lsp/providers.ts` | Delete (unused) |
| `src/app.ts` | Use LSPService |

### New Files to Create

```
src/services/lsp/
├── interface.ts      # LSPService interface
├── types.ts          # ServerConfig, ServerStatus, etc.
├── client.ts         # LSPClient (from features/lsp/client.ts)
├── manager.ts        # LSPManager implementing interface
├── adapter.ts        # ECP adapter
└── index.ts          # Public exports
```

### UI Components (Stay in UX Layer)

These remain in `src/ui/` as TUI-specific components:
- `autocomplete-popup.ts`
- `hover-tooltip.ts`
- `signature-help.ts`
- `diagnostics-renderer.ts`

They consume data from LSPService but render in terminal.
