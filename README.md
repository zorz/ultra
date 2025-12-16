# Ultra

_v0.6.0_

A terminal-native code editor with Sublime Text ergonomics, VS Code configuration compatibility, and AI-native capabilities. Also includes git.




## Features

- **Piece Table Buffer** - Efficient text editing with O(log n) insert/delete
- **Multi-Cursor Support** - Edit multiple locations simultaneously
- **VS Code Keybindings** - Familiar keyboard shortcuts
- **Mouse Support** - Click, drag to select, scroll
- **Theme Support** - VS Code-compatible color themes
- **Undo/Redo** - Operation-based with intelligent action merging

## Requirements

- [Bun](https://bun.sh) v1.0 or later

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/ultra-editor.git
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

# Run with hot reload
bun --watch run src/index.ts file.ts
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

### Navigation
| Shortcut | Action |
|----------|--------|
| `Ctrl+G` | Go to line |
| `Ctrl+Home` | Go to start of file |
| `Ctrl+End` | Go to end of file |
| `Home` | Go to start of line |
| `End` | Go to end of line |
| `Ctrl+Left` | Move word left |
| `Ctrl+Right` | Move word right |

### Multi-Cursor
| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+Up` | Add cursor above |
| `Ctrl+Alt+Down` | Add cursor below |
| `Escape` | Clear secondary cursors |

### View
| Shortcut | Action |
|----------|--------|
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+\`` | Toggle terminal |
| `Ctrl+P` | Command palette |
| `Ctrl+Tab` | Next tab |
| `Ctrl+Shift+Tab` | Previous tab |

## Project Structure

```
ultra-editor/
├── src/
│   ├── index.ts              # Entry point
│   ├── app.ts                # Main application orchestrator
│   ├── core/
│   │   ├── buffer.ts         # Piece table text buffer
│   │   ├── cursor.ts         # Multi-cursor management
│   │   ├── document.ts       # Document model with file I/O
│   │   └── undo.ts           # Undo/redo system
│   ├── ui/
│   │   ├── renderer.ts       # Terminal rendering
│   │   ├── layout.ts         # Pane layout management
│   │   ├── mouse.ts          # Mouse event handling
│   │   ├── components/
│   │   │   ├── editor-pane.ts
│   │   │   ├── tab-bar.ts
│   │   │   ├── status-bar.ts
│   │   │   └── ...
│   │   └── themes/
│   │       └── theme-loader.ts
│   ├── input/
│   │   ├── commands.ts       # Command registry
│   │   ├── keymap.ts         # Keybinding system
│   │   └── keybindings-loader.ts
│   ├── config/
│   │   ├── settings.ts       # Settings manager
│   │   └── settings-loader.ts
│   └── features/
│       ├── syntax/           # Syntax highlighting (WIP)
│       ├── lsp/              # Language Server Protocol (WIP)
│       ├── search/           # File/project search (WIP)
│       ├── git/              # Git integration (WIP)
│       └── ai/               # AI features (WIP)
├── config/
│   ├── default-settings.json
│   ├── default-keybindings.json
│   └── themes/
│       └── one-dark.json
├── package.json
└── tsconfig.json
```

## Configuration

Ultra uses VS Code-compatible configuration files:

### Settings (`~/.config/ultra/settings.json`)

```json
{
  "editor.tabSize": 4,
  "editor.insertSpaces": true,
  "editor.wordWrap": "off",
  "editor.lineNumbers": "on",
  "editor.cursorStyle": "line",
  "editor.cursorBlinking": "blink"
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
  }
]
```

### Themes

Place VS Code-compatible theme JSON files in `~/.config/ultra/themes/`.

## Development Roadmap

- [x] **Phase 1**: Core Editor MVP
  - Piece table buffer
  - Multi-cursor editing
  - Basic UI (editor, tabs, status bar)
  - Keybinding system
  - File I/O

- [ ] **Phase 2**: Enhanced Editing
  - Tree-sitter syntax highlighting
  - Auto-indent
  - Bracket matching
  - Code folding

- [ ] **Phase 3**: IDE Features
  - LSP integration
  - File tree sidebar
  - Project-wide search
  - Git integration

- [ ] **Phase 4**: AI Integration
  - Claude API integration
  - Inline code suggestions
  - Chat panel
  - Context-aware completions

## License

Copyright 2025, Zorz LLC, All Rights Reserved
