/**
 * Goto Line Dialog
 *
 * Dialog for jumping to a specific line and column.
 * Accepts formats: "line", "line:column", ":column"
 */

import { PromiseDialog, type DialogConfig, type DialogResult } from './promise-dialog.ts';
import type { OverlayManagerCallbacks } from './overlay-manager.ts';
import type { KeyEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';

// ============================================
// Types
// ============================================

/**
 * Result from goto line dialog.
 */
export interface GotoLineResult {
  /** Line number (1-indexed) */
  line: number;
  /** Column number (1-indexed), optional */
  column?: number;
}

// ============================================
// Goto Line Dialog
// ============================================

export class GotoLineDialog extends PromiseDialog<GotoLineResult> {
  /** Current input value */
  private value: string = '';

  /** Cursor position */
  private cursorPos: number = 0;

  /** Current line for hint */
  private currentLine: number = 1;

  /** Parse error message */
  private error: string | null = null;

  constructor(id: string, callbacks: OverlayManagerCallbacks) {
    super(id, callbacks);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the goto line dialog.
   */
  showWithCurrentLine(currentLine?: number): Promise<DialogResult<GotoLineResult>> {
    this.currentLine = currentLine ?? 1;
    this.value = '';
    this.cursorPos = 0;
    this.error = null;

    return this.showAsync({
      title: 'Go to Line',
      width: 40,
      height: 5,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Parsing
  // ─────────────────────────────────────────────────────────────────────────

  private parseInput(): GotoLineResult | null {
    const trimmed = this.value.trim();
    if (!trimmed) {
      this.error = 'Enter a line number';
      return null;
    }

    // Format: line or line:column or :column
    const match = trimmed.match(/^(\d*):?(\d*)$/);
    if (!match) {
      this.error = 'Invalid format. Use: line or line:column';
      return null;
    }

    const [, lineStr, colStr] = match;
    let line: number;
    let column: number | undefined;

    if (lineStr) {
      line = parseInt(lineStr, 10);
      if (isNaN(line) || line < 1) {
        this.error = 'Line must be a positive number';
        return null;
      }
    } else {
      // Just ":column" - stay on current line
      line = this.currentLine;
    }

    if (colStr) {
      column = parseInt(colStr, 10);
      if (isNaN(column) || column < 1) {
        this.error = 'Column must be a positive number';
        return null;
      }
    }

    this.error = null;
    return { line, column };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  protected override handleKeyInput(event: KeyEvent): boolean {
    // Enter - confirm
    if (event.key === 'Enter') {
      const result = this.parseInput();
      if (result) {
        this.confirm(result);
      } else {
        this.callbacks.onDirty();
      }
      return true;
    }

    // Backspace
    if (event.key === 'Backspace') {
      if (this.cursorPos > 0) {
        this.value =
          this.value.slice(0, this.cursorPos - 1) + this.value.slice(this.cursorPos);
        this.cursorPos--;
        this.error = null;
        this.callbacks.onDirty();
      }
      return true;
    }

    // Delete
    if (event.key === 'Delete') {
      if (this.cursorPos < this.value.length) {
        this.value =
          this.value.slice(0, this.cursorPos) + this.value.slice(this.cursorPos + 1);
        this.error = null;
        this.callbacks.onDirty();
      }
      return true;
    }

    // Arrow keys
    if (event.key === 'ArrowLeft' && this.cursorPos > 0) {
      this.cursorPos--;
      this.callbacks.onDirty();
      return true;
    }

    if (event.key === 'ArrowRight' && this.cursorPos < this.value.length) {
      this.cursorPos++;
      this.callbacks.onDirty();
      return true;
    }

    // Home/End
    if (event.key === 'Home') {
      this.cursorPos = 0;
      this.callbacks.onDirty();
      return true;
    }

    if (event.key === 'End') {
      this.cursorPos = this.value.length;
      this.callbacks.onDirty();
      return true;
    }

    // Clear
    if (event.ctrl && event.key === 'u') {
      this.value = '';
      this.cursorPos = 0;
      this.error = null;
      this.callbacks.onDirty();
      return true;
    }

    // Only allow digits and colon
    if (event.key.length === 1 && !event.ctrl && !event.alt && !event.meta) {
      if (/[\d:]/.test(event.key)) {
        this.value =
          this.value.slice(0, this.cursorPos) + event.key + this.value.slice(this.cursorPos);
        this.cursorPos++;
        this.error = null;
        this.callbacks.onDirty();
      }
      return true;
    }

    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  protected override renderContent(buffer: ScreenBuffer): void {
    const content = this.getContentBounds();
    const bg = this.callbacks.getThemeColor('panel.background', '#252526');
    const fg = this.callbacks.getThemeColor('panel.foreground', '#cccccc');
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');
    const inputBg = this.callbacks.getThemeColor('input.background', '#3c3c3c');
    const focusBorder = this.callbacks.getThemeColor('focusBorder', '#007acc');
    const errorFg = this.callbacks.getThemeColor('errorForeground', '#f44336');

    // Input field
    const y = content.y;
    const inputWidth = content.width;

    // Background
    for (let col = 0; col < inputWidth; col++) {
      buffer.set(content.x + col, y, { char: ' ', fg, bg: inputBg });
    }

    // Placeholder or value
    const placeholder = `line:column (current: ${this.currentLine})`;
    const displayText = this.value || placeholder;
    const displayFg = this.value ? fg : dimFg;
    const maxDisplay = inputWidth - 2;
    const truncated =
      displayText.length > maxDisplay ? displayText.slice(0, maxDisplay - 1) + '…' : displayText;

    buffer.writeString(content.x + 1, y, truncated, displayFg, inputBg);

    // Cursor
    if (this.value) {
      const cursorX = content.x + 1 + this.cursorPos;
      if (cursorX < content.x + inputWidth - 1) {
        const cursorChar = this.value[this.cursorPos] ?? ' ';
        buffer.set(cursorX, y, { char: cursorChar, fg: inputBg, bg: focusBorder });
      }
    } else {
      buffer.set(content.x + 1, y, { char: '│', fg: focusBorder, bg: inputBg });
    }

    // Error or hint
    const hintY = y + 1;
    if (this.error) {
      buffer.writeString(content.x, hintY, this.error, errorFg, bg);
    } else {
      const hint = 'Format: line or line:column';
      buffer.writeString(content.x, hintY, hint, dimFg, bg);
    }
  }
}
