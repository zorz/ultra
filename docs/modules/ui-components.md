# UI Components Module

This module covers Ultra's TUI component system including elements, overlays, and panels.

## Overview

Ultra's TUI is built from composable components organized in layers:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    TUI Client (Window)                               │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    Overlays (top layer)                      │    │
│  │  Command Palette, Autocomplete, Hover, Dialogs              │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │                    Pane Container                            │    │
│  │  ┌──────────────────────┬──────────────────────┐            │    │
│  │  │     Pane (tabs)      │     Pane (tabs)      │            │    │
│  │  │  ┌────────────────┐  │  ┌────────────────┐  │            │    │
│  │  │  │ Document Editor│  │  │Terminal Session│  │            │    │
│  │  │  │ (element)      │  │  │ (element)      │  │            │    │
│  │  │  └────────────────┘  │  └────────────────┘  │            │    │
│  │  └──────────────────────┴──────────────────────┘            │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │                    Status Bar                                │    │
│  └─────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    Sidebar Panel                             │    │
│  │  File Tree, Outline, Git Panel                              │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

## Location

```
src/clients/tui/
├── client/
│   ├── tui-client.ts       # Main TUI orchestrator
│   └── lsp-integration.ts  # LSP overlay management
├── elements/               # Tab content types
│   ├── base-element.ts     # Base class for elements
│   ├── document-editor.ts  # Code editor
│   ├── terminal-session.ts # Terminal emulator
│   └── ai-terminal-chat.ts # AI assistant chat
├── overlays/               # Modal overlays
│   ├── base-dialog.ts      # Base dialog class
│   ├── searchable-dialog.ts # Searchable list dialog
│   ├── command-palette.ts  # Command palette
│   ├── file-picker.ts      # Quick file open
│   ├── autocomplete-popup.ts # LSP completions
│   ├── hover-tooltip.ts    # LSP hover info
│   └── signature-help.ts   # LSP signatures
├── panels/                 # Sidebar panels
│   ├── sidebar-panel.ts    # Sidebar container
│   ├── file-tree.ts        # File explorer
│   ├── outline-panel.ts    # Document outline
│   └── git-panel.ts        # Git status panel
├── config/
│   └── config-manager.ts   # Settings + keybindings
└── window.ts               # Window/pane management
```

## Elements

Elements are the content displayed in pane tabs.

### Base Element

```typescript
// src/clients/tui/elements/base-element.ts
abstract class BaseElement {
  protected _debugName: string;

  abstract render(ctx: RenderContext): void;
  abstract handleKey(event: KeyEvent): boolean;
  abstract handleMouse(event: MouseEvent): boolean;

  // Optional lifecycle methods
  onFocus?(): void;
  onBlur?(): void;
  onResize?(rect: Rect): void;
}
```

### Document Editor

The primary code editing element:

```typescript
// src/clients/tui/elements/document-editor.ts
class DocumentEditor extends BaseElement {
  private documentId: string;
  private buffer: Buffer;
  private cursors: Cursor[];
  private selections: Selection[];
  private scrollTop: number = 0;

  render(ctx: RenderContext): void {
    const { buffer, rect } = ctx;

    for (let row = 0; row < rect.height; row++) {
      const lineNumber = this.scrollTop + row;
      // Render gutter
      this.renderGutter(ctx, row, lineNumber);
      // Render line with syntax highlighting
      this.renderLine(ctx, row, lineNumber);
      // Render selections and cursors
      this.renderSelections(ctx, row, lineNumber);
    }
  }

  handleKey(event: KeyEvent): boolean {
    // Handle editing keys
    if (event.char && !event.ctrl && !event.alt) {
      this.insertChar(event.char);
      return true;
    }
    // Handle navigation
    if (event.key === 'ArrowUp') {
      this.moveCursorUp();
      return true;
    }
    // ... more key handling
    return false;
  }
}
```

### Terminal Session

Integrated terminal emulator:

```typescript
// src/clients/tui/elements/terminal-session.ts
class TerminalSession extends BaseElement {
  private pty: PTY;
  private buffer: TerminalBuffer;
  private scrollback: number[];

  handleKey(event: KeyEvent): boolean {
    // Forward input to PTY
    this.pty.write(this.encodeKeyEvent(event));
    return true;
  }

  onPtyData(data: string): void {
    // Parse ANSI sequences and update buffer
    this.parseAnsi(data);
    renderScheduler.scheduleRender();
  }
}
```

### AI Terminal Chat

Claude Code and Codex integration:

```typescript
// src/clients/tui/elements/ai-terminal-chat.ts
class AITerminalChat extends BaseElement {
  private provider: 'claude-code' | 'codex';
  private sessionId: string | null;
  private messages: ChatMessage[];

  async sendMessage(message: string): Promise<void> {
    this.messages.push({ role: 'user', content: message });
    // Send to AI provider
    const response = await this.sendToProvider(message);
    this.messages.push({ role: 'assistant', content: response });
    renderScheduler.scheduleRender();
  }
}
```

## Overlays

Overlays are modal dialogs that appear above other content.

### Base Dialog

```typescript
// src/clients/tui/overlays/base-dialog.ts
abstract class BaseDialog {
  protected visible: boolean = false;
  protected rect: Rect;

  abstract render(ctx: RenderContext): void;
  abstract handleKey(event: KeyEvent): boolean;
  abstract onMouseEvent(event: MouseEvent): boolean;

  show(): void {
    this.visible = true;
    renderScheduler.scheduleRender();
  }

  hide(): void {
    this.visible = false;
    renderScheduler.scheduleRender();
  }

  isVisible(): boolean {
    return this.visible;
  }
}
```

### Searchable Dialog

List with fuzzy search filtering:

```typescript
// src/clients/tui/overlays/searchable-dialog.ts
class SearchableDialog<T> extends BaseDialog {
  protected items: T[] = [];
  protected filteredItems: T[] = [];
  protected selectedIndex: number = 0;
  protected query: string = '';

  abstract getLabel(item: T): string;
  abstract onSelect(item: T): void;

  handleKey(event: KeyEvent): boolean {
    if (event.key === 'Escape') {
      this.hide();
      return true;
    }

    if (event.key === 'Enter') {
      const item = this.filteredItems[this.selectedIndex];
      if (item) {
        this.onSelect(item);
        this.hide();
      }
      return true;
    }

    if (event.key === 'ArrowDown') {
      this.selectedIndex = Math.min(this.selectedIndex + 1, this.filteredItems.length - 1);
      return true;
    }

    if (event.key === 'ArrowUp') {
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      return true;
    }

    // Update search query
    if (event.char) {
      this.query += event.char;
      this.filterItems();
      return true;
    }

    return false;
  }

  private filterItems(): void {
    this.filteredItems = this.items.filter(item =>
      this.fuzzyMatch(this.query, this.getLabel(item))
    );
    this.selectedIndex = 0;
    renderScheduler.scheduleRender();
  }
}
```

### Command Palette

```typescript
// src/clients/tui/overlays/command-palette.ts
class CommandPalette extends SearchableDialog<CommandItem> {
  getLabel(item: CommandItem): string {
    return item.label;
  }

  onSelect(item: CommandItem): void {
    this.client.executeCommand(item.id);
  }

  show(): void {
    const commands = Array.from(this.client.commandHandlers.keys())
      .map(id => ({
        id,
        label: this.formatLabel(id),
      }));

    this.items = commands;
    this.filteredItems = commands;
    this.query = '';
    this.selectedIndex = 0;
    super.show();
  }
}
```

### File Picker

Quick file open with fuzzy search:

```typescript
// src/clients/tui/overlays/file-picker.ts
class FilePicker extends SearchableDialog<string> {
  private files: string[] = [];

  getLabel(path: string): string {
    return basename(path);
  }

  getDetail(path: string): string {
    return path;
  }

  onSelect(path: string): void {
    this.client.openFile(path);
  }

  async show(): Promise<void> {
    this.files = await this.scanProjectFiles();
    this.items = this.files;
    this.filteredItems = this.files;
    super.show();
  }
}
```

## Panels

### Sidebar Panel

Container for sidebar sections:

```typescript
// src/clients/tui/panels/sidebar-panel.ts
class SidebarPanel {
  private sections: SidebarSection[] = [];
  private activeSection: number = 0;

  render(ctx: RenderContext): void {
    // Render section tabs
    this.renderTabs(ctx);

    // Render active section content
    const section = this.sections[this.activeSection];
    section.render(ctx);
  }
}
```

### File Tree

File explorer:

```typescript
// src/clients/tui/panels/file-tree.ts
class FileTree {
  private root: TreeNode;
  private selectedIndex: number = 0;
  private expanded: Set<string> = new Set();

  handleKey(event: KeyEvent): boolean {
    switch (event.key) {
      case 'ArrowUp':
        this.selectPrevious();
        return true;
      case 'ArrowDown':
        this.selectNext();
        return true;
      case 'ArrowRight':
        this.expandSelected();
        return true;
      case 'ArrowLeft':
        this.collapseSelected();
        return true;
      case 'Enter':
        this.openSelected();
        return true;
    }
    return false;
  }
}
```

### Git Panel

Git status and operations:

```typescript
// src/clients/tui/panels/git-panel.ts
class GitPanel {
  private files: GitFile[] = [];
  private selectedIndex: number = 0;

  handleKey(event: KeyEvent): boolean {
    switch (event.key) {
      case 's':
        this.stageSelected();
        return true;
      case 'u':
        this.unstageSelected();
        return true;
      case 'd':
        this.discardSelected();
        return true;
      case 'c':
        this.showCommitDialog();
        return true;
      case 'S':
        if (event.shift) {
          this.stageAll();
          return true;
        }
        break;
    }
    return false;
  }

  private async stageSelected(): Promise<void> {
    const file = this.files[this.selectedIndex];
    const gitService = this.client.ecpServer.getService('git');
    await gitService.stage([file.path]);
    await this.refresh();
  }
}
```

## Window Management

### Window Class

Manages panes and layout:

```typescript
// src/clients/tui/window.ts
class Window {
  private paneContainer: PaneContainer;
  private sidebar: SidebarPanel;
  private statusBar: StatusBar;
  private buffer: ScreenBuffer;

  render(): void {
    const rect = this.getViewportRect();

    // Render sidebar if visible
    if (this.sidebarVisible) {
      this.sidebar.render(this.createContext(this.getSidebarRect()));
    }

    // Render pane container
    this.paneContainer.render(this.createContext(this.getPaneRect()));

    // Render status bar
    this.statusBar.render(this.createContext(this.getStatusBarRect()));

    // Flush buffer to terminal
    this.buffer.flush();
  }

  toggleSidebar(): void {
    this.sidebarVisible = !this.sidebarVisible;
    this.updateLayout();
    renderScheduler.scheduleRender();
  }

  splitVertical(): void {
    this.paneContainer.splitVertical();
    renderScheduler.scheduleRender();
  }
}
```

### Pane Container

Manages split panes:

```typescript
// Pane splitting creates a tree structure
interface LayoutNode {
  type: 'leaf' | 'horizontal' | 'vertical';
  children?: LayoutNode[];
  ratio?: number[];
  pane?: Pane;
}

class PaneContainer {
  private root: LayoutNode;
  private activePane: Pane;

  splitVertical(): void {
    // Current pane becomes part of a horizontal split
    const current = this.findNode(this.activePane);
    const newPane = new Pane();

    current.type = 'vertical';
    current.children = [
      { type: 'leaf', pane: this.activePane },
      { type: 'leaf', pane: newPane }
    ];
    current.ratio = [0.5, 0.5];
  }
}
```

## Component Communication

### Event Pattern

Components communicate via callbacks:

```typescript
// Registration returns unsubscribe function
const unsubscribe = component.onChange((data) => {
  // Handle change
});

// Example: File tree notifies when file is selected
fileTree.onFileSelect((path) => {
  client.openFile(path);
});

// Cleanup
unsubscribe();
```

### Render Scheduling

All components use the render scheduler:

```typescript
// Never render directly
this.render();  // BAD

// Schedule through the scheduler
renderScheduler.schedule(() => {
  this.render(ctx);
}, 'normal', RenderTaskIds.FILE_TREE);  // GOOD
```

## Theme Integration

Components use theme colors via RenderContext:

```typescript
render(ctx: RenderContext): void {
  const bg = ctx.getThemeColor('sideBar.background', '#1e1e1e');
  const fg = ctx.getThemeColor('sideBar.foreground', '#cccccc');
  const selectedBg = ctx.getThemeColor('list.activeSelectionBackground', '#3c3c3c');

  for (const item of this.items) {
    const isSelected = this.selectedIndex === index;
    ctx.buffer.set(x, y, {
      char: item.label[0],
      fg,
      bg: isSelected ? selectedBg : bg
    });
  }
}
```

## Best Practices

1. **Extend Base Classes** - Use BaseElement for elements, BaseDialog for overlays
2. **Use SearchableDialog** for selection lists
3. **Return `true`** from handleKey when event is consumed
4. **Schedule renders** instead of direct rendering
5. **Use callbacks** (onConfirm, onSelect) instead of return values
6. **Clean up timers** in hide() method
7. **Use theme colors** - Never hardcode colors

## Creating a Custom Dialog

```typescript
// 1. Extend BaseDialog
class MyDialog extends BaseDialog {
  private value: string = '';
  private onConfirm: ((value: string) => void) | null = null;

  constructor() {
    super();
    this._debugName = 'MyDialog';
  }

  // 2. Implement required methods
  render(ctx: RenderContext): void {
    if (!this.visible) return;

    const bg = ctx.getThemeColor('editorWidget.background', '#2d2d2d');
    const fg = ctx.getThemeColor('editorWidget.foreground', '#cccccc');

    // Draw dialog box
    // ...
  }

  handleKey(event: KeyEvent): boolean {
    if (event.key === 'Escape') {
      this.hide();
      return true;
    }

    if (event.key === 'Enter') {
      this.onConfirm?.(this.value);
      this.hide();
      return true;
    }

    if (event.char) {
      this.value += event.char;
      renderScheduler.scheduleRender();
      return true;
    }

    return false;
  }

  onMouseEvent(event: MouseEvent): boolean {
    // Handle mouse clicks
    return false;
  }
}

// 3. Export as singleton
export const myDialog = new MyDialog();
export default myDialog;
```

## Related Documentation

- [Rendering Architecture](../architecture/rendering.md) - How components render
- [Keybindings](../architecture/keybindings.md) - Key event handling
- [Data Flow](../architecture/data-flow.md) - Component communication
