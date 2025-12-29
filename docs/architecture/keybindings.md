# Keybindings Architecture

This document explains how Ultra handles keyboard input, from raw terminal bytes to command execution.

## Overview

Ultra's keybinding system consists of several layers:

```
Terminal Input (raw bytes)
         │
         ▼
TUI Client Key Parser (escape sequences → KeyEvent)
         │
         ▼
Session Service (KeyEvent → command string via keybindings)
         │
         ▼
Command Handler (command string → handler function)
         │
         ▼
Command Execution
```

## Input Parsing

### Raw Input

The terminal is set to raw mode, meaning each keystroke is sent immediately without waiting for Enter. Input arrives as:

- **Printable characters**: Single bytes (ASCII) or multi-byte sequences (UTF-8)
- **Control characters**: `Ctrl+A` = byte 0x01, `Ctrl+Z` = byte 0x1A
- **Escape sequences**: Start with ESC (0x1B), encode special keys

### Escape Sequences

Common escape sequences:

| Key | Sequence |
|-----|----------|
| Arrow Up | `\x1b[A` |
| Arrow Down | `\x1b[B` |
| Arrow Right | `\x1b[C` |
| Arrow Left | `\x1b[D` |
| Home | `\x1b[H` |
| End | `\x1b[F` |
| F1-F4 | `\x1bOP` - `\x1bOS` |
| F5-F12 | `\x1b[15~` - `\x1b[24~` |
| Shift+Arrow | `\x1b[1;2A` (A/B/C/D) |
| Ctrl+Arrow | `\x1b[1;5A` |
| Alt+Arrow | `\x1b[1;3A` |

### Modifier Encoding

Modifiers are encoded in escape sequences:

```
ESC [ 1 ; <modifier> <key>

modifier = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0) + (meta ? 8 : 0)

Examples:
  Shift       = 2
  Alt         = 3
  Ctrl        = 5
  Ctrl+Shift  = 6
  Ctrl+Alt    = 7
```

### KeyEvent Structure

```typescript
interface KeyEvent {
  key: string;       // The key name ('a', 'Enter', 'ArrowUp', 'F1')
  char?: string;     // The actual character if printable
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}
```

## Keybinding Resolution

### Session Service

The Session Service manages keybinding configuration:

```typescript
// src/services/session/local.ts
class LocalSessionService {
  resolveKeybinding(event: KeyEvent, context: KeyContext): string | null {
    const keyStr = this.eventToKeyString(event);

    // Find matching binding with context
    for (const binding of this.keybindings) {
      if (binding.key === keyStr) {
        // Check 'when' clause if present
        if (!binding.when || this.evaluateWhen(binding.when, context)) {
          return binding.command;
        }
      }
    }

    return null;
  }
}
```

### Key String Format

Keys are converted to a normalized string format:

```
[ctrl+][alt+][shift+][meta+]<key>

Examples:
  ctrl+s
  ctrl+shift+p
  alt+ArrowLeft
  F12
```

### Keybinding Sources

Keybindings are loaded from multiple sources (in priority order):

1. **User keybindings** (`~/.ultra/keybindings.jsonc`) - Highest priority
2. **Default keybindings** (`config/default-keybindings.jsonc`)

```typescript
// Session Service loads keybindings
async function loadKeybindings(): Promise<Keybinding[]> {
  // Load defaults first
  const defaults = await loadDefaultKeybindings();

  // Merge user keybindings (override defaults)
  const userPath = path.join(getUserConfigDir(), 'keybindings.jsonc');
  if (await Bun.file(userPath).exists()) {
    const user = await loadUserKeybindings();
    return mergeKeybindings(defaults, user);
  }

  return defaults;
}
```

### Keybinding Format

```jsonc
[
  {
    "key": "ctrl+s",
    "command": "file.save"
  },
  {
    "key": "ctrl+shift+p",
    "command": "view.commandPalette"
  },
  {
    "key": "ctrl+d",
    "command": "edit.selectNextOccurrence",
    "when": "editorFocus"
  }
]
```

### Context Conditions (`when`)

Some keybindings only apply in certain contexts:

| Context | Description |
|---------|-------------|
| `editorFocus` | Editor has focus |
| `sidebarFocus` | Sidebar/file tree has focus |
| `terminalFocus` | Terminal panel has focus |
| `gitPanelFocus` | Git panel has focus |
| `dialogOpen` | A dialog/overlay is open |
| `autocompleteVisible` | Autocomplete popup is showing |

## Command Handlers

### TUI Client Registration

Commands are registered in the TUI Client:

```typescript
// src/clients/tui/client/tui-client.ts
class TUIClient {
  private commandHandlers: Map<string, () => Promise<boolean>>;

  private registerCommands(): void {
    this.commandHandlers.set('file.save', async () => {
      await this.save();
      return true;
    });

    this.commandHandlers.set('view.commandPalette', async () => {
      this.commandPalette.show();
      return true;
    });

    // ... more command registrations
  }
}
```

### Command Categories

Commands are organized by category:

- **file.*** - File operations (save, saveAs, open, close)
- **edit.*** - Editing operations (undo, redo, cut, copy, paste)
- **view.*** - View operations (toggleSidebar, toggleTerminal, splitPane)
- **navigation.*** - Navigation (goToLine, goToDefinition, goToFile)
- **git.*** - Git operations (stage, unstage, commit)
- **lsp.*** - LSP features (hover, completion, definition)

## Input Handling Flow

### Main Event Loop

```typescript
// src/clients/tui/client/tui-client.ts
private async handleKeyEvent(event: KeyEvent): Promise<void> {
  // 1. Check for active overlay handlers first
  if (this.activeOverlay) {
    if (this.activeOverlay.handleKey(event)) {
      return;
    }
  }

  // 2. Get current context
  const context = this.getCurrentContext();

  // 3. Try to resolve keybinding
  const commandId = this.sessionService.resolveKeybinding(event, context);

  if (commandId) {
    const handler = this.commandHandlers.get(commandId);
    if (handler) {
      await handler();
      return;
    }
  }

  // 4. If printable character, pass to active element
  if (event.char && !event.ctrl && !event.alt && !event.meta) {
    this.activeElement?.handleChar(event.char);
  }
}
```

### Focus-Based Routing

Different components handle input based on focus:

```typescript
private getCurrentContext(): KeyContext {
  return {
    editorFocus: this.activeElement instanceof DocumentEditor,
    sidebarFocus: this.sidebarPanel?.hasFocus(),
    terminalFocus: this.activeElement instanceof TerminalSession,
    gitPanelFocus: this.gitPanel?.hasFocus(),
    dialogOpen: this.activeOverlay !== null,
    autocompleteVisible: this.autocompletePopup?.isVisible(),
  };
}
```

## Multi-Key Sequences (Chords)

Some commands use multi-key sequences:

```
Ctrl+K, Ctrl+C  → Comment selection
Ctrl+K, Ctrl+U  → Uncomment selection
```

### Chord Format

```jsonc
{
  "key": "ctrl+k ctrl+c",
  "command": "edit.commentLine"
}
```

### Chord Implementation

```typescript
class KeybindingResolver {
  private pendingChord: string | null = null;

  resolve(event: KeyEvent, context: KeyContext): string | null {
    const keyStr = this.eventToKeyString(event);

    if (this.pendingChord) {
      // Check for chord completion
      const chordKey = `${this.pendingChord} ${keyStr}`;
      const command = this.findBinding(chordKey, context);
      this.pendingChord = null;

      if (command) return command;
      return null; // Chord didn't match
    }

    // Check if this starts a chord
    if (this.isChordStart(keyStr)) {
      this.pendingChord = keyStr;
      return null; // Wait for next key
    }

    return this.findBinding(keyStr, context);
  }
}
```

## Default Keybindings Reference

### File Operations

| Key | Command |
|-----|---------|
| `Ctrl+S` | file.save |
| `Ctrl+Shift+S` | file.saveAs |
| `Ctrl+N` | file.new |
| `Ctrl+O` | file.open |
| `Ctrl+W` | file.closeTab |
| `Ctrl+Q` | file.quit |

### Navigation

| Key | Command |
|-----|---------|
| `Ctrl+G` | navigation.goToLine |
| `Ctrl+P` | navigation.quickOpen |
| `Ctrl+Shift+P` | view.commandPalette |
| `F12` | lsp.goToDefinition |
| `Ctrl+Shift+K` | lsp.goToDefinition |
| `Shift+F12` | lsp.findReferences |

### Editing

| Key | Command |
|-----|---------|
| `Ctrl+Z` | edit.undo |
| `Ctrl+Shift+Z` | edit.redo |
| `Ctrl+X` | edit.cut |
| `Ctrl+C` | edit.copy |
| `Ctrl+V` | edit.paste |
| `Ctrl+D` | edit.selectNextOccurrence |
| `Ctrl+Shift+L` | edit.selectAllOccurrences |
| `Ctrl+/` | edit.toggleComment |
| `Tab` | edit.indent |
| `Shift+Tab` | edit.outdent |

### Multi-Cursor

| Key | Command |
|-----|---------|
| `Ctrl+Alt+Up` | edit.addCursorAbove |
| `Ctrl+Alt+Down` | edit.addCursorBelow |
| `Ctrl+D` | edit.selectNextOccurrence |
| `Ctrl+Shift+L` | edit.selectAllOccurrences |

### View

| Key | Command |
|-----|---------|
| `Ctrl+B` | view.toggleSidebar |
| `` Ctrl+` `` | view.toggleTerminal |
| `Ctrl+\` | view.splitVertical |
| `Ctrl+Shift+\` | view.splitHorizontal |
| `Ctrl+Shift+G` | view.toggleGitPanel |

### LSP Features

| Key | Command |
|-----|---------|
| `Ctrl+Space` | lsp.triggerCompletion |
| `Ctrl+K` | lsp.showHover |
| `Ctrl+Shift+Space` | lsp.triggerSignatureHelp |

## Customization

### Adding Custom Keybindings

Create or edit `~/.ultra/keybindings.jsonc`:

```jsonc
[
  {
    "key": "ctrl+shift+d",
    "command": "edit.duplicateLine"
  },
  {
    "key": "ctrl+k ctrl+f",
    "command": "edit.formatDocument"
  }
]
```

### Removing Default Keybindings

Set command to empty string to unbind:

```jsonc
[
  {
    "key": "ctrl+d",
    "command": ""
  }
]
```

### Context-Specific Bindings

```jsonc
[
  {
    "key": "s",
    "command": "git.stage",
    "when": "gitPanelFocus"
  },
  {
    "key": "Enter",
    "command": "autocomplete.accept",
    "when": "autocompleteVisible"
  }
]
```

### Viewing Active Keybindings

Debug mode shows key events:

```bash
./ultra --debug myfile.ts
# Check debug.log for key event parsing
```

## Related Documentation

- [Data Flow](data-flow.md) - How input flows through the system
- [Adding Commands](../guides/adding-commands.md) - Creating new commands
