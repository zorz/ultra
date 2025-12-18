# Ultra

_v0.8.0_

A terminal-native code editor with Sublime Text ergonomics, VS Code configuration compatibility, and modern IDE features. Built with Bun for maximum performance.

## Features

### Core Editor
- **Piece Table Buffer** - Efficient text editing with O(log n) insert/delete operations
- **Multi-Cursor Support** - Edit multiple locations simultaneously with full selection support
- **Word Wrap** - Intelligent line wrapping with word-boundary awareness
- **Code Folding** - Collapse/expand code blocks with visual indicators
- **Undo/Redo** - Operation-based history with intelligent action merging

### IDE Features
- **Syntax Highlighting** - Shiki-powered highlighting with TextMate grammar support
- **LSP Integration** - Language Server Protocol support for completions, hover, go-to-definition
- **Git Integration** - Inline diff view, staging, gutter indicators, branch management
- **File Tree** - Sidebar navigation with git status indicators
- **Integrated Terminal** - Built-in terminal with PTY support
- **Minimap** - Code overview with scroll position indicator

### User Experience
- **VS Code Keybindings** - Familiar keyboard shortcuts out of the box
- **VS Code Themes** - Full compatibility with VS Code color themes
- **Mouse Support** - Click positioning, drag selection, scroll wheel
- **Command Palette** - Full API access via fuzzy-searchable command palette
- **Split Panes** - Horizontal and vertical editor splits
- **Tab Management** - Multiple document tabs with dirty indicators

### Configuration
- **Hot-Reloadable Settings** - JSON-based configuration that updates live
- **Custom Keybindings** - Full keybinding customization via JSON
- **Per-Language Settings** - Language-specific editor configurations

## Requirements

- [Bun](https://bun.sh) v1.0 or later

## Installation

```bash
# Clone the repository
git clone https://github.com/AgeOfLearning/ultra-editor.git
cd ultra-editor

# Install dependencies
bun install
```

## Usage

### Development Mode

```bash
# Open with no file (scratch buffer)
bun run dev

# Open a specific file
bun run dev path/to/file.ts

# Open a directory
bun run dev /path/to/project

# Run with hot reload
bun --watch run src/index.ts file.ts

# Enable debug logging
bun run dev --debug
```

### Build Executable

```bash
# Build native binary
bun run build

# Run the built executable
./ultra file.ts
```

### Type Checking

```bash
bun run typecheck
```

## Keyboard Shortcuts

### File Operations
| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save file |
| `Ctrl+Shift+S` | Save As |
| `Ctrl+O` | Open file |
| `Ctrl+N` | New file |
| `Ctrl+W` | Close tab |
| `Ctrl+Q` | Quit |

### Editing
| Shortcut | Action |
|----------|--------|
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+C` | Copy |
| `Ctrl+X` | Cut |
| `Ctrl+V` | Paste |
| `Ctrl+A` | Select all |
| `Ctrl+D` | Select word / Add cursor at next occurrence |
| `Ctrl+/` | Toggle line comment |
| `Ctrl+]` | Indent line |
| `Ctrl+[` | Outdent line |

### Navigation
| Shortcut | Action |
|----------|--------|
| `Ctrl+G` | Go to line |
| `Ctrl+P` | Quick open file |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+Home` | Go to start of file |
| `Ctrl+End` | Go to end of file |
| `Home` | Go to start of line |
| `End` | Go to end of line |
| `Ctrl+Left` | Move word left |
| `Ctrl+Right` | Move word right |
| `F12` | Go to definition |
| `Shift+F12` | Find references |

### Multi-Cursor
| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+Up` | Add cursor above |
| `Ctrl+Alt+Down` | Add cursor below |
| `Ctrl+Shift+L` | Add cursor to all occurrences |
| `Escape` | Clear secondary cursors |

### View
| Shortcut | Action |
|----------|--------|
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+\`` | Toggle terminal |
| `Ctrl+Shift+G` | Toggle git panel |
| `Ctrl+Tab` | Next tab |
| `Ctrl+Shift+Tab` | Previous tab |
| `Ctrl+\` | Split editor |
| `Ctrl+K Ctrl+[` | Fold region |
| `Ctrl+K Ctrl+]` | Unfold region |

### Search
| Shortcut | Action |
|----------|--------|
| `Ctrl+F` | Find in file |
| `Ctrl+H` | Find and replace |
| `F3` | Find next |
| `Shift+F3` | Find previous |

## Project Structure

```
ultra-editor/
├── src/
│   ├── index.ts              # Entry point
│   ├── app.ts                # Main application orchestrator
│   ├── constants.ts          # Centralized configuration constants
│   ├── core/
│   │   ├── buffer.ts         # Piece table text buffer
│   │   ├── cursor.ts         # Multi-cursor management
│   │   ├── document.ts       # Document model with file I/O
│   │   ├── undo.ts           # Undo/redo system
│   │   ├── fold.ts           # Code folding manager
│   │   ├── event-emitter.ts  # Typed event emitter base class
│   │   ├── result.ts         # Result type for error handling
│   │   ├── cache.ts          # Cache manager with TTL
│   │   ├── errors.ts         # Error handling infrastructure
│   │   ├── auto-indent.ts    # Auto-indentation
│   │   ├── auto-pair.ts      # Auto-pairing brackets
│   │   └── bracket-match.ts  # Bracket matching
│   ├── ui/
│   │   ├── renderer.ts       # Terminal rendering engine
│   │   ├── render-scheduler.ts # Priority-based render batching
│   │   ├── colors.ts         # Shared color utilities
│   │   ├── mouse.ts          # Mouse event handling
│   │   ├── components/
│   │   │   ├── pane.ts       # Main editor pane
│   │   │   ├── pane-manager.ts # Multi-pane orchestration
│   │   │   ├── pane/         # Decomposed pane components
│   │   │   │   ├── pane-gutter.ts
│   │   │   │   └── inline-diff.ts
│   │   │   ├── tab-bar.ts
│   │   │   ├── status-bar.ts
│   │   │   ├── file-tree.ts
│   │   │   ├── git-panel.ts
│   │   │   ├── terminal-pane.ts
│   │   │   ├── minimap.ts
│   │   │   ├── command-palette.ts
│   │   │   ├── search-widget.ts
│   │   │   └── ...
│   │   └── themes/
│   │       └── theme-loader.ts
│   ├── state/
│   │   └── editor-state.ts   # Centralized state management
│   ├── input/
│   │   ├── commands.ts       # Command registry
│   │   ├── keymap.ts         # Keybinding system
│   │   └── keybindings-loader.ts
│   ├── config/
│   │   ├── settings.ts       # Settings manager
│   │   ├── settings-loader.ts
│   │   └── defaults.ts       # Default themes and settings
│   ├── terminal/
│   │   ├── pty.ts            # PTY management
│   │   └── input.ts          # Terminal input handling
│   └── features/
│       ├── syntax/           # Shiki syntax highlighting
│       ├── lsp/              # Language Server Protocol
│       ├── search/           # File and project search
│       └── git/              # Git integration
├── config/
│   ├── default-settings.json
│   ├── default-keybindings.json
│   └── themes/
├── docs/
│   └── REFACTORING-RECOMMENDATIONS.md
├── package.json
└── tsconfig.json
```

## Configuration

Ultra uses VS Code-compatible configuration files:

### Settings (`~/.config/ultra/settings.json`)

```json
{
  "editor.tabSize": 2,
  "editor.insertSpaces": true,
  "editor.wordWrap": "off",
  "editor.lineNumbers": "on",
  "editor.cursorStyle": "line",
  "editor.cursorBlinking": "blink",
  "editor.minimap.enabled": true,
  "editor.folding": true,
  "workbench.colorTheme": "One Dark Pro"
}
```

### Keybindings (`~/.config/ultra/keybindings.json`)

```json
[
  {
    "key": "ctrl+s",
    "command": "file.save"
  },
  {
    "key": "ctrl+shift+p",
    "command": "command-palette.show"
  },
  {
    "key": "ctrl+`",
    "command": "terminal.toggle"
  }
]
```

### Themes

Place VS Code-compatible theme JSON files in `~/.config/ultra/themes/`.

Built-in themes include:
- One Dark Pro
- GitHub Dark
- Catppuccin Mocha
- Solarized Dark
- Nord

## Architecture

Ultra is built on several key architectural patterns:

- **Piece Table Buffer**: Efficient text storage using a piece table data structure
- **Event-Driven UI**: Components communicate via typed event emitters
- **Centralized State**: EditorStateManager provides a single source of truth
- **Priority Rendering**: RenderScheduler batches updates by priority
- **Result Types**: Explicit error handling without exceptions
- **Cache Management**: Coordinated caching with TTL and dependency tracking

## Development Roadmap

- [x] **Phase 1**: Core Editor
  - [x] Piece table buffer
  - [x] Multi-cursor editing
  - [x] Basic UI (editor, tabs, status bar)
  - [x] Keybinding system
  - [x] File I/O

- [x] **Phase 2**: Enhanced Editing
  - [x] Syntax highlighting (Shiki)
  - [x] Auto-indent
  - [x] Bracket matching & auto-pairing
  - [x] Code folding
  - [x] Word wrap

- [x] **Phase 3**: IDE Features
  - [x] LSP integration
  - [x] File tree sidebar
  - [x] Git integration with inline diff
  - [x] Integrated terminal
  - [x] Split panes
  - [x] Minimap

- [ ] **Phase 4**: Polish & Performance
  - [ ] Project-wide search
  - [ ] Symbol search
  - [ ] Performance profiling
  - [ ] Plugin system

- [ ] **Phase 5**: AI Integration
  - [ ] Claude API integration
  - [ ] Inline code suggestions
  - [ ] Chat panel
  - [ ] Context-aware completions

## License

Copyright 2025, Zorz LLC, All Rights Reserved
