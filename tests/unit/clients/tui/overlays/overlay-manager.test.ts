/**
 * OverlayManager Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  OverlayManager,
  BaseDialog,
  createOverlayManager,
  type OverlayManagerCallbacks,
  type Overlay,
} from '../../../../../src/clients/tui/overlays/overlay-manager.ts';
import { createScreenBuffer } from '../../../../../src/clients/tui/rendering/buffer.ts';
import type { InputEvent, Rect } from '../../../../../src/clients/tui/types.ts';
import type { ScreenBuffer } from '../../../../../src/clients/tui/rendering/buffer.ts';

// ============================================
// Test Setup
// ============================================

function createTestCallbacks(): OverlayManagerCallbacks & { dirtyCount: number } {
  const callbacks = {
    dirtyCount: 0,
    onDirty: () => {
      callbacks.dirtyCount++;
    },
    getThemeColor: (_key: string, fallback = '#ffffff') => fallback,
    getScreenSize: () => ({ width: 80, height: 24 }),
  };
  return callbacks;
}

class TestOverlay implements Overlay {
  readonly id: string;
  zIndex: number;
  private visible = false;
  private bounds: Rect = { x: 0, y: 0, width: 20, height: 10 };
  dismissCalled = false;
  inputHandled = false;

  constructor(id: string, zIndex = 100) {
    this.id = id;
    this.zIndex = zIndex;
  }

  isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }

  setBounds(bounds: Rect): void {
    this.bounds = { ...bounds };
  }

  getBounds(): Rect {
    return { ...this.bounds };
  }

  render(buffer: ScreenBuffer): void {
    // Simple render - just fill bounds
    for (let y = this.bounds.y; y < this.bounds.y + this.bounds.height; y++) {
      for (let x = this.bounds.x; x < this.bounds.x + this.bounds.width; x++) {
        buffer.set(x, y, { char: 'X', fg: '#fff', bg: '#000' });
      }
    }
  }

  handleInput(_event: InputEvent): boolean {
    this.inputHandled = true;
    return true;
  }

  onDismiss(): void {
    this.dismissCalled = true;
  }
}

// ============================================
// Tests
// ============================================

describe('OverlayManager', () => {
  let manager: OverlayManager;
  let callbacks: ReturnType<typeof createTestCallbacks>;

  beforeEach(() => {
    callbacks = createTestCallbacks();
    manager = new OverlayManager(callbacks);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Overlay Management
  // ─────────────────────────────────────────────────────────────────────────

  describe('overlay management', () => {
    test('addOverlay adds overlay', () => {
      const overlay = new TestOverlay('test');
      manager.addOverlay(overlay);

      expect(manager.getOverlay('test')).toBe(overlay);
      expect(manager.hasOverlays()).toBe(true);
    });

    test('addOverlay calls onDirty', () => {
      manager.addOverlay(new TestOverlay('test'));
      expect(callbacks.dirtyCount).toBe(1);
    });

    test('addOverlay inserts in z-order', () => {
      const low = new TestOverlay('low', 50);
      const mid = new TestOverlay('mid', 100);
      const high = new TestOverlay('high', 150);

      manager.addOverlay(mid);
      manager.addOverlay(high);
      manager.addOverlay(low);

      // High should be on top (last when iterating from bottom)
      high.show();
      expect(manager.getTopOverlay()).toBe(high);
    });

    test('removeOverlay removes overlay', () => {
      const overlay = new TestOverlay('test');
      manager.addOverlay(overlay);

      expect(manager.removeOverlay('test')).toBe(true);
      expect(manager.getOverlay('test')).toBeNull();
    });

    test('removeOverlay returns false for unknown overlay', () => {
      expect(manager.removeOverlay('unknown')).toBe(false);
    });

    test('removeOverlay calls onDismiss', () => {
      const overlay = new TestOverlay('test');
      manager.addOverlay(overlay);

      manager.removeOverlay('test');
      expect(overlay.dismissCalled).toBe(true);
    });

    test('getOverlay returns null for unknown overlay', () => {
      expect(manager.getOverlay('unknown')).toBeNull();
    });

    test('hasOverlays returns false when empty', () => {
      expect(manager.hasOverlays()).toBe(false);
    });

    test('hasVisibleOverlays returns false when none visible', () => {
      manager.addOverlay(new TestOverlay('test'));
      expect(manager.hasVisibleOverlays()).toBe(false);
    });

    test('hasVisibleOverlays returns true when visible', () => {
      const overlay = new TestOverlay('test');
      overlay.show();
      manager.addOverlay(overlay);

      expect(manager.hasVisibleOverlays()).toBe(true);
    });

    test('getTopOverlay returns topmost visible overlay', () => {
      const low = new TestOverlay('low', 50);
      const high = new TestOverlay('high', 150);

      low.show();
      high.show();

      manager.addOverlay(low);
      manager.addOverlay(high);

      expect(manager.getTopOverlay()).toBe(high);
    });

    test('getTopOverlay returns null when none visible', () => {
      manager.addOverlay(new TestOverlay('test'));
      expect(manager.getTopOverlay()).toBeNull();
    });

    test('dismissTop hides topmost overlay', () => {
      const overlay = new TestOverlay('test');
      overlay.show();
      manager.addOverlay(overlay);

      expect(manager.dismissTop()).toBe(true);
      expect(overlay.isVisible()).toBe(false);
      expect(overlay.dismissCalled).toBe(true);
    });

    test('dismissTop returns false when none visible', () => {
      manager.addOverlay(new TestOverlay('test'));
      expect(manager.dismissTop()).toBe(false);
    });

    test('dismissAll hides all overlays', () => {
      const a = new TestOverlay('a');
      const b = new TestOverlay('b');
      a.show();
      b.show();
      manager.addOverlay(a);
      manager.addOverlay(b);

      manager.dismissAll();

      expect(a.isVisible()).toBe(false);
      expect(b.isVisible()).toBe(false);
      expect(a.dismissCalled).toBe(true);
      expect(b.dismissCalled).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Notifications
  // ─────────────────────────────────────────────────────────────────────────

  describe('notifications', () => {
    test('showNotification creates notification', () => {
      const id = manager.showNotification('Test message');
      expect(id).toMatch(/^notification-\d+$/);
      expect(manager.getNotifications()).toHaveLength(1);
    });

    test('showNotification with type', () => {
      manager.showNotification('Error!', 'error');
      const notifications = manager.getNotifications();
      expect(notifications[0].type).toBe('error');
    });

    test('showNotification with custom duration', () => {
      manager.showNotification('Quick!', 'info', 100);
      const notifications = manager.getNotifications();
      expect(notifications[0].duration).toBe(100);
    });

    test('showNotification trims to max', () => {
      for (let i = 0; i < 10; i++) {
        manager.showNotification(`Message ${i}`);
      }
      expect(manager.getNotifications().length).toBeLessThanOrEqual(5);
    });

    test('removeNotification removes notification', () => {
      const id = manager.showNotification('Test');
      expect(manager.removeNotification(id)).toBe(true);
      expect(manager.getNotifications()).toHaveLength(0);
    });

    test('removeNotification returns false for unknown', () => {
      expect(manager.removeNotification('unknown')).toBe(false);
    });

    test('clearNotifications removes all', () => {
      manager.showNotification('A');
      manager.showNotification('B');
      manager.clearNotifications();
      expect(manager.getNotifications()).toHaveLength(0);
    });

    test('getNotifications returns copy', () => {
      manager.showNotification('Test');
      const notifications = manager.getNotifications();
      notifications.push({ id: 'fake', message: 'Fake', type: 'info', duration: 1000, createdAt: Date.now() });
      expect(manager.getNotifications()).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  describe('input handling', () => {
    test('handleInput routes to visible overlays', () => {
      const overlay = new TestOverlay('test');
      overlay.show();
      manager.addOverlay(overlay);

      const handled = manager.handleInput({ key: 'a', ctrl: false, alt: false, shift: false, meta: false });

      expect(handled).toBe(true);
      expect(overlay.inputHandled).toBe(true);
    });

    test('handleInput skips hidden overlays', () => {
      const overlay = new TestOverlay('test');
      manager.addOverlay(overlay);

      const handled = manager.handleInput({ key: 'a', ctrl: false, alt: false, shift: false, meta: false });

      expect(handled).toBe(false);
      expect(overlay.inputHandled).toBe(false);
    });

    test('handleInput routes to topmost overlay first', () => {
      const low = new TestOverlay('low', 50);
      const high = new TestOverlay('high', 150);
      low.show();
      high.show();
      manager.addOverlay(low);
      manager.addOverlay(high);

      manager.handleInput({ key: 'a', ctrl: false, alt: false, shift: false, meta: false });

      expect(high.inputHandled).toBe(true);
      expect(low.inputHandled).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  describe('rendering', () => {
    test('render renders visible overlays', () => {
      const overlay = new TestOverlay('test');
      overlay.show();
      overlay.setBounds({ x: 5, y: 5, width: 10, height: 5 });
      manager.addOverlay(overlay);

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      manager.render(buffer);

      // Check that overlay rendered something
      expect(buffer.get(5, 5)?.char).toBe('X');
    });

    test('render skips hidden overlays', () => {
      const overlay = new TestOverlay('test');
      overlay.setBounds({ x: 5, y: 5, width: 10, height: 5 });
      manager.addOverlay(overlay);

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      manager.render(buffer);

      // Should still be empty (space)
      expect(buffer.get(5, 5)?.char).toBe(' ');
    });

    test('render renders notifications', () => {
      manager.showNotification('Test notification');

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      manager.render(buffer);

      // Notification should appear somewhere in the buffer
      let foundNotification = false;
      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 80; x++) {
          if (buffer.get(x, y)?.char === 'T') {
            foundNotification = true;
            break;
          }
        }
        if (foundNotification) break;
      }
      expect(foundNotification).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Utility
  // ─────────────────────────────────────────────────────────────────────────

  describe('utility', () => {
    test('centerRect centers on screen', () => {
      const rect = manager.centerRect(20, 10);

      expect(rect.width).toBe(20);
      expect(rect.height).toBe(10);
      expect(rect.x).toBe(30); // (80 - 20) / 2
      expect(rect.y).toBe(7); // (24 - 10) / 2
    });
  });
});

// ============================================
// BaseDialog Tests
// ============================================

describe('BaseDialog', () => {
  class TestDialog extends BaseDialog {
    renderCalled = false;
    lastEvent: InputEvent | null = null;

    render(buffer: ScreenBuffer): void {
      this.renderCalled = true;
      this.drawDialogBox(buffer, 'Test Dialog');
    }

    handleInput(event: InputEvent): boolean {
      this.lastEvent = event;
      return true;
    }
  }

  test('creates dialog with id', () => {
    const callbacks = createTestCallbacks();
    const dialog = new TestDialog('test-dialog', callbacks);

    expect(dialog.id).toBe('test-dialog');
    expect(dialog.zIndex).toBe(100);
  });

  test('show sets visible', () => {
    const callbacks = createTestCallbacks();
    const dialog = new TestDialog('test', callbacks);

    dialog.show();
    expect(dialog.isVisible()).toBe(true);
    expect(callbacks.dirtyCount).toBe(1);
  });

  test('hide clears visible', () => {
    const callbacks = createTestCallbacks();
    const dialog = new TestDialog('test', callbacks);

    dialog.show();
    dialog.hide();
    expect(dialog.isVisible()).toBe(false);
  });

  test('setBounds updates bounds', () => {
    const callbacks = createTestCallbacks();
    const dialog = new TestDialog('test', callbacks);

    dialog.setBounds({ x: 10, y: 5, width: 30, height: 15 });
    expect(dialog.getBounds()).toEqual({ x: 10, y: 5, width: 30, height: 15 });
  });

  test('render draws dialog box', () => {
    const callbacks = createTestCallbacks();
    const dialog = new TestDialog('test', callbacks);
    dialog.setBounds({ x: 5, y: 5, width: 30, height: 10 });
    dialog.show();

    const buffer = createScreenBuffer({ width: 80, height: 24 });
    dialog.render(buffer);

    expect(dialog.renderCalled).toBe(true);
  });

  test('handleInput receives events', () => {
    const callbacks = createTestCallbacks();
    const dialog = new TestDialog('test', callbacks);

    const event = { key: 'Enter', ctrl: false, alt: false, shift: false, meta: false };
    dialog.handleInput(event);

    expect(dialog.lastEvent).toEqual(event);
  });
});

// ============================================
// Factory Function Tests
// ============================================

describe('createOverlayManager', () => {
  test('creates overlay manager', () => {
    const callbacks = createTestCallbacks();
    const manager = createOverlayManager(callbacks);

    expect(manager).toBeInstanceOf(OverlayManager);
  });
});
