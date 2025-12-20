# Ultra 1.0 Architecture Overview

## Vision

Ultra 1.0 transforms from a monolithic terminal-native editor into a modular **Editor Command Protocol (ECP) Server** architecture. This enables:

1. **Headless Operation**: Ultra can run without any UI, controlled entirely via ECP
2. **Multiple Clients**: TUI, GUI (Electron/Web), AI agents, or remote clients can connect
3. **Pluggable Services**: File access, version control, LSP, and other services are abstracted
4. **Mixed-Mode Editing**: Humans and AI agents can edit collaboratively

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │   TUI       │  │   GUI       │  │  AI Agent   │  │   Remote    │ │
│  │  (Current)  │  │  (Electron) │  │  (Claude)   │  │   Client    │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
└─────────┼────────────────┼────────────────┼────────────────┼────────┘
          │                │                │                │
          └────────────────┴────────────────┴────────────────┘
                                    │
                              JSON-RPC 2.0
                                    │
┌─────────────────────────────────────────────────────────────────────┐
│                     ECP SERVER (Core Ultra)                          │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Command Router                              │  │
│  │  - Routes ECP commands to appropriate services                 │  │
│  │  - Manages sessions and client connections                     │  │
│  │  - Handles authentication/authorization                        │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Document Manager                            │  │
│  │  - Buffer management (piece table)                             │  │
│  │  - Cursor/selection state                                      │  │
│  │  - Undo/redo history                                           │  │
│  │  - Document versioning                                         │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                           Service Adapters
                                    │
┌─────────────────────────────────────────────────────────────────────┐
│                        SERVICE LAYER                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │    File     │  │     Git     │  │     LSP     │  │   Session   │ │
│  │   Service   │  │   Service   │  │   Service   │  │   Service   │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
│         │                │                │                │        │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐ │
│  │  Local FS   │  │  Git CLI    │  │  TS Server  │  │  Local DB   │ │
│  │  FTP/SSH    │  │  GitHub API │  │  Rust Anlzr │  │  Cloud Sync │ │
│  │  Cloud      │  │  GitLab API │  │  PyLSP      │  │  Redis      │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

## Protocol: ECP (Editor Command Protocol)

ECP uses JSON-RPC 2.0 with the following conventions:

### Message Format

```typescript
// Request
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "document/insert",
  "params": {
    "documentId": "doc-123",
    "position": { "line": 10, "column": 5 },
    "text": "Hello, World!"
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "success": true,
    "version": 42,
    "operations": [
      { "type": "insert", "position": {...}, "text": "..." }
    ]
  }
}

// Notification (no response expected)
{
  "jsonrpc": "2.0",
  "method": "document/didChange",
  "params": {
    "documentId": "doc-123",
    "version": 42
  }
}
```

### Method Namespaces

| Namespace | Purpose |
|-----------|---------|
| `session/*` | Session lifecycle, authentication |
| `document/*` | Document operations (open, edit, save) |
| `cursor/*` | Cursor and selection management |
| `file/*` | File system operations |
| `git/*` | Version control operations |
| `lsp/*` | Language server passthrough |
| `config/*` | Configuration management |
| `ui/*` | UI hints (optional, for rendering clients) |

## Service Definitions

### 1. Document Service
**Current**: `src/core/buffer.ts`, `src/core/cursor.ts`, `src/core/document.ts`, `src/core/undo.ts`

The heart of Ultra. Manages text buffers, cursors, selections, and edit history. In ECP architecture, this becomes a network-accessible service.

[→ Full Documentation](./services/document-service.md)

### 2. File Service
**Current**: Distributed across `Document.save()`, `Document.fromFile()`, file tree, etc.

Abstracts file system access to support local files, SSH, FTP, cloud storage, etc.

[→ Full Documentation](./services/file-service.md)

### 3. Git Service
**Current**: `src/features/git/git-integration.ts`

Version control operations. Currently wraps Git CLI, could support GitHub API, GitLab, etc.

[→ Full Documentation](./services/git-service.md)

### 4. LSP Service
**Current**: `src/features/lsp/`

Language Server Protocol integration. Routes requests to appropriate language servers.

[→ Full Documentation](./services/lsp-service.md)

### 5. Session Service
**Current**: `src/config/`, `src/state/session-manager.ts`

Manages user state: settings, keybindings, workspace state, undo history persistence.

[→ Full Documentation](./services/session-service.md)

### 6. Syntax Service
**Current**: `src/features/syntax/shiki-highlighter.ts`

Syntax highlighting using Shiki. Could become optional for headless mode.

[→ Full Documentation](./services/syntax-service.md)

### 7. Terminal Service
**Current**: `src/terminal/`

Terminal I/O abstraction. In ECP mode, becomes optional (only needed for TUI client).

[→ Full Documentation](./services/terminal-service.md)

## UX Layer (Client-Side)

The current TUI becomes one of many possible clients:

| Component | Current Location | ECP Role |
|-----------|-----------------|----------|
| Renderer | `src/ui/renderer.ts` | TUI client only |
| Layout | `src/ui/layout.ts` | TUI client only |
| Components | `src/ui/components/` | TUI client only |
| Input | `src/input/`, `src/terminal/input.ts` | TUI client only |
| Dialogs | `src/ui/components/*-dialog.ts` | TUI client only |

[→ UX Documentation](./ux/)

## Migration Strategy

### Phase 1: Define Service Interfaces
- Create abstract interfaces for each service
- Current implementations become "local" adapters
- No breaking changes to existing functionality

### Phase 2: Implement ECP Router
- JSON-RPC message parsing and routing
- Session management
- Client connection handling

### Phase 3: Refactor Services
- Extract service logic from UI dependencies
- Add ECP method handlers
- Maintain backward compatibility

### Phase 4: Client Abstraction
- Abstract TUI as an ECP client
- Add remote client support
- Enable AI agent integration

## Directory Structure (Target)

```
src/
├── ecp/                    # ECP Server Core
│   ├── router.ts           # Command routing
│   ├── session.ts          # Session management
│   ├── protocol.ts         # JSON-RPC handling
│   └── types.ts            # ECP type definitions
│
├── services/               # Service Layer
│   ├── document/           # Document service
│   │   ├── buffer.ts
│   │   ├── cursor.ts
│   │   ├── document.ts
│   │   ├── undo.ts
│   │   └── adapter.ts      # ECP adapter
│   │
│   ├── file/               # File service
│   │   ├── interface.ts    # Abstract interface
│   │   ├── local.ts        # Local FS adapter
│   │   ├── ssh.ts          # SSH adapter (future)
│   │   └── adapter.ts      # ECP adapter
│   │
│   ├── git/                # Git service
│   │   ├── interface.ts
│   │   ├── cli.ts          # Git CLI adapter
│   │   └── adapter.ts      # ECP adapter
│   │
│   ├── lsp/                # LSP service
│   │   ├── client.ts
│   │   ├── manager.ts
│   │   └── adapter.ts      # ECP adapter
│   │
│   ├── session/            # Session service
│   │   ├── settings.ts
│   │   ├── state.ts
│   │   └── adapter.ts      # ECP adapter
│   │
│   └── syntax/             # Syntax service
│       ├── highlighter.ts
│       └── adapter.ts      # ECP adapter
│
├── clients/                # Client implementations
│   ├── tui/                # Terminal UI client
│   │   ├── renderer.ts
│   │   ├── input.ts
│   │   ├── layout.ts
│   │   └── components/
│   │
│   └── shared/             # Shared client utilities
│
└── core/                   # Shared utilities
    ├── types.ts
    ├── errors.ts
    ├── result.ts
    └── event-emitter.ts
```

## Key Principles

1. **Service Independence**: Each service should be testable in isolation
2. **Protocol-First**: Design ECP methods before implementation
3. **Backward Compatibility**: Current TUI must continue working during migration
4. **Incremental Migration**: Can be done service-by-service
5. **Type Safety**: Full TypeScript types for all ECP messages

## Known Issues to Address

During migration, we should fix these known issues:

1. **Console.log Anti-pattern**: Multiple files use `console.error` instead of `debugLog`
2. **Silent Failures**: Many operations fail silently without error feedback
3. **Hardcoded Values**: Magic numbers scattered throughout code
4. **Incomplete Features**: Several TODO markers for missing functionality
5. **Inconsistent Defaults**: `settings.ts` vs `defaults.ts` have conflicting values
6. **Memory Leaks**: Unbounded caches, file watchers not always cleaned up
7. **Missing GIT_EDITOR**: Documentation says it's set but it isn't

See individual service documentation for detailed issue lists.
