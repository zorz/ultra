# Architecture Overview

Ultra uses an Editor Command Protocol (ECP) architecture that separates the editor into services and clients.

## ECP Architecture

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
│   JSON-RPC 2.0 Interface                                                 │
│   Routes requests to service adapters based on method prefix:            │
│     document/* → DocumentServiceAdapter                                  │
│     file/*     → FileServiceAdapter                                      │
│     git/*      → GitServiceAdapter                                       │
│     lsp/*      → LSPServiceAdapter                                       │
│     session/*  → SessionServiceAdapter                                   │
│     ...                                                                  │
└─────────────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            Services                                      │
│                         (src/services/)                                  │
│                                                                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐        │
│  │  Document  │  │    File    │  │    Git     │  │    LSP     │        │
│  │  Service   │  │  Service   │  │  Service   │  │  Service   │        │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘        │
│                                                                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐        │
│  │  Session   │  │   Syntax   │  │  Database  │  │  Terminal  │        │
│  │  Service   │  │  Service   │  │  Service   │  │  Service   │        │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘        │
└─────────────────────────────────────────────────────────────────────────┘
```

## Core Concepts

### Services

Services are stateful backend components that implement core functionality:

| Service | Purpose | Key Features |
|---------|---------|--------------|
| **Document** | Text editing | Buffer, cursor, undo/redo, selections |
| **File** | File system | Read, write, watch, list directories |
| **Git** | Version control | Status, diff, stage, commit, branches |
| **LSP** | Language features | Completion, hover, definition, references |
| **Session** | Configuration | Settings, keybindings, themes, state |
| **Syntax** | Highlighting | Shiki-based syntax highlighting |
| **Database** | DB connections | PostgreSQL/Supabase queries |
| **Terminal** | PTY management | Shell sessions, I/O |
| **Secret** | Credentials | Keychain, encrypted storage |
| **Search** | Find in files | File search, content grep |

### Service Structure

Each service follows a consistent pattern:

```
src/services/<name>/
├── interface.ts      # Abstract service interface
├── types.ts          # Type definitions
├── local.ts          # LocalXxxService implementation
├── adapter.ts        # XxxServiceAdapter (ECP JSON-RPC)
└── index.ts          # Public exports
```

Example:
```typescript
// interface.ts - The contract
export interface GitService {
  getStatus(): Promise<GitStatus>;
  stage(paths: string[]): Promise<void>;
  commit(message: string): Promise<CommitResult>;
}

// local.ts - The implementation
export class LocalGitService implements GitService {
  async getStatus(): Promise<GitStatus> { ... }
}

// adapter.ts - ECP routing
export class GitServiceAdapter {
  constructor(private service: GitService) {}

  async handleRequest(method: string, params: unknown) {
    switch (method) {
      case 'git/status': return this.service.getStatus();
      case 'git/stage': return this.service.stage(params.paths);
    }
  }
}
```

### Clients

Clients connect to the ECP server to provide user interfaces:

**TUI Client** (`src/clients/tui/`)
- Terminal-based UI using ANSI escape sequences
- Components: document editors, terminals, AI chat
- Overlays: command palette, file picker, dialogs

**TestECPClient** (`tests/helpers/ecp-client.ts`)
- Headless client for automated testing
- Direct service access without terminal I/O

### TUI Client Structure

```
src/clients/tui/
├── client/
│   ├── tui-client.ts       # Main orchestrator
│   └── lsp-integration.ts  # LSP overlay management
├── elements/               # Tab content types
│   ├── document-editor.ts  # Code editor
│   ├── terminal-session.ts # Terminal emulator
│   └── ai-terminal-chat.ts # AI assistant
├── overlays/               # Modal dialogs
│   ├── command-palette.ts
│   ├── file-picker.ts
│   ├── autocomplete-popup.ts
│   └── hover-tooltip.ts
├── config/
│   └── config-manager.ts   # Settings + keybindings
└── window.ts               # Pane management
```

## Data Flow

### User Input → State Change

```
User presses key
        │
        ▼
┌─────────────────┐
│  Terminal stdin │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   TUI Client    │
│  (key handler)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  ECP Request    │
│  document/insert│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Document Service│
│  (buffer edit)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ State Changed   │
│ → Emit Event    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  TUI Renders    │
│  (terminal out) │
└─────────────────┘
```

### ECP Request/Response

All client-server communication uses JSON-RPC 2.0:

```typescript
// Request
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

// Response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "success": true }
}
```

## Key Patterns

### Singleton Services

Services are singletons with named + default exports:

```typescript
export class LocalGitService implements GitService { ... }
export const gitService = new LocalGitService();
export default gitService;
```

### Event Callbacks

Components use callback registration with unsubscribe:

```typescript
const unsubscribe = service.onChange((data) => {
  // Handle change
});

// Later, to clean up
unsubscribe();
```

### Render Scheduling

UI updates are batched via the render scheduler:

```typescript
import { renderScheduler } from '../render-scheduler.ts';

// Schedule render with priority
renderScheduler.schedule(() => {
  this.render(ctx);
}, 'normal', RenderTaskIds.STATUS_BAR);
```

Priorities: `immediate` > `high` > `normal` > `low`

### Debug Logging

Use `debugLog()` instead of `console.log`:

```typescript
import { debugLog } from '../../debug.ts';

debugLog(`[MyComponent] Event: ${data}`);
```

Logs are written to `debug.log` when `--debug` flag is passed.

## Configuration

### Settings Priority

1. User settings: `~/.ultra/settings.jsonc`
2. Default settings: `config/default-settings.jsonc` (embedded at build)

### Keybindings

- Default: `config/default-keybindings.jsonc`
- User overrides: `~/.ultra/keybindings.jsonc`
- Context-aware via `when` clauses

### Themes

- Built-in: `config/themes/*.json`
- User themes: `~/.ultra/themes/`
- VS Code compatible format

## Testing

The ECP architecture enables comprehensive testing:

```typescript
// Unit test a service
test('git status', async () => {
  const service = new LocalGitService('/repo');
  const status = await service.getStatus();
  expect(status.staged).toEqual([]);
});

// Integration test via ECP
test('document workflow', async () => {
  const client = new TestECPClient();
  const { documentId } = await client.request('document/open', { uri: 'file:///test.txt' });
  await client.request('document/insert', { documentId, text: 'hello' });
  await client.shutdown();
});
```

## Next Steps

- [Rendering](rendering.md): Terminal rendering pipeline
- [Keybindings](keybindings.md): Keyboard input handling
