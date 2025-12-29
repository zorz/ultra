# Adding Commands Guide

This guide explains how to add new commands to Ultra.

## Overview

Commands in Ultra are actions that can be:
- Executed from the command palette (`Ctrl+Shift+P`)
- Bound to keyboard shortcuts
- Called programmatically

## Adding a Command

### Step 1: Register the Command Handler

In `src/clients/tui/client/tui-client.ts`, add to the `registerCommands()` method:

```typescript
private registerCommands(): void {
  // ... existing commands ...

  this.commandHandlers.set('myFeature.doSomething', async () => {
    await this.doSomething();
    return true;
  });
}

// Add the implementation method
private async doSomething(): Promise<void> {
  this.window.showNotification('Command executed!', 'info');
}
```

### Command Naming

Use consistent naming: `category.action`

```
file.save
file.saveAs
edit.undo
edit.redo
git.commit
git.push
view.toggleSidebar
```

## Step 2: Add Keybinding (Optional)

Edit `config/default-keybindings.jsonc`:

```jsonc
[
  {
    "key": "ctrl+shift+m",
    "command": "myFeature.doSomething"
  }
]
```

### Key Format

```
[ctrl+][alt+][shift+][meta+]<key>

Examples:
  ctrl+s
  ctrl+shift+p
  alt+ArrowLeft
  F12
  ctrl+k ctrl+c   // Chord (multi-key)
```

### Context-Aware Keybindings

Use `when` clauses for context-specific bindings:

```jsonc
{
  "key": "s",
  "command": "gitPanel.stage",
  "when": "gitPanelFocus"
}
```

Available contexts:
- `editorFocus` - Editor has focus
- `sidebarFocus` - Sidebar panel focused
- `gitPanelFocus` - Git panel focused
- `terminalFocus` - Terminal focused

## Examples

### Simple Command

```typescript
this.commandHandlers.set('edit.insertTimestamp', async () => {
  const editor = this.window.getActiveEditor();
  if (!editor) return false;

  const timestamp = new Date().toISOString();
  editor.insertText(timestamp);
  return true;
});
```

### Command Using Services

```typescript
this.commandHandlers.set('git.stageAll', async () => {
  const gitService = this.ecpServer.getService<LocalGitService>('git');
  await gitService.stageAll();
  this.window.showNotification('All files staged', 'info');
  return true;
});
```

### Command with User Input

```typescript
this.commandHandlers.set('navigation.goToLine', async () => {
  // Show go-to-line dialog
  this.goToLineDialog.show();
  return true;
});
```

### Toggle Command

```typescript
this.commandHandlers.set('view.toggleMinimap', async () => {
  const current = this.sessionService.getSetting('editor.minimap.enabled');
  await this.sessionService.setSetting('editor.minimap.enabled', !current);
  this.window.requestRender();
  return true;
});
```

## Best Practices

### 1. Return Success Status

Commands should return `true` on success, `false` on failure:

```typescript
this.commandHandlers.set('file.save', async () => {
  const editor = this.window.getActiveEditor();
  if (!editor) return false;

  try {
    await editor.save();
    return true;
  } catch (error) {
    this.window.showNotification(`Save failed: ${error}`, 'error');
    return false;
  }
});
```

### 2. Use Services for Logic

Don't implement business logic in command handlers. Use services:

```typescript
// Good - uses service
this.commandHandlers.set('git.commit', async () => {
  const gitService = this.ecpServer.getService('git');
  await gitService.commit(message);
  return true;
});

// Bad - implements logic directly
this.commandHandlers.set('git.commit', async () => {
  await $`git commit -m ${message}`.quiet();  // Don't do this
  return true;
});
```

### 3. Provide User Feedback

```typescript
this.commandHandlers.set('format.document', async () => {
  this.window.showNotification('Formatting...', 'info');

  try {
    await this.lspService.formatDocument(documentId);
    this.window.showNotification('Document formatted', 'info');
    return true;
  } catch (error) {
    this.window.showNotification('Format failed', 'error');
    return false;
  }
});
```

### 4. Check Prerequisites

```typescript
this.commandHandlers.set('lsp.goToDefinition', async () => {
  const editor = this.window.getActiveEditor();
  if (!editor) {
    this.window.showNotification('No active editor', 'warning');
    return false;
  }

  // Proceed with command
});
```

## Testing Commands

### Using TestECPClient

```typescript
import { TestECPClient } from '@test/ecp-client.ts';

test('command executes successfully', async () => {
  const client = new TestECPClient();

  // Commands are executed via the TUI client
  // For service-level testing, use the service directly
  const gitService = client.getService('git');
  await gitService.stageAll();

  await client.shutdown();
});
```

### Manual Testing

1. Run Ultra with debug mode:
   ```bash
   bun run dev --debug
   ```

2. Open command palette (`Ctrl+Shift+P`)

3. Find and execute your command

4. Check `debug.log` for errors

## Troubleshooting

### Command Not Found

- Check the command ID matches exactly
- Ensure the command is registered in `registerCommands()`
- Verify keybinding config syntax

### Command Fails Silently

- Add debug logging with `debugLog()`
- Check for missing null checks
- Wrap in try/catch

## Related Documentation

- [Architecture Overview](../architecture/overview.md) - ECP architecture
- [Keybindings](../architecture/keybindings.md) - Key handling system
