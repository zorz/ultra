/**
 * Command Palette
 *
 * A searchable command palette overlay for executing commands.
 */

import { BaseDialog, type OverlayManagerCallbacks } from './overlay-manager.ts';
import type { InputEvent, KeyEvent, Rect } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';

// ============================================
// Types
// ============================================

/**
 * A command that can be executed.
 */
export interface Command {
  /** Unique command ID */
  id: string;
  /** Display label */
  label: string;
  /** Optional description */
  description?: string;
  /** Optional keyboard shortcut display */
  keybinding?: string;
  /** Optional category for grouping */
  category?: string;
  /** Execute the command */
  execute: () => void | Promise<void>;
}

/**
 * Callbacks for command palette.
 */
export interface CommandPaletteCallbacks extends OverlayManagerCallbacks {
  /** Called when palette is dismissed */
  onDismiss?: () => void;
}

// ============================================
// Command Palette
// ============================================

export class CommandPalette extends BaseDialog {
  /** All registered commands */
  private commands: Command[] = [];

  /** Filtered commands based on search */
  private filtered: Command[] = [];

  /** Current search query */
  private query = '';

  /** Selected index in filtered list */
  private selectedIndex = 0;

  /** Scroll offset */
  private scrollTop = 0;

  /** Max visible items */
  private maxVisible = 10;

  /** Callbacks */
  private paletteCallbacks: CommandPaletteCallbacks;

  constructor(callbacks: CommandPaletteCallbacks) {
    super('command-palette', callbacks);
    this.paletteCallbacks = callbacks;
    this.zIndex = 200; // Above other dialogs
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Command Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set available commands.
   */
  setCommands(commands: Command[]): void {
    this.commands = commands;
    this.updateFilter();
  }

  /**
   * Add a command.
   */
  addCommand(command: Command): void {
    this.commands.push(command);
    this.updateFilter();
  }

  /**
   * Remove a command.
   */
  removeCommand(id: string): boolean {
    const index = this.commands.findIndex((c) => c.id === id);
    if (index === -1) return false;
    this.commands.splice(index, 1);
    this.updateFilter();
    return true;
  }

  /**
   * Get all commands.
   */
  getCommands(): Command[] {
    return [...this.commands];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Show/Hide
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the command palette.
   */
  override show(): void {
    this.query = '';
    this.selectedIndex = 0;
    this.scrollTop = 0;
    this.updateFilter();
    super.show();
  }

  /**
   * Hide the command palette.
   */
  override hide(): void {
    super.hide();
    this.paletteCallbacks.onDismiss?.();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Search & Filter
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set search query.
   */
  setQuery(query: string): void {
    this.query = query;
    this.selectedIndex = 0;
    this.scrollTop = 0;
    this.updateFilter();
    this.callbacks.onDirty();
  }

  /**
   * Get current query.
   */
  getQuery(): string {
    return this.query;
  }

  /**
   * Update filtered commands based on query.
   */
  private updateFilter(): void {
    if (!this.query) {
      this.filtered = [...this.commands];
      return;
    }

    const queryLower = this.query.toLowerCase();
    const terms = queryLower.split(/\s+/).filter(Boolean);

    this.filtered = this.commands.filter((cmd) => {
      const searchText = `${cmd.label} ${cmd.description ?? ''} ${cmd.category ?? ''}`.toLowerCase();
      return terms.every((term) => searchText.includes(term));
    });

    // Sort by relevance (label match first)
    this.filtered.sort((a, b) => {
      const aLabelMatch = a.label.toLowerCase().startsWith(queryLower);
      const bLabelMatch = b.label.toLowerCase().startsWith(queryLower);
      if (aLabelMatch && !bLabelMatch) return -1;
      if (bLabelMatch && !aLabelMatch) return 1;
      return a.label.localeCompare(b.label);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Navigation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Select next item.
   */
  selectNext(): void {
    if (this.filtered.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.filtered.length;
    this.ensureVisible();
    this.callbacks.onDirty();
  }

  /**
   * Select previous item.
   */
  selectPrevious(): void {
    if (this.filtered.length === 0) return;
    this.selectedIndex = this.selectedIndex === 0 ? this.filtered.length - 1 : this.selectedIndex - 1;
    this.ensureVisible();
    this.callbacks.onDirty();
  }

  /**
   * Execute selected command.
   */
  executeSelected(): void {
    const command = this.filtered[this.selectedIndex];
    if (!command) return;

    this.hide();
    command.execute();
  }

  /**
   * Ensure selected item is visible.
   */
  private ensureVisible(): void {
    if (this.selectedIndex < this.scrollTop) {
      this.scrollTop = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollTop + this.maxVisible) {
      this.scrollTop = this.selectedIndex - this.maxVisible + 1;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  render(buffer: ScreenBuffer): void {
    const { x, y, width, height } = this.bounds;

    // Colors
    const bg = this.callbacks.getThemeColor('panel.background', '#252526');
    const fg = this.callbacks.getThemeColor('panel.foreground', '#cccccc');
    const inputBg = this.callbacks.getThemeColor('input.background', '#3c3c3c');
    const inputFg = this.callbacks.getThemeColor('input.foreground', '#cccccc');
    const selectedBg = this.callbacks.getThemeColor('list.activeSelectionBackground', '#094771');
    const selectedFg = this.callbacks.getThemeColor('list.activeSelectionForeground', '#ffffff');
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');
    const keyFg = this.callbacks.getThemeColor('keybindingLabel.foreground', '#cccccc');
    const border = this.callbacks.getThemeColor('panel.border', '#404040');

    // Draw dialog box
    this.drawDialogBox(buffer, 'Command Palette');

    // Input field (row 1)
    const inputY = y + 1;
    const inputWidth = width - 4;
    const inputX = x + 2;

    // Input background
    for (let col = 0; col < inputWidth; col++) {
      buffer.set(inputX + col, inputY, { char: ' ', fg: inputFg, bg: inputBg });
    }

    // Search icon and query
    const prefix = '> ';
    buffer.writeString(inputX, inputY, prefix, dimFg, inputBg);
    buffer.writeString(inputX + prefix.length, inputY, this.query, inputFg, inputBg);

    // Cursor
    const cursorX = inputX + prefix.length + this.query.length;
    if (cursorX < inputX + inputWidth) {
      buffer.set(cursorX, inputY, { char: '▏', fg: inputFg, bg: inputBg });
    }

    // Separator
    const sepY = y + 2;
    for (let col = 1; col < width - 1; col++) {
      buffer.set(x + col, sepY, { char: '─', fg: border, bg });
    }

    // Command list
    const listY = y + 3;
    const listHeight = height - 4;
    this.maxVisible = listHeight;

    if (this.filtered.length === 0) {
      const msg = this.query ? 'No matching commands' : 'No commands registered';
      buffer.writeString(x + 2, listY + 1, msg, dimFg, bg);
    } else {
      for (let i = 0; i < listHeight; i++) {
        const cmdIndex = this.scrollTop + i;
        if (cmdIndex >= this.filtered.length) break;

        const cmd = this.filtered[cmdIndex]!;
        const isSelected = cmdIndex === this.selectedIndex;
        const rowY = listY + i;

        // Row background
        const rowBg = isSelected ? selectedBg : bg;
        const rowFg = isSelected ? selectedFg : fg;

        for (let col = 1; col < width - 1; col++) {
          buffer.set(x + col, rowY, { char: ' ', fg: rowFg, bg: rowBg });
        }

        // Category prefix
        let labelX = x + 2;
        if (cmd.category) {
          const category = `${cmd.category}: `;
          buffer.writeString(labelX, rowY, category, isSelected ? selectedFg : dimFg, rowBg);
          labelX += category.length;
        }

        // Label
        const maxLabelWidth = width - 4 - (cmd.keybinding?.length ?? 0) - 2;
        let label = cmd.label;
        if (labelX - x - 2 + label.length > maxLabelWidth) {
          label = label.slice(0, maxLabelWidth - (labelX - x - 2) - 1) + '…';
        }
        buffer.writeString(labelX, rowY, label, rowFg, rowBg);

        // Keybinding (right aligned)
        if (cmd.keybinding) {
          const keyX = x + width - 2 - cmd.keybinding.length;
          buffer.writeString(keyX, rowY, cmd.keybinding, isSelected ? selectedFg : keyFg, rowBg);
        }
      }
    }

    // Scrollbar
    if (this.filtered.length > listHeight) {
      const scrollX = x + width - 2;
      const thumbHeight = Math.max(1, Math.floor((listHeight / this.filtered.length) * listHeight));
      const thumbStart = Math.floor((this.scrollTop / this.filtered.length) * listHeight);

      for (let i = 0; i < listHeight; i++) {
        const isThumb = i >= thumbStart && i < thumbStart + thumbHeight;
        buffer.set(scrollX, listY + i, {
          char: ' ',
          fg: '#ffffff',
          bg: isThumb ? '#5a5a5a' : bg,
        });
      }
    }

    // Footer with count
    const footerY = y + height - 1;
    const countText = ` ${this.filtered.length} / ${this.commands.length} commands `;
    buffer.writeString(x + 2, footerY, countText, dimFg, bg);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  handleInput(event: InputEvent): boolean {
    if (!('key' in event)) return false;

    const keyEvent = event as KeyEvent;

    // Navigation
    if (keyEvent.key === 'ArrowDown' || (keyEvent.ctrl && keyEvent.key === 'n')) {
      this.selectNext();
      return true;
    }

    if (keyEvent.key === 'ArrowUp' || (keyEvent.ctrl && keyEvent.key === 'p')) {
      this.selectPrevious();
      return true;
    }

    // Execute
    if (keyEvent.key === 'Enter') {
      this.executeSelected();
      return true;
    }

    // Dismiss
    if (keyEvent.key === 'Escape') {
      this.hide();
      return true;
    }

    // Backspace
    if (keyEvent.key === 'Backspace') {
      if (this.query.length > 0) {
        this.setQuery(this.query.slice(0, -1));
      }
      return true;
    }

    // Clear
    if (keyEvent.ctrl && keyEvent.key === 'u') {
      this.setQuery('');
      return true;
    }

    // Character input
    if (keyEvent.key.length === 1 && !keyEvent.ctrl && !keyEvent.alt && !keyEvent.meta) {
      this.setQuery(this.query + keyEvent.key);
      return true;
    }

    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Layout
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Calculate bounds for centered dialog.
   */
  calculateBounds(screenWidth: number, screenHeight: number): Rect {
    const width = Math.min(60, screenWidth - 4);
    const height = Math.min(16, screenHeight - 4);
    const x = Math.floor((screenWidth - width) / 2);
    const y = Math.max(2, Math.floor(screenHeight / 6)); // Position towards top

    return { x, y, width, height };
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a command palette.
 */
export function createCommandPalette(callbacks: CommandPaletteCallbacks): CommandPalette {
  return new CommandPalette(callbacks);
}
