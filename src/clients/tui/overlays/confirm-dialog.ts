/**
 * Confirm Dialog
 *
 * Yes/No confirmation dialog with customizable buttons.
 */

import { PromiseDialog, type DialogConfig, type DialogResult } from './promise-dialog.ts';
import type { OverlayManagerCallbacks } from './overlay-manager.ts';
import type { KeyEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';

// ============================================
// Types
// ============================================

/**
 * Options for confirm dialog.
 */
export interface ConfirmDialogOptions extends DialogConfig {
  /** Message to display */
  message: string;
  /** Confirm button text */
  confirmText?: string;
  /** Cancel button text */
  cancelText?: string;
  /** Whether destructive action (red confirm button) */
  destructive?: boolean;
  /** Default selection (true = confirm, false = cancel) */
  defaultConfirm?: boolean;
}

// ============================================
// Confirm Dialog
// ============================================

export class ConfirmDialog extends PromiseDialog<boolean> {
  /** Message to display */
  private message: string = '';

  /** Confirm button text */
  private confirmText: string = 'Yes';

  /** Cancel button text */
  private cancelText: string = 'No';

  /** Whether destructive action */
  private destructive: boolean = false;

  /** Currently focused button (true = confirm, false = cancel) */
  private focusConfirm: boolean = false;

  constructor(id: string, callbacks: OverlayManagerCallbacks) {
    super(id, callbacks);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the confirm dialog.
   */
  showWithOptions(options: ConfirmDialogOptions): Promise<DialogResult<boolean>> {
    this.message = options.message;
    this.confirmText = options.confirmText ?? 'Yes';
    this.cancelText = options.cancelText ?? 'No';
    this.destructive = options.destructive ?? false;
    this.focusConfirm = options.defaultConfirm ?? false;

    // Calculate height based on message
    const lines = this.message.split('\n').length;
    const height = Math.max(7, lines + 5);

    return this.showAsync({
      title: options.title ?? 'Confirm',
      width: options.width ?? 50,
      height: options.height ?? height,
      ...options,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  protected override handleKeyInput(event: KeyEvent): boolean {
    // Enter - select focused button
    if (event.key === 'Enter') {
      this.confirm(this.focusConfirm);
      return true;
    }

    // Tab / Arrow keys - toggle focus
    if (event.key === 'Tab' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      this.focusConfirm = !this.focusConfirm;
      this.callbacks.onDirty();
      return true;
    }

    // Y key - confirm
    if (event.key === 'y' || event.key === 'Y') {
      this.confirm(true);
      return true;
    }

    // N key - cancel
    if (event.key === 'n' || event.key === 'N') {
      this.confirm(false);
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

    // Message
    const lines = this.message.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const maxWidth = content.width;
      const truncated = line.length > maxWidth ? line.slice(0, maxWidth - 1) + '…' : line;
      buffer.writeString(content.x, content.y + i, truncated, fg, bg);
    }

    // Buttons
    const buttonY = content.y + content.height - 2;
    this.renderButtons(buffer, content.x, buttonY, content.width);
  }

  private renderButtons(buffer: ScreenBuffer, x: number, y: number, width: number): void {
    const bg = this.callbacks.getThemeColor('panel.background', '#252526');
    const buttonBg = this.callbacks.getThemeColor('button.background', '#3c3c3c');
    const buttonFg = this.callbacks.getThemeColor('button.foreground', '#cccccc');
    const focusBg = this.callbacks.getThemeColor('focusBorder', '#007acc');
    const focusFg = '#ffffff';
    const destructiveBg = this.callbacks.getThemeColor('errorForeground', '#f44336');

    // Button dimensions
    const confirmWidth = this.confirmText.length + 4;
    const cancelWidth = this.cancelText.length + 4;
    const totalWidth = confirmWidth + cancelWidth + 4;
    const startX = x + Math.floor((width - totalWidth) / 2);

    // Cancel button (left)
    const cancelBg = this.focusConfirm ? buttonBg : focusBg;
    const cancelFg = this.focusConfirm ? buttonFg : focusFg;
    this.renderButton(buffer, startX, y, this.cancelText, cancelFg, cancelBg);

    // Confirm button (right)
    const confirmBgColor = this.destructive && this.focusConfirm ? destructiveBg : focusBg;
    const confirmBg = this.focusConfirm ? confirmBgColor : buttonBg;
    const confirmFg = this.focusConfirm ? focusFg : buttonFg;
    this.renderButton(buffer, startX + cancelWidth + 4, y, this.confirmText, confirmFg, confirmBg);
  }

  private renderButton(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    text: string,
    fg: string,
    bg: string
  ): void {
    const buttonText = ` ${text} `;
    for (let i = 0; i < buttonText.length; i++) {
      buffer.set(x + i, y, { char: buttonText[i]!, fg, bg });
    }
  }
}
