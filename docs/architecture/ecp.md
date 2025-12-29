# Editor Command Protocol (ECP)

The Editor Command Protocol (ECP) is Ultra's internal architecture that separates the editor core from its UI clients.

## Overview

ECP is a JSON-RPC 2.0 based protocol that allows clients to interact with Ultra's services:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Clients                                     │
│  ┌───────────────────┐  ┌───────────────────┐  ┌─────────────────────┐  │
│  │    TUI Client     │  │   (Future: GUI)   │  │   TestECPClient     │  │
│  │  (Terminal UI)    │  │                   │  │   (Headless Test)   │  │
│  └─────────┬─────────┘  └─────────┬─────────┘  └──────────┬──────────┘  │
└────────────┼──────────────────────┼───────────────────────┼─────────────┘
             │                      │                       │
             ▼                      ▼                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           ECP Server                                     │
│                         (src/ecp/server.ts)                              │
│                                                                          │
│   Routes requests to service adapters based on method prefix:            │
│     document/* → DocumentServiceAdapter                                  │
│     file/*     → FileServiceAdapter                                      │
│     git/*      → GitServiceAdapter                                       │
│     lsp/*      → LSPServiceAdapter                                       │
│     session/*  → SessionServiceAdapter                                   │
│     ...                                                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Why ECP?

The ECP architecture provides several benefits:

1. **Testability**: Services can be tested without UI via TestECPClient
2. **Separation of Concerns**: UI logic is separate from editor logic
3. **Future Extensibility**: Multiple clients (TUI, GUI, remote) can share the same core
4. **Clean Interfaces**: Services have well-defined contracts

## ECP Server

The ECP Server (`src/ecp/server.ts`) is the central router:

```typescript
class ECPServer {
  private documentService: LocalDocumentService;
  private fileService: LocalFileService;
  private gitService: LocalGitService;
  private lspService: LocalLSPService;
  private sessionService: LocalSessionService;
  // ... more services

  async request(method: string, params: unknown): Promise<ECPResponse> {
    // Route to appropriate service adapter
    if (method.startsWith('document/')) {
      return { result: await this.documentAdapter.handleRequest(method, params) };
    }
    if (method.startsWith('file/')) {
      return { result: await this.fileAdapter.handleRequest(method, params) };
    }
    // ... more routing
  }

  getService<T>(name: string): T {
    switch (name) {
      case 'document': return this.documentService as T;
      case 'file': return this.fileService as T;
      case 'git': return this.gitService as T;
      // ...
    }
  }
}
```

## Request/Response Format

ECP uses JSON-RPC 2.0 format:

### Request

```typescript
interface ECPRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

// Example
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "document/insert",
  "params": {
    "documentId": "doc-123",
    "position": { "line": 5, "column": 10 },
    "text": "hello"
  }
}
```

### Response

```typescript
interface ECPResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// Success
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "success": true }
}

// Error
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32600,
    "message": "Document not found"
  }
}
```

## Method Naming

Methods use a `namespace/action` format:

| Namespace | Purpose | Examples |
|-----------|---------|----------|
| `document/*` | Document operations | `document/open`, `document/insert`, `document/save` |
| `file/*` | File system | `file/read`, `file/write`, `file/list` |
| `git/*` | Version control | `git/status`, `git/stage`, `git/commit` |
| `lsp/*` | Language features | `lsp/completion`, `lsp/hover`, `lsp/definition` |
| `session/*` | Configuration | `session/getSetting`, `session/setSetting` |
| `syntax/*` | Highlighting | `syntax/highlight`, `syntax/getTokens` |
| `database/*` | DB connections | `database/connect`, `database/query` |
| `terminal/*` | PTY management | `terminal/create`, `terminal/write` |

## Services

### Service Structure

Each service follows a consistent pattern:

```
src/services/<name>/
├── interface.ts      # Abstract service interface (contract)
├── types.ts          # Type definitions
├── local.ts          # LocalXxxService implementation
├── adapter.ts        # XxxServiceAdapter (ECP JSON-RPC)
└── index.ts          # Public exports
```

### Interface

Defines the service contract:

```typescript
// src/services/document/interface.ts
export interface DocumentService {
  open(uri: string, content?: string): Promise<DocumentInfo>;
  insert(documentId: string, position: Position, text: string): Promise<void>;
  delete(documentId: string, range: Range): Promise<string>;
  save(documentId: string): Promise<void>;
  getContent(documentId: string): Promise<string>;
  close(documentId: string): Promise<void>;

  // Event subscription
  onChange(callback: (event: DocumentChangeEvent) => void): Unsubscribe;
}
```

### Local Implementation

Implements the interface:

```typescript
// src/services/document/local.ts
export class LocalDocumentService implements DocumentService {
  private documents: Map<string, Document> = new Map();

  async open(uri: string, content?: string): Promise<DocumentInfo> {
    const doc = new Document(uri, content);
    this.documents.set(doc.id, doc);
    return { documentId: doc.id, uri, lineCount: doc.lineCount };
  }

  async insert(documentId: string, position: Position, text: string): Promise<void> {
    const doc = this.documents.get(documentId);
    if (!doc) throw new Error('Document not found');
    doc.buffer.insertAt(position, text);
    this.emit('contentChanged', { documentId, changes: [{ position, text }] });
  }
}

// Singleton export
export const localDocumentService = new LocalDocumentService();
export default localDocumentService;
```

### Adapter

Maps ECP methods to service calls:

```typescript
// src/services/document/adapter.ts
export class DocumentServiceAdapter {
  constructor(private service: DocumentService) {}

  async handleRequest(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'document/open':
        return this.service.open(params.uri, params.content);

      case 'document/insert':
        await this.service.insert(params.documentId, params.position, params.text);
        return { success: true };

      case 'document/content':
        return { content: await this.service.getContent(params.documentId) };

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }
}
```

## Available Services

### Document Service

Manages text buffers, cursors, and undo/redo:

| Method | Description |
|--------|-------------|
| `document/open` | Open or create a document |
| `document/insert` | Insert text at position |
| `document/delete` | Delete text in range |
| `document/replace` | Replace text in range |
| `document/content` | Get document content |
| `document/save` | Save document to file |
| `document/close` | Close document |
| `document/undo` | Undo last change |
| `document/redo` | Redo last undo |

### File Service

File system abstraction:

| Method | Description |
|--------|-------------|
| `file/read` | Read file content |
| `file/write` | Write content to file |
| `file/exists` | Check if file exists |
| `file/list` | List directory contents |
| `file/delete` | Delete file or directory |
| `file/rename` | Rename file |
| `file/watch` | Watch for file changes |

### Git Service

Version control operations:

| Method | Description |
|--------|-------------|
| `git/status` | Get repository status |
| `git/stage` | Stage files |
| `git/unstage` | Unstage files |
| `git/commit` | Create commit |
| `git/diff` | Get file diff |
| `git/branches` | List branches |
| `git/checkout` | Switch branches |

### LSP Service

Language server integration:

| Method | Description |
|--------|-------------|
| `lsp/completion` | Get completions |
| `lsp/hover` | Get hover info |
| `lsp/definition` | Go to definition |
| `lsp/references` | Find references |
| `lsp/diagnostics` | Get diagnostics |
| `lsp/format` | Format document |

### Session Service

Configuration and state:

| Method | Description |
|--------|-------------|
| `session/getSetting` | Get setting value |
| `session/setSetting` | Set setting value |
| `session/getTheme` | Get current theme |
| `session/setTheme` | Set theme |
| `session/saveState` | Save session state |
| `session/restoreState` | Restore session state |

## Testing with TestECPClient

The `TestECPClient` enables headless testing:

```typescript
import { TestECPClient } from '@test/ecp-client.ts';

test('document editing', async () => {
  const client = new TestECPClient();

  // Open document
  const { documentId } = await client.request('document/open', {
    uri: 'memory://test.txt',
    content: 'hello'
  });

  // Edit
  await client.request('document/insert', {
    documentId,
    position: { line: 0, column: 5 },
    text: ' world'
  });

  // Verify
  const { content } = await client.request('document/content', { documentId });
  expect(content).toBe('hello world');

  await client.shutdown();
});
```

### Direct Service Access

TestECPClient also provides direct service access:

```typescript
const client = new TestECPClient();

// Get service directly
const gitService = client.getService('git');
const status = await gitService.getStatus();

// Or use the request method for ECP-level testing
const result = await client.request('git/status', {});
```

## Adding a New Service

### 1. Create Service Files

```
src/services/example/
├── interface.ts      # Service interface
├── types.ts          # Type definitions
├── local.ts          # Implementation
├── adapter.ts        # ECP adapter
└── index.ts          # Exports
```

### 2. Implement the Interface

```typescript
// interface.ts
export interface ExampleService {
  doSomething(params: Params): Promise<Result>;
  onEvent(callback: EventCallback): Unsubscribe;
}

// local.ts
export class LocalExampleService implements ExampleService {
  async doSomething(params: Params): Promise<Result> {
    // Implementation
  }
}

export const localExampleService = new LocalExampleService();
export default localExampleService;

// adapter.ts
export class ExampleServiceAdapter {
  constructor(private service: ExampleService) {}

  async handleRequest(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'example/doSomething':
        return this.service.doSomething(params);
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }
}
```

### 3. Register with ECP Server

In `src/ecp/server.ts`:

```typescript
import { LocalExampleService } from '../services/example/local.ts';
import { ExampleServiceAdapter } from '../services/example/adapter.ts';

class ECPServer {
  private exampleService: LocalExampleService;
  private exampleAdapter: ExampleServiceAdapter;

  constructor() {
    this.exampleService = new LocalExampleService();
    this.exampleAdapter = new ExampleServiceAdapter(this.exampleService);
  }

  async request(method: string, params: unknown): Promise<ECPResponse> {
    // Add routing
    if (method.startsWith('example/')) {
      return { result: await this.exampleAdapter.handleRequest(method, params) };
    }
    // ...
  }

  getService<T>(name: string): T {
    switch (name) {
      case 'example': return this.exampleService as T;
      // ...
    }
  }
}
```

## Error Handling

Services should throw descriptive errors:

```typescript
class LocalDocumentService {
  async getContent(documentId: string): Promise<string> {
    const doc = this.documents.get(documentId);
    if (!doc) {
      throw new Error(`Document not found: ${documentId}`);
    }
    return doc.getContent();
  }
}
```

The adapter converts these to ECP error responses:

```typescript
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32600,
    "message": "Document not found: doc-123"
  }
}
```

## Event System

Services emit events for state changes:

```typescript
// Service emits events
class LocalDocumentService {
  private callbacks: Set<Function> = new Set();

  onChange(callback: (event: DocumentChangeEvent) => void): Unsubscribe {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  private emit(event: DocumentChangeEvent): void {
    for (const callback of this.callbacks) {
      callback(event);
    }
  }

  async insert(documentId: string, position: Position, text: string): void {
    // ... make change ...
    this.emit({ documentId, type: 'insert', position, text });
  }
}
```

Clients subscribe to events:

```typescript
// TUI Client subscribes
const unsubscribe = documentService.onChange((event) => {
  this.handleDocumentChange(event);
});

// Cleanup
unsubscribe();
```

## Related Documentation

- [Architecture Overview](overview.md) - High-level architecture
- [Data Flow](data-flow.md) - How data flows through ECP
- [Testing](../testing/overview.md) - Testing with TestECPClient
