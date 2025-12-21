/**
 * Input Dialog
 *
 * Simple text input dialog with optional validation.
 */

import { PromiseDialog, type DialogConfig, type DialogResult } from './promise-dialog.ts';
import type { OverlayManagerCallbacks } from './overlay-manager.ts';
import type { KeyEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';

// ============================================
// Types
// ============================================

/**
 * Options for input dialog.
 */
export interface InputDialogOptions extends DialogConfig {
  /** Prompt message */
  prompt?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Initial value */
  initialValue?: string;
  /** Validation function (returns error message or null) */
  validate?: (value: string) => string | null;
  /** Whether to select all text initially */
  selectAll?: boolean;
}

// ============================================
// Input Dialog
// ============================================

export class InputDialog extends PromiseDialog<string> {
  /** Current input value */
  private value: string = '';

  /** Cursor position in input */
  private cursorPos: number = 0;

  /** Selection start (for select all) */
  private selectionStart: number = -1;

  /** Prompt text */
  private prompt: string = '';

  /** Placeholder text */
  private placeholder: string = '';

  /** Validation error */
  private error: string | null = null;

  /** Validation function */
  private validate: ((value: string) => string | null) | null = null;

  constructor(id: string, callbacks: OverlayManagerCallbacks) {
    super(id, callbacks);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the input dialog.
   */
  showWithOptions(options: InputDialogOptions): Promise<DialogResult<string>> {
    this.prompt = options.prompt ?? '';
    this.placeholder = options.placeholder ?? '';
    this.value = options.initialValue ?? '';
    this.cursorPos = this.value.length;
    this.validate = options.validate ?? null;
    this.error = null;

    // Select all if requested
    if (options.selectAll && this.value.length > 0) {
      this.selectionStart = 0;
    } else {
      this.selectionStart = -1;
    }

    return this.showAsync({
      title: options.title ?? 'Input',
      width: options.width ?? 50,
      height: options.height ?? (this.prompt ? 7 : 5),
      ...options,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  protected override handleKeyInput(event: KeyEvent): boolean {
    // Clear selection on any key
    const hadSelection = this.selectionStart !== -1;

    // Enter - confirm
    if (event.key === 'Enter') {
      // Validate
      if (this.validate) {
        this.error = this.validate(this.value);
        if (this.error) {
          this.callbacks.onDirty();
          return true;
        }
      }
      this.confirm(this.value);
      return true;
    }

    // Backspace
    if (event.key === 'Backspace') {
      if (hadSelection) {
        this.deleteSelection();
      } else if (this.cursorPos > 0) {
        this.value =
          this.value.slice(0, this.cursorPos - 1) + this.value.slice(this.cursorPos);
        this.cursorPos--;
      }
      this.selectionStart = -1;
      this.error = null;
      this.callbacks.onDirty();
      return true;
    }

    // Delete
    if (event.key === 'Delete') {
      if (hadSelection) {
        this.deleteSelection();
      } else if (this.cursorPos < this.value.length) {
        this.value =
          this.value.slice(0, this.cursorPos) + this.value.slice(this.cursorPos + 1);
      }
      this.selectionStart = -1;
      this.error = null;
      this.callbacks.onDirty();
      return true;
    }

    // Arrow keys
    if (event.key === 'ArrowLeft') {
      if (this.cursorPos > 0) {
        this.cursorPos--;
      }
      this.selectionStart = -1;
      this.callbacks.onDirty();
      return true;
    }

    if (event.key === 'ArrowRight') {
      if (this.cursorPos < this.value.length) {
        this.cursorPos++;
      }
      this.selectionStart = -1;
      this.callbacks.onDirty();
      return true;
    }

    // Home/End
    if (event.key === 'Home') {
      this.cursorPos = 0;
      this.selectionStart = -1;
      this.callbacks.onDirty();
      return true;
    }

    if (event.key === 'End') {
      this.cursorPos = this.value.length;
      this.selectionStart = -1;
      this.callbacks.onDirty();
      return true;
    }

    // Select all
    if (event.ctrl && event.key === 'a') {
      this.selectionStart = 0;
      this.cursorPos = this.value.length;
      this.callbacks.onDirty();
      return true;
    }

    // Clear line
    if (event.ctrl && event.key === 'u') {
      this.value = '';
      this.cursorPos = 0;
      this.selectionStart = -1;
      this.error = null;
      this.callbacks.onDirty();
      return true;
    }

    // Character input
    if (event.key.length === 1 && !event.ctrl && !event.alt && !event.meta) {
      if (hadSelection) {
        this.deleteSelection();
      }
      this.value =
        this.value.slice(0, this.cursorPos) + event.key + this.value.slice(this.cursorPos);
      this.cursorPos++;
      this.selectionStart = -1;
      this.error = null;
      this.callbacks.onDirty();
      return true;
    }

    return false;
  }

  private deleteSelection(): void {
    if (this.selectionStart === -1) return;

    const start = Math.min(this.selectionStart, this.cursorPos);
    const end = Math.max(this.selectionStart, this.cursorPos);
    this.value = this.value.slice(0, start) + this.value.slice(end);
    this.cursorPos = start;
    this.selectionStart = -1;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  protected override renderContent(buffer: ScreenBuffer): void {
    const content = this.getContentBounds();
    const bg = this.callbacks.getThemeColor('editorWidget.background', '#252526');
    const fg = this.callbacks.getThemeColor('editorWidget.foreground', '#cccccc');
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');
    const inputBg = this.callbacks.getThemeColor('input.background', '#3c3c3c');
    const focusBorder = this.callbacks.getThemeColor('focusBorder', '#007acc');
    const errorFg = this.callbacks.getThemeColor('errorForeground', '#f44336');
    const selectionBg = this.callbacks.getThemeColor('editor.selectionBackground', '#264f78');

    let y = content.y;

    // Prompt
    if (this.prompt) {
      buffer.writeString(content.x, y, this.prompt, fg, bg);
      y += 2;
    }

    // Input field background
    const inputWidth = content.width;
    for (let col = 0; col < inputWidth; col++) {
      buffer.set(content.x + col, y, { char: ' ', fg, bg: inputBg });
    }

    // Display text or placeholder
    const displayText = this.value || this.placeholder;
    const displayFg = this.value ? fg : dimFg;
    const maxDisplay = inputWidth - 2;

    // Calculate scroll offset if value is too long
    let scrollOffset = 0;
    if (this.cursorPos > maxDisplay - 1) {
      scrollOffset = this.cursorPos - maxDisplay + 1;
    }

    const visibleText = displayText.slice(scrollOffset, scrollOffset + maxDisplay);

    // Render text with selection
    for (let i = 0; i < visibleText.length; i++) {
      const charIndex = scrollOffset + i;
      const isSelected =
        this.selectionStart !== -1 &&
        charIndex >= Math.min(this.selectionStart, this.cursorPos) &&
        charIndex < Math.max(this.selectionStart, this.cursorPos);

      buffer.set(content.x + 1 + i, y, {
        char: visibleText[i]!,
        fg: displayFg,
        bg: isSelected ? selectionBg : inputBg,
      });
    }

    // Cursor
    const cursorScreenX = content.x + 1 + this.cursorPos - scrollOffset;
    if (cursorScreenX < content.x + inputWidth - 1 && this.value) {
      buffer.set(cursorScreenX, y, {
        char: this.value[this.cursorPos] ?? ' ',
        fg: inputBg,
        bg: focusBorder,
      });
    } else if (!this.value) {
      buffer.set(content.x + 1, y, { char: '│', fg: focusBorder, bg: inputBg });
    }

    // Error message
    if (this.error) {
      y += 2;
      buffer.writeString(content.x, y, this.error, errorFg, bg);
    }
  }
}
