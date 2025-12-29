# LSP Module

The LSP (Language Server Protocol) module provides IDE features like autocomplete, go-to-definition, and diagnostics.

## Overview

Ultra implements an LSP client that communicates with language servers for:

- **Autocomplete** - Intelligent code suggestions
- **Hover** - Documentation on hover
- **Go to Definition** - Jump to symbol definition
- **Find References** - Find all usages
- **Diagnostics** - Errors and warnings
- **Signature Help** - Function parameter hints

## Architecture

The LSP functionality is split between the LSP Service and TUI overlays:

```
┌─────────────────────────────────────────────────────────────────────┐
│                      LSP Service                                     │
│  (src/services/lsp/)                                                │
│                                                                      │
│  ┌─────────────────┐    ┌─────────────────┐                        │
│  │  LSP Manager    │───▶│  LSP Client(s)  │                        │
│  │  (connection    │    │  (per language) │                        │
│  │   management)   │    │                 │                        │
│  └─────────────────┘    └────────┬────────┘                        │
│                                  │ JSON-RPC                         │
│                                  ▼                                  │
│                     ┌─────────────────────┐                        │
│                     │  Language Server    │                        │
│                     │  (tsserver, etc.)   │                        │
│                     └─────────────────────┘                        │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      TUI Client (Overlays)                           │
│  (src/clients/tui/overlays/)                                        │
│                                                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │ Autocomplete    │  │ Hover Tooltip   │  │ Signature Help  │     │
│  │ Popup           │  │                 │  │                 │     │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

## Location

```
src/services/lsp/
├── interface.ts      # LSP service interface
├── types.ts          # LSP type definitions
├── local.ts          # LocalLSPService implementation
├── adapter.ts        # ECP adapter
├── providers.ts      # Server configuration
└── index.ts          # Public exports

src/clients/tui/overlays/
├── autocomplete-popup.ts   # Completion UI
├── hover-tooltip.ts        # Hover info display
├── signature-help.ts       # Function signature UI
└── diagnostics-overlay.ts  # Error/warning display

src/clients/tui/client/
└── lsp-integration.ts      # LSP overlay management
```

## LSP Service

### Interface

```typescript
// src/services/lsp/interface.ts
export interface LSPService {
  // Connection management
  startServer(languageId: string): Promise<void>;
  stopServer(languageId: string): Promise<void>;

  // Document sync
  didOpen(uri: string, languageId: string, content: string): Promise<void>;
  didChange(uri: string, changes: TextDocumentChange[]): Promise<void>;
  didSave(uri: string): Promise<void>;
  didClose(uri: string): Promise<void>;

  // LSP features
  completion(uri: string, position: Position): Promise<CompletionList>;
  hover(uri: string, position: Position): Promise<Hover | null>;
  definition(uri: string, position: Position): Promise<Location | null>;
  references(uri: string, position: Position): Promise<Location[]>;
  signatureHelp(uri: string, position: Position): Promise<SignatureHelp | null>;

  // Events
  onDiagnostics(callback: DiagnosticsCallback): Unsubscribe;
}
```

### ECP Methods

| Method | Description |
|--------|-------------|
| `lsp/startServer` | Start language server for a language |
| `lsp/completion` | Get completions at position |
| `lsp/hover` | Get hover info at position |
| `lsp/definition` | Get definition location |
| `lsp/references` | Get reference locations |
| `lsp/signatureHelp` | Get signature help |
| `lsp/format` | Format document |

## Supported Languages

The LSP Service supports multiple languages via external language servers:

| Language | Server | Command |
|----------|--------|---------|
| TypeScript/JavaScript | typescript-language-server | `typescript-language-server --stdio` |
| Python | pyright | `pyright-langserver --stdio` |
| Go | gopls | `gopls serve` |
| Rust | rust-analyzer | `rust-analyzer` |
| C/C++ | clangd | `clangd` |
| SQL | sql-language-server | `sql-language-server up --method stdio` |

### Configuration

Language servers are configured in `~/.ultra/settings.jsonc`:

```jsonc
{
  "lsp.servers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "rootPatterns": ["tsconfig.json", "package.json"]
    },
    "python": {
      "command": "pyright-langserver",
      "args": ["--stdio"],
      "rootPatterns": ["pyproject.toml", "setup.py"]
    }
  }
}
```

## LSP Integration (TUI)

The `LSPIntegration` class manages LSP overlays in the TUI:

```typescript
// src/clients/tui/client/lsp-integration.ts
class LSPIntegration {
  private autocomplete: AutocompletePopup;
  private hoverTooltip: HoverTooltip;
  private signatureHelp: SignatureHelpOverlay;

  // Trigger completion
  async triggerCompletion(
    uri: string,
    position: Position,
    screenX: number,
    screenY: number,
    prefix: string,
    startColumn: number
  ): Promise<void> {
    const result = await this.lspService.completion(uri, position);
    if (result.items.length > 0) {
      this.autocomplete.show(result.items, screenX, screenY, prefix, startColumn);
    }
  }

  // Show hover info
  async showHover(uri: string, position: Position, screenX: number, screenY: number): Promise<void> {
    const hover = await this.lspService.hover(uri, position);
    if (hover) {
      this.hoverTooltip.show(hover.contents, screenX, screenY);
    }
  }
}
```

## Autocomplete

### Trigger

Completion is triggered by:
- Typing trigger characters (`.`, `(`, etc.)
- Pressing `Ctrl+Space`

```typescript
// In document editor
handleChar(char: string): void {
  this.insertChar(char);

  // Check for trigger character
  if (this.isTriggerChar(char)) {
    this.lspIntegration.triggerCompletion(
      this.uri,
      this.position,
      this.screenX,
      this.screenY,
      char,
      this.position.column
    );
  }
}
```

### Completion Popup

```typescript
// src/clients/tui/overlays/autocomplete-popup.ts
class AutocompletePopup {
  private items: CompletionItem[] = [];
  private selectedIndex: number = 0;

  show(items: CompletionItem[], x: number, y: number, prefix: string, startColumn: number): void {
    this.items = items;
    this.selectedIndex = 0;
    this.prefix = prefix;
    this.startColumn = startColumn;
    this.visible = true;
    this.position = { x, y };
    renderScheduler.scheduleRender();
  }

  handleKey(event: KeyEvent): boolean {
    switch (event.key) {
      case 'ArrowDown':
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.items.length - 1);
        return true;
      case 'ArrowUp':
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        return true;
      case 'Enter':
      case 'Tab':
        this.accept();
        return true;
      case 'Escape':
        this.hide();
        return true;
    }
    return false;
  }
}
```

### Accepting Completion

```typescript
// Callback when completion is accepted
onCompletionAccepted: (item: CompletionItem, prefix: string, startColumn: number) => {
  // Delete prefix text
  this.editor.deleteRange({
    start: { line: this.position.line, column: startColumn },
    end: this.position
  });

  // Insert completion text
  const insertText = item.insertText || item.label;
  this.editor.insert(insertText);
}
```

## Hover Tooltip

```typescript
// src/clients/tui/overlays/hover-tooltip.ts
class HoverTooltip {
  private content: string = '';
  private position: { x: number; y: number } = { x: 0, y: 0 };

  async showAtPosition(uri: string, position: Position, screenX: number, screenY: number): Promise<void> {
    const hover = await this.lspService.hover(uri, position);
    if (hover) {
      this.content = this.parseMarkdown(hover.contents);
      this.position = { x: screenX, y: screenY };
      this.visible = true;
      renderScheduler.scheduleRender();
    }
  }

  render(ctx: RenderContext): void {
    if (!this.visible) return;

    // Draw tooltip box with content
    const bg = ctx.getThemeColor('editorHoverWidget.background', '#2d2d2d');
    const fg = ctx.getThemeColor('editorHoverWidget.foreground', '#cccccc');
    // ... render tooltip
  }
}
```

## Diagnostics

Diagnostics are pushed from the language server:

```typescript
// LSP Service receives diagnostics
this.client.on('textDocument/publishDiagnostics', (params) => {
  const { uri, diagnostics } = params;
  this.emit('diagnostics', { uri, diagnostics });
});

// TUI subscribes to diagnostics
lspService.onDiagnostics((event) => {
  this.updateDiagnostics(event.uri, event.diagnostics);
  renderScheduler.scheduleRender();
});
```

### Diagnostic Rendering

```typescript
// In document editor
renderGutter(ctx: RenderContext, lineNumber: number): void {
  const diagnostics = this.getDiagnosticsForLine(lineNumber);
  if (diagnostics.length > 0) {
    const severity = Math.min(...diagnostics.map(d => d.severity));
    const icon = severity === 1 ? '●' : severity === 2 ? '▲' : 'ℹ';
    const color = severity === 1 ? '#ff5555' : severity === 2 ? '#ffaa00' : '#5555ff';

    ctx.buffer.set(gutterX, y, { char: icon, fg: color, bg });
  }
}
```

## Document Synchronization

The LSP Service keeps language servers in sync with document changes:

```typescript
// Open document
await lspService.didOpen(uri, 'typescript', content);

// Document changed
await lspService.didChange(uri, [
  {
    range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } },
    text: 'new text'
  }
]);

// Document saved
await lspService.didSave(uri);

// Document closed
await lspService.didClose(uri);
```

## Error Handling

```typescript
// Handle server errors
this.client.on('error', (error) => {
  debugLog(`[LSP] Server error: ${error.message}`);
});

// Handle server exit
this.client.on('exit', (code) => {
  debugLog(`[LSP] Server exited with code ${code}`);
  // Attempt restart
  this.restartServer(languageId);
});
```

## Keybindings

| Key | Command | Description |
|-----|---------|-------------|
| `Ctrl+Space` | `lsp.triggerCompletion` | Trigger autocomplete |
| `Ctrl+K` | `lsp.showHover` | Show hover tooltip |
| `F12` | `lsp.goToDefinition` | Go to definition |
| `Ctrl+Shift+K` | `lsp.goToDefinition` | Go to definition (alt) |
| `Shift+F12` | `lsp.findReferences` | Find all references |
| `Ctrl+Shift+Space` | `lsp.triggerSignatureHelp` | Show signature help |

## Debugging

Enable LSP debug logging:

```bash
./ultra --debug myfile.ts
# Check debug.log for LSP messages
```

Log format:
```
[LSP] -> initialize {...}
[LSP] <- initialize result {...}
[LSP] -> textDocument/didOpen {...}
[LSP] <- textDocument/publishDiagnostics {...}
[LSP] -> textDocument/completion {...}
[LSP] <- textDocument/completion result {...}
```

## Related Documentation

- [ECP Protocol](../architecture/ecp.md) - LSP Service ECP API
- [Adding Languages](../guides/adding-languages.md) - Configuring language servers
- [Keybindings](../architecture/keybindings.md) - LSP keybindings
