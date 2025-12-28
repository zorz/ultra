# Web GUI Client Architecture

## Overview

The Web GUI client provides a browser-based interface to Ultra, replicating TUI functionality in a web environment. It connects to the ECP server via WebSocket, using the same JSON-RPC 2.0 protocol.

## Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Frontend Framework | Svelte 5 | Lightweight, excellent DX, reactive by default |
| Build Tool | Vite | Fast HMR, excellent Svelte support |
| Code Editor | Monaco Editor | Full LSP support, VS Code compatibility |
| Terminal | xterm.js | Industry standard, addon ecosystem |
| Styling | CSS Variables + Tailwind | Theme-aware, utility-first |
| Desktop Wrapper | Tauri (future) | Small bundle, native performance |

## Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         Svelte Application                            │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │   Sidebar   │  │   Editor    │  │  Terminal   │  │  Overlays   │  │  │
│  │  │  - FileTree │  │  - Monaco   │  │  - xterm.js │  │  - Palette  │  │  │
│  │  │  - GitPanel │  │  - Tabs     │  │  - Tabs     │  │  - Dialogs  │  │  │
│  │  │             │  │  - Splits   │  │             │  │             │  │  │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │  │
│  │         │                │                │                │         │  │
│  │         └────────────────┴────────────────┴────────────────┘         │  │
│  │                                   │                                   │  │
│  │  ┌────────────────────────────────┴────────────────────────────────┐  │  │
│  │  │                      Svelte Stores                               │  │  │
│  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │  │  │
│  │  │  │documents│ │  files  │ │   git   │ │  theme  │ │ layout  │   │  │  │
│  │  └──┴────┬────┴─┴────┬────┴─┴────┬────┴─┴────┬────┴─┴────┬────┴───┘  │  │
│  │          │           │           │           │           │           │  │
│  │  ┌───────┴───────────┴───────────┴───────────┴───────────┴────────┐  │  │
│  │  │                      ECP WebSocket Client                       │  │  │
│  │  │  - JSON-RPC request/response                                    │  │  │
│  │  │  - Notification subscriptions                                   │  │  │
│  │  │  - Automatic reconnection                                       │  │  │
│  │  └────────────────────────────────┬───────────────────────────────┘  │  │
│  └───────────────────────────────────┼───────────────────────────────────┘  │
└──────────────────────────────────────┼──────────────────────────────────────┘
                                       │
                                  WebSocket
                                       │
┌──────────────────────────────────────┼──────────────────────────────────────┐
│                              BUN SERVER                                      │
│  ┌───────────────────────────────────┴───────────────────────────────────┐  │
│  │                      WebSocket Transport Layer                         │  │
│  │  - Connection management                                               │  │
│  │  - JSON-RPC framing                                                    │  │
│  │  - Authentication (stubbed for remote)                                 │  │
│  └────────────────────────────────────┬──────────────────────────────────┘  │
│                                       │                                      │
│  ┌────────────────────────────────────┴──────────────────────────────────┐  │
│  │                           ECP Server                                   │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐         │  │
│  │  │Document │ │  File   │ │   Git   │ │   LSP   │ │Terminal │ ...     │  │
│  │  │ Service │ │ Service │ │ Service │ │ Service │ │ Service │         │  │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘         │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                      HTTP Static Server                                │  │
│  │  - Serves built Svelte app                                             │  │
│  │  - Development: proxies to Vite                                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
src/clients/web/
├── server/                      # Bun server (WebSocket + HTTP)
│   ├── index.ts                 # Server entry point
│   ├── ws-transport.ts          # WebSocket JSON-RPC transport
│   ├── http-handler.ts          # Static file serving
│   └── auth.ts                  # Authentication (stubbed)
│
├── app/                         # Svelte application
│   ├── src/
│   │   ├── App.svelte           # Root component
│   │   ├── main.ts              # Application entry
│   │   │
│   │   ├── lib/
│   │   │   ├── ecp/
│   │   │   │   ├── client.ts        # WebSocket ECP client
│   │   │   │   ├── types.ts         # JSON-RPC types
│   │   │   │   └── notifications.ts # Notification handlers
│   │   │   │
│   │   │   ├── stores/
│   │   │   │   ├── documents.ts     # Open documents state
│   │   │   │   ├── files.ts         # File tree state
│   │   │   │   ├── git.ts           # Git status state
│   │   │   │   ├── theme.ts         # Current theme
│   │   │   │   ├── layout.ts        # Pane/split layout
│   │   │   │   └── lsp.ts           # Diagnostics, completions
│   │   │   │
│   │   │   ├── theme/
│   │   │   │   ├── loader.ts        # Fetches theme from ECP
│   │   │   │   ├── css-vars.ts      # Converts to CSS variables
│   │   │   │   └── monaco.ts        # Monaco theme adapter
│   │   │   │
│   │   │   └── utils/
│   │   │       ├── keybindings.ts   # Keyboard shortcut handling
│   │   │       └── commands.ts      # Command registry
│   │   │
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── MainLayout.svelte    # Top-level layout
│   │   │   │   ├── Sidebar.svelte       # Collapsible sidebar
│   │   │   │   ├── PaneContainer.svelte # Split pane container
│   │   │   │   ├── Pane.svelte          # Individual pane
│   │   │   │   ├── TabBar.svelte        # Tab container
│   │   │   │   └── StatusBar.svelte     # Bottom status bar
│   │   │   │
│   │   │   ├── sidebar/
│   │   │   │   ├── FileTree.svelte      # File explorer
│   │   │   │   ├── FileTreeNode.svelte  # Tree node component
│   │   │   │   ├── GitPanel.svelte      # Git status/actions
│   │   │   │   └── GitFileItem.svelte   # Changed file item
│   │   │   │
│   │   │   ├── editor/
│   │   │   │   ├── Editor.svelte        # Monaco wrapper
│   │   │   │   ├── EditorTab.svelte     # Tab component
│   │   │   │   └── EditorGroup.svelte   # Group of tabs
│   │   │   │
│   │   │   ├── terminal/
│   │   │   │   ├── Terminal.svelte      # xterm.js wrapper
│   │   │   │   ├── TerminalTab.svelte   # Terminal tab
│   │   │   │   └── TerminalPanel.svelte # Terminal panel
│   │   │   │
│   │   │   └── overlays/
│   │   │       ├── CommandPalette.svelte    # Command palette
│   │   │       ├── QuickOpen.svelte         # File picker
│   │   │       └── Dialog.svelte            # Generic dialog
│   │   │
│   │   └── types/
│   │       ├── ecp.ts               # ECP method types
│   │       ├── layout.ts            # Layout types
│   │       └── editor.ts            # Editor types
│   │
│   ├── index.html               # HTML entry point
│   ├── vite.config.ts           # Vite configuration
│   ├── svelte.config.js         # Svelte configuration
│   ├── tsconfig.json            # TypeScript config
│   └── package.json             # Dependencies
│
└── shared/                      # Shared types with server
    └── protocol.ts              # JSON-RPC message types
```

## Phase 1 Implementation (MVP)

### Features Included

1. **File Tree** (sidebar)
   - Directory tree navigation
   - File create/rename/delete context menu
   - File watching for external changes

2. **Git Panel** (sidebar)
   - Changed files list (staged/unstaged)
   - Stage/unstage actions
   - Discard changes
   - Commit with message

3. **Editor Panel**
   - Monaco editor with tabs
   - Split panes (horizontal/vertical)
   - Syntax highlighting via Monaco themes
   - LSP integration (completion, hover, diagnostics)

4. **Command Palette**
   - Keyboard-triggered (Ctrl+Shift+P)
   - Fuzzy search commands
   - Quick file open (Ctrl+P)

5. **Terminal Panel**
   - xterm.js terminal emulator
   - Multiple terminal tabs
   - Resize support

### Theme Integration

Themes are fetched from the ECP server and applied as CSS variables:

```typescript
// lib/theme/loader.ts
import { ecpClient } from '../ecp/client';

export async function loadTheme(): Promise<Theme> {
  const { theme } = await ecpClient.request('theme/current', {});
  return theme;
}

// lib/theme/css-vars.ts
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;

  // Map Ultra theme colors to CSS variables
  root.style.setProperty('--editor-bg', theme.colors['editor.background']);
  root.style.setProperty('--editor-fg', theme.colors['editor.foreground']);
  root.style.setProperty('--sidebar-bg', theme.colors['sideBar.background']);
  // ... etc
}
```

Monaco editor receives a matching theme:

```typescript
// lib/theme/monaco.ts
import * as monaco from 'monaco-editor';

export function registerMonacoTheme(theme: Theme): void {
  monaco.editor.defineTheme('ultra-theme', {
    base: theme.type === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: convertToMonacoRules(theme.tokenColors),
    colors: convertToMonacoColors(theme.colors)
  });
}
```

## Server-Side Changes

### WebSocket Transport

New file: `src/clients/web/server/ws-transport.ts`

```typescript
import { ECPServer } from '../../../ecp/server.ts';

interface ClientConnection {
  id: string;
  ws: WebSocket;
  subscriptions: Set<string>;
}

export class WebSocketTransport {
  private ecpServer: ECPServer;
  private clients = new Map<string, ClientConnection>();

  constructor(ecpServer: ECPServer) {
    this.ecpServer = ecpServer;
    this.setupNotificationForwarding();
  }

  handleConnection(ws: WebSocket): void {
    const clientId = crypto.randomUUID();
    const client: ClientConnection = {
      id: clientId,
      ws,
      subscriptions: new Set()
    };
    this.clients.set(clientId, client);

    ws.addEventListener('message', (event) => {
      this.handleMessage(client, event.data);
    });

    ws.addEventListener('close', () => {
      this.clients.delete(clientId);
    });
  }

  private async handleMessage(client: ClientConnection, data: string): Promise<void> {
    const request = JSON.parse(data);

    // Handle subscription requests
    if (request.method === 'subscribe') {
      client.subscriptions.add(request.params.event);
      return;
    }

    // Route to ECP server
    const response = await this.ecpServer.requestRaw(
      request.method,
      request.params
    );

    client.ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      ...response
    }));
  }

  private setupNotificationForwarding(): void {
    this.ecpServer.onNotification((method, params) => {
      for (const client of this.clients.values()) {
        if (client.subscriptions.has(method) || client.subscriptions.has('*')) {
          client.ws.send(JSON.stringify({
            jsonrpc: '2.0',
            method,
            params
          }));
        }
      }
    });
  }
}
```

### ECP Server Remote Support

Add to `src/ecp/server.ts`:

```typescript
interface ECPServerConfig {
  allowRemote?: boolean;        // Default: false
  remotePort?: number;          // Default: 7890
  authToken?: string;           // Required if allowRemote=true
}
```

### Entry Point

New flag: `ultra --gui`

```typescript
// In src/index.ts or new src/clients/web/index.ts
if (args.includes('--gui')) {
  const { startWebServer } = await import('./clients/web/server/index.ts');
  const port = await startWebServer({ openBrowser: true });
  console.log(`Ultra Web GUI running at http://localhost:${port}`);
}
```

## ECP Client (Browser)

```typescript
// lib/ecp/client.ts
type Callback = (params: unknown) => void;

class ECPClient {
  private ws: WebSocket;
  private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();
  private notificationHandlers = new Map<string, Set<Callback>>();
  private requestId = 0;

  async connect(url: string): Promise<void> {
    this.ws = new WebSocket(url);

    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = reject;
      this.ws.onmessage = (event) => this.handleMessage(event.data);
    });
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    const id = ++this.requestId;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params
      }));
    });
  }

  subscribe(event: string, callback: Callback): () => void {
    if (!this.notificationHandlers.has(event)) {
      this.notificationHandlers.set(event, new Set());
      this.ws.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'subscribe',
        params: { event }
      }));
    }

    this.notificationHandlers.get(event)!.add(callback);
    return () => this.notificationHandlers.get(event)!.delete(callback);
  }

  private handleMessage(data: string): void {
    const message = JSON.parse(data);

    if ('id' in message) {
      // Response to request
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        if (message.error) {
          pending.reject(message.error);
        } else {
          pending.resolve(message.result);
        }
      }
    } else {
      // Notification
      const handlers = this.notificationHandlers.get(message.method);
      if (handlers) {
        for (const handler of handlers) {
          handler(message.params);
        }
      }
    }
  }
}

export const ecpClient = new ECPClient();
```

## Svelte Stores

Reactive stores that sync with ECP:

```typescript
// stores/documents.ts
import { writable, derived } from 'svelte/store';
import { ecpClient } from '../ecp/client';

interface DocumentState {
  id: string;
  uri: string;
  content: string;
  version: number;
  isDirty: boolean;
  cursors: Cursor[];
}

function createDocumentsStore() {
  const { subscribe, update } = writable<Map<string, DocumentState>>(new Map());

  // Subscribe to document changes from server
  ecpClient.subscribe('document/didChange', (params) => {
    update(docs => {
      const doc = docs.get(params.documentId);
      if (doc) {
        doc.version = params.version;
        doc.isDirty = true;
      }
      return docs;
    });
  });

  return {
    subscribe,

    async open(uri: string): Promise<string> {
      const { documentId, content, version } = await ecpClient.request('document/open', { uri });
      update(docs => {
        docs.set(documentId, { id: documentId, uri, content, version, isDirty: false, cursors: [] });
        return docs;
      });
      return documentId;
    },

    async insert(documentId: string, position: Position, text: string): Promise<void> {
      await ecpClient.request('document/insert', { documentId, position, text });
    },

    // ... other methods
  };
}

export const documents = createDocumentsStore();
```

## Keybinding System

Keybindings are fetched from ECP and handled client-side:

```typescript
// lib/utils/keybindings.ts
import { ecpClient } from '../ecp/client';

interface Keybinding {
  key: string;
  command: string;
  when?: string;
}

class KeybindingManager {
  private bindings: Keybinding[] = [];
  private commandHandlers = new Map<string, () => void>();

  async load(): Promise<void> {
    const { keybindings } = await ecpClient.request('keybindings/get', {});
    this.bindings = keybindings;
  }

  register(command: string, handler: () => void): void {
    this.commandHandlers.set(command, handler);
  }

  handleKeydown(event: KeyboardEvent): boolean {
    const key = this.eventToKey(event);
    const binding = this.bindings.find(b => b.key === key);

    if (binding) {
      const handler = this.commandHandlers.get(binding.command);
      if (handler) {
        event.preventDefault();
        handler();
        return true;
      }
    }

    return false;
  }

  private eventToKey(event: KeyboardEvent): string {
    const parts: string[] = [];
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.shiftKey) parts.push('Shift');
    if (event.altKey) parts.push('Alt');
    parts.push(event.key);
    return parts.join('+');
  }
}

export const keybindings = new KeybindingManager();
```

## Development Workflow

### Development Mode

```bash
# Terminal 1: Start ECP server with WebSocket transport
bun run dev:server

# Terminal 2: Start Vite dev server with HMR
cd src/clients/web/app && bun run dev
```

Vite proxies WebSocket to ECP server for development.

### Production Build

```bash
# Build Svelte app
cd src/clients/web/app && bun run build

# Output goes to src/clients/web/app/dist/
# Server serves these static files in production
```

### Starting GUI

```bash
# Production mode
ultra --gui

# Development mode
ultra --gui --dev
```

## Future Phases

### Phase 2: AI Chat Integration
- Add AI terminal chat component
- Claude/Codex provider support
- Session persistence

### Phase 3: Advanced Editor Features
- Multi-cursor support
- Find/replace with regex
- Minimap
- Breadcrumbs

### Phase 4: Remote Access
- Enable `allowRemote` config
- Token-based authentication
- Connection encryption (TLS)
- Session management for multiple clients

### Phase 5: Tauri Desktop App
- Tauri wrapper for native experience
- System tray integration
- Native file dialogs
- OS-specific shortcuts

## Configuration

New settings for web GUI:

```jsonc
// ~/.ultra/settings.jsonc
{
  "web.server.port": 7890,
  "web.server.allowRemote": false,
  "web.server.authToken": null,
  "web.ui.defaultLayout": "editor-terminal-split",
  "web.ui.sidebarPosition": "left",
  "web.ui.sidebarWidth": 250,
  "web.ui.terminalHeight": 300
}
```

## Security Considerations

1. **Local-Only by Default**: WebSocket server binds to `localhost` only
2. **Auth Stubs**: Authentication hooks in place for future remote support
3. **Token Validation**: When remote enabled, all requests require valid token
4. **Origin Checking**: WebSocket upgrade validates origin header
5. **No External Fetches**: Web app is fully self-contained

## Performance Considerations

1. **Lazy Loading**: Monaco and xterm.js loaded on demand
2. **Virtual Scrolling**: File tree uses virtual list for large directories
3. **Debounced Updates**: Editor changes batched before sending to server
4. **Efficient Diffs**: Only changed regions sent for document updates
5. **WebSocket Compression**: Enable permessage-deflate extension
