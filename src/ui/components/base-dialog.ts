/**
 * BaseDialog - Abstract base class for all dialog components
 *
 * Provides:
 * - Consistent visibility management (show/hide/isOpen)
 * - Standard positioning with Rect
 * - MouseHandler implementation
 * - Callback management with cleanup
 * - Common rendering utilities
 * - Keyboard event handling structure
 */

import type { RenderContext } from '../renderer.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import type { KeyEvent } from '../../terminal/input.ts';
import type { Rect } from '../layout.ts';
import type { DialogConfig, BorderStyle, DialogColors } from '../types.ts';
import { DEFAULT_DIALOG_COLORS } from '../types.ts';
import { RenderUtils } from '../render-utils.ts';
import { themeLoader } from '../themes/theme-loader.ts';
import { debugLog } from '../../debug.ts';

/**
 * Base configuration that all dialogs share
 */
export interface BaseDialogConfig extends DialogConfig {
  title?: string;
  width?: number;
  height?: number;
}

/**
 * Abstract base class for dialog components
 *
 * All dialog components should extend this class to ensure
 * consistent API and behavior across the application.
 */
export abstract class BaseDialog implements MouseHandler {
  // === State ===
  protected _isVisible: boolean = false;
  protected _rect: Rect = { x: 0, y: 0, width: 60, height: 20 };
  protected _title: string = '';
  protected _borderStyle: BorderStyle = 'rounded';

  // === Colors (lazy-loaded from theme) ===
  protected _colors: DialogColors | null = null;

  // === Callbacks ===
  protected _closeCallbacks: Set<() => void> = new Set();

  // === Debug ===
  protected _debugName: string = 'BaseDialog';

  constructor() {
    // Subclasses should set _debugName in their constructor
  }

  // === Lifecycle ===

  /**
   * Check if dialog is currently open/visible
   */
  isOpen(): boolean {
    return this._isVisible;
  }

  /**
   * Hide the dialog and trigger close callbacks
   */
  hide(): void {
    if (!this._isVisible) return;

    this._isVisible = false;
    this.debugLog('Hidden');

    // Trigger close callbacks
    for (const callback of this._closeCallbacks) {
      try {
        callback();
      } catch (e) {
        this.debugLog(`Close callback error: ${e}`);
      }
    }
  }

  /**
   * Base show method - subclasses should call this and then set their specific state
   */
  protected showBase(config: BaseDialogConfig): void {
    this._isVisible = true;
    this._title = config.title || '';

    // Calculate centered position
    const width = config.width || 60;
    const height = config.height || 20;
    this._rect = RenderUtils.centerRect(
      width,
      height,
      config.screenWidth,
      config.screenHeight,
      config.editorX,
      config.editorWidth
    );

    // Reset colors to pick up theme changes
    this._colors = null;

    this.debugLog(`Shown at (${this._rect.x}, ${this._rect.y}) ${this._rect.width}x${this._rect.height}`);
  }

  // === Positioning ===

  /**
   * Get current rectangle bounds
   */
  getRect(): Rect {
    return { ...this._rect };
  }

  /**
   * Set rectangle bounds
   */
  setRect(rect: Rect): void {
    this._rect = { ...rect };
  }

  /**
   * Set dialog position
   */
  setPosition(x: number, y: number): void {
    this._rect.x = x;
    this._rect.y = y;
  }

  /**
   * Set dialog size
   */
  setSize(width: number, height: number): void {
    this._rect.width = width;
    this._rect.height = height;
  }

  // === Colors ===

  /**
   * Get dialog colors, loading from theme if needed
   */
  protected getColors(): DialogColors {
    if (!this._colors) {
      this.debugLog('Colors not cached, loading from theme...');
      this._colors = this.loadColorsFromTheme();
      this.debugLog(`Loaded colors: bg=${this._colors.background}`);
    }
    return this._colors;
  }

  /**
   * Load colors from the current theme
   */
  protected loadColorsFromTheme(): DialogColors {
    // Use editor.background for dialog background (matches main editor color)
    const dialogBg = themeLoader.getColor('editor.background') || DEFAULT_DIALOG_COLORS.background;
    const dialogFg = themeLoader.getColor('editor.foreground') || DEFAULT_DIALOG_COLORS.foreground;

    // Debug logging for troubleshooting
    this.debugLog(`Loading colors: bg=${dialogBg} (from editor.background=${themeLoader.getColor('editor.background')}), fg=${dialogFg}`);

    return {
      background: dialogBg,
      foreground: dialogFg,
      border: themeLoader.getColor('editor.lineHighlightBackground') || themeLoader.getColor('tab.border') || DEFAULT_DIALOG_COLORS.border,
      titleForeground: dialogFg,
      titleBackground: dialogBg,
      inputBackground: themeLoader.getColor('input.background') || DEFAULT_DIALOG_COLORS.inputBackground,
      inputForeground: themeLoader.getColor('input.foreground') || DEFAULT_DIALOG_COLORS.inputForeground,
      inputBorder: themeLoader.getColor('input.border') || DEFAULT_DIALOG_COLORS.inputBorder,
      inputFocusBorder: themeLoader.getColor('focusBorder') || DEFAULT_DIALOG_COLORS.inputFocusBorder,
      selectedBackground: themeLoader.getColor('list.activeSelectionBackground') || DEFAULT_DIALOG_COLORS.selectedBackground,
      selectedForeground: themeLoader.getColor('list.activeSelectionForeground') || DEFAULT_DIALOG_COLORS.selectedForeground,
      hintForeground: themeLoader.getColor('editorLineNumber.foreground') || DEFAULT_DIALOG_COLORS.hintForeground,
      successForeground: themeLoader.getColor('editorGutter.addedBackground') || DEFAULT_DIALOG_COLORS.successForeground,
      errorForeground: themeLoader.getColor('editorGutter.deletedBackground') || DEFAULT_DIALOG_COLORS.errorForeground
    };
  }

  // === Callbacks ===

  /**
   * Register a close callback
   * @returns Cleanup function to unregister
   */
  onClose(callback: () => void): () => void {
    this._closeCallbacks.add(callback);
    return () => {
      this._closeCallbacks.delete(callback);
    };
  }

  /**
   * Clear all close callbacks
   */
  protected clearCloseCallbacks(): void {
    this._closeCallbacks.clear();
  }

  // === Rendering ===

  /**
   * Main render method - must be implemented by subclasses
   */
  abstract render(ctx: RenderContext): void;

  /**
   * Render the dialog background and border
   */
  protected renderBackground(ctx: RenderContext): void {
    const colors = this.getColors();
    RenderUtils.drawBox(ctx, this._rect, colors.background, colors.border, this._borderStyle);
  }

  /**
   * Render the dialog title
   */
  protected renderTitle(ctx: RenderContext, title?: string): void {
    const displayTitle = title || this._title;
    if (!displayTitle) return;

    const colors = this.getColors();
    const paddedTitle = ` ${displayTitle} `;
    const titleX = this._rect.x + Math.floor((this._rect.width - paddedTitle.length) / 2);

    ctx.drawStyled(titleX, this._rect.y, paddedTitle, colors.titleForeground, colors.background);
  }

  /**
   * Render a horizontal separator line
   */
  protected renderSeparator(ctx: RenderContext, yOffset: number): void {
    const colors = this.getColors();
    RenderUtils.drawSeparator(
      ctx,
      this._rect.x + 1,
      this._rect.y + yOffset,
      this._rect.width - 2,
      colors.border,
      colors.background
    );
  }

  /**
   * Get the content area rect (inside border)
   */
  protected getContentRect(): Rect {
    return RenderUtils.insetRect(this._rect, 1, 1, 1, 1);
  }

  // === Mouse Handling ===

  /**
   * Check if a point is within the dialog bounds
   */
  containsPoint(x: number, y: number): boolean {
    if (!this._isVisible) return false;
    return RenderUtils.containsPoint(this._rect, x, y);
  }

  /**
   * Handle mouse events - must be implemented by subclasses
   * @returns true if the event was handled
   */
  abstract onMouseEvent(event: MouseEvent): boolean;

  /**
   * Base mouse handling - close on click outside
   * Subclasses should call this via super.onMouseEvent() if they want this behavior
   */
  protected handleBaseMouseEvent(event: MouseEvent): boolean {
    if (!this._isVisible) return false;

    // Click outside to close (optional behavior)
    if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED') {
      if (!this.containsPoint(event.x, event.y)) {
        // Don't close by default - let subclasses decide
        return false;
      }
    }

    // Consume events within dialog bounds
    return this.containsPoint(event.x, event.y);
  }

  // === Keyboard Handling ===

  /**
   * Handle keyboard events - subclasses should override
   * @returns true if the event was handled
   */
  handleKey(event: KeyEvent): boolean {
    if (!this._isVisible) return false;

    // Escape to close
    if (event.key === 'ESCAPE') {
      this.hide();
      return true;
    }

    return false;
  }

  // === Debug ===

  /**
   * Log debug message with component prefix
   */
  protected debugLog(msg: string): void {
    debugLog(`[${this._debugName}] ${msg}`);
  }

  // === Utility ===

  /**
   * Get display width available for content (accounting for border)
   */
  protected getContentWidth(): number {
    return this._rect.width - 2;
  }

  /**
   * Get display height available for content (accounting for border)
   */
  protected getContentHeight(): number {
    return this._rect.height - 2;
  }

  /**
   * Calculate relative coordinates within dialog
   */
  protected getRelativeCoords(x: number, y: number): { relX: number; relY: number } {
    return {
      relX: x - this._rect.x,
      relY: y - this._rect.y
    };
  }
}

export default BaseDialog;
