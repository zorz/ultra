/**
 * SignatureHelp Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  SignatureHelpOverlay,
  createSignatureHelp,
  type SignatureDisplayMode,
} from '../../../../../src/clients/tui/overlays/signature-help.ts';
import type { OverlayManagerCallbacks } from '../../../../../src/clients/tui/overlays/overlay-manager.ts';
import type { LSPSignatureHelp } from '../../../../../src/services/lsp/types.ts';
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

function createTestSignatureHelp(): LSPSignatureHelp {
  return {
    signatures: [
      {
        label: 'console.log(message?: any, ...optionalParams: any[]): void',
        documentation: 'Prints to stdout with newline.',
        parameters: [
          { label: 'message?: any', documentation: 'The message to log' },
          { label: '...optionalParams: any[]', documentation: 'Additional parameters' },
        ],
      },
    ],
    activeSignature: 0,
    activeParameter: 0,
  };
}

function createMultipleSignatures(): LSPSignatureHelp {
  return {
    signatures: [
      {
        label: 'foo(a: string): void',
        parameters: [{ label: 'a: string' }],
      },
      {
        label: 'foo(a: string, b: number): void',
        parameters: [{ label: 'a: string' }, { label: 'b: number' }],
      },
      {
        label: 'foo(a: string, b: number, c: boolean): void',
        parameters: [{ label: 'a: string' }, { label: 'b: number' }, { label: 'c: boolean' }],
      },
    ],
    activeSignature: 0,
    activeParameter: 0,
  };
}

// ============================================
// Tests
// ============================================

describe('SignatureHelpOverlay', () => {
  let overlay: SignatureHelpOverlay;
  let callbacks: ReturnType<typeof createTestCallbacks>;

  beforeEach(() => {
    callbacks = createTestCallbacks();
    overlay = createSignatureHelp('signature-test', callbacks);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Basic Functionality
  // ─────────────────────────────────────────────────────────────────────────

  describe('Initialization', () => {
    test('creates overlay with correct id', () => {
      expect(overlay.id).toBe('signature-test');
    });

    test('is initially hidden', () => {
      expect(overlay.isVisible()).toBe(false);
    });

    test('has correct zIndex', () => {
      expect(overlay.zIndex).toBe(275);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Showing Signature Help
  // ─────────────────────────────────────────────────────────────────────────

  describe('showSignatureHelp', () => {
    test('shows overlay with signature help', () => {
      overlay.showSignatureHelp(createTestSignatureHelp(), 10, 5);
      expect(overlay.isVisible()).toBe(true);
    });

    test('hides when no signatures', () => {
      overlay.showSignatureHelp({ signatures: [], activeSignature: 0, activeParameter: 0 }, 10, 5);
      expect(overlay.isVisible()).toBe(false);
    });

    test('marks dirty when showing', () => {
      const initialCount = callbacks.dirtyCount;
      overlay.showSignatureHelp(createTestSignatureHelp(), 10, 5);
      expect(callbacks.dirtyCount).toBeGreaterThan(initialCount);
    });

    test('sets bounds based on position', () => {
      overlay.showSignatureHelp(createTestSignatureHelp(), 20, 10);
      const bounds = overlay.getBounds();
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Display Modes
  // ─────────────────────────────────────────────────────────────────────────

  describe('Display Modes', () => {
    test('setDisplayMode changes mode', () => {
      overlay.setDisplayMode('statusBar');
      // Mode is internal, but we can test that it doesn't throw
      expect(() => overlay.showSignatureHelp(createTestSignatureHelp(), 10, 5)).not.toThrow();
    });

    test('statusBar mode does not make overlay visible', () => {
      overlay.setDisplayMode('statusBar');
      overlay.showSignatureHelp(createTestSignatureHelp(), 10, 5);
      expect(overlay.isVisible()).toBe(false);
    });

    test('popup mode makes overlay visible', () => {
      overlay.setDisplayMode('popup');
      overlay.showSignatureHelp(createTestSignatureHelp(), 10, 5);
      expect(overlay.isVisible()).toBe(true);
    });

    test('onStatusBarUpdate callback is called for statusBar mode', () => {
      let statusBarText = '';
      overlay.onStatusBarUpdate((text) => {
        statusBarText = text;
      });
      overlay.setDisplayMode('statusBar');
      overlay.showSignatureHelp(createTestSignatureHelp(), 10, 5);
      expect(statusBarText.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Signature Navigation
  // ─────────────────────────────────────────────────────────────────────────

  describe('Signature Navigation', () => {
    beforeEach(() => {
      overlay.showSignatureHelp(createMultipleSignatures(), 10, 5);
    });

    test('getActiveSignatureIndex returns current index', () => {
      expect(overlay.getActiveSignatureIndex()).toBe(0);
    });

    test('nextSignature moves to next signature', () => {
      overlay.nextSignature();
      expect(overlay.getActiveSignatureIndex()).toBe(1);
    });

    test('prevSignature moves to previous signature', () => {
      overlay.nextSignature();
      overlay.nextSignature();
      overlay.prevSignature();
      expect(overlay.getActiveSignatureIndex()).toBe(1);
    });

    test('nextSignature wraps around', () => {
      overlay.nextSignature();
      overlay.nextSignature();
      overlay.nextSignature();
      expect(overlay.getActiveSignatureIndex()).toBe(0);
    });

    test('prevSignature wraps around', () => {
      overlay.prevSignature();
      expect(overlay.getActiveSignatureIndex()).toBe(2);
    });

    test('navigation does nothing with single signature', () => {
      overlay.showSignatureHelp(createTestSignatureHelp(), 10, 5);
      overlay.nextSignature();
      expect(overlay.getActiveSignatureIndex()).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Hide
  // ─────────────────────────────────────────────────────────────────────────

  describe('Hide', () => {
    test('hide hides overlay', () => {
      overlay.showSignatureHelp(createTestSignatureHelp(), 10, 5);
      overlay.hide();
      expect(overlay.isVisible()).toBe(false);
    });

    test('hide marks dirty', () => {
      overlay.showSignatureHelp(createTestSignatureHelp(), 10, 5);
      const countBeforeHide = callbacks.dirtyCount;
      overlay.hide();
      expect(callbacks.dirtyCount).toBeGreaterThan(countBeforeHide);
    });

    test('onDismiss hides overlay', () => {
      overlay.showSignatureHelp(createTestSignatureHelp(), 10, 5);
      overlay.onDismiss();
      expect(overlay.isVisible()).toBe(false);
    });

    test('hide clears status bar in statusBar mode', () => {
      let statusBarText = 'initial';
      overlay.onStatusBarUpdate((text) => {
        statusBarText = text;
      });
      overlay.setDisplayMode('statusBar');
      overlay.showSignatureHelp(createTestSignatureHelp(), 10, 5);
      overlay.hide();
      expect(statusBarText).toBe('');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  describe('Input Handling', () => {
    beforeEach(() => {
      overlay.showSignatureHelp(createMultipleSignatures(), 10, 5);
    });

    test('Escape key hides overlay', () => {
      const result = overlay.handleInput({ key: 'Escape', ctrl: false, alt: false, shift: false, meta: false });
      expect(result).toBe(true);
      expect(overlay.isVisible()).toBe(false);
    });

    test('Alt+ArrowUp goes to previous signature', () => {
      overlay.nextSignature(); // Go to 1 first
      const result = overlay.handleInput({ key: 'ArrowUp', ctrl: false, alt: true, shift: false, meta: false });
      expect(result).toBe(true);
      expect(overlay.getActiveSignatureIndex()).toBe(0);
    });

    test('Alt+ArrowDown goes to next signature', () => {
      const result = overlay.handleInput({ key: 'ArrowDown', ctrl: false, alt: true, shift: false, meta: false });
      expect(result).toBe(true);
      expect(overlay.getActiveSignatureIndex()).toBe(1);
    });

    test('other keys pass through', () => {
      const result = overlay.handleInput({ key: 'a', ctrl: false, alt: false, shift: false, meta: false });
      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  describe('Rendering', () => {
    test('renders without error', () => {
      overlay.showSignatureHelp(createTestSignatureHelp(), 10, 5);
      overlay.setBounds({ x: 10, y: 5, width: 60, height: 5 });
      const buffer = createScreenBuffer({ width: 80, height: 24 });
      expect(() => overlay.render(buffer)).not.toThrow();
    });

    test('does not render when hidden', () => {
      const buffer = createScreenBuffer({ width: 80, height: 24 });
      expect(() => overlay.render(buffer)).not.toThrow();
    });

    test('does not render in statusBar mode', () => {
      overlay.setDisplayMode('statusBar');
      overlay.showSignatureHelp(createTestSignatureHelp(), 10, 5);
      const buffer = createScreenBuffer({ width: 80, height: 24 });
      expect(() => overlay.render(buffer)).not.toThrow();
    });

    test('renders multiple signatures with indicator', () => {
      overlay.showSignatureHelp(createMultipleSignatures(), 10, 5);
      overlay.setBounds({ x: 10, y: 5, width: 60, height: 5 });
      const buffer = createScreenBuffer({ width: 80, height: 24 });
      expect(() => overlay.render(buffer)).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Bounds
  // ─────────────────────────────────────────────────────────────────────────

  describe('Bounds', () => {
    test('getBounds returns current bounds', () => {
      overlay.setBounds({ x: 10, y: 5, width: 30, height: 10 });
      const bounds = overlay.getBounds();
      expect(bounds.x).toBe(10);
      expect(bounds.y).toBe(5);
    });

    test('setBounds updates bounds', () => {
      overlay.setBounds({ x: 5, y: 3, width: 40, height: 8 });
      const bounds = overlay.getBounds();
      expect(bounds.x).toBe(5);
      expect(bounds.y).toBe(3);
    });
  });
});

describe('createSignatureHelp', () => {
  test('returns SignatureHelpOverlay instance', () => {
    const callbacks = createTestCallbacks();
    const overlay = createSignatureHelp('test', callbacks);
    expect(overlay).toBeInstanceOf(SignatureHelpOverlay);
  });
});
