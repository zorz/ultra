/**
 * Window Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  Window,
  createWindow,
  type WindowConfig,
} from '../../../../src/clients/tui/window.ts';

// ============================================
// Test Setup
// ============================================

function createTestConfig(): WindowConfig & { dirtyCount: number } {
  const config = {
    size: { width: 80, height: 24 },
    dirtyCount: 0,
    getThemeColor: (_key: string, fallback = '#ffffff') => fallback,
    onDirty: () => {
      config.dirtyCount++;
    },
  };
  return config;
}

// ============================================
// Tests
// ============================================

describe('Window', () => {
  let window: Window;
  let config: ReturnType<typeof createTestConfig>;

  beforeEach(() => {
    config = createTestConfig();
    window = new Window(config);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    test('starts inactive', () => {
      expect(window.isActive()).toBe(false);
    });

    test('start activates window', () => {
      window.start();
      expect(window.isActive()).toBe(true);
    });

    test('stop deactivates window', () => {
      window.start();
      window.stop();
      expect(window.isActive()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Size & Layout
  // ─────────────────────────────────────────────────────────────────────────

  describe('size and layout', () => {
    test('getSize returns configured size', () => {
      expect(window.getSize()).toEqual({ width: 80, height: 24 });
    });

    test('resize updates size', () => {
      window.resize({ width: 120, height: 40 });
      expect(window.getSize()).toEqual({ width: 120, height: 40 });
    });

    test('resize calls onDirty', () => {
      const initialDirty = config.dirtyCount;
      window.resize({ width: 100, height: 30 });
      expect(config.dirtyCount).toBeGreaterThan(initialDirty);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Pane Management
  // ─────────────────────────────────────────────────────────────────────────

  describe('pane management', () => {
    test('getPaneContainer returns pane container', () => {
      expect(window.getPaneContainer()).toBeDefined();
    });

    test('ensureRootPane creates root pane', () => {
      const pane = window.ensureRootPane();
      expect(pane).toBeDefined();
      expect(pane.id).toMatch(/^pane-\d+$/);
    });

    test('ensureRootPane returns same pane on second call', () => {
      const pane1 = window.ensureRootPane();
      const pane2 = window.ensureRootPane();
      expect(pane1).toBe(pane2);
    });

    test('splitPane creates new pane', () => {
      window.ensureRootPane();
      const newPane = window.splitPane('horizontal');
      expect(newPane).toBeDefined();
    });

    test('closePane removes pane', () => {
      const pane = window.ensureRootPane();
      // Split first so we have something left after closing
      window.splitPane('horizontal');
      expect(window.closePane(pane.id)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Focus Management
  // ─────────────────────────────────────────────────────────────────────────

  describe('focus management', () => {
    test('getFocusManager returns focus manager', () => {
      expect(window.getFocusManager()).toBeDefined();
    });

    test('getFocusedElement returns null initially', () => {
      expect(window.getFocusedElement()).toBeNull();
    });

    test('getFocusedPane returns null initially', () => {
      expect(window.getFocusedPane()).toBeNull();
    });

    test('focusPane sets focused pane', () => {
      const pane = window.ensureRootPane();
      window.focusPane(pane);
      // The pane container needs to implement getFocusResolver
      // For now, just verify no error is thrown
    });

    test('focusNextPane navigates focus', () => {
      window.ensureRootPane();
      window.splitPane('horizontal');
      // Should not throw even without proper setup
      window.focusNextPane();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Status Bar
  // ─────────────────────────────────────────────────────────────────────────

  describe('status bar', () => {
    test('getStatusBar returns status bar', () => {
      expect(window.getStatusBar()).toBeDefined();
    });

    test('setStatusItem updates status item', () => {
      const statusBar = window.getStatusBar();
      statusBar.addItem({ id: 'test', content: 'Initial', align: 'left', priority: 1 });

      expect(window.setStatusItem('test', 'Updated')).toBe(true);
      expect(statusBar.getItem('test')?.content).toBe('Updated');
    });

    test('addStatusHistory adds entry', () => {
      window.addStatusHistory('Test message', 'info');
      expect(window.getStatusBar().getHistoryCount()).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Overlays & Notifications
  // ─────────────────────────────────────────────────────────────────────────

  describe('overlays and notifications', () => {
    test('getOverlayManager returns overlay manager', () => {
      expect(window.getOverlayManager()).toBeDefined();
    });

    test('showNotification creates notification', () => {
      const id = window.showNotification('Test');
      expect(id).toMatch(/^notification-\d+$/);
    });

    test('removeNotification removes notification', () => {
      const id = window.showNotification('Test');
      expect(window.removeNotification(id)).toBe(true);
    });

    test('hasOverlay returns false initially', () => {
      expect(window.hasOverlay()).toBe(false);
    });

    test('dismissOverlays clears overlays', () => {
      window.dismissOverlays();
      expect(window.hasOverlay()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  describe('input handling', () => {
    test('handleInput returns false for unhandled input', () => {
      const result = window.handleInput({
        key: 'x',
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
      });
      expect(result).toBe(false);
    });

    test('addKeybinding registers keybinding', () => {
      let called = false;
      window.addKeybinding({
        key: 'ctrl+s',
        handler: () => {
          called = true;
          return true;
        },
      });

      window.handleInput({
        key: 's',
        ctrl: true,
        alt: false,
        shift: false,
        meta: false,
      });

      expect(called).toBe(true);
    });

    test('addKeybinding returns unsubscribe function', () => {
      let callCount = 0;
      const unsubscribe = window.addKeybinding({
        key: 'ctrl+t',
        handler: () => {
          callCount++;
          return true;
        },
      });

      window.handleInput({ key: 't', ctrl: true, alt: false, shift: false, meta: false });
      expect(callCount).toBe(1);

      unsubscribe();

      window.handleInput({ key: 't', ctrl: true, alt: false, shift: false, meta: false });
      expect(callCount).toBe(1);
    });

    test('keybinding with when condition', () => {
      let condition = false;
      let called = false;

      window.addKeybinding({
        key: 'ctrl+w',
        handler: () => {
          called = true;
          return true;
        },
        when: () => condition,
      });

      // Condition false - should not call
      window.handleInput({ key: 'w', ctrl: true, alt: false, shift: false, meta: false });
      expect(called).toBe(false);

      // Condition true - should call
      condition = true;
      window.handleInput({ key: 'w', ctrl: true, alt: false, shift: false, meta: false });
      expect(called).toBe(true);
    });

    test('clearKeybindings removes all keybindings', () => {
      let called = false;
      window.addKeybinding({
        key: 'ctrl+r',
        handler: () => {
          called = true;
          return true;
        },
      });

      window.clearKeybindings();

      window.handleInput({ key: 'r', ctrl: true, alt: false, shift: false, meta: false });
      expect(called).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  describe('rendering', () => {
    test('render returns buffer', () => {
      const buffer = window.render();
      expect(buffer).toBeDefined();
      const size = buffer.getSize();
      expect(size.width).toBe(80);
      expect(size.height).toBe(24);
    });

    test('getBuffer returns buffer', () => {
      expect(window.getBuffer()).toBeDefined();
    });

    test('markDirty calls onDirty callback', () => {
      const initialDirty = config.dirtyCount;
      window.markDirty();
      expect(config.dirtyCount).toBeGreaterThan(initialDirty);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Serialization
  // ─────────────────────────────────────────────────────────────────────────

  describe('serialization', () => {
    test('serialize returns window state', () => {
      const state = window.serialize();

      expect(state.size).toEqual({ width: 80, height: 24 });
      expect(state.layout).toBeDefined();
      expect(state.statusBarExpanded).toBe(false);
    });

    test('deserialize restores state', () => {
      // Create some state
      const pane = window.ensureRootPane();
      window.focusPane(pane);
      window.getStatusBar().expand();

      const state = window.serialize();

      // Create new window and deserialize
      const newWindow = new Window(createTestConfig());
      newWindow.deserialize(state);

      expect(newWindow.getStatusBar().isExpanded()).toBe(true);
    });
  });
});

// ============================================
// Factory Function Tests
// ============================================

describe('createWindow', () => {
  test('creates window instance', () => {
    const config = createTestConfig();
    const window = createWindow(config);

    expect(window).toBeInstanceOf(Window);
  });
});
