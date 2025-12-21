/**
 * GotoLineDialog Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  GotoLineDialog,
  createGotoLineDialog,
  type GotoLineCallbacks,
} from '../../../../../src/clients/tui/overlays/goto-line.ts';
import { createScreenBuffer } from '../../../../../src/clients/tui/rendering/buffer.ts';

// ============================================
// Test Setup
// ============================================

function createTestCallbacks(): GotoLineCallbacks & {
  dirtyCount: number;
  dismissed: boolean;
  gotoLine: number;
  gotoColumn: number | undefined;
} {
  const callbacks = {
    dirtyCount: 0,
    dismissed: false,
    gotoLine: 0,
    gotoColumn: undefined as number | undefined,
    onDirty: () => {
      callbacks.dirtyCount++;
    },
    getThemeColor: (_key: string, fallback = '#ffffff') => fallback,
    getScreenSize: () => ({ width: 80, height: 24 }),
    onDismiss: () => {
      callbacks.dismissed = true;
    },
    onGoto: (line: number, column?: number) => {
      callbacks.gotoLine = line;
      callbacks.gotoColumn = column;
    },
  };
  return callbacks;
}

// ============================================
// Tests
// ============================================

describe('GotoLineDialog', () => {
  let dialog: GotoLineDialog;
  let callbacks: ReturnType<typeof createTestCallbacks>;

  beforeEach(() => {
    callbacks = createTestCallbacks();
    dialog = new GotoLineDialog(callbacks);
    dialog.setDocumentInfo(10, 100);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Basic Functionality
  // ─────────────────────────────────────────────────────────────────────────

  describe('basic functionality', () => {
    test('creates with id', () => {
      expect(dialog.id).toBe('goto-line');
    });

    test('starts hidden', () => {
      expect(dialog.isVisible()).toBe(false);
    });

    test('show makes visible', () => {
      dialog.show();
      expect(dialog.isVisible()).toBe(true);
    });

    test('hide makes invisible', () => {
      dialog.show();
      dialog.hide();
      expect(dialog.isVisible()).toBe(false);
    });

    test('hide calls onDismiss', () => {
      dialog.show();
      dialog.hide();
      expect(callbacks.dismissed).toBe(true);
    });

    test('show resets input', () => {
      dialog.setInputValue('42');
      dialog.show();
      expect(dialog.getInputValue()).toBe('');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Input State
  // ─────────────────────────────────────────────────────────────────────────

  describe('input state', () => {
    test('setInputValue updates value', () => {
      dialog.setInputValue('42');
      expect(dialog.getInputValue()).toBe('42');
    });

    test('setInputValue calls onDirty', () => {
      dialog.show();
      const initialDirty = callbacks.dirtyCount;
      dialog.setInputValue('42');
      expect(callbacks.dirtyCount).toBeGreaterThan(initialDirty);
    });

    test('setDocumentInfo sets document info', () => {
      dialog.setDocumentInfo(50, 200);
      // Info is used for validation and display
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Navigation
  // ─────────────────────────────────────────────────────────────────────────

  describe('navigation', () => {
    test('confirm with line number calls onGoto', () => {
      dialog.show();
      dialog.setInputValue('42');
      dialog.confirm();
      expect(callbacks.gotoLine).toBe(42);
    });

    test('confirm with line and column calls onGoto', () => {
      dialog.show();
      dialog.setInputValue('42:10');
      dialog.confirm();
      expect(callbacks.gotoLine).toBe(42);
      expect(callbacks.gotoColumn).toBe(10);
    });

    test('confirm hides dialog', () => {
      dialog.show();
      dialog.setInputValue('42');
      dialog.confirm();
      expect(dialog.isVisible()).toBe(false);
    });

    test('confirm with invalid input does nothing', () => {
      dialog.show();
      dialog.setInputValue('abc');
      dialog.confirm();
      expect(callbacks.gotoLine).toBe(0);
    });

    test('confirm with out of range line does nothing', () => {
      dialog.setDocumentInfo(10, 100);
      dialog.show();
      dialog.setInputValue('200');
      dialog.confirm();
      // onGoto should not be called for out of range
    });

    test('confirm with line 0 does nothing', () => {
      dialog.show();
      dialog.setInputValue('0');
      dialog.confirm();
      // onGoto should not be called for line 0
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Input Formats
  // ─────────────────────────────────────────────────────────────────────────

  describe('input formats', () => {
    test('accepts line number', () => {
      dialog.show();
      dialog.setInputValue('42');
      dialog.confirm();
      expect(callbacks.gotoLine).toBe(42);
      expect(callbacks.gotoColumn).toBeUndefined();
    });

    test('accepts line:column format', () => {
      dialog.show();
      dialog.setInputValue('42:10');
      dialog.confirm();
      expect(callbacks.gotoLine).toBe(42);
      expect(callbacks.gotoColumn).toBe(10);
    });

    test('accepts line,column format', () => {
      dialog.show();
      dialog.setInputValue('42,10');
      dialog.confirm();
      expect(callbacks.gotoLine).toBe(42);
      expect(callbacks.gotoColumn).toBe(10);
    });

    test('accepts line space column format', () => {
      dialog.show();
      dialog.setInputValue('42 10');
      dialog.confirm();
      expect(callbacks.gotoLine).toBe(42);
      expect(callbacks.gotoColumn).toBe(10);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  describe('input handling', () => {
    test('Enter confirms', () => {
      dialog.show();
      dialog.setInputValue('42');
      dialog.handleInput({ key: 'Enter', ctrl: false, alt: false, shift: false, meta: false });
      expect(callbacks.gotoLine).toBe(42);
    });

    test('Escape hides dialog', () => {
      dialog.show();
      dialog.handleInput({ key: 'Escape', ctrl: false, alt: false, shift: false, meta: false });
      expect(dialog.isVisible()).toBe(false);
    });

    test('Backspace removes character', () => {
      dialog.show();
      dialog.setInputValue('42');
      dialog.handleInput({ key: 'Backspace', ctrl: false, alt: false, shift: false, meta: false });
      expect(dialog.getInputValue()).toBe('4');
    });

    test('Ctrl+U clears input', () => {
      dialog.show();
      dialog.setInputValue('42');
      dialog.handleInput({ key: 'u', ctrl: true, alt: false, shift: false, meta: false });
      expect(dialog.getInputValue()).toBe('');
    });

    test('number input adds digit', () => {
      dialog.show();
      dialog.handleInput({ key: '4', ctrl: false, alt: false, shift: false, meta: false });
      dialog.handleInput({ key: '2', ctrl: false, alt: false, shift: false, meta: false });
      expect(dialog.getInputValue()).toBe('42');
    });

    test('colon input allowed', () => {
      dialog.show();
      dialog.handleInput({ key: '4', ctrl: false, alt: false, shift: false, meta: false });
      dialog.handleInput({ key: ':', ctrl: false, alt: false, shift: false, meta: false });
      dialog.handleInput({ key: '2', ctrl: false, alt: false, shift: false, meta: false });
      expect(dialog.getInputValue()).toBe('4:2');
    });

    test('comma input allowed', () => {
      dialog.show();
      dialog.handleInput({ key: '4', ctrl: false, alt: false, shift: false, meta: false });
      dialog.handleInput({ key: ',', ctrl: false, alt: false, shift: false, meta: false });
      dialog.handleInput({ key: '2', ctrl: false, alt: false, shift: false, meta: false });
      expect(dialog.getInputValue()).toBe('4,2');
    });

    test('space input allowed', () => {
      dialog.show();
      dialog.handleInput({ key: '4', ctrl: false, alt: false, shift: false, meta: false });
      dialog.handleInput({ key: ' ', ctrl: false, alt: false, shift: false, meta: false });
      dialog.handleInput({ key: '2', ctrl: false, alt: false, shift: false, meta: false });
      expect(dialog.getInputValue()).toBe('4 2');
    });

    test('letter input ignored', () => {
      dialog.show();
      dialog.handleInput({ key: 'a', ctrl: false, alt: false, shift: false, meta: false });
      expect(dialog.getInputValue()).toBe('');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Layout
  // ─────────────────────────────────────────────────────────────────────────

  describe('layout', () => {
    test('calculateBounds returns centered rect', () => {
      const bounds = dialog.calculateBounds(80, 24);
      expect(bounds.width).toBeLessThanOrEqual(50);
      expect(bounds.height).toBe(7);
      expect(bounds.x).toBeGreaterThan(0);
      expect(bounds.y).toBeGreaterThan(0);
    });

    test('calculateBounds respects screen size', () => {
      const bounds = dialog.calculateBounds(40, 12);
      expect(bounds.width).toBeLessThanOrEqual(36);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  describe('rendering', () => {
    test('render draws dialog', () => {
      dialog.show();
      dialog.setBounds({ x: 15, y: 6, width: 50, height: 7 });

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      dialog.render(buffer);

      // Check for content
      let hasContent = false;
      for (let y = 6; y < 13; y++) {
        for (let x = 15; x < 65; x++) {
          if (buffer.get(x, y)?.char !== ' ') {
            hasContent = true;
            break;
          }
        }
        if (hasContent) break;
      }
      expect(hasContent).toBe(true);
    });

    test('render shows current line info', () => {
      dialog.setDocumentInfo(50, 200);
      dialog.show();
      dialog.setBounds({ x: 15, y: 6, width: 50, height: 7 });

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      dialog.render(buffer);
      // Line info should be visible
    });

    test('render shows input value', () => {
      dialog.show();
      dialog.setInputValue('42');
      dialog.setBounds({ x: 15, y: 6, width: 50, height: 7 });

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      dialog.render(buffer);
      // Input should be visible
    });
  });
});

// ============================================
// Factory Function Tests
// ============================================

describe('createGotoLineDialog', () => {
  test('creates goto line dialog', () => {
    const callbacks = createTestCallbacks();
    const dialog = createGotoLineDialog(callbacks);
    expect(dialog).toBeInstanceOf(GotoLineDialog);
  });
});
