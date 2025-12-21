/**
 * Go To Line Dialog
 *
 * A dialog for jumping to a specific line and column.
 */

import { BaseDialog, type OverlayManagerCallbacks } from './overlay-manager.ts';
import type { InputEvent, KeyEvent, Rect } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';

// ============================================
// Types
// ============================================

/**
 * Callbacks for go-to-line dialog.
 */
export interface GotoLineCallbacks extends OverlayManagerCallbacks {
  /** Called when user confirms line/column */
  onGoto?: (line: number, column?: number) => void;
  /** Called when dialog is dismissed */
  onDismiss?: () => void;
}

// ============================================
// Go To Line Dialog
// ============================================

export class GotoLineDialog extends BaseDialog {
  /** Current input value */
  private inputValue = '';

  /** Current line in document (for display) */
  private currentLine = 1;

  /** Total lines in document */
  private totalLines = 1;

  /** Error message */
  private errorMessage = '';

  /** Callbacks */
  private gotoCallbacks: GotoLineCallbacks;

  constructor(callbacks: GotoLineCallbacks) {
    super('goto-line', callbacks);
    this.gotoCallbacks = callbacks;
    this.zIndex = 200;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set document info for display.
   */
  setDocumentInfo(currentLine: number, totalLines: number): void {
    this.currentLine = currentLine;
    this.totalLines = totalLines;
    this.callbacks.onDirty();
  }

  /**
   * Get the input value.
   */
  getInputValue(): string {
    return this.inputValue;
  }

  /**
   * Set input value.
   */
  setInputValue(value: string): void {
    this.inputValue = value;
    this.validateInput();
    this.callbacks.onDirty();
  }

  /**
   * Parse input into line and optional column.
   */
  private parseInput(): { line: number; column?: number } | null {
    const trimmed = this.inputValue.trim();
    if (!trimmed) return null;

    // Format: line or line:column or line,column
    const match = trimmed.match(/^(\d+)(?:[:, ](\d+))?$/);
    if (!match) return null;

    const line = parseInt(match[1]!, 10);
    const column = match[2] ? parseInt(match[2], 10) : undefined;

    return { line, column };
  }

  /**
   * Validate input and set error message.
   */
  private validateInput(): void {
    const parsed = this.parseInput();

    if (!this.inputValue.trim()) {
      this.errorMessage = '';
      return;
    }

    if (!parsed) {
      this.errorMessage = 'Enter a line number (e.g., 42 or 42:10)';
      return;
    }

    if (parsed.line < 1) {
      this.errorMessage = 'Line must be at least 1';
      return;
    }

    if (parsed.line > this.totalLines) {
      this.errorMessage = `Line exceeds document length (${this.totalLines})`;
      return;
    }

    if (parsed.column !== undefined && parsed.column < 1) {
      this.errorMessage = 'Column must be at least 1';
      return;
    }

    this.errorMessage = '';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Show/Hide
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the dialog.
   */
  override show(): void {
    this.inputValue = '';
    this.errorMessage = '';
    super.show();
  }

  /**
   * Hide the dialog.
   */
  override hide(): void {
    super.hide();
    this.gotoCallbacks.onDismiss?.();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Confirm and go to line.
   */
  confirm(): void {
    const parsed = this.parseInput();
    if (!parsed || this.errorMessage) return;

    this.hide();
    this.gotoCallbacks.onGoto?.(parsed.line, parsed.column);
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
    const inputBorderActive = this.callbacks.getThemeColor('focusBorder', '#007acc');
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');
    const border = this.callbacks.getThemeColor('panel.border', '#404040');
    const errorFg = this.callbacks.getThemeColor('errorForeground', '#f48771');

    // Draw dialog box
    this.drawDialogBox(buffer, 'Go to Line');

    const contentX = x + 2;
    let rowY = y + 1;

    // Prompt text
    const promptText = `Current line: ${this.currentLine} of ${this.totalLines}`;
    buffer.writeString(contentX, rowY, promptText, dimFg, bg);
    rowY++;

    // Input field
    const inputY = rowY;
    const inputWidth = width - 4;
    const inputX = contentX;

    // Input background
    for (let col = 0; col < inputWidth; col++) {
      buffer.set(inputX + col, inputY, { char: ' ', fg: inputFg, bg: inputBg });
    }

    // Prefix
    const prefix = ': ';
    buffer.writeString(inputX, inputY, prefix, dimFg, inputBg);

    // Input value
    const maxDisplay = inputWidth - prefix.length - 2;
    let displayValue = this.inputValue;
    if (displayValue.length > maxDisplay) {
      displayValue = displayValue.slice(-maxDisplay);
    }
    buffer.writeString(inputX + prefix.length, inputY, displayValue, inputFg, inputBg);

    // Cursor
    const cursorX = inputX + prefix.length + displayValue.length;
    if (cursorX < inputX + inputWidth - 1) {
      buffer.set(cursorX, inputY, { char: '▏', fg: inputBorderActive, bg: inputBg });
    }

    rowY++;

    // Error message
    if (this.errorMessage) {
      buffer.writeString(contentX, rowY, this.errorMessage, errorFg, bg);
    } else {
      // Format hint
      const hintText = 'Format: line or line:column';
      buffer.writeString(contentX, rowY, hintText, dimFg, bg);
    }

    rowY++;

    // Separator
    for (let col = 1; col < width - 1; col++) {
      buffer.set(x + col, rowY, { char: '─', fg: border, bg });
    }

    // Help text at bottom
    const helpY = y + height - 1;
    const helpText = 'Enter: Go to line | Esc: Cancel';
    buffer.writeString(x + 2, helpY, helpText, dimFg, bg);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  handleInput(event: InputEvent): boolean {
    if (!('key' in event)) return false;

    const keyEvent = event as KeyEvent;

    // Enter to confirm
    if (keyEvent.key === 'Enter') {
      this.confirm();
      return true;
    }

    // Escape to close
    if (keyEvent.key === 'Escape') {
      this.hide();
      return true;
    }

    // Backspace
    if (keyEvent.key === 'Backspace') {
      if (this.inputValue.length > 0) {
        this.setInputValue(this.inputValue.slice(0, -1));
      }
      return true;
    }

    // Clear
    if (keyEvent.ctrl && keyEvent.key === 'u') {
      this.setInputValue('');
      return true;
    }

    // Number and separator input only
    if (/^[0-9:, ]$/.test(keyEvent.key) && !keyEvent.ctrl && !keyEvent.alt && !keyEvent.meta) {
      this.setInputValue(this.inputValue + keyEvent.key);
      return true;
    }

    // Ignore other keys but consume them
    if (keyEvent.key.length === 1) {
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
    const width = Math.min(50, screenWidth - 4);
    const height = 7;
    const dialogX = Math.floor((screenWidth - width) / 2);
    const dialogY = Math.max(2, Math.floor(screenHeight / 4));

    return { x: dialogX, y: dialogY, width, height };
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a go-to-line dialog.
 */
export function createGotoLineDialog(callbacks: GotoLineCallbacks): GotoLineDialog {
  return new GotoLineDialog(callbacks);
}
