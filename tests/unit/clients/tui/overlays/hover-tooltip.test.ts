/**
 * HoverTooltip Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  HoverTooltip,
  createHoverTooltip,
} from '../../../../../src/clients/tui/overlays/hover-tooltip.ts';
import type { OverlayManagerCallbacks } from '../../../../../src/clients/tui/overlays/overlay-manager.ts';
import type { LSPHover } from '../../../../../src/services/lsp/types.ts';
import { createScreenBuffer } from '../../../../../src/clients/tui/rendering/buffer.ts';

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

function createTestHover(): LSPHover {
  return {
    contents: {
      kind: 'markdown',
      value: '```typescript\nconst foo: string\n```\nA string variable',
    },
  };
}

function createArrayHover(): LSPHover {
  return {
    contents: [
      'First part',
      { kind: 'markdown', value: '```typescript\ntype Foo = string\n```' },
    ],
  };
}

// ============================================
// Tests
// ============================================

describe('HoverTooltip', () => {
  let tooltip: HoverTooltip;
  let callbacks: ReturnType<typeof createTestCallbacks>;

  beforeEach(() => {
    callbacks = createTestCallbacks();
    tooltip = createHoverTooltip('hover-test', callbacks);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Basic Functionality
  // ─────────────────────────────────────────────────────────────────────────

  describe('Initialization', () => {
    test('creates tooltip with correct id', () => {
      expect(tooltip.id).toBe('hover-test');
    });

    test('is initially hidden', () => {
      expect(tooltip.isVisible()).toBe(false);
    });

    test('has correct zIndex', () => {
      expect(tooltip.zIndex).toBe(250);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Showing Hover
  // ─────────────────────────────────────────────────────────────────────────

  describe('showHover', () => {
    test('shows tooltip with hover content', () => {
      tooltip.showHover(createTestHover(), 10, 5);
      expect(tooltip.isVisible()).toBe(true);
    });

    test('parses markdown content', () => {
      // showHover should process the content without error
      expect(() => tooltip.showHover(createTestHover(), 10, 5)).not.toThrow();
    });

    test('handles array contents', () => {
      expect(() => tooltip.showHover(createArrayHover(), 10, 5)).not.toThrow();
      expect(tooltip.isVisible()).toBe(true);
    });

    test('marks dirty when showing', () => {
      const initialCount = callbacks.dirtyCount;
      tooltip.showHover(createTestHover(), 10, 5);
      expect(callbacks.dirtyCount).toBeGreaterThan(initialCount);
    });

    test('sets bounds based on position', () => {
      tooltip.showHover(createTestHover(), 20, 10);
      const bounds = tooltip.getBounds();
      // Position may be adjusted based on content, but should be set
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Show Text
  // ─────────────────────────────────────────────────────────────────────────

  describe('showText', () => {
    test('shows simple text content', () => {
      tooltip.showText('Hello, World!', 10, 5);
      expect(tooltip.isVisible()).toBe(true);
    });

    test('shows even with empty text (wraps to one empty line)', () => {
      // Empty text becomes one empty line, so tooltip still shows
      tooltip.showText('', 10, 5);
      expect(tooltip.isVisible()).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Auto-Hide
  // ─────────────────────────────────────────────────────────────────────────

  describe('Auto-Hide', () => {
    test('startAutoHide sets a timer', () => {
      tooltip.showText('Test', 10, 5);
      expect(() => tooltip.startAutoHide(100)).not.toThrow();
    });

    test('cancelAutoHide cancels the timer', () => {
      tooltip.showText('Test', 10, 5);
      tooltip.startAutoHide(100);
      expect(() => tooltip.cancelAutoHide()).not.toThrow();
      // Tooltip should still be visible since timer was cancelled
      expect(tooltip.isVisible()).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Hide
  // ─────────────────────────────────────────────────────────────────────────

  describe('Hide', () => {
    test('hide hides tooltip', () => {
      tooltip.showText('Test', 10, 5);
      tooltip.hide();
      expect(tooltip.isVisible()).toBe(false);
    });

    test('hide marks dirty', () => {
      tooltip.showText('Test', 10, 5);
      const countBeforeHide = callbacks.dirtyCount;
      tooltip.hide();
      expect(callbacks.dirtyCount).toBeGreaterThan(countBeforeHide);
    });

    test('onDismiss hides tooltip', () => {
      tooltip.showText('Test', 10, 5);
      tooltip.onDismiss();
      expect(tooltip.isVisible()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  describe('Input Handling', () => {
    beforeEach(() => {
      tooltip.showText('Test content', 10, 5);
    });

    test('Escape key hides tooltip', () => {
      const result = tooltip.handleInput({ key: 'Escape', ctrl: false, alt: false, shift: false, meta: false });
      expect(result).toBe(true);
      expect(tooltip.isVisible()).toBe(false);
    });

    test('other keys hide and pass through', () => {
      const result = tooltip.handleInput({ key: 'a', ctrl: false, alt: false, shift: false, meta: false });
      expect(result).toBe(false);
      expect(tooltip.isVisible()).toBe(false);
    });

    test('mouse click outside hides tooltip', () => {
      tooltip.setBounds({ x: 10, y: 5, width: 20, height: 5 });
      const result = tooltip.handleInput({
        type: 'press',
        x: 0,
        y: 0,
        button: 'left',
        shift: false,
        ctrl: false,
        alt: false,
        meta: false,
      });
      expect(result).toBe(false);
      expect(tooltip.isVisible()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  describe('Rendering', () => {
    test('renders without error', () => {
      tooltip.showText('Test content', 10, 5);
      tooltip.setBounds({ x: 10, y: 5, width: 30, height: 5 });
      const buffer = createScreenBuffer({ width: 80, height: 24 });
      expect(() => tooltip.render(buffer)).not.toThrow();
    });

    test('does not render when hidden', () => {
      const buffer = createScreenBuffer({ width: 80, height: 24 });
      expect(() => tooltip.render(buffer)).not.toThrow();
    });

    test('renders markdown hover content', () => {
      tooltip.showHover(createTestHover(), 10, 5);
      tooltip.setBounds({ x: 10, y: 5, width: 40, height: 10 });
      const buffer = createScreenBuffer({ width: 80, height: 24 });
      expect(() => tooltip.render(buffer)).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Bounds
  // ─────────────────────────────────────────────────────────────────────────

  describe('Bounds', () => {
    test('getBounds returns current bounds', () => {
      tooltip.setBounds({ x: 10, y: 5, width: 30, height: 10 });
      const bounds = tooltip.getBounds();
      expect(bounds.x).toBe(10);
      expect(bounds.y).toBe(5);
      expect(bounds.width).toBe(30);
      expect(bounds.height).toBe(10);
    });

    test('setBounds updates bounds', () => {
      tooltip.setBounds({ x: 5, y: 3, width: 40, height: 8 });
      const bounds = tooltip.getBounds();
      expect(bounds.x).toBe(5);
      expect(bounds.y).toBe(3);
    });
  });
});

describe('createHoverTooltip', () => {
  test('returns HoverTooltip instance', () => {
    const callbacks = createTestCallbacks();
    const tooltip = createHoverTooltip('test', callbacks);
    expect(tooltip).toBeInstanceOf(HoverTooltip);
  });
});
