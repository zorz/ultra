/**
 * Overlay Manager
 *
 * Manages z-ordered overlay components like dialogs, command palette, and notifications.
 */

import type { Rect, Size, KeyEvent, MouseEvent, InputEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';

// ============================================
// Types
// ============================================

/**
 * Base interface for overlay components.
 */
export interface Overlay {
  /** Unique overlay ID */
  readonly id: string;
  /** Z-index for stacking order */
  zIndex: number;
  /** Whether overlay is visible */
  isVisible(): boolean;
  /** Show the overlay */
  show(): void;
  /** Hide the overlay */
  hide(): void;
  /** Set bounds for the overlay */
  setBounds(bounds: Rect): void;
  /** Get bounds */
  getBounds(): Rect;
  /** Render to buffer */
  render(buffer: ScreenBuffer): void;
  /** Handle input, return true if consumed */
  handleInput(event: InputEvent): boolean;
  /** Called when overlay is dismissed */
  onDismiss?(): void;
}

/**
 * Callbacks for overlay manager events.
 */
export interface OverlayManagerCallbacks {
  /** Called when overlays change (need re-render) */
  onDirty: () => void;
  /** Get a theme color */
  getThemeColor: (key: string, fallback?: string) => string;
  /** Get screen size */
  getScreenSize: () => Size;
}

/**
 * Notification type.
 */
export type NotificationType = 'info' | 'warning' | 'error' | 'success';

/**
 * A toast notification.
 */
export interface Notification {
  id: string;
  message: string;
  type: NotificationType;
  duration: number;
  createdAt: number;
}

// ============================================
// Overlay Manager
// ============================================

export class OverlayManager {
  /** Active overlays in z-order */
  private overlays: Overlay[] = [];

  /** Active notifications */
  private notifications: Notification[] = [];

  /** Callbacks */
  private callbacks: OverlayManagerCallbacks;

  /** Notification ID counter */
  private notificationIdCounter = 0;

  /** Default notification duration (ms) */
  private static readonly DEFAULT_NOTIFICATION_DURATION = 3000;

  /** Max visible notifications */
  private static readonly MAX_NOTIFICATIONS = 5;

  /** Notification height */
  private static readonly NOTIFICATION_HEIGHT = 1;

  constructor(callbacks: OverlayManagerCallbacks) {
    this.callbacks = callbacks;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Overlay Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Add an overlay.
   */
  addOverlay(overlay: Overlay): void {
    // Insert in z-order
    const insertIdx = this.overlays.findIndex((o) => o.zIndex > overlay.zIndex);
    if (insertIdx === -1) {
      this.overlays.push(overlay);
    } else {
      this.overlays.splice(insertIdx, 0, overlay);
    }
    this.callbacks.onDirty();
  }

  /**
   * Remove an overlay.
   */
  removeOverlay(id: string): boolean {
    const idx = this.overlays.findIndex((o) => o.id === id);
    if (idx === -1) return false;

    const overlay = this.overlays[idx];
    this.overlays.splice(idx, 1);
    overlay.onDismiss?.();
    this.callbacks.onDirty();
    return true;
  }

  /**
   * Get an overlay by ID.
   */
  getOverlay(id: string): Overlay | null {
    return this.overlays.find((o) => o.id === id) ?? null;
  }

  /**
   * Check if any overlays are visible.
   */
  hasVisibleOverlays(): boolean {
    return this.overlays.some((o) => o.isVisible());
  }

  /**
   * Check if any overlays exist.
   */
  hasOverlays(): boolean {
    return this.overlays.length > 0;
  }

  /**
   * Get the topmost visible overlay.
   */
  getTopOverlay(): Overlay | null {
    for (let i = this.overlays.length - 1; i >= 0; i--) {
      if (this.overlays[i].isVisible()) {
        return this.overlays[i];
      }
    }
    return null;
  }

  /**
   * Dismiss the topmost overlay.
   */
  dismissTop(): boolean {
    const top = this.getTopOverlay();
    if (top) {
      top.hide();
      top.onDismiss?.();
      this.callbacks.onDirty();
      return true;
    }
    return false;
  }

  /**
   * Dismiss all overlays.
   */
  dismissAll(): void {
    for (const overlay of this.overlays) {
      if (overlay.isVisible()) {
        overlay.hide();
        overlay.onDismiss?.();
      }
    }
    this.callbacks.onDirty();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Notifications
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show a notification.
   */
  showNotification(
    message: string,
    type: NotificationType = 'info',
    duration = OverlayManager.DEFAULT_NOTIFICATION_DURATION
  ): string {
    const id = `notification-${++this.notificationIdCounter}`;

    this.notifications.push({
      id,
      message,
      type,
      duration,
      createdAt: Date.now(),
    });

    // Trim to max
    while (this.notifications.length > OverlayManager.MAX_NOTIFICATIONS) {
      this.notifications.shift();
    }

    // Schedule removal
    setTimeout(() => {
      this.removeNotification(id);
    }, duration);

    this.callbacks.onDirty();
    return id;
  }

  /**
   * Remove a notification.
   */
  removeNotification(id: string): boolean {
    const idx = this.notifications.findIndex((n) => n.id === id);
    if (idx === -1) return false;

    this.notifications.splice(idx, 1);
    this.callbacks.onDirty();
    return true;
  }

  /**
   * Clear all notifications.
   */
  clearNotifications(): void {
    this.notifications = [];
    this.callbacks.onDirty();
  }

  /**
   * Get active notifications.
   */
  getNotifications(): Notification[] {
    return [...this.notifications];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Handle input event.
   * @returns true if handled by an overlay
   */
  handleInput(event: InputEvent): boolean {
    // Check overlays from top to bottom
    for (let i = this.overlays.length - 1; i >= 0; i--) {
      const overlay = this.overlays[i];
      if (overlay.isVisible() && overlay.handleInput(event)) {
        return true;
      }
    }
    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Render all overlays and notifications.
   */
  render(buffer: ScreenBuffer): void {
    // Render overlays in z-order
    for (const overlay of this.overlays) {
      if (overlay.isVisible()) {
        overlay.render(buffer);
      }
    }

    // Render notifications
    this.renderNotifications(buffer);
  }

  private renderNotifications(buffer: ScreenBuffer): void {
    if (this.notifications.length === 0) return;

    const size = this.callbacks.getScreenSize();
    const now = Date.now();

    // Remove expired notifications
    this.notifications = this.notifications.filter(
      (n) => now - n.createdAt < n.duration
    );

    // Render from bottom-right
    const startY = 1; // Below top edge
    const maxWidth = Math.min(60, Math.floor(size.width * 0.6));

    for (let i = 0; i < this.notifications.length; i++) {
      const notification = this.notifications[i];
      const y = startY + i;

      if (y >= size.height - 1) break;

      this.renderNotification(buffer, notification, size.width - maxWidth - 2, y, maxWidth);
    }
  }

  private renderNotification(
    buffer: ScreenBuffer,
    notification: Notification,
    x: number,
    y: number,
    maxWidth: number
  ): void {
    const colors = this.getNotificationColors(notification.type);
    const icon = this.getNotificationIcon(notification.type);

    // Build message
    let content = ` ${icon} ${notification.message} `;
    if (content.length > maxWidth) {
      content = content.slice(0, maxWidth - 1) + '…';
    }

    // Pad to maxWidth
    while (content.length < maxWidth) {
      content += ' ';
    }

    // Render
    for (let i = 0; i < content.length; i++) {
      buffer.set(x + i, y, {
        char: content[i],
        fg: colors.fg,
        bg: colors.bg,
      });
    }
  }

  private getNotificationColors(type: NotificationType): { fg: string; bg: string } {
    const get = (key: string, fallback: string) =>
      this.callbacks.getThemeColor(key, fallback);

    switch (type) {
      case 'error':
        return {
          fg: get('notificationError.foreground', '#ffffff'),
          bg: get('notificationError.background', '#f44336'),
        };
      case 'warning':
        return {
          fg: get('notificationWarning.foreground', '#000000'),
          bg: get('notificationWarning.background', '#ff9800'),
        };
      case 'success':
        return {
          fg: get('notificationSuccess.foreground', '#ffffff'),
          bg: get('notificationSuccess.background', '#4caf50'),
        };
      default:
        return {
          fg: get('notification.foreground', '#ffffff'),
          bg: get('notification.background', '#2196f3'),
        };
    }
  }

  private getNotificationIcon(type: NotificationType): string {
    switch (type) {
      case 'error':
        return '✗';
      case 'warning':
        return '⚠';
      case 'success':
        return '✓';
      default:
        return 'ℹ';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Utility Methods
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Center a rect on screen.
   */
  centerRect(width: number, height: number): Rect {
    const size = this.callbacks.getScreenSize();
    return {
      x: Math.floor((size.width - width) / 2),
      y: Math.floor((size.height - height) / 2),
      width,
      height,
    };
  }
}

// ============================================
// Base Dialog Implementation
// ============================================

/**
 * Base class for dialog overlays.
 */
export abstract class BaseDialog implements Overlay {
  readonly id: string;
  zIndex = 100;

  protected visible = false;
  protected bounds: Rect = { x: 0, y: 0, width: 40, height: 10 };
  protected callbacks: OverlayManagerCallbacks;

  constructor(id: string, callbacks: OverlayManagerCallbacks) {
    this.id = id;
    this.callbacks = callbacks;
  }

  isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.callbacks.onDirty();
  }

  hide(): void {
    this.visible = false;
    this.callbacks.onDirty();
  }

  setBounds(bounds: Rect): void {
    this.bounds = { ...bounds };
  }

  getBounds(): Rect {
    return { ...this.bounds };
  }

  abstract render(buffer: ScreenBuffer): void;
  abstract handleInput(event: InputEvent): boolean;

  onDismiss?(): void;

  /**
   * Draw a dialog box border.
   */
  protected drawDialogBox(
    buffer: ScreenBuffer,
    title?: string
  ): void {
    const { x, y, width, height } = this.bounds;
    const bg = this.callbacks.getThemeColor('panel.background', '#252526');
    const fg = this.callbacks.getThemeColor('panel.foreground', '#cccccc');
    const border = this.callbacks.getThemeColor('panel.border', '#404040');

    // Fill background
    for (let row = y; row < y + height; row++) {
      for (let col = x; col < x + width; col++) {
        buffer.set(col, row, { char: ' ', fg, bg });
      }
    }

    // Draw border
    buffer.drawBox({ x, y, width, height }, border, bg, 'rounded');

    // Draw title if provided
    if (title) {
      const titleText = ` ${title} `;
      const titleX = x + Math.floor((width - titleText.length) / 2);
      buffer.writeString(titleX, y, titleText, fg, bg);
    }
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a new overlay manager.
 */
export function createOverlayManager(callbacks: OverlayManagerCallbacks): OverlayManager {
  return new OverlayManager(callbacks);
}
