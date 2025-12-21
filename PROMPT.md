---

## Ultra - Terminal Code Editor

**Build a terminal-native code editor called "Ultra" using Bun + TypeScript with terminal-kit.**

### Project Overview

Ultra is a lightweight, terminal-based code editor with Sublime Text ergonomics, VS Code configuration compatibility, and AI-native capabilities. Target: fast startup (<500ms), low memory footprint, single binary distribution via Bun.

### Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict mode)
- **TUI Framework**: terminal-kit
- **Syntax Highlighting**: Tree-sitter (via tree-sitter WASM bindings or node bindings)
- **LSP Client**: vscode-languageclient protocol implementation (or minimal custom)
- **AI Integration**: Anthropic Claude API (claude-sonnet-4-20250514 for speed)
- **Build Output**: Single executable via `bun build --compile`

### Directory Structure

```
ultra/
├── src/
│   ├── index.ts              # Entry point
│   ├── app.ts                # Main application orchestrator
│   ├── core/
│   │   ├── buffer.ts         # Text buffer with piece table or rope
│   │   ├── cursor.ts         # Cursor/selection management (multi-cursor)
│   │   ├── document.ts       # Document model (file <-> buffer)
│   │   └── undo.ts           # Undo/redo stack
│   ├── ui/
│   │   ├── renderer.ts       # Main terminal-kit renderer
│   │   ├── layout.ts         # Pane/split management
│   │   ├── mouse.ts          # Mouse event handling and delegation
│   │   ├── components/
│   │   │   ├── editor-pane.ts
│   │   │   ├── file-tree.ts
│   │   │   ├── tab-bar.ts
│   │   │   ├── status-bar.ts
│   │   │   ├── command-palette.ts
│   │   │   ├── terminal-pane.ts
│   │   │   └── ai-panel.ts
│   │   └── themes/
│   │       └── theme-loader.ts  # VS Code theme parser
│   ├── features/
│   │   ├── syntax/
│   │   │   ├── highlighter.ts
│   │   │   └── tree-sitter-loader.ts
│   │   ├── lsp/
│   │   │   ├── client.ts
│   │   │   └── providers.ts   # completion, hover, goto-def
│   │   ├── search/
│   │   │   ├── file-search.ts    # Fuzzy file finder
│   │   │   └── project-search.ts # ripgrep integration
│   │   ├── git/
│   │   │   └── git-integration.ts
│   │   └── ai/
│   │       ├── claude-client.ts
│   │       └── context-builder.ts
│   ├── input/
│   │   ├── keymap.ts          # Keybinding system
│   │   ├── commands.ts        # Command registry
│   │   └── keybindings-loader.ts # VS Code keybindings.json parser
│   └── config/
│       ├── settings.ts        # Settings manager
│       └── settings-loader.ts # VS Code settings.json parser
├── config/
│   ├── default-keybindings.json
│   ├── default-settings.json
│   └── themes/
│       └── one-dark.json      # Bundled default theme
├── package.json
├── tsconfig.json
└── bunfig.toml
```

### Input System Foundation

**Initialize terminal-kit with full input capture on startup:**

```typescript
// In renderer.ts or input initialization
term.grabInput({ mouse: 'motion' }); // Full mouse tracking including hover

// Mouse event types to handle:
// 'MOUSE_LEFT_BUTTON_PRESSED', 'MOUSE_LEFT_BUTTON_RELEASED'
// 'MOUSE_RIGHT_BUTTON_PRESSED', 'MOUSE_RIGHT_BUTTON_RELEASED'
// 'MOUSE_MIDDLE_BUTTON_PRESSED'
// 'MOUSE_WHEEL_UP', 'MOUSE_WHEEL_DOWN'
// 'MOUSE_DRAG', 'MOUSE_MOTION'

term.on('mouse', (name: string, data: MouseEvent) => {
  // data.x, data.y - 1-indexed position
  // data.shift, data.ctrl, data.meta - modifiers
  // Route to appropriate component based on coordinates and layout
});
```

**Mouse Handler Interface** (all UI components implement):
```typescript
interface MouseHandler {
  containsPoint(x: number, y: number): boolean;
  onMouseEvent(event: MouseEvent): boolean; // return true if handled
}
```

### Phase 1: Core Editor (MVP)

**Goal**: Open a file, edit it, save it, with syntax highlighting and basic mouse support.

1. **Buffer Implementation**
   - Use piece table data structure for efficient insertions/deletions
   - Line index for O(1) line lookups
   - UTF-8 aware with grapheme cluster handling

2. **Basic Renderer**
   - Full terminal-kit screen management
   - Viewport scrolling (vertical and horizontal)
   - Line numbers gutter
   - Single editor pane filling screen
   - Status bar (filename, cursor position, file type, encoding)

3. **Core Editing**
   - Insert/delete characters
   - Newline handling
   - Backspace/delete
   - Arrow key navigation
   - Home/End, Page Up/Down
   - Undo/redo (operation-based, not snapshot)

4. **Mouse Support (Editor)**
   - Click to position cursor (translate screen coords to buffer position)
   - Click and drag to select text
   - Double-click to select word
   - Triple-click to select line
   - Scroll wheel for vertical scrolling
   - `Shift+Scroll` for horizontal scrolling

5. **File Operations**
   - Open file from CLI argument: `ultra ./file.ts`
   - Save: `Cmd+S`
   - Dirty indicator in tab/status bar

6. **Syntax Highlighting**
   - Tree-sitter integration for parsing
   - VS Code theme JSON parser (TextMate scope mapping)
   - Start with: TypeScript, JavaScript, JSON, Markdown, Rust, Python, Ruby
   - Lazy/incremental parsing on edits

**Keybindings (Phase 1)**:
```
Cmd+S              → Save
Cmd+Z              → Undo
Cmd+Shift+Z        → Redo
Cmd+Q              → Quit
Arrows             → Move cursor
Cmd+Left/Right     → Line start/end
Cmd+Up/Down        → File start/end
Option+Left/Right  → Word jump
Shift+Arrow        → Extend selection
```

### Phase 2: Multi-Buffer & Layout

1. **Tab System**
   - Tab bar component at top
   - `Cmd+W` close tab
   - `Cmd+Option+Left/Right` switch tabs
   - `Cmd+1-9` jump to tab by index
   - Modified indicator dot
   - **Mouse**:
     - Click tab to switch
     - Middle-click tab to close
     - Drag tab to reorder (track drag start, highlight drop position)

2. **Split Panes**
   - `Cmd+\` split vertical
   - `Cmd+Shift+\` split horizontal
   - `Cmd+Option+Arrow` move focus between panes
   - Each pane has independent tab bar
   - **Mouse**:
     - Click in pane to focus
     - Drag divider to resize (cursor changes to resize indicator)
     - Minimum pane size enforced (e.g., 10 columns / 5 rows)

3. **File Tree Sidebar**
   - Toggle with `Cmd+B`
   - Tree view with expand/collapse
   - File icons (nerd font compatible)
   - Keyboard navigation (j/k or arrows, enter to open)
   - **Mouse**:
     - Click to select item
     - Double-click to open file / toggle folder expand
     - Right-click for context menu (New File, New Folder, Rename, Delete)
     - Drag and drop to move files/folders (stretch goal)
     - Drag divider between sidebar and editor to resize

### Phase 3: Multi-Cursor & Sublime Commands

1. **Multi-Cursor**
   - `Cmd+D` select next occurrence of current word/selection
   - `Cmd+Shift+L` split selection into lines (cursors on each line)
   - `Option+Up/Down` add cursor above/below
   - All cursors edit simultaneously
   - **Mouse**:
     - `Cmd+Click` to add cursor at position
     - `Cmd+Click+Drag` to add selection at position

2. **Selection**
   - `Shift+Arrow` extend selection
   - `Cmd+A` select all
   - `Cmd+L` select line
   - `Shift+Click` extend selection from current cursor to click position
   - Mouse drag to select (already in Phase 1)

3. **Command Palette**
   - `Cmd+Shift+P` open
   - Fuzzy search all commands
   - Show keybinding next to command
   - Recent commands at top
   - **Mouse**:
     - Click item to execute
     - Scroll wheel to navigate list
     - Click outside to dismiss

4. **Fuzzy File Finder**
   - `Cmd+P` open
   - Respects .gitignore
   - Show file path context
   - Enter to open, `Cmd+Enter` to open in split
   - **Mouse**:
     - Click item to open
     - Scroll wheel to navigate
     - Click outside to dismiss

### Phase 4: LSP Integration

1. **LSP Client**
   - Auto-detect and spawn language servers (typescript-language-server, rust-analyzer, etc.)
   - Configuration in settings.json for server paths

2. **Features**
   - **Autocomplete**: Inline popup, Tab/Enter to accept
     - **Mouse**: Click item to select
   - **Hover**: Show type/docs on `Cmd+K Cmd+I` or mouse hover (with delay, ~500ms)
   - **Go to Definition**: `Cmd+Click` or `F12`
   - **Find References**: `Shift+F12`
   - **Rename Symbol**: `F2`
   - **Diagnostics**: Inline squiggles, gutter icons, problems panel
     - **Mouse**: Click gutter icon to show diagnostic popup
     - **Mouse**: Hover over squiggle to show diagnostic

3. **Diagnostics Panel**
   - Toggle with `Cmd+Shift+M`
   - List of errors/warnings
   - **Mouse**: Click item to jump to location
   - **Mouse**: Scroll wheel to navigate

### Phase 5: Search & Git

1. **Project-Wide Search**
   - `Cmd+Shift+F` open search panel
   - Use ripgrep (`rg`) as backend for speed
   - Regex support toggle
   - Case sensitivity toggle
   - Results tree with file grouping
   - Replace in files support
   - **Mouse**:
     - Click result to jump to location
     - Click file header to expand/collapse
     - Click toggle buttons (regex, case)
     - Scroll wheel to navigate results

2. **In-File Search**
   - `Cmd+F` find bar (appears at top of editor pane)
   - `Cmd+G` / `Enter` find next
   - `Cmd+Shift+G` / `Shift+Enter` find previous
   - `Cmd+H` find and replace
   - `Cmd+Option+Enter` replace all
   - **Mouse**:
     - Click next/prev buttons
     - Click replace/replace all buttons
     - Click outside or X to dismiss

3. **Git Integration**
   - Gutter indicators: added (green), modified (yellow), deleted (red)
   - Status bar branch name with icon
   - `Cmd+Shift+G` toggle Git panel showing changed files
   - Inline diff view (later: full diff viewer)
   - **Mouse**:
     - Click gutter indicator to show inline diff popup
     - Click changed file in Git panel to open diff
     - Right-click for stage/unstage/revert options

### Phase 6: Terminal & AI Panel

1. **Embedded Terminal**
   - `Cmd+`` ` toggle terminal pane (bottom)
   - Full PTY support (node-pty or Bun equivalent)
   - Multiple terminal tabs
   - Shell integration (detect cwd, command status)
   - **Mouse**:
     - Click to focus terminal pane
     - Pass all mouse events through to PTY (for vim, htop, etc.)
     - Click terminal tabs to switch
     - Drag divider to resize terminal height

2. **AI Panel (Claude Integration)**
   - `Cmd+I` toggle AI panel (right sidebar)
   - Chat interface with message history
   - Context awareness:
     - Current file name and content
     - Current selection (if any)
     - Project file list (top-level structure)
     - Recent diagnostics/errors
   - Actions from AI responses:
     - "Apply to file" button for code blocks
     - "Copy" button
   - Streaming responses
   - Conversation history (per-session, optionally persist)
   - **Mouse**:
     - Click "Apply" to insert code block at cursor / replace selection
     - Click "Copy" to copy code block to clipboard
     - Scroll wheel to navigate conversation history
     - Click in input textarea to focus
     - Drag left edge to resize panel width
     - Click "New Chat" button to clear history

**Context Builder API**:
```typescript
interface AIContext {
  currentFile: {
    path: string;
    content: string;
    language: string;
    cursorPosition: Position;
    selection?: { text: string; range: Range };
  } | null;
  openFiles: Array<{ path: string; language: string }>;
  projectRoot: string;
  projectStructure: string; // tree output, truncated
  recentDiagnostics: Diagnostic[];
}

interface AIProvider {
  chat(message: string, context: AIContext): AsyncIterable<string>;
  abort(): void;
}
```

### Configuration Compatibility

**settings.json format** (subset):
```json
{
  "editor.fontSize": 14,
  "editor.tabSize": 2,
  "editor.insertSpaces": true,
  "editor.wordWrap": "off",
  "editor.lineNumbers": "on",
  "editor.minimap.enabled": false,
  "editor.renderWhitespace": "selection",
  "editor.mouseWheelScrollSensitivity": 3,
  "files.autoSave": "off",
  "files.exclude": { "**/node_modules": true },
  "workbench.colorTheme": "One Dark Pro",
  "ultra.ai.model": "claude-sonnet-4-20250514",
  "ultra.ai.apiKey": "${env:ANTHROPIC_API_KEY}"
}
```

**keybindings.json format**:
```json
[
  { "key": "cmd+s", "command": "ultra.save" },
  { "key": "cmd+d", "command": "ultra.selectNextOccurrence" },
  { "key": "cmd+shift+p", "command": "ultra.commandPalette" },
  { "key": "cmd+click", "command": "ultra.addCursorAtPosition" },
  { "key": "cmd+b", "command": "ultra.toggleSidebar" }
]
```

**Theme format**: Standard VS Code theme JSON with TextMate scopes.

### Non-Goals (For Now)

- Full VS Code extension runtime
- Remote development / SSH
- Notebooks
- Debugging (DAP)
- Extension marketplace

### Implementation Notes

1. **Performance**: Profile startup aggressively. Lazy load Tree-sitter grammars. Use Bun's fast file I/O.

2. **Mouse Coordinate Translation**: Terminal-kit provides 1-indexed coordinates. Build a robust system to translate screen coordinates to:
   - Buffer line/column (accounting for scroll offset, line numbers gutter, wrapped lines)
   - UI component (hit testing against layout bounds)

3. **Click Detection**: Implement double/triple click detection with timing threshold (~300ms). Track click count and reset on timeout or position change.

4. **Drag State Machine**: Track drag operations with clear states:
   ```typescript
   type DragState = 
     | { type: 'none' }
     | { type: 'selecting'; startPos: Position }
     | { type: 'resizing'; divider: Divider; startSize: number }
     | { type: 'reordering-tab'; tabIndex: number }
   ```

5. **Error Handling**: Graceful degradation if LSP not found, if theme fails to load, etc.

6. **Testing**: Unit tests for buffer operations, keybinding parser, theme loader, coordinate translation. Integration tests for file operations.

7. **Distribution**: `bun build --compile --target=bun-darwin-arm64 ./src/index.ts --outfile ultra`

### Getting Started

Begin with Phase 1. Create the project structure, implement the buffer, get a single file rendering with syntax highlighting and basic editing. Include mouse click-to-position and drag-to-select from the start. Commit at each working milestone.

Remember to make regular git commits with clear commit messages detailed the steps you've taken.