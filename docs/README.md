# Ultra Documentation

Ultra is a terminal-native code editor built with TypeScript and Bun, using an Editor Command Protocol (ECP) architecture.

## Quick Links

| Guide | Description |
|-------|-------------|
| [Getting Started](getting-started.md) | Installation, first run, basic usage |
| [Architecture Overview](architecture/overview.md) | ECP architecture and services |
| [ECP Protocol](architecture/ecp.md) | Editor Command Protocol details |
| [Data Flow](architecture/data-flow.md) | How data flows through Ultra |
| [Keybindings](architecture/keybindings.md) | Keyboard handling system |
| [Rendering](architecture/rendering.md) | Terminal rendering pipeline |

## Module Documentation

| Module | Description |
|--------|-------------|
| [Buffer](modules/buffer.md) | Piece table text storage |
| [Commands](modules/commands.md) | Command registration and execution |
| [LSP](modules/lsp.md) | Language server integration |
| [UI Components](modules/ui-components.md) | TUI elements, overlays, and panels |

## Developer Guides

| Guide | Description |
|-------|-------------|
| [Adding Commands](guides/adding-commands.md) | Creating new editor commands |
| [Adding Languages](guides/adding-languages.md) | Adding language support |

## API Reference

Generated API documentation is available in the [api/](api/) directory after running:

```bash
bun run docs
```

## Project Structure

```
ultra/
├── src/
│   ├── index.ts              # Entry point
│   ├── constants.ts          # Shared constants
│   ├── debug.ts              # Debug logging
│   │
│   ├── ecp/                  # Editor Command Protocol
│   │   └── server.ts         # ECP server (routes requests to services)
│   │
│   ├── services/             # Backend services
│   │   ├── database/         # Database connections and queries
│   │   ├── document/         # Buffer, cursor, undo/redo
│   │   ├── file/             # File system abstraction
│   │   ├── git/              # Version control
│   │   ├── lsp/              # Language server protocol
│   │   ├── search/           # File and content search
│   │   ├── secret/           # Credential storage
│   │   ├── session/          # Settings, keybindings, state
│   │   ├── syntax/           # Syntax highlighting
│   │   └── terminal/         # PTY management
│   │
│   ├── clients/              # UI clients
│   │   └── tui/              # Terminal UI client
│   │       ├── client/       # TUI orchestrator
│   │       ├── elements/     # Tab content (editors, terminals, AI chat)
│   │       ├── overlays/     # Modals (command palette, file picker)
│   │       └── config/       # TUI configuration
│   │
│   ├── core/                 # Core utilities
│   │   ├── buffer.ts         # Piece table implementation
│   │   ├── colors.ts         # Color utilities
│   │   └── event-emitter.ts  # Typed event emitter
│   │
│   ├── terminal/             # PTY backends
│   │   ├── pty-factory.ts    # Backend selection
│   │   └── backends/         # node-pty, bun-pty, IPC
│   │
│   └── config/               # Embedded configuration
│       └── defaults.ts       # Generated from config/*.jsonc
│
├── config/                   # Source configuration
│   ├── default-keybindings.jsonc
│   ├── default-settings.jsonc
│   ├── BOOT.md
│   └── themes/
│
├── tests/                    # Test suites
│   ├── unit/                 # Service unit tests
│   ├── integration/          # ECP integration tests
│   └── helpers/              # Test utilities (TestECPClient)
│
└── docs/                     # Documentation
```

## ECP Architecture

Ultra uses an Editor Command Protocol (ECP) architecture that separates concerns:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Clients                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  TUI Client │  │ (Future GUI)│  │ TestECPClient (testing) │  │
│  └──────┬──────┘  └──────┬──────┘  └────────────┬────────────┘  │
└─────────┼────────────────┼──────────────────────┼───────────────┘
          │                │                      │
          ▼                ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ECP Server                                  │
│                    (JSON-RPC 2.0)                                │
│  Routes: document/*, file/*, git/*, lsp/*, session/*, ...       │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Services                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Document │ │   File   │ │   Git    │ │   LSP    │  ...      │
│  │ Service  │ │ Service  │ │ Service  │ │ Service  │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

### Service Pattern

Each service follows a consistent pattern:

```
services/<name>/
├── interface.ts      # Service interface (contract)
├── types.ts          # Type definitions
├── local.ts          # Local implementation
├── adapter.ts        # ECP JSON-RPC adapter
└── index.ts          # Public exports
```

### Testing with TestECPClient

The ECP architecture enables headless testing:

```typescript
import { TestECPClient } from '@test/ecp-client.ts';

test('document editing', async () => {
  const client = new TestECPClient();

  const { documentId } = await client.request('document/open', {
    uri: 'memory://test.txt',
    content: 'hello'
  });

  await client.request('document/insert', {
    documentId,
    position: { line: 0, column: 5 },
    text: ' world'
  });

  const { content } = await client.request('document/content', { documentId });
  expect(content).toBe('hello world');

  await client.shutdown();
});
```

## Technology Stack

- **Runtime**: [Bun](https://bun.sh/) - Fast JavaScript runtime
- **Language**: TypeScript with strict mode
- **Syntax Highlighting**: [Shiki](https://shiki.style/) - VS Code's syntax engine
- **Terminal**: Raw mode with ANSI escape sequences
- **LSP**: Language Server Protocol for IDE features
- **Database**: PostgreSQL/Supabase support via `postgres` package
