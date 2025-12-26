# Ultra

_v0.5.0_

A terminal-native code editor with Sublime Text ergonomics, VS Code configuration compatibility, and integrated AI capabilities. Built with Bun for maximum performance.

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
- **Git Integration** - Inline diff view, staging, gutter indicators, branch management, timeline view
- **File Tree** - Sidebar navigation with git status indicators
- **Outline Panel** - Symbol navigation with LSP-powered document outline
- **Integrated Terminal** - Built-in terminal with full PTY support
- **Minimap** - Code overview with scroll position indicator
- **Search** - Project-wide search with regex support

### AI Integration
- **Claude Code** - Integrated Claude AI chat with session persistence
- **Codex** - OpenAI Codex integration for code assistance
- **AI Terminal** - Dedicated AI chat panel with context awareness

### User Experience
- **VS Code Keybindings** - Familiar keyboard shortcuts out of the box
- **VS Code Themes** - Full compatibility with VS Code color themes (Catppuccin, One Dark, etc.)
- **Mouse Support** - Click positioning, drag selection, scroll wheel
- **Command Palette** - Fuzzy-searchable command palette (`Ctrl+Shift+P`)
- **Split Panes** - Horizontal and vertical editor splits
- **Tab Management** - Multiple document tabs with dirty indicators
- **Session Persistence** - Automatic session save/restore

### Configuration
- **Hot-Reloadable Settings** - JSONC-based configuration that updates live
- **Custom Keybindings** - Full keybinding customization with context-aware "when" clauses
- **Per-Language Settings** - Language-specific editor configurations

## Requirements

- [Bun](https://bun.sh) v1.0 or later
- macOS, Linux, or Windows with WSL

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

# Enable debug logging (writes to debug.log)
bun run dev --debug
```

### Build Executable

```bash
# Build native binary
bun run build

# Run the built executable
./ultra file.ts
```

### Other Commands

```bash
# Type checking
bun run typecheck

# Run tests
bun test

# Generate API documentation
bun run docs
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

### Navigation
| Shortcut | Action |
|----------|--------|
| `Ctrl+G` | Go to line |
| `Ctrl+P` | Quick open file |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+Shift+O` | Go to symbol |
| `Ctrl+K` | Show hover info |
| `Ctrl+Shift+K` | Go to definition |

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
| `Ctrl+Shift+B` | Toggle sidebar |
| `` Ctrl+` `` | Toggle terminal |
| `Ctrl+Shift+G` | Focus git panel |
| `Ctrl+Tab` | Next pane |
| `Ctrl+Shift+Tab` | Previous pane |
| `Ctrl+\` | Split editor vertically |

### Search
| Shortcut | Action |
|----------|--------|
| `Ctrl+F` | Find in file |
| `Ctrl+H` | Find and replace |
| `Ctrl+Shift+F` | Find in all files |
| `F3` | Find next |
| `Shift+F3` | Find previous |

### Sidebar Panels (when focused)
| Shortcut | Action |
|----------|--------|
| `j` / `Arrow Down` | Move down |
| `k` / `Arrow Up` | Move up |
| `Enter` / `Space` | Open/Select |
| `h` / `Arrow Left` | Collapse |
| `l` / `Arrow Right` | Expand |

## Project Structure

```
ultra/
├── src/
│   ├── index.ts                 # Entry point
│   ├── constants.ts             # Centralized configuration constants
│   ├── debug.ts                 # Debug logging utility
│   ├── core/                    # Core editing primitives
│   │   ├── buffer.ts            # Piece table text buffer
│   │   ├── cursor.ts            # Multi-cursor management
│   │   ├── undo.ts              # Undo/redo system
│   │   ├── fold.ts              # Code folding manager
│   │   └── ...
│   ├── services/                # ECP Services (modular backends)
│   │   ├── document/            # Buffer, cursor, undo operations
│   │   ├── file/                # File system abstraction
│   │   ├── git/                 # Version control
│   │   ├── lsp/                 # Language server integration
│   │   ├── session/             # Settings, keybindings, state
│   │   ├── syntax/              # Syntax highlighting
│   │   ├── search/              # Project-wide search
│   │   └── terminal/            # PTY management
│   ├── clients/
│   │   └── tui/                 # Terminal UI client
│   │       ├── client/          # Main TUI orchestrator
│   │       ├── elements/        # UI elements (editor, terminal, panels)
│   │       ├── overlays/        # Modal dialogs and popups
│   │       ├── layout/          # Pane and split management
│   │       ├── config/          # TUI configuration
│   │       └── rendering/       # Screen buffer and renderer
│   ├── terminal/                # PTY backends
│   └── config/                  # Global configuration
├── config/
│   ├── default-settings.jsonc   # Default settings
│   ├── default-keybindings.jsonc # Default keybindings
│   └── themes/                  # Color themes
├── tests/
│   ├── unit/                    # Unit tests
│   └── integration/             # Integration tests
└── docs/                        # Documentation
```

## Configuration

Ultra stores configuration in `~/.ultra/`:

### Settings (`~/.ultra/settings.jsonc`)

```jsonc
{
  // Editor
  "editor.tabSize": 2,
  "editor.insertSpaces": true,
  "editor.wordWrap": "on",
  "editor.lineNumbers": "on",
  "editor.minimap.enabled": true,
  "editor.folding": true,

  // Theme
  "workbench.colorTheme": "catppuccin-frappe",

  // Sidebar
  "tui.sidebar.width": 36,
  "tui.sidebar.visible": true,
  "tui.sidebar.location": "left",

  // Terminal
  "tui.terminal.height": 24,

  // AI
  "ai.defaultProvider": "claude-code"
}
```

### Keybindings (`~/.ultra/keybindings.jsonc`)

```jsonc
[
  // Override default keybindings
  { "key": "ctrl+s", "command": "file.save" },
  { "key": "ctrl+shift+p", "command": "workbench.commandPalette" },

  // Context-aware keybindings
  { "key": "s", "command": "gitPanel.stage", "when": "gitPanelFocus" },
  { "key": "Enter", "command": "fileTree.open", "when": "fileTreeFocus" }
]
```

### Themes

Built-in themes:
- Catppuccin Frappé (default)
- Catppuccin Mocha
- Catppuccin Macchiato
- Catppuccin Latte
- One Dark

## Architecture

Ultra uses an **Editor Command Protocol (ECP)** architecture:

- **Services**: Modular backends (Document, File, Git, LSP, Session, Syntax, Terminal)
- **Clients**: UI implementations (TUI client, future GUI/remote clients)
- **Abstracted I/O**: File system, git, etc. are pluggable backends

Key patterns:
- **Piece Table Buffer**: Efficient text storage
- **Event-Driven UI**: Components communicate via typed event emitters
- **Priority Rendering**: RenderScheduler batches updates by priority
- **Dirty Tracking**: Screen buffer tracks changed cells for efficient rendering

## Development

See [CLAUDE.md](./CLAUDE.md) for development guidelines including:
- Code patterns and conventions
- Service architecture
- Testing requirements
- Debugging tips

## License

Copyright 2025, Zorz LLC, All Rights Reserved
