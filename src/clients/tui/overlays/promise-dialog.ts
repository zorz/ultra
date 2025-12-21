/**
 * Promise Dialog
 *
 * Extended base dialog with Promise-based result handling.
 * Dialogs resolve when closed via confirm(), cancel(), or dismiss().
 */

import { BaseDialog, type OverlayManagerCallbacks } from './overlay-manager.ts';
import type { InputEvent, KeyEvent, Rect, Size } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';

// ============================================
// Types
// ============================================

/**
 * Result of a dialog operation.
 */
export interface DialogResult<T> {
  /** Whether user confirmed the dialog */
  confirmed: boolean;
  /** The result value (only set if confirmed) */
  value?: T;
  /** Whether dialog was cancelled or dismissed */
  cancelled: boolean;
}

/**
 * Dialog close reason.
 */
export type DialogCloseReason = 'confirm' | 'cancel' | 'dismiss';

/**
 * Configuration for dialogs.
 */
export interface DialogConfig {
  /** Dialog title */
  title?: string;
  /** Preferred width */
  width?: number;
  /** Preferred height */
  height?: number;
  /** Whether dialog is modal (blocks background input) */
  modal?: boolean;
}

// ============================================
// Promise Dialog
// ============================================

/**
 * Base class for Promise-based dialogs.
 *
 * Extends BaseDialog with:
 * - Promise-based lifecycle (resolves on close)
 * - Close reason tracking (confirm/cancel/dismiss)
 * - Result value passing
 * - Auto-centering on screen
 */
export abstract class PromiseDialog<T> extends BaseDialog {
  /** How the dialog was closed */
  protected closeReason: DialogCloseReason = 'cancel';

  /** Result value to return */
  protected resultValue: T | undefined;

  /** Dialog title */
  protected title: string = '';

  /** Promise resolver */
  private resolvePromise: ((result: DialogResult<T>) => void) | null = null;

  constructor(id: string, callbacks: OverlayManagerCallbacks) {
    super(id, callbacks);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Promise API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show dialog and return Promise.
   * Promise resolves when dialog is closed via confirm(), cancel(), or dismiss().
   */
  showAsync(config: DialogConfig = {}): Promise<DialogResult<T>> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.closeReason = 'cancel';
      this.resultValue = undefined;
      this.title = config.title ?? '';

      // Calculate centered bounds
      const screenSize = this.callbacks.getScreenSize();
      const width = config.width ?? 60;
      const height = config.height ?? 20;

      this.setBounds({
        x: Math.floor((screenSize.width - width) / 2),
        y: Math.max(2, Math.floor(screenSize.height / 6)),
        width,
        height,
      });

      // Allow subclass to initialize
      this.onShow(config);

      this.show();
    });
  }

  /**
   * Called when dialog is shown. Override to initialize state.
   */
  protected onShow(_config: DialogConfig): void {
    // Override in subclass
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Close Methods
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Confirm the dialog with a result value.
   */
  confirm(value?: T): void {
    this.closeReason = 'confirm';
    this.resultValue = value;
    this.close();
  }

  /**
   * Cancel the dialog.
   */
  cancel(): void {
    this.closeReason = 'cancel';
    this.close();
  }

  /**
   * Dismiss the dialog (external close).
   */
  dismiss(): void {
    this.closeReason = 'dismiss';
    this.close();
  }

  /**
   * Close and resolve promise.
   */
  private close(): void {
    this.hide();

    if (this.resolvePromise) {
      this.resolvePromise({
        confirmed: this.closeReason === 'confirm',
        value: this.resultValue,
        cancelled: this.closeReason === 'cancel' || this.closeReason === 'dismiss',
      });
      this.resolvePromise = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Handle input. Escape cancels by default.
   */
  handleInput(event: InputEvent): boolean {
    if (!this.visible) return false;

    if ('key' in event) {
      const keyEvent = event as KeyEvent;

      // Escape cancels
      if (keyEvent.key === 'Escape') {
        this.cancel();
        return true;
      }

      // Delegate to subclass
      return this.handleKeyInput(keyEvent);
    }

    // Mouse events - consume if inside bounds
    if ('x' in event && 'y' in event) {
      const { x, y, width, height } = this.bounds;
      const inside =
        event.x >= x && event.x < x + width && event.y >= y && event.y < y + height;

      if (inside) {
        return this.handleMouseInput(event);
      }

      // Click outside - cancel (modal behavior)
      if ('button' in event && event.type === 'press') {
        this.cancel();
        return true;
      }
    }

    return true; // Consume all input when visible (modal)
  }

  /**
   * Handle keyboard input. Override in subclass.
   */
  protected handleKeyInput(_event: KeyEvent): boolean {
    return false;
  }

  /**
   * Handle mouse input. Override in subclass.
   */
  protected handleMouseInput(_event: InputEvent): boolean {
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Render the dialog. Draws box with title, subclass adds content.
   */
  render(buffer: ScreenBuffer): void {
    if (!this.visible) return;

    // Draw dialog box with title
    this.drawDialogBox(buffer, this.title || undefined);

    // Render content
    this.renderContent(buffer);
  }

  /**
   * Render dialog content. Override in subclass.
   */
  protected abstract renderContent(buffer: ScreenBuffer): void;

  // ─────────────────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get content area (inside border).
   */
  protected getContentBounds(): Rect {
    return {
      x: this.bounds.x + 1,
      y: this.bounds.y + 1,
      width: this.bounds.width - 2,
      height: this.bounds.height - 2,
    };
  }
}
