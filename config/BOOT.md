# Welcome to Ultra

Ultra is a terminal-native code editor with modern IDE features, built with TypeScript and Bun.

## Quick Start

| Action | Shortcut |
|--------|----------|
| Command Palette | **Ctrl+P** |
| Quick Open File | **Ctrl+]** |
| Toggle Sidebar | **Ctrl+B** |
| Toggle Terminal | **Ctrl+`** |
| Toggle Git Panel | **Ctrl+Shift+G** |

## Essential Shortcuts

### File Operations

| Action | Shortcut |
|--------|----------|
| Save | **Ctrl+S** |
| Save As | **Ctrl+Shift+S** or **F4** |
| New File | **Ctrl+N** |
| Open File | **Ctrl+O** |
| Close Tab | **Ctrl+W** |
| Quit | **Ctrl+Q** |

### Navigation

| Action | Shortcut |
|--------|----------|
| Go to Line | **Ctrl+G** |
| Go to Definition | **F12** |
| Find References | **Shift+F12** |
| Word Left/Right | **Alt+Left/Right** |
| File Start/End | **Ctrl+Home/End** |
| Next/Prev Tab | **Ctrl+Alt+Right/Left** |
| Go to Tab 1-9 | **Ctrl+1** through **Ctrl+9** |

### Editing

| Action | Shortcut |
|--------|----------|
| Find | **Ctrl+F** |
| Find and Replace | **Ctrl+H** |
| Find Next/Previous | **F3** / **Shift+F3** |
| Select Line | **Ctrl+L** |
| Select All | **Ctrl+Shift+A** |
| Undo/Redo | **Ctrl+Z** / **Ctrl+Shift+Z** |
| Indent/Outdent | **Tab** / **Shift+Tab** |

### Multi-Cursor

| Action | Shortcut |
|--------|----------|
| Select Next Occurrence | **Ctrl+D** |
| Select All Occurrences | **Ctrl+D A** |
| Add Cursor Above | **Ctrl+U** |
| Add Cursor Below | **Ctrl+J** |
| Split Selection into Lines | **Ctrl+Shift+L** |

### Split Panes

| Action | Shortcut |
|--------|----------|
| Split Vertical | **Ctrl+\\** |
| Split Horizontal | **Ctrl+Shift+\\** |
| Close Pane | **Ctrl+Shift+W** |
| Next/Prev Pane | **Alt+]** / **Alt+[** |

## Git Integration

Press **Ctrl+Shift+G** to open the git panel.

**In the git panel:**
| Key | Action |
|-----|--------|
| **s** | Stage selected file |
| **Shift+S** | Stage all files |
| **u** | Unstage selected file |
| **d** | Discard changes |
| **c** | Open commit dialog |
| **r** | Refresh status |
| **j/k** | Navigate up/down |
| **Enter** | Open file in editor |

**Commit dialog:**
- Type your commit message (supports multiple lines)
- **Enter** - New line
- **Ctrl+Enter** - Commit
- **Escape** - Cancel

**Gutter indicators:** Click the colored markers in the gutter to view inline diffs for changed lines.

## LSP Features

Ultra includes Language Server Protocol support for intelligent code features:

- **Hover** - Move cursor over symbols for documentation
- **Autocomplete** - Suggestions appear as you type (or press **Ctrl+Space**)
- **Go to Definition** - **F12**
- **Find References** - **Shift+F12**
- **Rename Symbol** - **F2**

Supported languages include TypeScript, JavaScript, Python, Go, Rust, and more.

## Configuration

Customize Ultra by editing these files:

| File | Purpose |
|------|---------|
| `~/.config/ultra/settings.json` | Editor settings |
| `~/.config/ultra/keybindings.json` | Custom keybindings |
| `~/.config/ultra/themes/` | VS Code-compatible themes |

## Tips

- Press **Ctrl+P** to access any command via the command palette
- Use **Ctrl+B** to toggle the file tree for more editing space
- Click on folders in the file tree to expand/collapse them
- The minimap on the right provides a code overview (toggle with **Ctrl+Shift+M**)
- Focus different panels with **Ctrl+Shift+Arrow** keys

---

**Startup Tip:** To change what opens on startup, edit `workbench.startupEditor` in settings.
Set it to `"none"` to start with an empty editor.
