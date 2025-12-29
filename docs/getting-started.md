# Getting Started with Ultra

This guide covers installation, first-time setup, and basic usage of Ultra.

## Prerequisites

- [Bun](https://bun.sh/) v1.0 or later
- macOS, Linux, or Windows with WSL
- A terminal with 256-color support (most modern terminals)

## Installation

### Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/zorz/ultra/release/install.sh | bash
```

### From Source

```bash
# Clone the repository
git clone https://github.com/zorz/ultra.git
cd ultra

# Install dependencies
bun install

# Run in development mode
bun run dev

# Or build the native executable
bun run build
./ultra
```

## First Run

When you first launch Ultra, you'll see the welcome screen with essential keyboard shortcuts.

### Opening Files

```bash
# Open current directory
./ultra .

# Open a specific file
./ultra src/index.ts

# Open a file at a specific line
./ultra src/index.ts:42

# Enable debug logging
./ultra --debug .
```

## Basic Navigation

### Essential Shortcuts

| Action | Shortcut |
|--------|----------|
| Command Palette | `Ctrl+Shift+P` |
| Quick Open File | `Ctrl+P` |
| Toggle Sidebar | `Ctrl+B` |
| Toggle Terminal | `` Ctrl+` `` |
| Save File | `Ctrl+S` |
| Close Tab | `Ctrl+W` |
| Quit | `Ctrl+Q` |

### Moving Around

| Action | Shortcut |
|--------|----------|
| Go to Line | `Ctrl+G` |
| Go to Definition | `F12` or `Ctrl+Shift+K` |
| Find References | `Shift+F12` |
| Go to Symbol | `Ctrl+R` |
| Word Left/Right | `Alt+Left/Right` |

### Editing

| Action | Shortcut |
|--------|----------|
| Find | `Ctrl+F` |
| Find and Replace | `Ctrl+H` |
| Undo/Redo | `Ctrl+Z` / `Ctrl+Shift+Z` |
| Toggle Comment | `Ctrl+/` |
| Indent/Outdent | `Tab` / `Shift+Tab` |

### Multi-Cursor

| Action | Shortcut |
|--------|----------|
| Select Next Occurrence | `Ctrl+D` |
| Select All Occurrences | `Ctrl+Shift+L` |
| Add Cursor Above | `Ctrl+Alt+Up` |
| Add Cursor Below | `Ctrl+Alt+Down` |

## Interface Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│ [Sidebar]    │  Tab Bar: file1.ts  file2.ts  file3.ts               │
│              │──────────────────────────────────────────────────────│
│  File Tree   │  1  import { foo } from './bar';                     │
│  src/        │  2                                                   │
│    index.ts  │  3  export function main() {                         │
│    app.ts    │  4    console.log('Hello');                          │
│              │  5  }                                                 │
│ ─────────────│──────────────────────────────────────────────────────│
│  Outline     │  [Terminal Panel]                                    │
│  Git         │  $ bun test                                          │
├──────────────┴──────────────────────────────────────────────────────┤
│ Status Bar: main | file1.ts | TypeScript | Ln 3, Col 5              │
└─────────────────────────────────────────────────────────────────────┘
```

### Components

- **Sidebar** (`Ctrl+B`): File tree, outline, git panel
- **Tab Bar**: Open files, click to switch
- **Editor Pane**: Syntax-highlighted editing area
- **Terminal** (`` Ctrl+` ``): Integrated terminal
- **Status Bar**: File info, cursor position, git branch

## Split Panes

| Action | Shortcut |
|--------|----------|
| Split Vertical | `Ctrl+\` |
| Split Horizontal | `Ctrl+Shift+\` |
| Close Pane | `Ctrl+Shift+W` |
| Focus Next Pane | `Ctrl+Tab` |

## Git Integration

Press `Ctrl+Shift+G` to open the git panel:

| Key | Action |
|-----|--------|
| `s` | Stage file |
| `Shift+S` | Stage all |
| `u` | Unstage file |
| `d` | Discard changes |
| `c` | Commit |
| `Enter` | Open diff |

## LSP Features

Ultra supports Language Server Protocol for intelligent editing:

| Feature | Trigger |
|---------|---------|
| Autocomplete | Type or `Ctrl+Space` |
| Hover Info | `Ctrl+K` |
| Go to Definition | `F12` |
| Find References | `Shift+F12` |
| Signature Help | `Ctrl+Shift+Space` |

Supported: TypeScript, JavaScript, Python, Go, Rust, and more.

## Configuration

Ultra stores settings in `~/.ultra/`:

| File | Purpose |
|------|---------|
| `settings.jsonc` | Editor settings |
| `keybindings.jsonc` | Custom keybindings |
| `themes/` | Custom themes |

### Example Settings

```jsonc
{
  "editor.tabSize": 2,
  "editor.insertSpaces": true,
  "editor.wordWrap": "on",
  "editor.minimap.enabled": true,
  "workbench.colorTheme": "catppuccin-frappe"
}
```

## Troubleshooting

### Debug Logging

```bash
./ultra --debug .
# Check debug.log in current directory
```

### LSP Not Working

1. Ensure the language server is installed
2. Check `debug.log` for connection errors
3. Some languages need config files (tsconfig.json, etc.)

## Next Steps

- [Architecture Overview](architecture/overview.md): How Ultra works
- [Adding Commands](guides/adding-commands.md): Extend Ultra
