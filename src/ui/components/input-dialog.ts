/**
 * Input Dialog Component
 *
 * Simple text input dialog for prompts like "Save As" filename,
 * "Go to Line", etc.
 *
 * Now extends BaseDialog for consistent API and MouseHandler support.
 */

import type { RenderContext } from '../renderer.ts';
import type { MouseEvent } from '../mouse.ts';
import type { KeyEvent } from '../../terminal/input.ts';
import { BaseDialog, type BaseDialogConfig } from './base-dialog.ts';
import { TextInput } from './text-input.ts';
import { RenderUtils } from '../render-utils.ts';

/**
 * Configuration for InputDialog (new API)
 */
export interface InputDialogOptions {
  /** Dialog title */
  title: string;
  /** Placeholder text for empty input */
  placeholder?: string;
  /** Initial value */
  initialValue?: string;
  /** Custom width (default: 60) */
  width?: number;
  /** Hint text shown below input */
  hint?: string;
  /** Validation function - return error message or empty string */
  validate?: (value: string) => string;
}

/**
 * InputDialog - Simple text input dialog
 *
 * @example New API:
 * ```typescript
 * inputDialog.showDialog(
 *   { screenWidth: 80, screenHeight: 24 },
 *   { title: 'Save As', placeholder: 'filename.txt' }
 * );
 * inputDialog.onConfirm((value) => saveFile(value));
 * ```
 *
 * @example Legacy API (still supported):
 * ```typescript
 * inputDialog.show({
 *   title: 'Save As',
 *   screenWidth: 80,
 *   screenHeight: 24,
 *   onConfirm: (value) => saveFile(value)
 * });
 * ```
 */
export class InputDialog extends BaseDialog {
  private _textInput: TextInput;
  private _placeholder: string = '';
  private _hint: string = '';
  private _validationError: string = '';
  private _validate?: (value: string) => string;

  // Callbacks
  private _confirmCallbacks: Set<(value: string) => void> = new Set();
  private _cancelCallbacks: Set<() => void> = new Set();

  constructor() {
    super();
    this._debugName = 'InputDialog';

    this._textInput = new TextInput({
      onChange: () => this.onValueChange(),
      onSubmit: () => this.confirm(),
      onCancel: () => this.cancel()
    });
  }

  // === Lifecycle ===

  /**
   * Show the input dialog (new API)
   */
  showDialog(config: BaseDialogConfig, options: InputDialogOptions): void {
    // Calculate dimensions - input dialog is compact
    const width = options.width || 60;
    const height = 5;  // Title, input, hint, border = 5 lines

    this.showBase({
      ...config,
      title: options.title,
      width,
      height
    });

    // Center vertically in upper third of screen
    this._rect.y = Math.floor(config.screenHeight / 3);

    // Set input state
    this._placeholder = options.placeholder || '';
    this._hint = options.hint || 'Enter to confirm, Escape to cancel';
    this._validate = options.validate;
    this._validationError = '';

    // Reset text input
    this._textInput.reset(options.initialValue || '');
    this._textInput.setPlaceholder(this._placeholder);

    this.debugLog(`Showing with title "${options.title}"`);
  }

  /**
   * Show the input dialog (legacy API for backwards compatibility)
   */
  show(options: {
    title: string;
    placeholder?: string;
    initialValue?: string;
    screenWidth: number;
    screenHeight: number;
    width?: number;
    editorX?: number;
    editorWidth?: number;
    onConfirm: (value: string) => void;
    onCancel?: () => void;
  }): void {
    // Clear previous callbacks
    this._confirmCallbacks.clear();
    this._cancelCallbacks.clear();

    // Convert to new API
    this.showDialog(
      {
        screenWidth: options.screenWidth,
        screenHeight: options.screenHeight,
        editorX: options.editorX,
        editorWidth: options.editorWidth
      },
      {
        title: options.title,
        placeholder: options.placeholder,
        initialValue: options.initialValue,
        width: options.width
      }
    );

    // Register callbacks
    this._confirmCallbacks.add(options.onConfirm);
    if (options.onCancel) {
      this._cancelCallbacks.add(options.onCancel);
    }
  }

  /**
   * Hide the dialog
   */
  hide(): void {
    super.hide();
  }

  // === Value Management ===

  /**
   * Get current input value
   */
  getValue(): string {
    return this._textInput.value;
  }

  /**
   * Set input value
   */
  setValue(value: string): void {
    this._textInput.setValue(value);
  }

  /**
   * Append character to input
   */
  appendChar(char: string): void {
    this._textInput.appendChar(char);
  }

  /**
   * Delete last character
   */
  backspace(): void {
    this._textInput.backspace();
  }

  /**
   * Called when value changes - for validation
   */
  private onValueChange(): void {
    if (this._validate) {
      this._validationError = this._validate(this._textInput.value);
    }
  }

  // === Actions ===

  /**
   * Confirm the input
   */
  confirm(): void {
    const value = this._textInput.value;

    // Validate if validator provided
    if (this._validate) {
      const error = this._validate(value);
      if (error) {
        this._validationError = error;
        this.debugLog(`Validation failed: ${error}`);
        return;
      }
    }

    // Require non-empty value
    if (value.length === 0) {
      this.debugLog('Confirm blocked: empty value');
      return;
    }

    this.debugLog(`Confirming with value: ${value}`);

    // Trigger callbacks
    for (const callback of this._confirmCallbacks) {
      try {
        callback(value);
      } catch (e) {
        this.debugLog(`Confirm callback error: ${e}`);
      }
    }

    this.hide();
  }

  /**
   * Cancel the input
   */
  cancel(): void {
    this.debugLog('Cancelled');

    // Trigger callbacks
    for (const callback of this._cancelCallbacks) {
      try {
        callback();
      } catch (e) {
        this.debugLog(`Cancel callback error: ${e}`);
      }
    }

    this.hide();
  }

  // === Callbacks ===

  /**
   * Register confirm callback
   * @returns Cleanup function
   */
  onConfirm(callback: (value: string) => void): () => void {
    this._confirmCallbacks.add(callback);
    return () => {
      this._confirmCallbacks.delete(callback);
    };
  }

  /**
   * Register cancel callback
   * @returns Cleanup function
   */
  onCancel(callback: () => void): () => void {
    this._cancelCallbacks.add(callback);
    return () => {
      this._cancelCallbacks.delete(callback);
    };
  }

  // === Keyboard Handling ===

  /**
   * Handle keyboard input
   */
  handleKey(event: KeyEvent): boolean {
    if (!this._isVisible) return false;

    // Let TextInput handle most keys
    return this._textInput.handleKey(event);
  }

  // === Mouse Handling ===

  /**
   * Handle mouse events
   */
  onMouseEvent(event: MouseEvent): boolean {
    if (!this._isVisible) return false;

    if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED') {
      if (!this.containsPoint(event.x, event.y)) {
        // Click outside - cancel
        this.cancel();
        return true;
      }
    }

    return this.containsPoint(event.x, event.y);
  }

  // === Rendering ===

  /**
   * Render the dialog
   */
  render(ctx: RenderContext): void {
    if (!this._isVisible) return;

    const colors = this.getColors();

    // Background and border
    this.renderBackground(ctx);

    // Title
    this.renderTitle(ctx);

    // Input field
    this.renderInput(ctx);

    // Hint or validation error
    this.renderHint(ctx);
  }

  /**
   * Render the input field
   */
  private renderInput(ctx: RenderContext): void {
    const colors = this.getColors();
    const inputY = this._rect.y + 2;
    const inputX = this._rect.x + 2;
    const inputWidth = this._rect.width - 4;

    // Input background
    ctx.fill(inputX, inputY, inputWidth, 1, ' ', colors.inputForeground, colors.inputBackground);

    // Value or placeholder
    const value = this._textInput.value;
    const displayText = value || this._placeholder;
    const textColor = value ? colors.inputForeground : colors.hintForeground;
    const truncated = RenderUtils.truncateText(displayText, inputWidth - 1);

    ctx.drawStyled(inputX, inputY, truncated, textColor, colors.inputBackground);

    // Cursor (show as inverse character)
    const cursorPos = Math.min(this._textInput.cursorPosition, inputWidth - 1);
    const cursorX = inputX + cursorPos;
    const charUnderCursor = cursorPos < value.length ? value[cursorPos] : ' ';
    ctx.drawStyled(cursorX, inputY, charUnderCursor || ' ', undefined, undefined, { inverse: true });
  }

  /**
   * Render hint or validation error
   */
  private renderHint(ctx: RenderContext): void {
    const colors = this.getColors();
    const hintY = this._rect.y + 4;
    const hintX = this._rect.x + 2;
    const maxWidth = this._rect.width - 4;

    const text = this._validationError || this._hint;
    const color = this._validationError ? '#f14c4c' : colors.hintForeground;
    const truncated = RenderUtils.truncateText(text, maxWidth);

    ctx.drawStyled(hintX, hintY, truncated, color, colors.background);
  }
}

export const inputDialog = new InputDialog();
export default inputDialog;
