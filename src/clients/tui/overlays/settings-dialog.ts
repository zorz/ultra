/**
 * Settings Dialog
 *
 * Searchable dialog for browsing and editing settings.
 * Extends SearchableDialog for fuzzy search behavior.
 */

import { SearchableDialog, type SearchableDialogConfig, type ItemDisplay } from './searchable-dialog.ts';
import type { OverlayManagerCallbacks } from './overlay-manager.ts';
import type { DialogResult } from './promise-dialog.ts';
import type { KeyEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';

// ============================================
// Types
// ============================================

/**
 * Setting item for display.
 */
export interface SettingItem {
  /** Setting key (e.g., 'editor.fontSize') */
  key: string;
  /** Current value */
  value: unknown;
  /** Default value */
  defaultValue: unknown;
  /** Setting type */
  type: 'string' | 'number' | 'boolean' | 'enum' | 'object';
  /** Description */
  description?: string;
  /** Enum options (for type 'enum') */
  enumOptions?: string[];
  /** Category extracted from key */
  category: string;
}

/**
 * Options for settings dialog.
 */
export interface SettingsDialogOptions extends SearchableDialogConfig {
  /** All available settings */
  settings: SettingItem[];
  /** Callback when a setting is selected for editing */
  onEdit?: (item: SettingItem) => void;
}

// ============================================
// Settings Dialog
// ============================================

export class SettingsDialog extends SearchableDialog<SettingItem> {
  /** Callback for editing a setting */
  private onEdit: ((item: SettingItem) => void) | null = null;

  /** Current category filter */
  private categoryFilter: string | null = null;

  constructor(id: string, callbacks: OverlayManagerCallbacks) {
    super(id, callbacks);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the settings dialog.
   */
  showWithSettings(options: SettingsDialogOptions): Promise<DialogResult<SettingItem>> {
    this.onEdit = options.onEdit ?? null;
    this.categoryFilter = null;

    return this.showWithItems(
      {
        ...options,
        title: options.title ?? 'Settings',
        placeholder: options.placeholder ?? 'Search settings...',
        width: options.width ?? 80,
        height: options.height ?? 25,
      },
      options.settings
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SearchableDialog Implementation
  // ─────────────────────────────────────────────────────────────────────────

  protected override scoreItem(item: SettingItem, query: string): number {
    // If category filter is active, only show items in that category
    if (this.categoryFilter && item.category !== this.categoryFilter) {
      return 0;
    }

    // Score against key and description
    const keyScore = this.combinedScore(item.key, query);
    const descScore = item.description ? this.combinedScore(item.description, query) * 0.5 : 0;

    return Math.max(keyScore, descScore);
  }

  protected override getItemDisplay(item: SettingItem, isSelected: boolean): ItemDisplay {
    // Format the value for display
    const valueStr = this.formatValue(item);
    const isModified = JSON.stringify(item.value) !== JSON.stringify(item.defaultValue);

    return {
      text: item.key,
      secondary: valueStr,
      icon: isModified ? '●' : ' ',
      isCurrent: false,
    };
  }

  protected override getItemId(item: SettingItem): string {
    return item.key;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  protected override handleKeyInput(event: KeyEvent): boolean {
    // Enter - edit the selected setting
    if (event.key === 'Enter') {
      const selected = this.getSelectedItem();
      if (selected) {
        if (this.onEdit) {
          this.onEdit(selected);
          // Don't close - let the parent handle it
          return true;
        } else {
          this.confirm(selected);
        }
      }
      return true;
    }

    // Space on boolean - quick toggle
    if (event.key === ' ') {
      const selected = this.getSelectedItem();
      if (selected && selected.type === 'boolean') {
        if (this.onEdit) {
          // Toggle and call edit callback
          this.onEdit({
            ...selected,
            value: !selected.value,
          });
        }
        return true;
      }
    }

    // Let parent handle navigation and search
    return super.handleKeyInput(event);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  protected override renderContent(buffer: ScreenBuffer): void {
    const content = this.getContentBounds();

    // Render search input
    if (this.showSearchInput) {
      this.renderSearchInput(buffer, content.x, content.y, content.width);
    }

    // Render results list
    const listY = content.y + (this.showSearchInput ? 2 : 0);
    const listHeight = content.height - (this.showSearchInput ? 4 : 2);
    this.renderSettingsList(buffer, content.x, listY, content.width, listHeight);

    // Render footer with description
    const footerY = content.y + content.height - 2;
    this.renderSettingsFooter(buffer, content.x, footerY, content.width);
  }

  private renderSettingsList(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    const bg = this.callbacks.getThemeColor('editorWidget.background', '#252526');
    const fg = this.callbacks.getThemeColor('editorWidget.foreground', '#cccccc');
    const selectedBg = this.callbacks.getThemeColor('list.activeSelectionBackground', '#094771');
    const selectedFg = this.callbacks.getThemeColor('list.activeSelectionForeground', '#ffffff');
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');
    const modifiedFg = this.callbacks.getThemeColor('editorWarning.foreground', '#cca700');
    const boolTrueFg = this.callbacks.getThemeColor('gitDecoration.addedResourceForeground', '#81b88b');
    const boolFalseFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');

    this.maxVisibleResults = Math.max(1, height);

    if (this.filteredItems.length === 0) {
      const msg = this.query ? 'No matching settings' : 'No settings available';
      buffer.writeString(x + 1, y + 1, msg, dimFg, bg);
      return;
    }

    const visibleCount = Math.min(height, this.filteredItems.length - this.scrollOffset);

    for (let i = 0; i < visibleCount; i++) {
      const itemIndex = this.scrollOffset + i;
      const scoredItem = this.filteredItems[itemIndex]!;
      const item = scoredItem.item;
      const isSelected = itemIndex === this.selectedIndex;
      const rowY = y + i;

      const isModified = JSON.stringify(item.value) !== JSON.stringify(item.defaultValue);
      const rowBg = isSelected ? selectedBg : bg;
      const rowFg = isSelected ? selectedFg : fg;

      // Clear row
      for (let col = 0; col < width; col++) {
        buffer.set(x + col, rowY, { char: ' ', fg: rowFg, bg: rowBg });
      }

      // Modified indicator
      if (isModified) {
        buffer.writeString(x + 1, rowY, '●', modifiedFg, rowBg);
      }

      // Setting key
      const keyWidth = Math.floor(width * 0.5);
      const displayKey = item.key.length > keyWidth - 4
        ? item.key.slice(0, keyWidth - 5) + '…'
        : item.key;
      buffer.writeString(x + 3, rowY, displayKey, rowFg, rowBg);

      // Value (right side)
      const valueX = x + keyWidth;
      const valueWidth = width - keyWidth - 1;
      const valueStr = this.formatValue(item);
      const valueTruncated = valueStr.length > valueWidth
        ? valueStr.slice(0, valueWidth - 1) + '…'
        : valueStr;

      // Color code boolean values
      let valueFg = isSelected ? selectedFg : dimFg;
      if (item.type === 'boolean') {
        valueFg = item.value ? boolTrueFg : boolFalseFg;
      }

      buffer.writeString(valueX, rowY, valueTruncated, valueFg, rowBg);
    }
  }

  private renderSettingsFooter(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number
  ): void {
    const bg = this.callbacks.getThemeColor('editorWidget.background', '#252526');
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');
    const fg = this.callbacks.getThemeColor('editorWidget.foreground', '#cccccc');

    const selected = this.getSelectedItem();
    if (selected?.description) {
      // Show description
      const desc = selected.description.slice(0, width - 2);
      buffer.writeString(x, y, desc, dimFg, bg);
    }

    // Footer line with hints
    const footerY = y + 1;
    const hints = 'Enter: edit  |  Space: toggle boolean  |  Escape: close';
    const count = `${this.filteredItems.length}/${this.items.length}`;

    buffer.writeString(x, footerY, hints, dimFg, bg);
    buffer.writeString(x + width - count.length - 1, footerY, count, dimFg, bg);
  }

  private formatValue(item: SettingItem): string {
    if (item.value === undefined || item.value === null) {
      return 'not set';
    }

    switch (item.type) {
      case 'boolean':
        return item.value ? 'true' : 'false';
      case 'number':
        return String(item.value);
      case 'string':
        return String(item.value);
      case 'enum':
        return String(item.value);
      case 'object':
        return JSON.stringify(item.value);
      default:
        return String(item.value);
    }
  }
}
