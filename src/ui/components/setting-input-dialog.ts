/**
 * Setting Input Dialog
 *
 * A dialog for editing string and number settings with validation.
 * Shows setting description and validation criteria.
 * Enter confirms, Escape cancels.
 */

import type { RenderContext } from '../renderer.ts';
import type { MouseEvent } from '../mouse.ts';
import type { KeyEvent } from '../../terminal/input.ts';
import { BaseDialog, type BaseDialogConfig } from './base-dialog.ts';
import { TextInput } from './text-input.ts';
import { RenderUtils } from '../render-utils.ts';

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Configuration for the setting input dialog
 */
export interface SettingInputConfig extends BaseDialogConfig {
  /** Setting key for display */
  settingKey: string;
  /** Human-readable label */
  label: string;
  /** Setting description */
  description: string;
  /** Initial value */
  initialValue: string | number;
  /** Type of input (string or number) */
  inputType: 'string' | 'number';
  /** Minimum value for numbers */
  min?: number;
  /** Maximum value for numbers */
  max?: number;
  /** Callback when confirmed */
  onConfirm: (value: string | number) => void;
  /** Callback when cancelled */
  onCancel?: () => void;
}

/**
 * SettingInputDialog - Edit string/number settings
 */
export class SettingInputDialog extends BaseDialog {
  private _settingKey: string = '';
  private _label: string = '';
  private _description: string = '';
  private _inputType: 'string' | 'number' = 'string';
  private _min?: number;
  private _max?: number;
  private _textInput: TextInput;
  private _onConfirm: ((value: string | number) => void) | null = null;
  private _onCancel: (() => void) | null = null;
  private _validationError: string = '';

  constructor() {
    super();
    this._debugName = 'SettingInputDialog';

    this._textInput = new TextInput({
      onChange: () => this.validate(),
      onSubmit: () => this.confirm(),
      onCancel: () => this.cancel()
    });
  }

  /**
   * Show the dialog
   */
  show(config: SettingInputConfig): void {
    this._settingKey = config.settingKey;
    this._label = config.label;
    this._description = config.description;
    this._inputType = config.inputType;
    this._min = config.min;
    this._max = config.max;
    this._onConfirm = config.onConfirm;
    this._onCancel = config.onCancel || null;
    this._validationError = '';

    // Initialize text input with current value
    this._textInput.reset();
    this._textInput.setValue(String(config.initialValue));

    this.showBase({
      ...config,
      title: 'Edit Setting',
      width: Math.max(50, Math.min(80, Math.max(config.description.length + 10, 50))),
      height: 10
    });

    this.debugLog(`Showing input for ${config.settingKey}: ${config.initialValue}`);
  }

  /**
   * Validate the current input
   */
  private validate(): ValidationResult {
    const value = this._textInput.value;

    if (this._inputType === 'number') {
      const num = parseFloat(value);

      if (isNaN(num)) {
        this._validationError = 'Must be a valid number';
        return { valid: false, error: this._validationError };
      }

      if (this._min !== undefined && num < this._min) {
        this._validationError = `Minimum value is ${this._min}`;
        return { valid: false, error: this._validationError };
      }

      if (this._max !== undefined && num > this._max) {
        this._validationError = `Maximum value is ${this._max}`;
        return { valid: false, error: this._validationError };
      }
    }

    this._validationError = '';
    return { valid: true };
  }

  /**
   * Confirm and save
   */
  confirm(): void {
    const validation = this.validate();
    if (!validation.valid) {
      this.debugLog(`Validation failed: ${validation.error}`);
      return;
    }

    let value: string | number = this._textInput.value;
    if (this._inputType === 'number') {
      value = parseFloat(value);
    }

    if (this._onConfirm) {
      this._onConfirm(value);
    }
    this._isVisible = false;
    this.debugLog(`Confirmed: ${value}`);
  }

  /**
   * Cancel without saving
   */
  cancel(): void {
    if (this._onCancel) {
      this._onCancel();
    }
    this._isVisible = false;
    this.debugLog('Cancelled');
  }

  /**
   * Handle keyboard input
   */
  handleKey(event: KeyEvent): boolean {
    if (!this._isVisible) return false;

    const { key } = event;

    // Cancel with Escape
    if (key === 'ESCAPE') {
      this.cancel();
      return true;
    }

    // Confirm with Enter
    if (key === 'ENTER') {
      this.confirm();
      return true;
    }

    // Pass to text input
    return this._textInput.handleKey(event);
  }

  /**
   * Handle mouse events
   */
  onMouseEvent(event: MouseEvent): boolean {
    if (!this._isVisible) return false;

    if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED') {
      if (!this.containsPoint(event.x, event.y)) {
        this.cancel();
        return true;
      }
    }

    return this.containsPoint(event.x, event.y);
  }

  /**
   * Render the dialog
   */
  render(ctx: RenderContext): void {
    if (!this._isVisible) return;

    const colors = this.getColors();

    // Background and border
    this.renderBackground(ctx);

    // Title (label)
    this.renderTitle(ctx, this._label);

    // Description (line 2)
    const descY = this._rect.y + 2;
    const maxDescWidth = this._rect.width - 4;
    const desc = RenderUtils.truncateText(this._description, maxDescWidth);
    ctx.drawStyled(
      this._rect.x + 2,
      descY,
      desc,
      colors.hintForeground,
      colors.background
    );

    // Setting key (line 3)
    const keyY = this._rect.y + 3;
    ctx.drawStyled(
      this._rect.x + 2,
      keyY,
      this._settingKey,
      colors.hintForeground,
      colors.background
    );

    // Validation info (line 4)
    const validationY = this._rect.y + 4;
    if (this._inputType === 'number' && (this._min !== undefined || this._max !== undefined)) {
      let rangeText = 'Range: ';
      if (this._min !== undefined && this._max !== undefined) {
        rangeText += `${this._min} - ${this._max}`;
      } else if (this._min !== undefined) {
        rangeText += `≥ ${this._min}`;
      } else if (this._max !== undefined) {
        rangeText += `≤ ${this._max}`;
      }
      ctx.drawStyled(
        this._rect.x + 2,
        validationY,
        rangeText,
        colors.hintForeground,
        colors.background
      );
    }

    // Input field (line 5)
    const inputY = this._rect.y + 5;
    const inputX = this._rect.x + 2;
    const inputWidth = this._rect.width - 4;

    // Input background
    const hasError = this._validationError.length > 0;
    const inputBg = hasError ? colors.errorForeground : colors.inputBackground;
    ctx.fill(inputX, inputY, inputWidth, 1, ' ', colors.inputForeground, colors.inputBackground);

    // Input border indicator
    const borderColor = hasError ? colors.errorForeground : colors.inputFocusBorder;
    ctx.drawStyled(inputX, inputY, '>', borderColor, colors.background);

    // Input value with cursor
    const value = this._textInput.value;
    const cursorPos = this._textInput.cursorPosition;
    const maxLen = inputWidth - 4;
    const textStartX = inputX + 2;

    // Render text before cursor
    if (cursorPos > 0) {
      const beforeCursor = value.substring(0, Math.min(cursorPos, maxLen));
      ctx.drawStyled(textStartX, inputY, beforeCursor, colors.inputForeground, colors.inputBackground);
    }

    // Render cursor character (highlighted) or cursor block if at end
    const cursorX = textStartX + Math.min(cursorPos, maxLen);
    if (cursorPos < value.length) {
      // Show character at cursor with inverted colors
      const charAtCursor = value[cursorPos];
      ctx.drawStyled(cursorX, inputY, charAtCursor!, colors.inputBackground, colors.inputForeground);
    } else {
      // Cursor at end - show block cursor
      ctx.drawStyled(cursorX, inputY, ' ', colors.inputBackground, colors.inputFocusBorder);
    }

    // Render text after cursor
    if (cursorPos + 1 < value.length && cursorPos < maxLen) {
      const afterCursor = value.substring(cursorPos + 1, maxLen);
      ctx.drawStyled(cursorX + 1, inputY, afterCursor, colors.inputForeground, colors.inputBackground);
    }

    // Fill rest of input area
    const textEndX = textStartX + Math.min(value.length, maxLen);
    const cursorEndX = cursorPos >= value.length ? cursorX + 1 : textEndX;
    const remainingWidth = inputX + inputWidth - cursorEndX;
    if (remainingWidth > 0) {
      ctx.fill(cursorEndX, inputY, remainingWidth, 1, ' ', undefined, colors.inputBackground);
    }

    // Error message (line 6)
    const errorY = this._rect.y + 6;
    if (this._validationError) {
      ctx.drawStyled(
        this._rect.x + 2,
        errorY,
        this._validationError,
        colors.errorForeground,
        colors.background
      );
    }

    // Hint (line 8)
    const hintY = this._rect.y + 8;
    const hint = 'Enter confirm  Esc cancel';
    const hintX = this._rect.x + Math.floor((this._rect.width - hint.length) / 2);
    ctx.drawStyled(hintX, hintY, hint, colors.hintForeground, colors.background);
  }
}

export const settingInputDialog = new SettingInputDialog();
export default settingInputDialog;
