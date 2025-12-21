/**
 * Autocomplete Popup
 *
 * Displays LSP completion suggestions near the cursor.
 * Supports filtering, navigation, and selection.
 */

import type { Overlay, OverlayManagerCallbacks } from './overlay-manager.ts';
import type { Rect, KeyEvent, MouseEvent, InputEvent } from '../types.ts';
import { isKeyEvent, isMouseEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import type { LSPCompletionItem } from '../../../services/lsp/types.ts';
import { CompletionItemKind } from '../../../services/lsp/types.ts';

// ============================================
// Types
// ============================================

/**
 * Simplified completion item for display.
 */
export interface AutocompleteItem {
  label: string;
  kind: number;
  detail?: string;
  documentation?: string | { kind: string; value: string };
  insertText: string;
  sortText?: string;
  filterText?: string;
}

/**
 * Callback when a completion item is selected.
 */
export type CompletionSelectCallback = (item: LSPCompletionItem, prefix: string, startColumn: number) => void;

/**
 * Callback when the popup is dismissed.
 */
export type CompletionDismissCallback = () => void;

// ============================================
// Completion Kind Icons
// ============================================

/** Terminal-compatible text icons for completion kinds */
const COMPLETION_KIND_TEXT: Record<number, string> = {
  [CompletionItemKind.Text]: 'txt',
  [CompletionItemKind.Method]: 'mth',
  [CompletionItemKind.Function]: 'fn ',
  [CompletionItemKind.Constructor]: 'ctr',
  [CompletionItemKind.Field]: 'fld',
  [CompletionItemKind.Variable]: 'var',
  [CompletionItemKind.Class]: 'cls',
  [CompletionItemKind.Interface]: 'int',
  [CompletionItemKind.Module]: 'mod',
  [CompletionItemKind.Property]: 'prp',
  [CompletionItemKind.Unit]: 'unt',
  [CompletionItemKind.Value]: 'val',
  [CompletionItemKind.Enum]: 'enm',
  [CompletionItemKind.Keyword]: 'kwd',
  [CompletionItemKind.Snippet]: 'snp',
  [CompletionItemKind.Color]: 'clr',
  [CompletionItemKind.File]: 'fil',
  [CompletionItemKind.Reference]: 'ref',
  [CompletionItemKind.Folder]: 'dir',
  [CompletionItemKind.EnumMember]: 'emb',
  [CompletionItemKind.Constant]: 'cst',
  [CompletionItemKind.Struct]: 'str',
  [CompletionItemKind.Event]: 'evt',
  [CompletionItemKind.Operator]: 'opr',
  [CompletionItemKind.TypeParameter]: 'typ',
};

// ============================================
// Autocomplete Popup
// ============================================

export class AutocompletePopup implements Overlay {
  readonly id: string;
  zIndex = 300; // Above other overlays

  /** All items from LSP */
  private allItems: LSPCompletionItem[] = [];
  /** Filtered items */
  private items: LSPCompletionItem[] = [];
  /** Selected item index */
  private selectedIndex = 0;
  /** Scroll offset for visible window */
  private scrollOffset = 0;
  /** Maximum visible items */
  private maxVisibleItems = 10;
  /** Popup width in characters */
  private popupWidth = 50;

  /** Current prefix being typed */
  private prefix = '';
  /** Column where prefix started */
  private startColumn = 0;

  /** Visibility state */
  private visible = false;
  /** Popup bounds */
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 };

  /** Callbacks */
  private callbacks: OverlayManagerCallbacks;
  private onSelectCallback: CompletionSelectCallback | null = null;
  private onDismissCallback: CompletionDismissCallback | null = null;

  constructor(id: string, callbacks: OverlayManagerCallbacks) {
    this.id = id;
    this.callbacks = callbacks;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the popup with completions.
   *
   * @param items Completion items from LSP
   * @param x Screen X position (cursor column)
   * @param y Screen Y position (cursor line)
   * @param prefix Current word prefix
   * @param startColumn Column where the prefix started
   */
  showCompletions(
    items: LSPCompletionItem[],
    x: number,
    y: number,
    prefix: string = '',
    startColumn: number = 0
  ): void {
    if (items.length === 0) {
      this.hide();
      return;
    }

    this.allItems = items;
    this.prefix = prefix;
    this.startColumn = startColumn;
    this.visible = true;

    // Filter and sort items
    this.filterItems();

    if (this.items.length === 0) {
      this.hide();
      return;
    }

    // Calculate bounds
    this.calculateBounds(x, y);
    this.callbacks.onDirty();
  }

  /**
   * Update the prefix and re-filter items.
   */
  updatePrefix(prefix: string): void {
    this.prefix = prefix;
    this.filterItems();

    if (this.items.length === 0) {
      this.hide();
    } else {
      this.callbacks.onDirty();
    }
  }

  /**
   * Get the current prefix.
   */
  getPrefix(): string {
    return this.prefix;
  }

  /**
   * Get the start column.
   */
  getStartColumn(): number {
    return this.startColumn;
  }

  /**
   * Set callback for when an item is selected.
   */
  onSelect(callback: CompletionSelectCallback): void {
    this.onSelectCallback = callback;
  }

  /**
   * Set callback for when popup is dismissed.
   */
  onDismissed(callback: CompletionDismissCallback): void {
    this.onDismissCallback = callback;
  }

  /**
   * Accept the currently selected item.
   */
  acceptSelected(): void {
    if (this.items.length > 0 && this.selectedIndex < this.items.length) {
      const item = this.items[this.selectedIndex];
      if (item) {
        this.onSelectCallback?.(item, this.prefix, this.startColumn);
      }
    }
    this.hide();
  }

  /**
   * Get the currently selected item.
   */
  getSelectedItem(): LSPCompletionItem | null {
    if (this.items.length > 0 && this.selectedIndex < this.items.length) {
      return this.items[this.selectedIndex] ?? null;
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Overlay Interface
  // ─────────────────────────────────────────────────────────────────────────

  isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.callbacks.onDirty();
  }

  hide(): void {
    if (this.visible) {
      this.visible = false;
      this.allItems = [];
      this.items = [];
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      this.prefix = '';
      this.onDismissCallback?.();
      this.callbacks.onDirty();
    }
  }

  setBounds(bounds: Rect): void {
    this.bounds = bounds;
  }

  getBounds(): Rect {
    return this.bounds;
  }

  onDismiss(): void {
    this.hide();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  render(buffer: ScreenBuffer): void {
    if (!this.visible || this.items.length === 0) return;

    const { x, y, width, height } = this.bounds;
    const bgColor = this.callbacks.getThemeColor('editorSuggestWidget.background', '#252526');
    const fgColor = this.callbacks.getThemeColor('editorSuggestWidget.foreground', '#bbbbbb');
    const selectedBg = this.callbacks.getThemeColor('editorSuggestWidget.selectedBackground', '#094771');
    const borderColor = this.callbacks.getThemeColor('editorSuggestWidget.border', '#454545');
    const highlightColor = this.callbacks.getThemeColor('editorSuggestWidget.highlightForeground', '#18a3ff');

    // Draw border and background
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const screenX = x + col;
        const screenY = y + row;

        // Border
        if (row === 0 || row === height - 1 || col === 0 || col === width - 1) {
          let char = ' ';
          if (row === 0 && col === 0) char = '┌';
          else if (row === 0 && col === width - 1) char = '┐';
          else if (row === height - 1 && col === 0) char = '└';
          else if (row === height - 1 && col === width - 1) char = '┘';
          else if (row === 0 || row === height - 1) char = '─';
          else char = '│';

          buffer.set(screenX, screenY, { char, fg: borderColor, bg: bgColor });
        } else {
          buffer.set(screenX, screenY, { char: ' ', fg: fgColor, bg: bgColor });
        }
      }
    }

    // Draw items
    const visibleCount = Math.min(this.items.length, this.maxVisibleItems);
    for (let i = 0; i < visibleCount; i++) {
      const itemIndex = this.scrollOffset + i;
      if (itemIndex >= this.items.length) break;

      const item = this.items[itemIndex];
      if (!item) continue;

      const isSelected = itemIndex === this.selectedIndex;
      const rowY = y + 1 + i;
      const rowBg = isSelected ? selectedBg : bgColor;

      // Clear row
      for (let col = 1; col < width - 1; col++) {
        buffer.set(x + col, rowY, { char: ' ', fg: fgColor, bg: rowBg });
      }

      // Draw kind icon
      const kindIcon = COMPLETION_KIND_TEXT[item.kind ?? 1] ?? '   ';
      const kindColor = this.getKindColor(item.kind);
      for (let j = 0; j < 3; j++) {
        buffer.set(x + 1 + j, rowY, { char: kindIcon[j] ?? ' ', fg: kindColor, bg: rowBg });
      }

      // Draw separator
      buffer.set(x + 4, rowY, { char: ' ', fg: fgColor, bg: rowBg });

      // Draw label with prefix highlighting
      const label = item.label;
      const maxLabelWidth = width - 7; // Account for border, icon, separator
      const displayLabel = label.length > maxLabelWidth ? label.slice(0, maxLabelWidth - 1) + '…' : label;

      for (let c = 0; c < displayLabel.length; c++) {
        const char = displayLabel[c] ?? ' ';
        const charCol = x + 5 + c;

        // Highlight matching prefix
        let charFg = fgColor;
        if (this.prefix && c < this.prefix.length) {
          const prefixChar = this.prefix[c]?.toLowerCase() ?? '';
          const labelChar = char.toLowerCase();
          if (prefixChar === labelChar) {
            charFg = highlightColor;
          }
        }

        buffer.set(charCol, rowY, { char, fg: charFg, bg: rowBg });
      }
    }

    // Draw scrollbar if needed
    if (this.items.length > this.maxVisibleItems) {
      this.renderScrollbar(buffer, x + width - 1, y + 1, height - 2);
    }
  }

  private renderScrollbar(buffer: ScreenBuffer, x: number, y: number, height: number): void {
    const trackColor = this.callbacks.getThemeColor('scrollbarSlider.background', '#4a4a4a');
    const thumbColor = this.callbacks.getThemeColor('scrollbarSlider.activeBackground', '#6a6a6a');

    const thumbHeight = Math.max(1, Math.floor((this.maxVisibleItems / this.items.length) * height));
    const maxScroll = this.items.length - this.maxVisibleItems;
    const thumbTop = maxScroll > 0 ? Math.floor((this.scrollOffset / maxScroll) * (height - thumbHeight)) : 0;

    for (let i = 0; i < height; i++) {
      const isThumb = i >= thumbTop && i < thumbTop + thumbHeight;
      buffer.set(x, y + i, { char: '▐', fg: isThumb ? thumbColor : trackColor, bg: isThumb ? thumbColor : trackColor });
    }
  }

  private getKindColor(kind: number | undefined): string {
    switch (kind) {
      case CompletionItemKind.Function:
      case CompletionItemKind.Method:
        return this.callbacks.getThemeColor('symbolIcon.functionForeground', '#b180d7');
      case CompletionItemKind.Variable:
      case CompletionItemKind.Field:
      case CompletionItemKind.Property:
        return this.callbacks.getThemeColor('symbolIcon.variableForeground', '#75beff');
      case CompletionItemKind.Class:
      case CompletionItemKind.Struct:
        return this.callbacks.getThemeColor('symbolIcon.classForeground', '#ee9d28');
      case CompletionItemKind.Interface:
        return this.callbacks.getThemeColor('symbolIcon.interfaceForeground', '#75beff');
      case CompletionItemKind.Module:
        return this.callbacks.getThemeColor('symbolIcon.moduleForeground', '#ee9d28');
      case CompletionItemKind.Keyword:
        return this.callbacks.getThemeColor('symbolIcon.keywordForeground', '#c586c0');
      case CompletionItemKind.Constant:
      case CompletionItemKind.Enum:
      case CompletionItemKind.EnumMember:
        return this.callbacks.getThemeColor('symbolIcon.constantForeground', '#4fc1ff');
      default:
        return this.callbacks.getThemeColor('editorSuggestWidget.foreground', '#bbbbbb');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  handleInput(event: InputEvent): boolean {
    if (!this.visible) return false;

    if (isKeyEvent(event)) {
      return this.handleKey(event);
    } else if (isMouseEvent(event)) {
      return this.handleMouse(event);
    }

    return false;
  }

  private handleKey(event: KeyEvent): boolean {
    switch (event.key) {
      case 'ArrowUp':
        this.moveSelection(-1);
        return true;

      case 'ArrowDown':
        this.moveSelection(1);
        return true;

      case 'PageUp':
        this.moveSelection(-this.maxVisibleItems);
        return true;

      case 'PageDown':
        this.moveSelection(this.maxVisibleItems);
        return true;

      case 'Tab':
      case 'Enter':
        this.acceptSelected();
        return true;

      case 'Escape':
        this.hide();
        return true;

      default:
        // Don't consume other keys - let them be handled by editor
        return false;
    }
  }

  private handleMouse(event: MouseEvent): boolean {
    // Check if press is within bounds
    if (event.type === 'press') {
      const { x, y, width, height } = this.bounds;

      if (event.x >= x && event.x < x + width && event.y >= y && event.y < y + height) {
        // Calculate which item was clicked
        const clickedRow = event.y - y - 1; // -1 for border
        if (clickedRow >= 0 && clickedRow < this.maxVisibleItems) {
          const clickedIndex = this.scrollOffset + clickedRow;
          if (clickedIndex < this.items.length) {
            this.selectedIndex = clickedIndex;
            this.acceptSelected();
            this.callbacks.onDirty();
            return true;
          }
        }
      }
    }

    return false;
  }

  private moveSelection(delta: number): void {
    const newIndex = Math.max(0, Math.min(this.items.length - 1, this.selectedIndex + delta));
    if (newIndex !== this.selectedIndex) {
      this.selectedIndex = newIndex;

      // Adjust scroll to keep selection visible
      if (this.selectedIndex < this.scrollOffset) {
        this.scrollOffset = this.selectedIndex;
      } else if (this.selectedIndex >= this.scrollOffset + this.maxVisibleItems) {
        this.scrollOffset = this.selectedIndex - this.maxVisibleItems + 1;
      }

      this.callbacks.onDirty();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Filtering
  // ─────────────────────────────────────────────────────────────────────────

  private filterItems(): void {
    const lowerPrefix = this.prefix.toLowerCase();

    if (!lowerPrefix) {
      this.items = [...this.allItems];
    } else {
      // Filter items that match the prefix
      this.items = this.allItems.filter((item) => {
        const label = item.label.toLowerCase();
        const filterText = (item.insertText || item.label).toLowerCase();
        return (
          label.startsWith(lowerPrefix) ||
          filterText.startsWith(lowerPrefix) ||
          label.includes(lowerPrefix) ||
          filterText.includes(lowerPrefix)
        );
      });

      // Sort: exact prefix matches first, then starts-with, then contains
      this.items.sort((a, b) => {
        const aLabel = a.label.toLowerCase();
        const bLabel = b.label.toLowerCase();
        const aStartsWith = aLabel.startsWith(lowerPrefix);
        const bStartsWith = bLabel.startsWith(lowerPrefix);

        if (aStartsWith && !bStartsWith) return -1;
        if (!aStartsWith && bStartsWith) return 1;

        // Secondary sort by length (shorter = better match)
        return a.label.length - b.label.length;
      });
    }

    // Reset selection
    this.selectedIndex = 0;
    this.scrollOffset = 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Positioning
  // ─────────────────────────────────────────────────────────────────────────

  private calculateBounds(cursorX: number, cursorY: number): void {
    const screenSize = this.callbacks.getScreenSize();
    const visibleItems = Math.min(this.items.length, this.maxVisibleItems);
    const height = visibleItems + 2; // +2 for border
    const width = this.popupWidth;

    // Try to position below cursor
    let x = cursorX;
    let y = cursorY + 1;

    // Adjust if would go off-screen horizontally
    if (x + width > screenSize.width) {
      x = Math.max(0, screenSize.width - width);
    }

    // Adjust if would go off-screen vertically
    if (y + height > screenSize.height) {
      // Position above cursor instead
      y = cursorY - height;
      if (y < 0) {
        y = 0;
      }
    }

    this.bounds = { x, y, width, height };
  }
}

/**
 * Create an autocomplete popup instance.
 */
export function createAutocompletePopup(id: string, callbacks: OverlayManagerCallbacks): AutocompletePopup {
  return new AutocompletePopup(id, callbacks);
}
