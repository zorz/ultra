# Rendering Architecture

This document describes Ultra's terminal rendering pipeline, from state changes to screen output.

## Overview

Ultra renders to the terminal using ANSI escape sequences. The rendering system is designed to:

- Batch multiple state changes into single render passes
- Minimize terminal output via dirty cell tracking
- Support 24-bit color (true color)
- Handle resize events gracefully

## Render Pipeline

```
State Change
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Render Scheduler                                  │
│  - Debounces multiple rapid changes                                 │
│  - Prioritizes render tasks (immediate > high > normal > low)       │
│  - Deduplicates by task ID                                          │
└────────────────────────────────┬────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Component Render Pass                             │
│  - Each component renders to ScreenBuffer                           │
│  - Components paint their own backgrounds                           │
│  - Dirty cells are tracked automatically                            │
└────────────────────────────────┬────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    ScreenBuffer Flush                                │
│  - Only dirty cells are written                                     │
│  - Optimizes cursor movement                                        │
│  - Outputs ANSI sequences                                           │
└────────────────────────────────┬────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Terminal Output                                   │
│  - Write to stdout                                                  │
│  - Flush immediately                                                │
└─────────────────────────────────────────────────────────────────────┘
```

## ScreenBuffer

The ScreenBuffer is the central rendering abstraction:

```typescript
// src/clients/tui/window.ts
interface Cell {
  char: string;
  fg: string;      // Hex color
  bg: string;      // Hex color
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

class ScreenBuffer {
  private cells: Cell[][];
  private dirty: boolean[][];

  // Set a cell (marks as dirty)
  set(x: number, y: number, cell: Cell): void {
    if (this.isDifferent(x, y, cell)) {
      this.cells[y][x] = cell;
      this.dirty[y][x] = true;
    }
  }

  // Flush only dirty cells to terminal
  flush(): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.dirty[y][x]) {
          this.writeCell(x, y, this.cells[y][x]);
          this.dirty[y][x] = false;
        }
      }
    }
  }
}
```

### Dirty Cell Tracking

The buffer tracks which cells have changed since the last flush:

```typescript
// Only changed cells are written
buffer.set(5, 10, { char: 'A', fg: '#ffffff', bg: '#1e1e1e' });
// If cell at (5,10) already has same content, it's not marked dirty

buffer.flush();
// Only dirty cells are output to terminal
```

### Important: Don't Clear the Buffer

Components should NOT clear the entire buffer:

```typescript
// BAD - defeats dirty tracking, causes full screen rewrite
render(): void {
  this.buffer.clear(bg, fg);  // Don't do this!
  // ... render components ...
}

// GOOD - components paint their own backgrounds
render(): void {
  // Each component is responsible for its own region
  this.paneContainer.render(this.buffer);
  this.statusBar.render(this.buffer);
}
```

## Render Scheduler

### Purpose

The render scheduler prevents excessive rendering by batching state changes:

```typescript
// Multiple rapid state changes
cursor.moveTo(5, 10);
document.insert(5, 10, 'a');
statusBar.setMessage('Typing...');

// Without scheduling: 3 separate renders
// With scheduling: 1 batched render
```

### Implementation

```typescript
// src/clients/tui/render-scheduler.ts
class RenderScheduler {
  private pendingTasks: Map<string, RenderTask>;
  private scheduled: boolean = false;

  schedule(callback: () => void, priority: Priority, taskId: string): void {
    // Deduplicate by task ID
    this.pendingTasks.set(taskId, { callback, priority });

    if (!this.scheduled) {
      this.scheduled = true;
      setImmediate(() => this.flush());
    }
  }

  private flush(): void {
    this.scheduled = false;

    // Sort by priority and execute
    const tasks = Array.from(this.pendingTasks.values())
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

    this.pendingTasks.clear();

    for (const task of tasks) {
      task.callback();
    }
  }
}
```

### Priorities

| Priority | Use Case |
|----------|----------|
| `immediate` | Cursor position updates |
| `high` | User input feedback |
| `normal` | Content updates |
| `low` | Background updates (git status, etc.) |

### Usage

```typescript
import { renderScheduler, RenderTaskIds } from '../render-scheduler.ts';

// Schedule with priority and deduplication
renderScheduler.schedule(() => {
  this.render(ctx);
}, 'normal', RenderTaskIds.EDITOR);
```

## ANSI Escape Sequences

### Terminal Setup

```typescript
// Enter alternate screen buffer
const ENTER_ALT_SCREEN = '\x1b[?1049h';

// Enable mouse reporting
const ENABLE_MOUSE = '\x1b[?1000h\x1b[?1002h\x1b[?1006h';

// Hide cursor
const HIDE_CURSOR = '\x1b[?25l';

// Show cursor
const SHOW_CURSOR = '\x1b[?25h';
```

### Cursor Movement

```typescript
// Move cursor to (row, col) - 1-indexed
function moveTo(row: number, col: number): string {
  return `\x1b[${row};${col}H`;
}

// Move cursor relative
const CURSOR_UP = (n: number) => `\x1b[${n}A`;
const CURSOR_DOWN = (n: number) => `\x1b[${n}B`;
const CURSOR_RIGHT = (n: number) => `\x1b[${n}C`;
const CURSOR_LEFT = (n: number) => `\x1b[${n}D`;
```

### Colors

Ultra uses 24-bit (true color) ANSI sequences:

```typescript
// Foreground color
function fg(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}

// Background color
function bg(r: number, g: number, b: number): string {
  return `\x1b[48;2;${r};${g};${b}m`;
}

// Reset attributes
const RESET = '\x1b[0m';

// Example: Red text on blue background
`${fg(255, 0, 0)}${bg(0, 0, 255)}Hello${RESET}`
```

### Text Attributes

```typescript
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';
const UNDERLINE = '\x1b[4m';
const REVERSE = '\x1b[7m';
```

## Layout System

### Window Layout

The Window class manages the overall layout:

```
┌──────────────────────────────────────────────────────────────────┐
│ y=0  [Sidebar]      │  [Pane Container]                          │
│                     │                                            │
│                     │  ┌──────────────────────────────────────┐  │
│                     │  │ Tab Bar                              │  │
│      (width varies) │  ├──────────────────────────────────────┤  │
│                     │  │ Editor Content                       │  │
│                     │  │                                      │  │
│                     │  └──────────────────────────────────────┘  │
│                     ├────────────────────────────────────────────│
│                     │  [Terminal Panel] (if visible)             │
├─────────────────────┴────────────────────────────────────────────│
│ y=height-1  [Status Bar]                                         │
└──────────────────────────────────────────────────────────────────┘
```

### Rect Structure

```typescript
interface Rect {
  x: number;      // 0-indexed column
  y: number;      // 0-indexed row
  width: number;
  height: number;
}
```

### Pane Splitting

Panes use a tree structure for splits:

```typescript
interface LayoutNode {
  type: 'leaf' | 'horizontal' | 'vertical';
  rect: Rect;
  children?: LayoutNode[];
  ratio?: number[];  // Split ratios
  id?: string;       // Pane ID for leaf nodes
}

// Example: Two panes side by side (vertical split)
{
  type: 'vertical',
  rect: { x: 31, y: 1, width: 80, height: 30 },
  ratio: [0.5, 0.5],
  children: [
    { type: 'leaf', id: 'pane1', rect: {...} },
    { type: 'leaf', id: 'pane2', rect: {...} }
  ]
}
```

## Component Rendering

### RenderContext

Components receive a RenderContext for rendering:

```typescript
interface RenderContext {
  buffer: ScreenBuffer;
  getThemeColor(key: string, fallback: string): string;
  rect: Rect;
}
```

### Theme Colors

Components MUST use theme colors:

```typescript
// GOOD - Use theme colors
render(ctx: RenderContext): void {
  const bg = ctx.getThemeColor('editor.background', '#1e1e1e');
  const fg = ctx.getThemeColor('editor.foreground', '#cccccc');

  ctx.buffer.set(x, y, { char: 'A', fg, bg });
}

// BAD - Hardcoded colors
render(ctx: RenderContext): void {
  ctx.buffer.set(x, y, { char: 'A', fg: '#cccccc', bg: '#1e1e1e' });
}
```

### Common Theme Color Keys

| Key | Purpose |
|-----|---------|
| `editor.background` | Editor background |
| `editor.foreground` | Editor text |
| `editor.lineHighlightBackground` | Current line highlight |
| `editorLineNumber.foreground` | Line numbers |
| `terminal.background` | Terminal background |
| `terminal.foreground` | Terminal text |
| `terminalCursor.foreground` | Terminal cursor |
| `statusBar.background` | Status bar background |
| `statusBar.foreground` | Status bar text |
| `tab.activeBackground` | Active tab background |
| `tab.inactiveBackground` | Inactive tab background |

### Editor Pane Rendering

```typescript
class DocumentEditor {
  render(ctx: RenderContext): void {
    const { buffer, rect } = ctx;
    const bg = ctx.getThemeColor('editor.background', '#1e1e1e');
    const fg = ctx.getThemeColor('editor.foreground', '#cccccc');

    for (let row = 0; row < rect.height; row++) {
      const lineNumber = this.scrollTop + row;
      const line = this.document.getLine(lineNumber);
      const tokens = this.highlighter.getTokens(lineNumber);

      // Render gutter
      this.renderGutter(ctx, row, lineNumber);

      // Render line content with syntax highlighting
      this.renderLine(ctx, row, tokens);
    }
  }
}
```

### Syntax Highlighting

Shiki provides tokenized output for rendering:

```typescript
interface Token {
  content: string;
  color?: string;  // Hex color from theme
}

// Render a highlighted line
function renderHighlightedLine(
  ctx: RenderContext,
  y: number,
  tokens: Token[]
): void {
  const bg = ctx.getThemeColor('editor.background', '#1e1e1e');
  let x = 0;

  for (const token of tokens) {
    const fg = token.color || ctx.getThemeColor('editor.foreground', '#cccccc');

    for (const char of token.content) {
      ctx.buffer.set(x, y, { char, fg, bg });
      x++;
    }
  }
}
```

## Color Utilities

### Color Conversion

```typescript
// src/core/colors.ts
import { hexToRgb, rgbToHex, lighten, darken } from '../core/colors.ts';

// Convert hex to RGB
const { r, g, b } = hexToRgb('#ff5555');

// Apply foreground color from hex
function fgHex(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `\x1b[38;2;${r};${g};${b}m`;
}

// Apply background color from hex
function bgHex(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `\x1b[48;2;${r};${g};${b}m`;
}
```

## Performance Considerations

### Avoiding Flicker

1. **Hide cursor during render**
   ```typescript
   process.stdout.write(HIDE_CURSOR);
   // ... render ...
   process.stdout.write(SHOW_CURSOR);
   ```

2. **Use dirty tracking**
   - Don't clear the entire buffer
   - Only write changed cells

3. **Buffer output**
   ```typescript
   let buffer = '';
   // Build all output in buffer
   buffer += moveTo(1, 1);
   buffer += content;
   // Write once
   process.stdout.write(buffer);
   ```

### Partial Updates

For small changes, update only affected regions:

```typescript
// Only re-render changed lines
function invalidateLine(lineNumber: number): void {
  renderScheduler.schedule(() => {
    this.renderLine(lineNumber);
  }, 'normal', `line-${lineNumber}`);
}
```

## Resize Handling

When the terminal resizes:

```typescript
process.stdout.on('resize', () => {
  const { columns, rows } = process.stdout;

  // Resize screen buffer
  this.buffer.resize(columns, rows);

  // Update layout
  this.window.updateDimensions(columns, rows);

  // Force full re-render
  this.buffer.markAllDirty();
  this.render();
});
```

## Debug Rendering

Enable render debugging with `--debug` flag:

```typescript
import { debugLog } from '../../debug.ts';

function debugRender(component: string, rect: Rect): void {
  debugLog(`[Render] ${component}: ${JSON.stringify(rect)}`);
}
```

## Best Practices

1. **Always use the render scheduler** - Never render directly
2. **Use dirty tracking** - Don't clear the buffer
3. **Hide cursor during updates** - Prevents flicker
4. **Use theme colors** - Never hardcode colors
5. **Components paint backgrounds** - Each component fills its own region
6. **Handle edge cases** - Empty lines, overflow, unicode width

## Related Documentation

- [Data Flow](data-flow.md) - How state changes trigger renders
- [Keybindings](keybindings.md) - Input handling
