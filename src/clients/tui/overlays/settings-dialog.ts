/**
 * Settings Dialog
 *
 * Searchable dialog for browsing and editing settings.
 * Extends SearchableDialog for fuzzy search behavior.
 * Supports inline editing for all setting types.
 */

import { SearchableDialog, type SearchableDialogConfig, type ItemDisplay } from './searchable-dialog.ts';
import type { OverlayManagerCallbacks } from './overlay-manager.ts';
import type { DialogResult } from './promise-dialog.ts';
import type { KeyEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import {
  validateNumberSetting,
  isMultilineSetting,
  parseSettingValue,
} from './settings-utils.ts';

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
 * Edit mode for inline editing.
 */
type EditMode = 'none' | 'number' | 'string' | 'enum';

/**
 * Callback options for settings dialog.
 */
export interface SettingsDialogCallbacks {
  /** Called when a setting value is changed */
  onValueChange?: (key: string, value: unknown) => void;
  /** Called when a setting is reset to default */
  onReset?: (key: string, defaultValue: unknown) => void;
}

/**
 * Options for settings dialog.
 */
export interface SettingsDialogOptions extends SearchableDialogConfig {
  /** All available settings */
  settings: SettingItem[];
  /** Callback when a setting is selected for editing (legacy) */
  onEdit?: (item: SettingItem) => void;
  /** New callbacks for inline editing */
  callbacks?: SettingsDialogCallbacks;
}

// ============================================
// Settings Dialog
// ============================================

export class SettingsDialog extends SearchableDialog<SettingItem> {
  /** Callback for editing a setting (legacy) */
  private onEdit: ((item: SettingItem) => void) | null = null;

  /** Callbacks for inline editing */
  private dialogCallbacks: SettingsDialogCallbacks | null = null;

  /** Current category filter */
  private categoryFilter: string | null = null;

  // ─────────────────────────────────────────────────────────────────────────
  // Edit Mode State
  // ─────────────────────────────────────────────────────────────────────────

  /** Current edit mode */
  private editMode: EditMode = 'none';

  /** Value being edited (string representation) */
  private editValue: string = '';

  /** Cursor position in edit value */
  private editCursorPos: number = 0;

  /** Current enum options (when in enum mode) */
  private currentEnumOptions: string[] = [];

  /** Current enum index */
  private enumIndex: number = 0;

  /** Error message for validation */
  private editError: string | null = null;

  /** Pending value change to apply */
  private pendingChange: { key: string; value: unknown } | null = null;

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
    this.dialogCallbacks = options.callbacks ?? null;
    this.categoryFilter = null;
    this.resetEditMode();

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

  /**
   * Update a setting item in the list.
   * Called after a value change to reflect the new value.
   */
  updateSettingValue(key: string, newValue: unknown): void {
    const item = this.items.find((i) => i.key === key);
    if (item) {
      item.value = newValue;
      this.filter();
      this.callbacks.onDirty();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Edit Mode Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Reset edit mode to none.
   */
  private resetEditMode(): void {
    this.editMode = 'none';
    this.editValue = '';
    this.editCursorPos = 0;
    this.currentEnumOptions = [];
    this.enumIndex = 0;
    this.editError = null;
    this.pendingChange = null;
  }

  /**
   * Start editing the selected item.
   */
  private startEdit(item: SettingItem): void {
    this.editError = null;

    switch (item.type) {
      case 'boolean':
        // Booleans toggle immediately
        this.toggleBoolean(item);
        break;

      case 'number':
        this.editMode = 'number';
        this.editValue = String(item.value);
        this.editCursorPos = this.editValue.length;
        break;

      case 'string':
        if (isMultilineSetting(item.key)) {
          // TODO: Open multiline text editor popup
          // For now, treat as single-line
          this.editMode = 'string';
          this.editValue = String(item.value);
          this.editCursorPos = this.editValue.length;
        } else {
          this.editMode = 'string';
          this.editValue = String(item.value);
          this.editCursorPos = this.editValue.length;
        }
        break;

      case 'enum':
        this.editMode = 'enum';
        this.currentEnumOptions = item.enumOptions ?? [];
        const currentValue = String(item.value);
        this.enumIndex = this.currentEnumOptions.indexOf(currentValue);
        if (this.enumIndex === -1) this.enumIndex = 0;
        break;

      case 'object':
        // Objects are not editable inline
        // Could open a JSON editor in the future
        break;
    }

    this.callbacks.onDirty();
  }

  /**
   * Toggle a boolean setting.
   */
  private toggleBoolean(item: SettingItem): void {
    const newValue = !item.value;
    this.applyValueChange(item.key, newValue);
  }

  /**
   * Confirm the current edit and apply the change.
   */
  private confirmEdit(): void {
    const selected = this.getSelectedItem();
    if (!selected) {
      this.resetEditMode();
      return;
    }

    let newValue: unknown;

    switch (this.editMode) {
      case 'number': {
        newValue = parseSettingValue(selected.key, this.editValue, 'number');
        const validation = validateNumberSetting(selected.key, newValue as number);
        if (!validation.valid) {
          this.editError = validation.message ?? 'Invalid value';
          this.callbacks.onDirty();
          return;
        }
        break;
      }

      case 'string':
        newValue = this.editValue;
        break;

      case 'enum':
        newValue = this.currentEnumOptions[this.enumIndex];
        break;

      default:
        this.resetEditMode();
        return;
    }

    this.applyValueChange(selected.key, newValue);
    this.resetEditMode();
  }

  /**
   * Cancel the current edit.
   */
  private cancelEdit(): void {
    this.resetEditMode();
    this.callbacks.onDirty();
  }

  /**
   * Apply a value change.
   */
  private applyValueChange(key: string, value: unknown): void {
    // Update the item in our list
    this.updateSettingValue(key, value);

    // Notify via callbacks
    if (this.dialogCallbacks?.onValueChange) {
      this.dialogCallbacks.onValueChange(key, value);
    }

    // Legacy callback support
    const item = this.items.find((i) => i.key === key);
    if (item && this.onEdit) {
      this.onEdit({ ...item, value });
    }
  }

  /**
   * Reset the selected setting to its default value.
   */
  private resetToDefault(): void {
    const selected = this.getSelectedItem();
    if (!selected) return;

    // Don't reset if already at default
    if (JSON.stringify(selected.value) === JSON.stringify(selected.defaultValue)) {
      return;
    }

    this.applyValueChange(selected.key, selected.defaultValue);

    if (this.dialogCallbacks?.onReset) {
      this.dialogCallbacks.onReset(selected.key, selected.defaultValue);
    }
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
    // Handle edit mode input first
    if (this.editMode !== 'none') {
      return this.handleEditKeyInput(event);
    }

    // Enter - start edit for the selected setting
    if (event.key === 'Enter') {
      const selected = this.getSelectedItem();
      if (selected) {
        this.startEdit(selected);
      }
      return true;
    }

    // Space on boolean - quick toggle
    if (event.key === ' ') {
      const selected = this.getSelectedItem();
      if (selected && selected.type === 'boolean') {
        this.toggleBoolean(selected);
        return true;
      }
    }

    // R - reset to default
    if (event.key === 'r' || event.key === 'R') {
      this.resetToDefault();
      return true;
    }

    // Let parent handle navigation and search
    return super.handleKeyInput(event);
  }

  /**
   * Handle key input during edit mode.
   */
  private handleEditKeyInput(event: KeyEvent): boolean {
    // Escape - cancel edit
    if (event.key === 'Escape') {
      this.cancelEdit();
      return true;
    }

    // Enter - confirm edit
    if (event.key === 'Enter') {
      this.confirmEdit();
      return true;
    }

    switch (this.editMode) {
      case 'number':
        return this.handleNumberEditInput(event);
      case 'string':
        return this.handleStringEditInput(event);
      case 'enum':
        return this.handleEnumEditInput(event);
      default:
        return false;
    }
  }

  /**
   * Handle input for number editing.
   */
  private handleNumberEditInput(event: KeyEvent): boolean {
    // Clear error on new input
    this.editError = null;

    // Up/Down - increment/decrement
    if (event.key === 'ArrowUp') {
      const num = parseFloat(this.editValue) || 0;
      this.editValue = String(num + 1);
      this.editCursorPos = this.editValue.length;
      this.callbacks.onDirty();
      return true;
    }

    if (event.key === 'ArrowDown') {
      const num = parseFloat(this.editValue) || 0;
      this.editValue = String(Math.max(0, num - 1));
      this.editCursorPos = this.editValue.length;
      this.callbacks.onDirty();
      return true;
    }

    // Left/Right - move cursor
    if (event.key === 'ArrowLeft') {
      this.editCursorPos = Math.max(0, this.editCursorPos - 1);
      this.callbacks.onDirty();
      return true;
    }

    if (event.key === 'ArrowRight') {
      this.editCursorPos = Math.min(this.editValue.length, this.editCursorPos + 1);
      this.callbacks.onDirty();
      return true;
    }

    // Backspace
    if (event.key === 'Backspace') {
      if (this.editCursorPos > 0) {
        this.editValue =
          this.editValue.slice(0, this.editCursorPos - 1) +
          this.editValue.slice(this.editCursorPos);
        this.editCursorPos--;
        this.callbacks.onDirty();
      }
      return true;
    }

    // Delete
    if (event.key === 'Delete') {
      if (this.editCursorPos < this.editValue.length) {
        this.editValue =
          this.editValue.slice(0, this.editCursorPos) +
          this.editValue.slice(this.editCursorPos + 1);
        this.callbacks.onDirty();
      }
      return true;
    }

    // Only allow digits, minus, and decimal point
    if (/^[0-9.\-]$/.test(event.key)) {
      this.editValue =
        this.editValue.slice(0, this.editCursorPos) +
        event.key +
        this.editValue.slice(this.editCursorPos);
      this.editCursorPos++;
      this.callbacks.onDirty();
      return true;
    }

    return true; // Consume all input in edit mode
  }

  /**
   * Handle input for string editing.
   */
  private handleStringEditInput(event: KeyEvent): boolean {
    // Left/Right - move cursor
    if (event.key === 'ArrowLeft') {
      this.editCursorPos = Math.max(0, this.editCursorPos - 1);
      this.callbacks.onDirty();
      return true;
    }

    if (event.key === 'ArrowRight') {
      this.editCursorPos = Math.min(this.editValue.length, this.editCursorPos + 1);
      this.callbacks.onDirty();
      return true;
    }

    // Home/End
    if (event.key === 'Home') {
      this.editCursorPos = 0;
      this.callbacks.onDirty();
      return true;
    }

    if (event.key === 'End') {
      this.editCursorPos = this.editValue.length;
      this.callbacks.onDirty();
      return true;
    }

    // Backspace
    if (event.key === 'Backspace') {
      if (this.editCursorPos > 0) {
        this.editValue =
          this.editValue.slice(0, this.editCursorPos - 1) +
          this.editValue.slice(this.editCursorPos);
        this.editCursorPos--;
        this.callbacks.onDirty();
      }
      return true;
    }

    // Delete
    if (event.key === 'Delete') {
      if (this.editCursorPos < this.editValue.length) {
        this.editValue =
          this.editValue.slice(0, this.editCursorPos) +
          this.editValue.slice(this.editCursorPos + 1);
        this.callbacks.onDirty();
      }
      return true;
    }

    // Printable characters
    if (event.key.length === 1) {
      this.editValue =
        this.editValue.slice(0, this.editCursorPos) +
        event.key +
        this.editValue.slice(this.editCursorPos);
      this.editCursorPos++;
      this.callbacks.onDirty();
      return true;
    }

    return true; // Consume all input in edit mode
  }

  /**
   * Handle input for enum editing.
   */
  private handleEnumEditInput(event: KeyEvent): boolean {
    // Left/Up - previous option
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      this.enumIndex =
        (this.enumIndex - 1 + this.currentEnumOptions.length) % this.currentEnumOptions.length;
      this.callbacks.onDirty();
      return true;
    }

    // Right/Down - next option
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      this.enumIndex = (this.enumIndex + 1) % this.currentEnumOptions.length;
      this.callbacks.onDirty();
      return true;
    }

    return true; // Consume all input in edit mode
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
    const editBg = this.callbacks.getThemeColor('input.background', '#3c3c3c');
    const errorFg = this.callbacks.getThemeColor('editorError.foreground', '#f14c4c');

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
      const displayKey =
        item.key.length > keyWidth - 4 ? item.key.slice(0, keyWidth - 5) + '…' : item.key;
      buffer.writeString(x + 3, rowY, displayKey, rowFg, rowBg);

      // Value area
      const valueX = x + keyWidth;
      const valueWidth = width - keyWidth - 1;

      // Check if this is the item being edited
      const isEditing = isSelected && this.editMode !== 'none';

      if (isEditing) {
        this.renderEditValue(buffer, valueX, rowY, valueWidth, item, rowBg);
      } else {
        // Normal value display
        const valueStr = this.formatValue(item);
        const valueTruncated =
          valueStr.length > valueWidth ? valueStr.slice(0, valueWidth - 1) + '…' : valueStr;

        // Color code boolean values
        let valueFg = isSelected ? selectedFg : dimFg;
        if (item.type === 'boolean') {
          valueFg = item.value ? boolTrueFg : boolFalseFg;
        }

        buffer.writeString(valueX, rowY, valueTruncated, valueFg, rowBg);
      }
    }
  }

  /**
   * Render the edit value for inline editing.
   */
  private renderEditValue(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number,
    item: SettingItem,
    rowBg: string
  ): void {
    const editBg = this.callbacks.getThemeColor('input.background', '#3c3c3c');
    const editFg = this.callbacks.getThemeColor('input.foreground', '#ffffff');
    const cursorBg = this.callbacks.getThemeColor('editorCursor.foreground', '#ffffff');
    const enumActiveFg = this.callbacks.getThemeColor('focusBorder', '#007fd4');

    switch (this.editMode) {
      case 'number':
      case 'string': {
        // Render input field with brackets
        buffer.writeString(x, y, '[', editFg, rowBg);

        const inputWidth = width - 2;
        const displayValue = this.editValue.slice(0, inputWidth);

        // Clear input area
        for (let i = 0; i < inputWidth; i++) {
          buffer.set(x + 1 + i, y, { char: ' ', fg: editFg, bg: editBg });
        }

        // Render value
        buffer.writeString(x + 1, y, displayValue, editFg, editBg);

        // Render cursor
        const cursorX = x + 1 + Math.min(this.editCursorPos, inputWidth - 1);
        const cursorChar = this.editCursorPos < this.editValue.length ? this.editValue[this.editCursorPos] : ' ';
        buffer.set(cursorX, y, { char: cursorChar || ' ', fg: editBg, bg: cursorBg });

        buffer.writeString(x + inputWidth + 1, y, ']', editFg, rowBg);
        break;
      }

      case 'enum': {
        // Render enum picker with arrows
        const currentOption = this.currentEnumOptions[this.enumIndex] ?? '';
        const displayStr = `◄ ${currentOption} ►`;
        buffer.writeString(x, y, displayStr, enumActiveFg, rowBg);
        break;
      }
    }
  }

  private renderSettingsFooter(buffer: ScreenBuffer, x: number, y: number, width: number): void {
    const bg = this.callbacks.getThemeColor('editorWidget.background', '#252526');
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');
    const errorFg = this.callbacks.getThemeColor('editorError.foreground', '#f14c4c');

    const selected = this.getSelectedItem();

    // Show error or description
    if (this.editError) {
      buffer.writeString(x, y, this.editError.slice(0, width - 2), errorFg, bg);
    } else if (selected?.description) {
      const desc = selected.description.slice(0, width - 2);
      buffer.writeString(x, y, desc, dimFg, bg);
    }

    // Footer line with hints
    const footerY = y + 1;
    let hints: string;

    if (this.editMode !== 'none') {
      // Edit mode hints
      switch (this.editMode) {
        case 'number':
          hints = 'Enter: confirm | ↑/↓: adjust | Esc: cancel';
          break;
        case 'string':
          hints = 'Enter: confirm | ←/→: move cursor | Esc: cancel';
          break;
        case 'enum':
          hints = 'Enter: confirm | ←/→: change | Esc: cancel';
          break;
        default:
          hints = 'Enter: confirm | Esc: cancel';
      }
    } else {
      // Normal mode hints
      hints = 'Enter: edit | Space: toggle | R: reset | Esc: close';
    }

    const count = `${this.filteredItems.length}/${this.items.length}`;

    // Clear footer line
    for (let i = 0; i < width; i++) {
      buffer.set(x + i, footerY, { char: ' ', fg: dimFg, bg });
    }

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
