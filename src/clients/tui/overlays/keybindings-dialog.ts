/**
 * Keybindings Dialog
 *
 * Searchable dialog for browsing and editing keybindings.
 * Supports key capture mode for setting new keybindings.
 */

import { SearchableDialog, type SearchableDialogConfig, type ItemDisplay } from './searchable-dialog.ts';
import type { OverlayManagerCallbacks } from './overlay-manager.ts';
import type { DialogResult } from './promise-dialog.ts';
import type { KeyEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import type { KeyBinding } from '../../../services/session/types.ts';

// ============================================
// Types
// ============================================

/**
 * Keybinding item for display.
 */
export interface KeybindingItem {
  /** Command ID */
  command: string;
  /** Display label (from command info) */
  label: string;
  /** Current keybinding */
  key: string;
  /** Default keybinding */
  defaultKey: string;
  /** Context condition (when clause) */
  when?: string;
  /** Category for grouping */
  category: string;
  /** Whether the user has modified this keybinding */
  isModified: boolean;
}

/**
 * Command info for labeling.
 */
export interface CommandInfo {
  label: string;
  category: string;
}

/**
 * Callback options for keybindings dialog.
 */
export interface KeybindingsDialogCallbacks {
  /** Called when a keybinding is changed */
  onKeybindingChange?: (command: string, newKey: string) => void;
  /** Called when a keybinding is reset to default */
  onReset?: (command: string, defaultKey: string) => void;
}

/**
 * Options for keybindings dialog.
 */
export interface KeybindingsDialogOptions extends SearchableDialogConfig {
  /** All keybindings */
  keybindings: KeybindingItem[];
  /** Callbacks for keybinding changes */
  callbacks?: KeybindingsDialogCallbacks;
}

// ============================================
// Keybindings Dialog
// ============================================

export class KeybindingsDialog extends SearchableDialog<KeybindingItem> {
  /** Callbacks for keybinding changes */
  private dialogCallbacks: KeybindingsDialogCallbacks | null = null;

  /** Whether we're in key capture mode */
  private captureMode: boolean = false;

  /** Captured key parts during key capture */
  private capturedKeyParts: string[] = [];

  /** Conflict warning message */
  private conflictMessage: string | null = null;

  constructor(id: string, callbacks: OverlayManagerCallbacks) {
    super(id, callbacks);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the keybindings dialog.
   */
  showWithKeybindings(options: KeybindingsDialogOptions): Promise<DialogResult<KeybindingItem>> {
    this.dialogCallbacks = options.callbacks ?? null;
    this.resetCaptureMode();

    return this.showWithItems(
      {
        ...options,
        title: options.title ?? 'Keyboard Shortcuts',
        placeholder: options.placeholder ?? 'Search keybindings...',
        width: options.width ?? 80,
        height: options.height ?? 25,
      },
      options.keybindings
    );
  }

  /**
   * Update a keybinding item in the list.
   */
  updateKeybindingKey(command: string, newKey: string): void {
    const item = this.items.find((i) => i.command === command);
    if (item) {
      item.key = newKey;
      item.isModified = item.key !== item.defaultKey;
      this.filter();
      this.callbacks.onDirty();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Capture Mode Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Reset capture mode.
   */
  private resetCaptureMode(): void {
    this.captureMode = false;
    this.capturedKeyParts = [];
    this.conflictMessage = null;
  }

  /**
   * Start key capture mode for the selected keybinding.
   */
  private startCapture(): void {
    const selected = this.getSelectedItem();
    if (!selected) return;

    this.captureMode = true;
    this.capturedKeyParts = [];
    this.conflictMessage = null;
    this.callbacks.onDirty();
  }

  /**
   * Format a key event into a keybinding string.
   */
  private formatKeyEvent(event: KeyEvent): string {
    const parts: string[] = [];

    // Modifiers in standard order
    if (event.ctrl) parts.push('ctrl');
    if (event.alt) parts.push('alt');
    if (event.shift) parts.push('shift');
    if (event.meta) parts.push('meta');

    // Key name (normalize some common keys)
    let keyName = event.key.toLowerCase();

    // Handle special keys
    const keyMap: Record<string, string> = {
      escape: 'escape',
      enter: 'enter',
      tab: 'tab',
      backspace: 'backspace',
      delete: 'delete',
      arrowup: 'up',
      arrowdown: 'down',
      arrowleft: 'left',
      arrowright: 'right',
      home: 'home',
      end: 'end',
      pageup: 'pageup',
      pagedown: 'pagedown',
      ' ': 'space',
    };

    keyName = keyMap[keyName] ?? keyName;

    // Skip modifier-only keys
    if (['control', 'alt', 'shift', 'meta'].includes(keyName)) {
      return '';
    }

    parts.push(keyName);
    return parts.join('+');
  }

  /**
   * Handle captured key and check for conflicts.
   */
  private handleCapturedKey(keyString: string): void {
    if (!keyString) return;

    const selected = this.getSelectedItem();
    if (!selected) {
      this.resetCaptureMode();
      return;
    }

    // Check for conflicts
    const conflict = this.findConflict(keyString, selected.command);

    if (conflict) {
      this.conflictMessage = `"${keyString}" is used by "${conflict.label}". Press Enter to override, Escape to cancel.`;
      this.capturedKeyParts = [keyString];
      this.callbacks.onDirty();
    } else {
      // Apply the change immediately if no conflict
      this.applyKeybindingChange(selected.command, keyString);
      this.resetCaptureMode();
    }
  }

  /**
   * Find a conflicting keybinding.
   */
  private findConflict(key: string, excludeCommand: string): KeybindingItem | null {
    return (
      this.items.find(
        (item) =>
          item.key.toLowerCase() === key.toLowerCase() && item.command !== excludeCommand
      ) ?? null
    );
  }

  /**
   * Apply a keybinding change.
   */
  private applyKeybindingChange(command: string, newKey: string): void {
    this.updateKeybindingKey(command, newKey);

    if (this.dialogCallbacks?.onKeybindingChange) {
      this.dialogCallbacks.onKeybindingChange(command, newKey);
    }
  }

  /**
   * Reset the selected keybinding to its default.
   */
  private resetToDefault(): void {
    const selected = this.getSelectedItem();
    if (!selected) return;

    // Don't reset if already at default
    if (selected.key === selected.defaultKey) {
      return;
    }

    this.applyKeybindingChange(selected.command, selected.defaultKey);

    if (this.dialogCallbacks?.onReset) {
      this.dialogCallbacks.onReset(selected.command, selected.defaultKey);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SearchableDialog Implementation
  // ─────────────────────────────────────────────────────────────────────────

  protected override scoreItem(item: KeybindingItem, query: string): number {
    // Score against command, label, key, and category
    const labelScore = this.combinedScore(item.label, query);
    const commandScore = this.combinedScore(item.command, query) * 0.8;
    const keyScore = this.combinedScore(item.key, query) * 0.6;
    const categoryScore = this.combinedScore(item.category, query) * 0.4;

    return Math.max(labelScore, commandScore, keyScore, categoryScore);
  }

  protected override getItemDisplay(item: KeybindingItem, isSelected: boolean): ItemDisplay {
    return {
      text: item.label,
      secondary: item.key,
      icon: item.isModified ? '●' : ' ',
      isCurrent: false,
    };
  }

  protected override getItemId(item: KeybindingItem): string {
    return item.command;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  protected override handleKeyInput(event: KeyEvent): boolean {
    // Handle capture mode input
    if (this.captureMode) {
      return this.handleCaptureKeyInput(event);
    }

    // Enter - start key capture
    if (event.key === 'Enter') {
      this.startCapture();
      return true;
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
   * Handle key input during capture mode.
   */
  private handleCaptureKeyInput(event: KeyEvent): boolean {
    // Escape - cancel capture
    if (event.key === 'Escape') {
      this.resetCaptureMode();
      this.callbacks.onDirty();
      return true;
    }

    // If we have a conflict and user presses Enter, apply the change
    if (event.key === 'Enter' && this.capturedKeyParts.length > 0 && this.conflictMessage) {
      const selected = this.getSelectedItem();
      if (selected) {
        this.applyKeybindingChange(selected.command, this.capturedKeyParts[0]!);
      }
      this.resetCaptureMode();
      return true;
    }

    // Format the key event
    const keyString = this.formatKeyEvent(event);

    // Handle the captured key
    if (keyString) {
      this.handleCapturedKey(keyString);
    }

    return true;
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
    this.renderKeybindingsList(buffer, content.x, listY, content.width, listHeight);

    // Render footer
    const footerY = content.y + content.height - 2;
    this.renderKeybindingsFooter(buffer, content.x, footerY, content.width);
  }

  private renderKeybindingsList(
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
    const keyFg = this.callbacks.getThemeColor('focusBorder', '#007fd4');
    const captureHighlight = this.callbacks.getThemeColor('editorInfo.foreground', '#75beff');

    this.maxVisibleResults = Math.max(1, height);

    if (this.filteredItems.length === 0) {
      const msg = this.query ? 'No matching keybindings' : 'No keybindings available';
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

      const rowBg = isSelected ? selectedBg : bg;
      const rowFg = isSelected ? selectedFg : fg;

      // Clear row
      for (let col = 0; col < width; col++) {
        buffer.set(x + col, rowY, { char: ' ', fg: rowFg, bg: rowBg });
      }

      // Modified indicator
      if (item.isModified) {
        buffer.writeString(x + 1, rowY, '●', modifiedFg, rowBg);
      }

      // Keybinding (left side)
      const keyWidth = 18;
      const isCapturing = isSelected && this.captureMode;

      if (isCapturing) {
        // Show capture prompt
        const captureText =
          this.capturedKeyParts.length > 0
            ? this.capturedKeyParts.join(' ')
            : 'Press key...';
        buffer.writeString(x + 3, rowY, captureText, captureHighlight, rowBg);
      } else {
        const displayKey =
          item.key.length > keyWidth - 4 ? item.key.slice(0, keyWidth - 5) + '…' : item.key;
        buffer.writeString(x + 3, rowY, displayKey, isSelected ? selectedFg : keyFg, rowBg);
      }

      // Label (middle)
      const labelX = x + keyWidth + 3;
      const categoryWidth = 12;
      const labelWidth = width - keyWidth - categoryWidth - 6;
      const displayLabel =
        item.label.length > labelWidth ? item.label.slice(0, labelWidth - 1) + '…' : item.label;
      buffer.writeString(labelX, rowY, displayLabel, rowFg, rowBg);

      // Category (right side)
      const categoryX = x + width - categoryWidth - 1;
      buffer.writeString(categoryX, rowY, item.category.slice(0, categoryWidth), dimFg, rowBg);
    }
  }

  private renderKeybindingsFooter(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number
  ): void {
    const bg = this.callbacks.getThemeColor('editorWidget.background', '#252526');
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');
    const warningFg = this.callbacks.getThemeColor('editorWarning.foreground', '#cca700');

    // Show conflict message or info
    if (this.conflictMessage) {
      buffer.writeString(x, y, this.conflictMessage.slice(0, width - 2), warningFg, bg);
    } else if (this.captureMode) {
      buffer.writeString(x, y, 'Note: CMD key = "meta" on Mac', dimFg, bg);
    } else {
      const selected = this.getSelectedItem();
      if (selected?.when) {
        buffer.writeString(x, y, `when: ${selected.when}`.slice(0, width - 2), dimFg, bg);
      }
    }

    // Footer line with hints
    const footerY = y + 1;
    let hints: string;

    if (this.captureMode) {
      if (this.conflictMessage) {
        hints = 'Enter: override | Esc: cancel';
      } else {
        hints = 'Press key combination... | Esc: cancel';
      }
    } else {
      hints = 'Enter: change | R: reset | Esc: close';
    }

    const count = `${this.filteredItems.length}/${this.items.length}`;

    // Clear footer line
    for (let i = 0; i < width; i++) {
      buffer.set(x + i, footerY, { char: ' ', fg: dimFg, bg });
    }

    buffer.writeString(x, footerY, hints, dimFg, bg);
    buffer.writeString(x + width - count.length - 1, footerY, count, dimFg, bg);
  }
}
