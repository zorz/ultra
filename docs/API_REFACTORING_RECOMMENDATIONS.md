# Ultra Editor: API Refactoring & Documentation Recommendations

**Version:** 0.8 Pre-Release Analysis
**Date:** December 2024
**Status:** Recommendations for Review

---

## Executive Summary

Ultra is a well-structured terminal-native code editor with ~10,849 lines of UI component code. The architecture follows clear domain separation, but the dialog/modal components have evolved independently without a shared base abstraction. This document outlines specific inconsistencies, proposes a unified Dialog API, and provides a phased implementation plan.

---

## Current Architecture Overview

### Component Hierarchy

```
src/
├── core/              # Buffer, cursor, document, undo/redo
├── features/          # LSP, Git, AI, syntax, search
├── input/             # Keybindings, commands
├── config/            # Settings management
├── terminal/          # Raw terminal I/O, ANSI codes
└── ui/
    ├── components/    # 17 components (10,849 lines)
    │   ├── command-palette.ts    (620 lines) - Dialog
    │   ├── input-dialog.ts       (200 lines) - Dialog
    │   ├── file-picker.ts        (359 lines) - Dialog
    │   ├── git-diff-popup.ts     (518 lines) - Dialog
    │   ├── search-widget.ts      (653 lines) - Dialog
    │   ├── pane.ts               (~2000 lines) - Core
    │   ├── pane-manager.ts       - Core
    │   ├── file-browser.ts       - Panel
    │   ├── file-tree.ts          - Panel
    │   ├── git-panel.ts          - Panel
    │   ├── ai-panel.ts           - Panel
    │   ├── status-bar.ts         - Chrome
    │   ├── tab-bar.ts            - Chrome
    │   └── ...
    ├── renderer.ts    # RenderContext provider
    ├── mouse.ts       # MouseHandler interface
    ├── layout.ts      # Rect interface, LayoutManager
    └── themes/        # Theme loading
```

### Existing Shared Abstractions

| Interface | Purpose | Implementation |
|-----------|---------|----------------|
| `RenderContext` | Rendering API | All components use this |
| `MouseHandler` | Mouse event delegation | 4/5 dialog components implement |
| `Rect` | Position/size | Used by layout, GitDiffPopup |

---

## Dialog Component Analysis

### Components Classified as "Dialogs"

| Component | Lines | MouseHandler | Visibility API | Input Method | Positioning |
|-----------|-------|--------------|----------------|--------------|-------------|
| CommandPalette | 620 | ✓ | `isOpen()` | `appendToQuery()` | `show(screenW, screenH)` |
| InputDialog | 200 | ✗ | `isOpen()` | `appendChar()` | `show({screenWidth, screenHeight})` |
| FilePicker | 359 | ✓ | `isOpen()` | `appendToQuery()` | `show(root, screenW, screenH)` |
| GitDiffPopup | 518 | ✓ | `isVisible()` | `handleKey()` | `setRect(rect)` |
| SearchWidget | 653 | ✓ | `get visible` | `handleKey()` | `setPosition(x, y, w)` |

### Inconsistency Analysis

#### 1. Visibility API Inconsistency

```typescript
// CommandPalette, InputDialog, FilePicker
isOpen(): boolean { return this.isVisible; }

// GitDiffPopup
isVisible(): boolean { return this.visible; }

// SearchWidget
get visible(): boolean { return this.isVisible; }
```

**Problem:** Three different API patterns for the same concept.

**Recommendation:** Standardize on `isOpen(): boolean` method for all dialogs.

---

#### 2. Show/Hide API Inconsistency

```typescript
// CommandPalette
show(commands: Command[], screenWidth: number, screenHeight: number, editorX?: number, editorWidth?: number): void

// InputDialog - uses options object
show(options: {
  title: string;
  placeholder?: string;
  initialValue?: string;
  screenWidth: number;
  screenHeight: number;
  onConfirm: (value: string) => void;
  onCancel?: () => void;
}): void

// FilePicker - async!
async show(workspaceRoot: string, screenWidth: number, screenHeight: number, ...): Promise<void>

// GitDiffPopup - async + different params
async show(filePath: string, changes: GitLineChange[], targetLine: number): Promise<void>

// SearchWidget - minimal params
show(mode: SearchMode = 'find'): void
```

**Problems:**
- Inconsistent parameter patterns (positional vs options object)
- Some async, some sync
- No shared contract for screen dimensions

**Recommendation:** Create a `DialogConfig` interface:

```typescript
interface DialogConfig {
  screenWidth: number;
  screenHeight: number;
  editorX?: number;
  editorWidth?: number;
}

// All dialogs implement:
show(config: DialogConfig, ...componentSpecificParams): void | Promise<void>
```

---

#### 3. Text Input API Inconsistency

```typescript
// CommandPalette
appendToQuery(char: string): void
backspaceQuery(): void
getQuery(): string

// InputDialog
appendChar(char: string): void
backspace(): void
getValue(): string
setValue(value: string): void

// FilePicker
setQuery(query: string): void
appendToQuery(char: string): void
backspaceQuery(): void
getQuery(): string

// SearchWidget - handles all input internally via handleKey()
```

**Problem:** Each component reimplements text input differently.

**Recommendation:** Extract `TextInput` component/mixin:

```typescript
class TextInput {
  private value: string = '';
  private cursorPosition: number = 0;

  appendChar(char: string): void
  backspace(): void
  delete(): void
  moveCursor(direction: 'left' | 'right' | 'home' | 'end'): void
  getValue(): string
  setValue(value: string): void
  getCursorPosition(): number
  // ... selection support
}
```

---

#### 4. Callback Registration Inconsistency

```typescript
// CommandPalette
onSelect(callback: (command: Command) => void): void
onClose(callback: () => void): void

// InputDialog - callbacks passed in show()
show({ onConfirm: (value) => {}, onCancel: () => {} })

// FilePicker
onSelect(callback: (filePath: string) => void): void
onClose(callback: () => void): void

// GitDiffPopup
onClose(callback: () => void): void
onStage(callback: (path, start, end) => Promise<void>): void
onRevert(callback: (path, start, end) => Promise<void>): void
onRefresh(callback: () => void): void

// SearchWidget
onClose(callback: () => void): void
onNavigate(callback: (match: SearchMatch | null) => void): void
onReplace(callback: () => void): void
```

**Problem:** Mix of registration methods and constructor/show params.

**Recommendation:** Standardize on registration methods with return cleanup:

```typescript
// Standard pattern
onClose(callback: () => void): () => void  // Returns unsubscribe
onConfirm(callback: (result: T) => void): () => void
```

---

#### 5. Positioning API Inconsistency

```typescript
// CommandPalette, InputDialog, FilePicker - auto-calculate in show()
show(screenWidth, screenHeight, editorX?, editorWidth?)

// GitDiffPopup - uses Rect interface
setRect(rect: Rect): void

// SearchWidget - separate method
setPosition(x: number, y: number, width: number): void
```

**Problem:** No consistent way to position/size dialogs.

**Recommendation:** All dialogs should use `Rect` interface:

```typescript
setRect(rect: Rect): void
getRect(): Rect
// OR
setBounds(rect: Partial<Rect>): void  // Allows partial updates
```

---

#### 6. Rendering Code Duplication

The following code is duplicated across multiple components:

**hexToRgb conversion:** (~10 lines, in InputDialog)
```typescript
private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!hex || !hex.startsWith('#')) return null;
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? { r: parseInt(result[1]!, 16), ... } : null;
}
```

**Border drawing:** (~15 lines each, in CommandPalette, FilePicker, GitDiffPopup)
```typescript
private drawBorder(ctx: RenderContext): void {
  const borderColor = '#444444';
  ctx.drawStyled(this.x, this.y, '╭' + '─'.repeat(this.width - 2) + '╮', ...);
  // ... side borders ...
  ctx.drawStyled(this.x, this.y + this.height - 1, '╰' + '─'.repeat(...) + '╯', ...);
}
```

**Recommendation:** Create `RenderUtils` class:

```typescript
// src/ui/render-utils.ts
export class RenderUtils {
  static drawRoundedBorder(ctx: RenderContext, rect: Rect, color: string, bg?: string): void
  static drawSquareBorder(ctx: RenderContext, rect: Rect, color: string, bg?: string): void
  static drawShadow(ctx: RenderContext, rect: Rect): void
  static truncateText(text: string, maxLength: number, ellipsis = '…'): string
  static centerText(text: string, width: number): string
}
```

---

#### 7. MouseHandler Implementation Missing

**InputDialog does NOT implement MouseHandler**

```typescript
// Current - no mouse support
export class InputDialog {
  // Missing: containsPoint, onMouseEvent
}

// All other dialogs implement MouseHandler
export class CommandPalette implements MouseHandler { ... }
```

**Recommendation:** All dialogs should implement `MouseHandler`.

---

## Proposed Base Dialog Architecture

### BaseDialog Abstract Class

```typescript
// src/ui/components/base-dialog.ts

import type { RenderContext } from '../renderer.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import type { Rect } from '../layout.ts';

export interface DialogConfig {
  screenWidth: number;
  screenHeight: number;
  editorX?: number;
  editorWidth?: number;
}

export abstract class BaseDialog implements MouseHandler {
  protected isVisible: boolean = false;
  protected rect: Rect = { x: 0, y: 0, width: 60, height: 20 };

  // Callbacks with cleanup support
  protected closeCallbacks: Set<() => void> = new Set();

  // === Lifecycle ===

  abstract show(config: DialogConfig, ...args: any[]): void | Promise<void>;

  hide(): void {
    this.isVisible = false;
    this.closeCallbacks.forEach(cb => cb());
  }

  isOpen(): boolean {
    return this.isVisible;
  }

  // === Positioning ===

  setRect(rect: Rect): void {
    this.rect = rect;
  }

  getRect(): Rect {
    return { ...this.rect };
  }

  protected centerInEditor(config: DialogConfig, width: number, height: number): Rect {
    const centerX = config.editorX !== undefined && config.editorWidth !== undefined
      ? config.editorX + Math.floor(config.editorWidth / 2)
      : Math.floor(config.screenWidth / 2);

    return {
      x: centerX - Math.floor(width / 2) + 1,
      y: 2,
      width: Math.min(width, (config.editorWidth || config.screenWidth) - 4),
      height: Math.min(height, config.screenHeight - 4)
    };
  }

  // === Callbacks ===

  onClose(callback: () => void): () => void {
    this.closeCallbacks.add(callback);
    return () => this.closeCallbacks.delete(callback);
  }

  // === Rendering (abstract) ===

  abstract render(ctx: RenderContext): void;

  // Helper for common border rendering
  protected drawBorder(ctx: RenderContext, style: 'rounded' | 'square' = 'rounded'): void {
    RenderUtils.drawBorder(ctx, this.rect, style);
  }

  // === MouseHandler ===

  containsPoint(x: number, y: number): boolean {
    if (!this.isVisible) return false;
    return (
      x >= this.rect.x &&
      x < this.rect.x + this.rect.width &&
      y >= this.rect.y &&
      y < this.rect.y + this.rect.height
    );
  }

  abstract onMouseEvent(event: MouseEvent): boolean;
}
```

### SearchableDialog Extension

For dialogs with fuzzy search (CommandPalette, FilePicker):

```typescript
// src/ui/components/searchable-dialog.ts

export abstract class SearchableDialog<T> extends BaseDialog {
  protected query: string = '';
  protected items: T[] = [];
  protected filteredItems: Array<{ item: T; score: number }> = [];
  protected selectedIndex: number = 0;

  // Callbacks
  protected selectCallbacks: Set<(item: T) => void> = new Set();

  // === Query Management ===

  getQuery(): string {
    return this.query;
  }

  setQuery(query: string): void {
    this.query = query;
    this.selectedIndex = 0;
    this.filter();
  }

  appendToQuery(char: string): void {
    this.query += char;
    this.selectedIndex = 0;
    this.filter();
  }

  backspaceQuery(): void {
    if (this.query.length > 0) {
      this.query = this.query.slice(0, -1);
      this.selectedIndex = 0;
      this.filter();
    }
  }

  // === Selection ===

  selectNext(): void {
    if (this.selectedIndex < this.filteredItems.length - 1) {
      this.selectedIndex++;
    }
  }

  selectPrevious(): void {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
    }
  }

  getSelectedItem(): T | null {
    return this.filteredItems[this.selectedIndex]?.item ?? null;
  }

  async confirm(): Promise<void> {
    const item = this.getSelectedItem();
    if (item) {
      this.selectCallbacks.forEach(cb => cb(item));
    }
    this.hide();
  }

  // === Abstract ===

  protected abstract filter(): void;
  protected abstract scoreItem(item: T, query: string): number;

  // === Callbacks ===

  onSelect(callback: (item: T) => void): () => void {
    this.selectCallbacks.add(callback);
    return () => this.selectCallbacks.delete(callback);
  }
}
```

### InputDialog Refactored

```typescript
// src/ui/components/input-dialog.ts (refactored)

export interface InputDialogOptions {
  title: string;
  placeholder?: string;
  initialValue?: string;
}

export class InputDialog extends BaseDialog {
  private title: string = '';
  private value: string = '';
  private placeholder: string = '';
  private confirmCallbacks: Set<(value: string) => void> = new Set();
  private cancelCallbacks: Set<() => void> = new Set();

  show(config: DialogConfig, options: InputDialogOptions): void {
    this.isVisible = true;
    this.title = options.title;
    this.placeholder = options.placeholder || '';
    this.value = options.initialValue || '';

    // Auto-center with fixed dimensions
    this.rect = this.centerInEditor(config, 60, 5);
    this.rect.y = Math.floor(config.screenHeight / 3);
  }

  // ... rest of implementation using BaseDialog patterns

  onConfirm(callback: (value: string) => void): () => void {
    this.confirmCallbacks.add(callback);
    return () => this.confirmCallbacks.delete(callback);
  }

  onCancel(callback: () => void): () => void {
    this.cancelCallbacks.add(callback);
    return () => this.cancelCallbacks.delete(callback);
  }
}
```

---

## Recommended Type Definitions

### Core Dialog Types

```typescript
// src/ui/types.ts

export interface DialogConfig {
  screenWidth: number;
  screenHeight: number;
  editorX?: number;
  editorWidth?: number;
}

export interface DialogResult<T> {
  confirmed: boolean;
  value?: T;
}

export type DialogCallback<T> = (result: DialogResult<T>) => void;
```

### Command System Types

```typescript
// src/input/types.ts

export interface Command {
  id: string;
  title: string;
  category?: CommandCategory;
  description?: string;
  keybinding?: string;
  handler: () => void | Promise<void>;
}

export type CommandCategory =
  | 'File'
  | 'Edit'
  | 'Selection'
  | 'View'
  | 'Navigation'
  | 'Search'
  | 'Git'
  | 'Terminal'
  | 'Debug';
```

---

## Implementation Plan

### Phase 1: Foundation (Low Risk)

1. **Create `RenderUtils` class**
   - Extract common rendering functions
   - No changes to existing components
   - Add unit tests

2. **Create `TextInput` class**
   - Reusable text input handling
   - Cursor management, selection support
   - No changes to existing components

3. **Create type definition files**
   - `src/ui/types.ts`
   - `src/input/types.ts`
   - Export from index files

### Phase 2: Base Classes (Medium Risk)

4. **Create `BaseDialog` abstract class**
   - Implement shared functionality
   - Don't modify existing dialogs yet

5. **Create `SearchableDialog` extension**
   - Fuzzy search functionality
   - Selection management

### Phase 3: Migration (Higher Risk)

6. **Migrate `InputDialog` to `BaseDialog`**
   - Simplest dialog, good test case
   - Add MouseHandler support
   - Update all call sites

7. **Migrate `FilePicker` to `SearchableDialog`**
   - Already similar structure
   - Test fuzzy search compatibility

8. **Migrate `CommandPalette` to `SearchableDialog`**
   - Most complex, do last
   - Preserve dual-mode functionality

9. **Migrate `GitDiffPopup` and `SearchWidget`**
   - These have unique features
   - May need additional base class methods

### Phase 4: Documentation & Testing

10. **Write API documentation**
    - JSDoc for all public methods
    - Usage examples
    - Architecture overview

11. **Add integration tests**
    - Dialog lifecycle tests
    - Mouse interaction tests
    - Keyboard navigation tests

---

## API Documentation Template

Each dialog component should have documentation following this template:

```typescript
/**
 * CommandPalette - Fuzzy search command/item selector
 *
 * @extends SearchableDialog<Command | PaletteItem>
 *
 * @example
 * ```typescript
 * // Show with commands
 * commandPalette.show(config, commands);
 * commandPalette.onSelect((cmd) => cmd.handler());
 *
 * // Show with custom items
 * commandPalette.showWithItems(config, items, 'Select Theme');
 * ```
 *
 * @keyboard
 * - Up/Down: Navigate items
 * - Enter: Confirm selection
 * - Escape: Close
 * - Type: Filter items
 *
 * @mouse
 * - Click item: Select and confirm
 * - Click outside: Close
 */
```

---

## Breaking Changes Checklist

When implementing these changes, the following call sites will need updates:

| Component | Current Usage | New Usage |
|-----------|--------------|-----------|
| InputDialog | `show({ title, screenWidth, ... })` | `show(config, { title })` |
| CommandPalette | `show(cmds, w, h, x?, w?)` | `show(config, cmds)` |
| FilePicker | `show(root, w, h, x?, w?)` | `show(config, root)` |
| GitDiffPopup | Separate `show()` + `setRect()` | Combined `show(config, ...)` |
| SearchWidget | Separate `show()` + `setPosition()` | Combined or keep separate |

---

## Metrics & Success Criteria

### Before Refactoring
- 5 dialog components with no shared base
- ~300 lines of duplicated code
- 5 different visibility API patterns
- 4 different input handling patterns

### After Refactoring
- All dialogs extend `BaseDialog`
- <50 lines of duplicated code
- 1 consistent visibility API
- 1 `TextInput` class for all input
- 100% MouseHandler implementation
- Comprehensive JSDoc coverage

---

## Files to Create

```
src/ui/
├── types.ts                    # Shared UI types
├── render-utils.ts             # Common rendering functions
├── components/
│   ├── base-dialog.ts          # BaseDialog abstract class
│   ├── searchable-dialog.ts    # SearchableDialog extension
│   └── text-input.ts           # TextInput component/class
└── __tests__/
    ├── base-dialog.test.ts
    ├── searchable-dialog.test.ts
    └── text-input.test.ts
```

---

## Conclusion

The Ultra codebase is well-organized but would benefit from a unified Dialog API. The proposed `BaseDialog` and `SearchableDialog` abstractions will:

1. **Reduce code duplication** by ~250 lines
2. **Standardize APIs** for easier maintenance
3. **Improve consistency** for users of the internal API
4. **Enable future features** like dialog stacking, animations, and accessibility

The phased approach minimizes risk by allowing incremental migration and testing.

---

*Document prepared for Ultra Editor v0.8 release planning*
