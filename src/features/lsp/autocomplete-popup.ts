/**
 * Autocomplete Popup Component
 * 
 * Displays LSP completion suggestions near the cursor.
 */

import type { RenderContext } from '../../ui/renderer.ts';
import type { LSPCompletionItem } from './client.ts';
import { themeLoader } from '../../ui/themes/theme-loader.ts';

// Completion item kinds (LSP spec)
const COMPLETION_KIND_ICONS: Record<number, string> = {
  1: '📝',   // Text
  2: '⚙️',   // Method
  3: 'ƒ ',   // Function
  4: '🔧',   // Constructor
  5: '📦',   // Field
  6: '📊',   // Variable
  7: '📦',   // Class
  8: '🔷',   // Interface
  9: '📦',   // Module
  10: '📋',  // Property
  11: '📏',  // Unit
  12: '🔢',  // Value
  13: '📑',  // Enum
  14: '🔑',  // Keyword
  15: '✂️',  // Snippet
  16: '🎨',  // Color
  17: '📄',  // File
  18: '📁',  // Reference
  19: '📁',  // Folder
  20: '📑',  // EnumMember
  21: 'π ',  // Constant
  22: '🏗️',  // Struct
  23: '⚡',  // Event
  24: '➕',  // Operator
  25: 'T ',  // TypeParameter
};

// Simple text icons for terminal compatibility
const COMPLETION_KIND_TEXT: Record<number, string> = {
  1: 'txt',  // Text
  2: 'mth',  // Method
  3: 'fn ',  // Function
  4: 'ctr',  // Constructor
  5: 'fld',  // Field
  6: 'var',  // Variable
  7: 'cls',  // Class
  8: 'int',  // Interface
  9: 'mod',  // Module
  10: 'prp', // Property
  11: 'unt', // Unit
  12: 'val', // Value
  13: 'enm', // Enum
  14: 'kwd', // Keyword
  15: 'snp', // Snippet
  16: 'clr', // Color
  17: 'fil', // File
  18: 'ref', // Reference
  19: 'dir', // Folder
  20: 'emb', // EnumMember
  21: 'cst', // Constant
  22: 'str', // Struct
  23: 'evt', // Event
  24: 'opr', // Operator
  25: 'typ', // TypeParameter
};

export class AutocompletePopup {
  private visible = false;
  private items: LSPCompletionItem[] = [];
  private selectedIndex = 0;
  private x = 0;
  private y = 0;
  private maxVisibleItems = 10;
  private scrollOffset = 0;
  private onSelectCallback: ((item: LSPCompletionItem) => void) | null = null;
  private onDismissCallback: (() => void) | null = null;

  /**
   * Show the popup with completions
   */
  show(items: LSPCompletionItem[], x: number, y: number): void {
    if (items.length === 0) {
      this.hide();
      return;
    }
    
    this.items = items;
    this.selectedIndex = 0;
    this.scrollOffset = 0;
    this.x = x;
    this.y = y;
    this.visible = true;
  }

  /**
   * Hide the popup
   */
  hide(): void {
    this.visible = false;
    this.items = [];
    this.selectedIndex = 0;
    this.scrollOffset = 0;
  }

  /**
   * Check if popup is visible
   */
  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Set selection callback
   */
  onSelect(callback: (item: LSPCompletionItem) => void): void {
    this.onSelectCallback = callback;
  }

  /**
   * Set dismiss callback
   */
  onDismiss(callback: () => void): void {
    this.onDismissCallback = callback;
  }

  /**
   * Get the selected item
   */
  getSelectedItem(): LSPCompletionItem | null {
    return this.items[this.selectedIndex] || null;
  }

  /**
   * Select next item
   */
  selectNext(): void {
    if (this.items.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.items.length;
    this.ensureSelectedVisible();
  }

  /**
   * Select previous item
   */
  selectPrevious(): void {
    if (this.items.length === 0) return;
    this.selectedIndex = (this.selectedIndex - 1 + this.items.length) % this.items.length;
    this.ensureSelectedVisible();
  }

  /**
   * Page down
   */
  pageDown(): void {
    if (this.items.length === 0) return;
    this.selectedIndex = Math.min(this.selectedIndex + this.maxVisibleItems, this.items.length - 1);
    this.ensureSelectedVisible();
  }

  /**
   * Page up
   */
  pageUp(): void {
    if (this.items.length === 0) return;
    this.selectedIndex = Math.max(this.selectedIndex - this.maxVisibleItems, 0);
    this.ensureSelectedVisible();
  }

  /**
   * Ensure selected item is visible
   */
  private ensureSelectedVisible(): void {
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + this.maxVisibleItems) {
      this.scrollOffset = this.selectedIndex - this.maxVisibleItems + 1;
    }
  }

  /**
   * Accept current selection
   */
  accept(): void {
    const item = this.getSelectedItem();
    if (item && this.onSelectCallback) {
      this.onSelectCallback(item);
    }
    this.hide();
  }

  /**
   * Dismiss popup
   */
  dismiss(): void {
    if (this.onDismissCallback) {
      this.onDismissCallback();
    }
    this.hide();
  }

  /**
   * Handle keyboard input
   * Returns true if the key was handled
   */
  handleKey(key: string, ctrl: boolean): boolean {
    if (!this.visible) return false;

    switch (key) {
      case 'DOWN':
        this.selectNext();
        return true;
      case 'UP':
        this.selectPrevious();
        return true;
      case 'PAGEDOWN':
        this.pageDown();
        return true;
      case 'PAGEUP':
        this.pageUp();
        return true;
      case 'TAB':
      case 'ENTER':
        this.accept();
        return true;
      case 'ESCAPE':
        this.dismiss();
        return true;
      default:
        return false;
    }
  }

  /**
   * Update position (when cursor moves)
   */
  setPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  /**
   * Render the popup
   */
  render(ctx: RenderContext, screenWidth: number, screenHeight: number): void {
    if (!this.visible || this.items.length === 0) return;

    const width = 50;
    const visibleItems = Math.min(this.items.length, this.maxVisibleItems);
    const height = visibleItems + 2;  // +2 for borders

    // Adjust position to fit on screen
    let popupX = this.x;
    let popupY = this.y + 1;  // Below cursor

    // If popup would go off the right edge, move it left
    if (popupX + width > screenWidth) {
      popupX = Math.max(1, screenWidth - width);
    }

    // If popup would go off the bottom, show it above cursor
    if (popupY + height > screenHeight) {
      popupY = Math.max(1, this.y - height);
    }

    // Colors - use existing theme colors
    const bgColor = themeLoader.getColor('sideBar.background') || themeLoader.getColor('editor.background') || '#252526';
    const fgColor = themeLoader.getColor('editor.foreground') || '#d4d4d4';
    const selectedBg = themeLoader.getColor('list.activeSelectionBackground') || '#094771';
    const selectedFg = themeLoader.getColor('list.activeSelectionForeground') || '#ffffff';
    const borderColor = themeLoader.getColor('input.border') || themeLoader.getColor('focusBorder') || '#454545';
    const kindColor = themeLoader.getColor('editorLineNumber.foreground') || '#888888';
    const detailColor = themeLoader.getColor('editorLineNumber.foreground') || '#666666';

    // Draw background and border
    ctx.fill(popupX, popupY, width, height, ' ', fgColor, bgColor);
    
    // Top border
    ctx.drawStyled(popupX, popupY, '┌' + '─'.repeat(width - 2) + '┐', borderColor, bgColor);
    
    // Side borders and items
    for (let i = 0; i < visibleItems; i++) {
      const itemIndex = this.scrollOffset + i;
      const item = this.items[itemIndex];
      if (!item) continue;

      const isSelected = itemIndex === this.selectedIndex;
      const itemY = popupY + 1 + i;
      const itemBg = isSelected ? selectedBg : bgColor;
      const itemFg = isSelected ? selectedFg : fgColor;

      // Left border
      ctx.drawStyled(popupX, itemY, '│', borderColor, bgColor);

      // Item content
      const kindIcon = COMPLETION_KIND_TEXT[item.kind || 1] || '   ';
      const label = item.label;
      const detail = item.detail ? ` ${item.detail}` : '';
      
      // Calculate available space
      const contentWidth = width - 4;  // -2 for borders, -2 for padding
      let displayText = `${kindIcon} ${label}`;
      
      // Add detail if there's space
      if (displayText.length < contentWidth - 10 && detail) {
        const availableForDetail = contentWidth - displayText.length - 1;
        const truncatedDetail = detail.length > availableForDetail 
          ? detail.substring(0, availableForDetail - 1) + '…'
          : detail;
        displayText += truncatedDetail;
      }
      
      // Truncate if too long
      if (displayText.length > contentWidth) {
        displayText = displayText.substring(0, contentWidth - 1) + '…';
      }
      
      // Pad to width
      displayText = ' ' + displayText.padEnd(contentWidth) + ' ';

      // Draw the item
      ctx.fill(popupX + 1, itemY, width - 2, 1, ' ', itemFg, itemBg);
      
      // Draw kind in different color
      ctx.drawStyled(popupX + 1, itemY, ' ' + kindIcon, isSelected ? selectedFg : kindColor, itemBg);
      
      // Draw label
      const labelStart = popupX + 5;
      const labelText = label.substring(0, contentWidth - 4);
      ctx.drawStyled(labelStart, itemY, labelText, itemFg, itemBg);
      
      // Draw detail in dimmer color if not selected
      if (detail && labelText.length + 5 < contentWidth) {
        const detailStart = labelStart + labelText.length;
        const detailText = detail.substring(0, contentWidth - labelText.length - 5);
        ctx.drawStyled(detailStart, itemY, detailText, isSelected ? selectedFg : detailColor, itemBg);
      }

      // Right border
      ctx.drawStyled(popupX + width - 1, itemY, '│', borderColor, bgColor);
    }

    // Bottom border
    ctx.drawStyled(popupX, popupY + height - 1, '└' + '─'.repeat(width - 2) + '┘', borderColor, bgColor);

    // Scroll indicator
    if (this.items.length > this.maxVisibleItems) {
      const scrollPercent = this.scrollOffset / (this.items.length - this.maxVisibleItems);
      const indicatorPos = Math.floor(scrollPercent * (visibleItems - 1));
      ctx.drawStyled(popupX + width - 1, popupY + 1 + indicatorPos, '█', '#666666', bgColor);
    }
  }
}

// Singleton instance
export const autocompletePopup = new AutocompletePopup();

export default autocompletePopup;
