# Ultra

[![CI](https://github.com/zorz/ultra/actions/workflows/ci.yml/badge.svg)](https://github.com/zorz/ultra/actions/workflows/ci.yml)
[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-blue.svg)](LICENSE)

_v0.5.0_

A terminal-native code editor with Sublime Text ergonomics, VS Code configuration compatibility, and integrated AI capabilities. Built with Bun for maximum performance.

Ultra is developed as a proof-of-concept for using AI to develop large, highly complex applications. Zero lines of code have been written by a human. **Do not use Ultra for production work as it may consume your data while making loud belching noises.**

## Quick Start

```bash
# clone the repo
git clone https://github.com/zorz/ultra.git
cd ultra

# Install dependencies
bun install

# Run in development mode
bun run dev

# Open a file or directory
bun run dev ~/projects/my-app

# Build native executable
bun run build
./ultra ~/projects/my-app
```

## Features at a Glance

| Feature | Access | Description |
|---------|--------|-------------|
| Quick Open | `Ctrl+P` | Fuzzy-find and open files |
| Command Palette | `Ctrl+Shift+P` | Search and run any command |
| Go to Symbol | `Ctrl+R` | Jump to symbol in current file |
| Workspace Symbols | `Ctrl+Shift+R` | Find symbol across all files |
| Go to Line | `Ctrl+G` | Jump to line number |
| Find | `Ctrl+F` | Search in current file |
| Find & Replace | `Ctrl+H` | Search and replace |
| Toggle Sidebar | `Ctrl+Shift+B` | Show/hide file tree |
| Toggle Terminal | `` Ctrl+` `` | Show/hide integrated terminal |
| Git Panel | `Ctrl+Shift+G` | Focus git staging panel |
| Split Editor | `Ctrl+\` | Split editor vertically |

---

## Editor Features

### Multi-Cursor Editing

Edit multiple locations simultaneously with full selection support.

| Shortcut | Action |
|----------|--------|
| `Ctrl+D` | Select word, then add cursor at next occurrence |
| `Ctrl+Shift+L` | Add cursor at all occurrences of selection |
| `Ctrl+Alt+Up` | Add cursor on line above |
| `Ctrl+Alt+Down` | Add cursor on line below |
| `Escape` | Clear secondary cursors |

All cursors move and edit together. Selections, typing, and deletions apply to every cursor position.

### Code Folding

Collapse and expand code blocks to focus on relevant sections.

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+[` | Fold current region |
| `Ctrl+Shift+]` | Unfold current region |
| `Ctrl+K Ctrl+0` | Fold all regions |
| `Ctrl+K Ctrl+J` | Unfold all regions |

Click the fold indicators in the gutter to toggle individual regions. Folded regions show a `...` indicator.

### Comments

| Shortcut | Action |
|----------|--------|
| `Ctrl+/` | Toggle line comment |
| `Ctrl+K Ctrl+C` | Add line comment |
| `Ctrl+K Ctrl+U` | Remove line comment |

### Word Wrap & Line Numbers

Configure in settings (`Ctrl+,`):

```jsonc
{
  "editor.wordWrap": "on",        // "off", "on", "wordWrapColumn", "bounded"
  "editor.lineNumbers": "on",     // "on", "off", "relative"
  "editor.tabSize": 2,
  "editor.insertSpaces": true
}
```

---

## Navigation

### Quick Open (`Ctrl+P`)

Fuzzy-find any file in your project. Start typing to filter results. The picker shows up to 10,000 files (configurable via `tui.filePicker.maxFiles`).

- Type partial file names: `tuicl` matches `tui-client.ts`
- Use path segments: `src/lsp` shows files in that directory
- Recently opened files appear first

### Go to Symbol (`Ctrl+R`)

Jump to any symbol (function, class, variable) in the current file. Requires LSP support for the file type.

- Symbols are categorized by type with icons
- Type to filter by symbol name
- Shows container name for nested symbols

### Workspace Symbols (`Ctrl+Shift+R`)

Search for symbols across all files in your project. Each result shows the file name for disambiguation.

- Queries all running language servers
- Opens the file and navigates to the symbol
- Great for finding class definitions, functions, etc.

### Go to Line (`Ctrl+G`)

Jump to a specific line number. Enter `line:column` for precise positioning (e.g., `42:10`).

### Go to Definition (`Ctrl+Shift+K`)

Jump to the definition of the symbol under the cursor. Works with LSP-supported languages.

### Find References

Right-click or use command palette to find all references to the current symbol.

---

## Sidebar Panels

Toggle the sidebar with `Ctrl+Shift+B`. The sidebar contains:

### File Tree

Navigate your project structure with keyboard or mouse.

| Key | Action |
|-----|--------|
| `j` / `↓` | Move down |
| `k` / `↑` | Move up |
| `l` / `→` | Expand folder |
| `h` / `←` | Collapse folder |
| `Enter` | Open file / Toggle folder |
| `n` | New file |
| `Shift+N` | New folder |
| `r` / `F2` | Rename |
| `d` / `Delete` | Delete |

Files show git status colors when `tui.fileTree.showGitStatus` is enabled:
- **Yellow**: Modified
- **Green**: Added/Untracked
- **Red**: Deleted

### Outline Panel

View the document outline for the current file. Shows functions, classes, variables, and other symbols from LSP.

| Key | Action |
|-----|--------|
| `j` / `↓` | Move down |
| `k` / `↑` | Move up |
| `Enter` | Go to symbol |
| `Space` | Toggle expand/collapse |

Enable auto-follow to track cursor position: `tui.outline.autoFollow: true`

### Timeline Panel

View git history for the current file or entire repository.

| Key | Action |
|-----|--------|
| `j` / `↓` | Move down |
| `k` / `↑` | Move up |
| `Enter` | View diff |
| `o` | Open file at commit |
| `Tab` | Toggle file/repo mode |
| `y` | Copy commit hash |

---

## Git Integration

### Git Panel (`Ctrl+Shift+G`)

Stage, unstage, and commit changes without leaving the editor.

| Key | Action |
|-----|--------|
| `s` | Stage file |
| `Shift+S` | Stage all files |
| `u` | Unstage file |
| `d` | Discard changes |
| `Enter` | Open diff viewer |
| `o` | Open file |
| `c` | Commit |
| `r` | Refresh status |

The panel shows:
- **Staged Changes**: Files ready to commit
- **Changes**: Modified files not yet staged
- **Untracked Files**: New files not in git

### Inline Diff

When viewing a modified file, inline diff markers appear in the gutter:
- **Green bar**: Added lines
- **Red bar**: Deleted lines
- **Yellow bar**: Modified lines

Click the gutter indicator to expand an inline diff view showing the changes.

### Diff Viewer

Open a side-by-side or unified diff view for any changed file. Navigate between hunks and stage individual changes.

---

## Integrated Terminal

Toggle the terminal panel with `` Ctrl+` ``.

| Shortcut | Action |
|----------|--------|
| `` Ctrl+` `` | Toggle terminal panel |
| `Ctrl+Shift+`` ` | New terminal in panel |
| `Ctrl+Shift+T` | New terminal in pane |

The terminal supports:
- Full PTY emulation with colors and cursor positioning
- Scrollback buffer (configurable via `tui.terminal.scrollback`)
- Mouse support for text selection
- Copy/paste with `Ctrl+C` / `Ctrl+V`

---

## AI Integration

Ultra integrates AI assistants directly into the editor.

### Claude Code

Open Claude Code chat with `Ctrl+Shift+A` or via command palette.

Features:
- Context-aware code assistance
- Session persistence (conversations resume where you left off)
- Code suggestions and explanations

### Codex

Alternative AI provider using OpenAI Codex.

Configure the default provider in settings:
```jsonc
{
  "ai.defaultProvider": "claude-code"  // or "codex"
}
```

---

## LSP (Language Server Protocol)

Ultra provides IDE features through LSP integration:

| Feature | Shortcut | Description |
|---------|----------|-------------|
| Autocomplete | `Ctrl+Space` | Trigger completion suggestions |
| Hover Info | `Ctrl+I` | Show type info and documentation |
| Signature Help | `Ctrl+Shift+Space` | Show function signature |
| Go to Definition | `Ctrl+Shift+K` | Jump to symbol definition |
| Find References | Command palette | Find all references |

LSP servers are auto-detected based on file type. Supported languages include TypeScript, JavaScript, Python, Go, Rust, and more.

Configure LSP behavior:
```jsonc
{
  "lsp.enabled": true,
  "lsp.completionDebounceMs": 250,
  "lsp.triggerCharacters": ".:/<@(",
  "lsp.hover.enabled": true,
  "lsp.signatureHelp.enabled": true,
  "lsp.diagnostics.enabled": true
}
```

---

## Panes and Splits

### Splitting the Editor

| Shortcut | Action |
|----------|--------|
| `Ctrl+\` | Split vertically |
| `Ctrl+Shift+\` | Split horizontally |
| `Ctrl+Tab` | Focus next pane |
| `Ctrl+Shift+Tab` | Focus previous pane |
| `Ctrl+1/2/3` | Focus specific pane |

### Tab Management

| Shortcut | Action |
|----------|--------|
| `Ctrl+W` | Close current tab |
| `Ctrl+]` | Next tab |
| `Ctrl+[` | Previous tab |

Tabs show:
- File name with icon
- Dirty indicator (dot) for unsaved changes
- Read-only indicator for non-editable files

---

## Search

### Find in File (`Ctrl+F`)

Search the current file with optional regex support.

| Shortcut | Action |
|----------|--------|
| `Ctrl+F` | Open find dialog |
| `F3` | Find next |
| `Shift+F3` | Find previous |
| `Escape` | Close find dialog |

Options:
- **Case Sensitive**: Match exact case
- **Whole Word**: Match complete words only
- **Regex**: Use regular expressions

### Find and Replace (`Ctrl+H`)

Replace occurrences in the current file.

- Replace one at a time or all at once
- Preview replacements before applying
- Regex capture groups supported

### Find in Files (`Ctrl+Shift+F`)

Search across all files in your project. Results show file paths and matching lines.

---

## Configuration

Ultra stores configuration in `~/.ultra/`:

### Settings (`~/.ultra/settings.jsonc`)

Open settings with `Ctrl+,` or via command palette.

```jsonc
{
  // Editor
  "editor.tabSize": 2,
  "editor.insertSpaces": true,
  "editor.wordWrap": "on",
  "editor.lineNumbers": "on",
  "editor.folding": true,
  "editor.minimap.enabled": true,
  "editor.minimap.width": 10,

  // Theme
  "workbench.colorTheme": "catppuccin-frappe",

  // Sidebar
  "tui.sidebar.width": 36,
  "tui.sidebar.visible": true,
  "tui.sidebar.location": "left",

  // File Tree
  "tui.fileTree.showGitStatus": true,

  // File Picker
  "tui.filePicker.maxFiles": 10000,

  // Terminal
  "tui.terminal.height": 24,
  "tui.terminal.scrollback": 1000,

  // Git
  "git.statusInterval": 500,
  "git.diffContextLines": 3,

  // AI
  "ai.defaultProvider": "claude-code",

  // Session
  "session.restoreOnStartup": true,
  "session.autoSave": true
}
```

### Keybindings (`~/.ultra/keybindings.jsonc`)

Open keybindings editor with `Ctrl+Shift+,`.

```jsonc
[
  // Override defaults
  { "key": "ctrl+s", "command": "file.save" },

  // Context-aware bindings
  { "key": "s", "command": "gitPanel.stage", "when": "gitPanelFocus" },
  { "key": "Enter", "command": "fileTree.open", "when": "fileTreeFocus" }
]
```

Available contexts for `when` clauses:
- `editorFocus` - Editor has focus
- `editorHasMultipleCursors` - Multiple cursors active
- `fileTreeFocus` - File tree panel focused
- `gitPanelFocus` - Git panel focused
- `outlinePanelFocus` - Outline panel focused
- `timelinePanelFocus` - Timeline panel focused

### Themes

Built-in themes:
- **Catppuccin Frappé** (default) - Warm pastel theme
- **Catppuccin Mocha** - Dark pastel theme
- **Catppuccin Macchiato** - Medium dark pastel theme
- **Catppuccin Latte** - Light pastel theme
- **One Dark** - Atom-inspired dark theme

Change theme in settings or via command palette: "Preferences: Color Theme"

---

## Session Management

Ultra automatically saves and restores your session:

- Open files and their cursor positions
- Scroll positions and fold state
- Pane layout
- Terminal sessions
- AI chat history

### Session Commands

| Command | Description |
|---------|-------------|
| `Ctrl+K Ctrl+S` | Save session as... |
| `Ctrl+K Ctrl+O` | Open session... |

Sessions are stored in `~/.ultra/sessions/`.

---

## Command Line Usage

```bash
# Open current directory
ultra .

# Open a file
ultra path/to/file.ts

# Open a directory
ultra ~/projects/my-app

# Open file at specific line
ultra file.ts:42

# Enable debug logging
ultra --debug

# Show version
ultra --version
```

---

## Keyboard Shortcuts Reference

### File Operations
| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save As |
| `Ctrl+O` | Open file |
| `Ctrl+N` | New file |
| `Ctrl+W` | Close tab |
| `Ctrl+Q` | Quit |

### Editing
| Shortcut | Action |
|----------|--------|
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Ctrl+C` | Copy |
| `Ctrl+X` | Cut |
| `Ctrl+V` | Paste |
| `Ctrl+A` | Select all |
| `Ctrl+D` | Select word / next occurrence |
| `Ctrl+Shift+L` | Select all occurrences |
| `Ctrl+/` | Toggle comment |

### Navigation
| Shortcut | Action |
|----------|--------|
| `Ctrl+P` | Quick open file |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+G` | Go to line |
| `Ctrl+R` | Go to symbol in file |
| `Ctrl+Shift+R` | Go to symbol in workspace |
| `Ctrl+I` | Show hover info |
| `Ctrl+Shift+K` | Go to definition |

### View
| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+B` | Toggle sidebar |
| `` Ctrl+` `` | Toggle terminal |
| `Ctrl+Shift+G` | Focus git panel |
| `Ctrl+\` | Split vertically |
| `Ctrl+Shift+\` | Split horizontally |
| `Ctrl+Tab` | Next pane |
| `Ctrl+1/2/3` | Focus pane |

### Search
| Shortcut | Action |
|----------|--------|
| `Ctrl+F` | Find |
| `Ctrl+H` | Find and replace |
| `Ctrl+Shift+F` | Find in files |
| `F3` | Find next |
| `Shift+F3` | Find previous |

---

## Requirements

- [Bun](https://bun.sh) v1.0 or later
- macOS, Linux, or Windows with WSL
- A modern terminal with 256-color support

---

## Development

```bash
# Install dependencies
bun install

# Development mode
bun run dev

# Build executable
bun run build

# Run tests
bun test

# Type checking
bun run typecheck

# Generate docs
bun run docs
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines.

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before submitting a PR.

---

## License

Ultra is licensed under the [Business Source License 1.1](LICENSE). After January 1, 2029, the license converts to Apache 2.0.

Copyright 2025 Zorz LLC
