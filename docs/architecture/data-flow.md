# Data Flow

This document describes how data flows through Ultra's ECP architecture.

## Overview

Ultra follows a service-oriented data flow pattern:

```
User Input → TUI Client → ECP Request → Service → State Update → Event → Render
```

## Input Processing

### Keyboard Input Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Terminal stdin                               │
│                     (raw bytes in raw mode)                         │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      TUI Client Key Handler                          │
│  - Parses escape sequences                                          │
│  - Identifies special keys (arrows, function keys)                  │
│  - Detects modifiers (ctrl, alt, shift, meta)                       │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         KeyEvent                                     │
│  { key: 's', ctrl: true, shift: false, alt: false, meta: false }   │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Keybinding Resolution                            │
│  - Converts event to key string: "ctrl+s"                           │
│  - Checks context conditions (when clauses)                         │
│  - Returns command ID: "file.save"                                  │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Command Handler Execution                          │
│  - Looks up handler in commandHandlers map                          │
│  - Calls appropriate service methods                                │
└─────────────────────────────────────────────────────────────────────┘
```

### Mouse Input Flow

```
Mouse Event (ANSI escape sequence)
         │
         ▼
┌─────────────────┐
│   Mouse Parser  │
│  (TUI Client)   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        MouseEvent                                    │
│  { x, y, button, action: 'click' | 'drag' | 'scroll' }             │
└────────────────────────────────┬────────────────────────────────────┘
         │
         ├────────────────────────┬────────────────────────┐
         ▼                        ▼                        ▼
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  Window Layout  │      │   Hit Test      │      │   Component     │
│  (find target)  │      │ (find element)  │      │    Handler      │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

## ECP Data Flow

### Client to Service

All operations flow through the ECP server:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         TUI Client                                   │
│                                                                      │
│  // User types 'a' in editor                                        │
│  const result = await ecpServer.request('document/insert', {        │
│    documentId: 'doc-123',                                           │
│    position: { line: 5, column: 10 },                              │
│    text: 'a'                                                        │
│  });                                                                │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         ECP Server                                   │
│  (src/ecp/server.ts)                                                │
│                                                                      │
│  // Routes based on method prefix                                   │
│  if (method.startsWith('document/')) {                              │
│    return documentAdapter.handleRequest(method, params);            │
│  }                                                                  │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Document Service Adapter                          │
│  (src/services/document/adapter.ts)                                 │
│                                                                      │
│  case 'document/insert':                                            │
│    return this.service.insert(params.documentId, params.position,   │
│                               params.text);                         │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Local Document Service                            │
│  (src/services/document/local.ts)                                   │
│                                                                      │
│  // Updates buffer, manages undo, emits events                      │
│  this.buffer.insertAt(position, text);                              │
│  this.emit('contentChanged', { documentId, changes });              │
└─────────────────────────────────────────────────────────────────────┘
```

## Text Editing Flow

### Character Insertion

```
Key Press ('a')
      │
      ▼
┌─────────────────┐
│ Document Editor │
│ handleChar('a') │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Document Service                                  │
│                                                                      │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐             │
│  │ insertAt()  │───▶│   Buffer    │───▶│ Undo Stack  │             │
│  │             │    │ (piece tbl) │    │ (snapshot)  │             │
│  └─────────────┘    └─────────────┘    └─────────────┘             │
│                                                                      │
│  emit('contentChanged')                                              │
└────────────────────────────────┬────────────────────────────────────┘
         │
         ├──────────────────────────────────────────┐
         ▼                                          ▼
┌─────────────────┐                        ┌─────────────────┐
│ LSP Service     │                        │ Syntax Service  │
│ (didChange)     │                        │ (invalidate)    │
└─────────────────┘                        └────────┬────────┘
                                                    │
                                                    ▼
                                           ┌─────────────────┐
                                           │ scheduleRender()│
                                           └─────────────────┘
```

### Buffer Operations

The piece table buffer tracks text efficiently:

```
Initial State:
  originalBuffer: "Hello World"
  addBuffer: ""
  pieces: [{ source: 'original', start: 0, length: 11 }]

After Insert " Beautiful" at position 5:
  originalBuffer: "Hello World"
  addBuffer: " Beautiful"
  pieces: [
    { source: 'original', start: 0, length: 5 },   // "Hello"
    { source: 'add', start: 0, length: 10 },       // " Beautiful"
    { source: 'original', start: 5, length: 6 }    // " World"
  ]

Result: "Hello Beautiful World"
```

## File Operations

### File Open Flow

```
Command: file.open
         │
         ▼
┌─────────────────┐
│ TUI Client      │
│ openFile()      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    File Service + Document Service                   │
│                                                                      │
│  1. file/read - Read file content from disk                         │
│  2. document/open - Create document with content                    │
│  3. Detect language from extension                                  │
│  4. Initialize undo history                                         │
└────────────────────────────────┬────────────────────────────────────┘
         │
         ├──────────────────────────────────────────┐
         ▼                                          ▼
┌─────────────────┐                        ┌─────────────────┐
│ LSP Service     │                        │ Syntax Service  │
│ didOpen()       │                        │ loadLanguage()  │
└─────────────────┘                        └─────────────────┘
         │
         ▼
┌─────────────────┐
│ TUI Window      │
│ Add tab to pane │
└─────────────────┘
```

### File Save Flow

```
Command: file.save
         │
         ▼
┌─────────────────┐
│ TUI Client      │
│ save()          │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Document Service → File Service                   │
│                                                                      │
│  1. document/content - Get buffer content                           │
│  2. file/write - Write to disk                                      │
│  3. Clear dirty flag                                                │
│  4. Update undo checkpoint                                          │
└────────────────────────────────┬────────────────────────────────────┘
         │
         ├──────────────────────────────────────────┐
         ▼                                          ▼
┌─────────────────┐                        ┌─────────────────┐
│ LSP Service     │                        │ Notification    │
│ didSave()       │                        │ "File saved"    │
└─────────────────┘                        └─────────────────┘
```

## LSP Data Flow

### Autocomplete Flow

```
User Types Character
         │
         ▼
┌─────────────────┐
│ LSP Integration │
│ triggerComplete │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      LSP Service                                     │
│  lsp/completion request                                              │
│  { uri, position: { line, character } }                             │
└────────────────────────────────┬────────────────────────────────────┘
         │ JSON-RPC over stdio
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Language Server                                   │
│              (typescript-language-server, pyright, etc.)            │
└────────────────────────────────┬────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Completion Response                                │
│  { items: [{ label, kind, insertText, ... }] }                      │
└────────────────────────────────┬────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│ Autocomplete    │
│ Popup Overlay   │
│ (show items)    │
└─────────────────┘
```

### Document Sync

```
Document Modified
         │
         ├──────────────────────────────────────────┐
         ▼                                          │
┌─────────────────────────────────────────────────┐ │
│              LSP didChange                      │ │
│  Full sync: entire document content             │ │
│  Incremental: only changed ranges               │ │
└─────────────────────────────────────────────────┘ │
         │                                          │
         ▼                                          │
┌─────────────────────────────────────────────────┐ │
│           Language Server                        │ │
│  - Updates internal document model              │ │
│  - Runs diagnostics                             │ │
│  - Returns publishDiagnostics                   │ │
└─────────────────────────────────┬───────────────┘ │
         │                                          │
         ▼                                          │
┌─────────────────────────────────────────────────┐ │
│         Diagnostics Overlay                      │◀┘
│  - Updates error/warning markers                │
│  - Schedules re-render                          │
└─────────────────────────────────────────────────┘
```

## Git Data Flow

### Status Update Flow

```
File Modified / Timer Tick / Manual Refresh
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Git Service                                     │
│  (src/services/git/)                                                │
│                                                                      │
│  await git.getStatus()                                              │
│  // Internally: git status --porcelain, git diff --numstat          │
└────────────────────────────────┬────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Parse Output                                  │
│  - Staged files (A, M, D, R)                                        │
│  - Modified files (not staged)                                      │
│  - Untracked files                                                  │
└────────────────────────────────┬────────────────────────────────────┘
         │
         ├──────────────────────────────────────────┐
         ▼                                          ▼
┌─────────────────┐                        ┌─────────────────┐
│ Git Panel       │                        │ Editor Gutter   │
│ Update list     │                        │ Show indicators │
└─────────────────┘                        └─────────────────┘
```

## Session State Flow

### State Persistence

```
User Action (open file, move cursor, split pane)
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Session Service                                   │
│  (src/services/session/)                                            │
│                                                                      │
│  - Tracks open documents with cursor/scroll positions               │
│  - Tracks terminal tabs and their sessions                          │
│  - Tracks AI chat tabs with session IDs                             │
│  - Tracks pane layout (splits, active pane)                         │
│  - Tracks UI state (sidebar, panel visibility)                      │
└────────────────────────────────┬────────────────────────────────────┘
         │
         ▼ (on idle or explicit save)
┌─────────────────────────────────────────────────────────────────────┐
│                    File System                                       │
│  ~/.ultra/sessions/<workspace>.json                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### Settings Flow

```
User Changes Setting
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Session Service                                   │
│                                                                      │
│  setSetting('editor.tabSize', 4)                                    │
│  → Validate against schema                                          │
│  → Update in-memory settings                                        │
│  → Write to ~/.ultra/settings.jsonc                                 │
│  → Emit 'settingChanged' event                                      │
└────────────────────────────────┬────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Components React                                  │
│                                                                      │
│  - Editor updates tab rendering                                      │
│  - Affected components schedule re-render                           │
└─────────────────────────────────────────────────────────────────────┘
```

## Render Data Flow

See [Rendering Architecture](rendering.md) for detailed render pipeline.

```
State Change
      │
      ▼
scheduleRender()
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Render Pass                                       │
│                                                                      │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐        │
│  │ Tab Bar   │  │ Editor    │  │ Sidebar   │  │ Status Bar│        │
│  │ render()  │  │ render()  │  │ render()  │  │ render()  │        │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘        │
│        │              │              │              │                │
│        └──────────────┴──────────────┴──────────────┘                │
│                              │                                       │
│                              ▼                                       │
│                    ┌─────────────────┐                              │
│                    │  ScreenBuffer   │                              │
│                    │  (dirty cells)  │                              │
│                    └────────┬────────┘                              │
│                              │                                       │
│                              ▼                                       │
│                    ┌─────────────────┐                              │
│                    │ ANSI Sequences  │                              │
│                    │ (terminal out)  │                              │
│                    └─────────────────┘                              │
└─────────────────────────────────────────────────────────────────────┘
```

## Event System

### Event Callback Pattern

```typescript
// Services emit events
documentService.on('contentChanged', (event) => {
  // Handle document change
});

// Registration returns unsubscribe function
const unsubscribe = service.onChange((data) => {
  // Handle change
});

// Clean up later
unsubscribe();
```

### Common Events

| Event | Source | Listeners |
|-------|--------|-----------|
| `contentChanged` | Document Service | LSP Service, Syntax Service, Git Service |
| `cursorMoved` | Document Service | Status Bar, LSP Hover |
| `fileSaved` | Document Service | LSP Service, Git Service |
| `focusChanged` | Window | Status Bar, Keybinding Resolution |
| `themeChanged` | Session Service | All renderers |
| `settingChanged` | Session Service | Affected components |

## Related Documentation

- [Architecture Overview](overview.md) - ECP architecture
- [Rendering](rendering.md) - Terminal rendering pipeline
- [Keybindings](keybindings.md) - Keyboard input handling
