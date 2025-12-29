# Commands Module

The Commands module provides Ultra's command registration and execution system.

## Overview

Commands are named actions that can be:
- Bound to keyboard shortcuts
- Executed from the command palette
- Called programmatically

## Architecture

Commands are registered in the TUI Client and executed via command handlers:

```
┌─────────────────────────────────────────────────────────────────────┐
│                      TUI Client                                      │
│  (src/clients/tui/client/tui-client.ts)                             │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                   Command Handlers                           │    │
│  │  Map<string, () => Promise<boolean>>                        │    │
│  │                                                              │    │
│  │  'file.save' → async () => { await this.save(); }           │    │
│  │  'edit.undo' → async () => { await this.undo(); }           │    │
│  │  'view.commandPalette' → async () => { this.palette.show() }│    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

## Command Naming

Commands use a `category.action` naming convention:

| Category | Purpose | Examples |
|----------|---------|----------|
| `file.*` | File operations | `file.save`, `file.saveAs`, `file.new` |
| `edit.*` | Editing | `edit.undo`, `edit.redo`, `edit.cut` |
| `view.*` | View changes | `view.toggleSidebar`, `view.splitVertical` |
| `navigation.*` | Navigation | `navigation.goToLine`, `navigation.quickOpen` |
| `git.*` | Git operations | `git.stage`, `git.commit`, `git.push` |
| `lsp.*` | LSP features | `lsp.goToDefinition`, `lsp.hover` |
| `database.*` | Database | `database.newQuery`, `database.runQuery` |

## Registering Commands

### In TUI Client

Commands are registered in the `registerCommands()` method:

```typescript
// src/clients/tui/client/tui-client.ts
private registerCommands(): void {
  // File commands
  this.commandHandlers.set('file.save', async () => {
    await this.save();
    return true;
  });

  this.commandHandlers.set('file.saveAs', async () => {
    await this.saveAs();
    return true;
  });

  // Edit commands
  this.commandHandlers.set('edit.undo', async () => {
    const editor = this.window.getActiveEditor();
    if (editor) {
      await editor.undo();
      return true;
    }
    return false;
  });

  // View commands
  this.commandHandlers.set('view.toggleSidebar', async () => {
    this.window.toggleSidebar();
    return true;
  });
}
```

### Command Handler Pattern

```typescript
// Handler signature
type CommandHandler = () => Promise<boolean>;

// Return true on success, false on failure
this.commandHandlers.set('myFeature.doSomething', async () => {
  try {
    await this.doSomething();
    return true;
  } catch (error) {
    this.window.showNotification(`Failed: ${error}`, 'error');
    return false;
  }
});
```

## Built-in Commands

### File Commands

| ID | Description |
|----|-------------|
| `file.save` | Save current file |
| `file.saveAs` | Save with new name |
| `file.new` | Create new file |
| `file.open` | Open file picker |
| `file.closeTab` | Close current tab |
| `file.quit` | Exit Ultra |

### Edit Commands

| ID | Description |
|----|-------------|
| `edit.undo` | Undo last change |
| `edit.redo` | Redo last undo |
| `edit.cut` | Cut selection |
| `edit.copy` | Copy selection |
| `edit.paste` | Paste clipboard |
| `edit.selectAll` | Select all text |
| `edit.selectLine` | Select current line |
| `edit.duplicateLine` | Duplicate current line |
| `edit.deleteLine` | Delete current line |
| `edit.toggleComment` | Toggle line comment |
| `edit.indent` | Indent selection |
| `edit.outdent` | Outdent selection |

### View Commands

| ID | Description |
|----|-------------|
| `view.toggleSidebar` | Show/hide sidebar |
| `view.toggleTerminal` | Show/hide terminal |
| `view.toggleGitPanel` | Show/hide git panel |
| `view.commandPalette` | Open command palette |
| `view.splitVertical` | Split pane vertically |
| `view.splitHorizontal` | Split pane horizontally |

### Navigation Commands

| ID | Description |
|----|-------------|
| `navigation.goToLine` | Jump to line number |
| `navigation.quickOpen` | Fuzzy file finder |
| `navigation.goToSymbol` | Go to symbol in file |

### LSP Commands

| ID | Description |
|----|-------------|
| `lsp.goToDefinition` | Go to symbol definition |
| `lsp.findReferences` | Find all references |
| `lsp.showHover` | Show hover tooltip |
| `lsp.triggerCompletion` | Trigger autocomplete |
| `lsp.triggerSignatureHelp` | Show function signature |
| `lsp.formatDocument` | Format entire document |

### Git Commands

| ID | Description |
|----|-------------|
| `git.stage` | Stage selected file |
| `git.stageAll` | Stage all files |
| `git.unstage` | Unstage selected file |
| `git.commit` | Open commit dialog |
| `git.push` | Push to remote |
| `git.pull` | Pull from remote |

### Multi-Cursor Commands

| ID | Description |
|----|-------------|
| `edit.addCursorAbove` | Add cursor on line above |
| `edit.addCursorBelow` | Add cursor on line below |
| `edit.selectNextOccurrence` | Select next match |
| `edit.selectAllOccurrences` | Select all matches |

## Command Palette Integration

Commands appear in the command palette (`Ctrl+Shift+P`):

```typescript
// Command palette shows registered commands
class CommandPalette {
  show(): void {
    const commands = Array.from(this.client.commandHandlers.keys())
      .map(id => ({
        id,
        label: this.formatLabel(id),  // 'file.save' → 'File: Save'
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    this.showItems(commands);
  }

  private formatLabel(id: string): string {
    const [category, action] = id.split('.');
    return `${this.capitalize(category)}: ${this.formatAction(action)}`;
  }
}
```

## Keybinding Integration

Commands are bound to keys in keybindings configuration:

```jsonc
// config/default-keybindings.jsonc
[
  { "key": "ctrl+s", "command": "file.save" },
  { "key": "ctrl+shift+p", "command": "view.commandPalette" },
  { "key": "ctrl+d", "command": "edit.selectNextOccurrence", "when": "editorFocus" }
]
```

The Session Service resolves keybindings:

```typescript
// Key event flows through keybinding resolution
const commandId = sessionService.resolveKeybinding(keyEvent, context);
if (commandId) {
  const handler = this.commandHandlers.get(commandId);
  await handler?.();
}
```

## Using Services in Commands

Commands delegate to ECP services:

```typescript
this.commandHandlers.set('git.stageAll', async () => {
  const gitService = this.ecpServer.getService<LocalGitService>('git');
  await gitService.stageAll();
  this.window.showNotification('All files staged', 'info');
  return true;
});

this.commandHandlers.set('lsp.goToDefinition', async () => {
  const editor = this.window.getActiveEditor();
  if (!editor) return false;

  const lspService = this.ecpServer.getService<LocalLSPService>('lsp');
  const location = await lspService.getDefinition(editor.uri, editor.position);

  if (location) {
    await this.openFileAtLocation(location);
    return true;
  }
  return false;
});
```

## Error Handling

Commands should handle their own errors:

```typescript
this.commandHandlers.set('file.save', async () => {
  const editor = this.window.getActiveEditor();
  if (!editor) {
    this.window.showNotification('No active editor', 'warning');
    return false;
  }

  try {
    await editor.save();
    this.window.showNotification('File saved', 'info');
    return true;
  } catch (error) {
    this.window.showNotification(`Save failed: ${error}`, 'error');
    return false;
  }
});
```

## Best Practices

1. **Use descriptive IDs** - `category.action` format
2. **Return success status** - `true` on success, `false` on failure
3. **Handle errors gracefully** - Show notifications for failures
4. **Use services for logic** - Don't implement business logic in handlers
5. **Check prerequisites** - Verify active editor, focused panel, etc.
6. **Provide user feedback** - Show notifications for async operations

## Adding a New Command

### 1. Register the Handler

```typescript
// In tui-client.ts registerCommands()
this.commandHandlers.set('myFeature.doThing', async () => {
  await this.doThing();
  return true;
});
```

### 2. Implement the Method

```typescript
// In TUIClient class
private async doThing(): Promise<void> {
  const service = this.ecpServer.getService<MyService>('myService');
  await service.doThing();
  this.window.showNotification('Thing done!', 'info');
}
```

### 3. Add Keybinding (Optional)

```jsonc
// In config/default-keybindings.jsonc
{
  "key": "ctrl+shift+t",
  "command": "myFeature.doThing"
}
```

## Related Documentation

- [Adding Commands Guide](../guides/adding-commands.md) - Step-by-step guide
- [Keybindings Architecture](../architecture/keybindings.md) - Key handling
- [ECP Protocol](../architecture/ecp.md) - Service access
