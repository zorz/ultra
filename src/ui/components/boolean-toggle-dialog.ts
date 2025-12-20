/**
 * Boolean Toggle Dialog
 *
 * A simple dialog for toggling boolean settings.
 * Use left/right arrows to change value, Enter to confirm, Escape to cancel.
 */

import type { RenderContext } from '../renderer.ts';
import type { MouseEvent } from '../mouse.ts';
import type { KeyEvent } from '../../terminal/input.ts';
import { BaseDialog, type BaseDialogConfig } from './base-dialog.ts';
import { RenderUtils } from '../render-utils.ts';

/**
 * Configuration for the boolean toggle dialog
 */
export interface BooleanToggleConfig extends BaseDialogConfig {
  /** Setting key for display */
  settingKey: string;
  /** Human-readable label */
  label: string;
  /** Setting description */
  description: string;
  /** Initial value */
  initialValue: boolean;
  /** Callback when confirmed */
  onConfirm: (value: boolean) => void;
  /** Callback when cancelled */
  onCancel?: () => void;
}

/**
 * BooleanToggleDialog - Toggle boolean settings
 */
export class BooleanToggleDialog extends BaseDialog {
  private _settingKey: string = '';
  private _label: string = '';
  private _description: string = '';
  private _value: boolean = false;
  private _initialValue: boolean = false;
  private _onConfirm: ((value: boolean) => void) | null = null;
  private _onCancel: (() => void) | null = null;

  constructor() {
    super();
    this._debugName = 'BooleanToggleDialog';
  }

  /**
   * Show the dialog
   */
  show(config: BooleanToggleConfig): void {
    this._settingKey = config.settingKey;
    this._label = config.label;
    this._description = config.description;
    this._value = config.initialValue;
    this._initialValue = config.initialValue;
    this._onConfirm = config.onConfirm;
    this._onCancel = config.onCancel || null;

    this.showBase({
      ...config,
      title: 'Toggle Setting',
      width: Math.max(50, Math.min(70, config.description.length + 10)),
      height: 8
    });

    this.debugLog(`Showing toggle for ${config.settingKey}: ${config.initialValue}`);
  }

  /**
   * Toggle the value
   */
  toggle(): void {
    this._value = !this._value;
    this.debugLog(`Toggled to ${this._value}`);
  }

  /**
   * Confirm and save
   */
  confirm(): void {
    if (this._onConfirm) {
      this._onConfirm(this._value);
    }
    this._isVisible = false;
    this.debugLog(`Confirmed: ${this._value}`);
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

    // Toggle with left/right arrows
    if (key === 'LEFT' || key === 'RIGHT') {
      this.toggle();
      return true;
    }

    // Confirm with Enter
    if (key === 'ENTER') {
      this.confirm();
      return true;
    }

    // Cancel with Escape
    if (key === 'ESCAPE') {
      this.cancel();
      return true;
    }

    // Also support 'o' for on, 'f' for off (quick toggle)
    if (key === 'o' || key === 'O' || key === '1') {
      this._value = true;
      return true;
    }
    if (key === 'f' || key === 'F' || key === '0') {
      this._value = false;
      return true;
    }

    return true; // Consume all keys while dialog is open
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

      // Check if clicking on toggle area
      const { relX, relY } = this.getRelativeCoords(event.x, event.y);
      if (relY === 4) {
        // Toggle row - check if clicking on On or Off
        const onX = Math.floor(this._rect.width / 2) - 8;
        const offX = Math.floor(this._rect.width / 2) + 2;

        if (relX >= onX && relX < onX + 6) {
          this._value = true;
          return true;
        }
        if (relX >= offX && relX < offX + 6) {
          this._value = false;
          return true;
        }
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

    // Title
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

    // Toggle display (line 4)
    const toggleY = this._rect.y + 4;
    const centerX = this._rect.x + Math.floor(this._rect.width / 2);

    // "On" option
    const onX = centerX - 8;
    const onSelected = this._value;
    const onBg = onSelected ? colors.selectedBackground : colors.background;
    const onFg = onSelected ? colors.successForeground : colors.hintForeground;
    ctx.fill(onX, toggleY, 6, 1, ' ', undefined, onBg);
    ctx.drawStyled(onX + 1, toggleY, ' On ', onFg, onBg);

    // Separator
    ctx.drawStyled(centerX - 1, toggleY, '/', colors.hintForeground, colors.background);

    // "Off" option
    const offX = centerX + 2;
    const offSelected = !this._value;
    const offBg = offSelected ? colors.selectedBackground : colors.background;
    const offFg = offSelected ? colors.foreground : colors.hintForeground;
    ctx.fill(offX, toggleY, 6, 1, ' ', undefined, offBg);
    ctx.drawStyled(offX + 1, toggleY, 'Off ', offFg, offBg);

    // Hint (line 6)
    const hintY = this._rect.y + 6;
    const hint = '←/→ toggle  Enter confirm  Esc cancel';
    const hintX = this._rect.x + Math.floor((this._rect.width - hint.length) / 2);
    ctx.drawStyled(hintX, hintY, hint, colors.hintForeground, colors.background);
  }
}

export const booleanToggleDialog = new BooleanToggleDialog();
export default booleanToggleDialog;
