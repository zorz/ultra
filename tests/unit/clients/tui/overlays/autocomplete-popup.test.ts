/**
 * AutocompletePopup Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  AutocompletePopup,
  createAutocompletePopup,
} from '../../../../../src/clients/tui/overlays/autocomplete-popup.ts';
import type { OverlayManagerCallbacks } from '../../../../../src/clients/tui/overlays/overlay-manager.ts';
import type { LSPCompletionItem } from '../../../../../src/services/lsp/types.ts';
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

function createTestCompletions(): LSPCompletionItem[] {
  return [
    { label: 'console', kind: 6, detail: 'Console object', insertText: 'console' },
    { label: 'log', kind: 3, detail: 'Log to console', insertText: 'log' },
    { label: 'error', kind: 3, detail: 'Log error', insertText: 'error' },
    { label: 'warn', kind: 3, detail: 'Log warning', insertText: 'warn' },
    { label: 'info', kind: 3, detail: 'Log info', insertText: 'info' },
  ];
}

// ============================================
// Tests
// ============================================

describe('AutocompletePopup', () => {
  let popup: AutocompletePopup;
  let callbacks: ReturnType<typeof createTestCallbacks>;

  beforeEach(() => {
    callbacks = createTestCallbacks();
    popup = createAutocompletePopup('autocomplete-test', callbacks);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Basic Functionality
  // ─────────────────────────────────────────────────────────────────────────

  describe('Initialization', () => {
    test('creates popup with correct id', () => {
      expect(popup.id).toBe('autocomplete-test');
    });

    test('is initially hidden', () => {
      expect(popup.isVisible()).toBe(false);
    });

    test('has correct zIndex', () => {
      expect(popup.zIndex).toBe(300);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Showing Completions
  // ─────────────────────────────────────────────────────────────────────────

  describe('showCompletions', () => {
    test('shows popup with completions', () => {
      popup.showCompletions(createTestCompletions(), 10, 5);
      expect(popup.isVisible()).toBe(true);
    });

    test('hides popup when empty completions', () => {
      popup.showCompletions(createTestCompletions(), 10, 5);
      expect(popup.isVisible()).toBe(true);

      popup.showCompletions([], 10, 5);
      expect(popup.isVisible()).toBe(false);
    });

    test('marks dirty when showing', () => {
      const initialCount = callbacks.dirtyCount;
      popup.showCompletions(createTestCompletions(), 10, 5);
      expect(callbacks.dirtyCount).toBeGreaterThan(initialCount);
    });

    test('sets bounds based on position', () => {
      popup.showCompletions(createTestCompletions(), 20, 10);
      const bounds = popup.getBounds();
      expect(bounds.x).toBe(20);
      // Y position may be offset to show below cursor
      expect(bounds.y).toBeGreaterThanOrEqual(10);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Selection
  // ─────────────────────────────────────────────────────────────────────────

  describe('Selection Navigation', () => {
    beforeEach(() => {
      popup.showCompletions(createTestCompletions(), 10, 5);
    });

    test('starts with first item selected', () => {
      const selected = popup.getSelectedItem();
      expect(selected?.label).toBe('console');
    });

    test('ArrowDown moves to next item', () => {
      popup.handleInput({ key: 'ArrowDown', ctrl: false, alt: false, shift: false, meta: false });
      const selected = popup.getSelectedItem();
      expect(selected?.label).toBe('log');
    });

    test('ArrowUp moves to previous item', () => {
      popup.handleInput({ key: 'ArrowDown', ctrl: false, alt: false, shift: false, meta: false });
      popup.handleInput({ key: 'ArrowDown', ctrl: false, alt: false, shift: false, meta: false });
      popup.handleInput({ key: 'ArrowUp', ctrl: false, alt: false, shift: false, meta: false });
      const selected = popup.getSelectedItem();
      expect(selected?.label).toBe('log');
    });

    test('ArrowDown stops at last item', () => {
      // Move down through all 5 items
      for (let i = 0; i < 10; i++) {
        popup.handleInput({ key: 'ArrowDown', ctrl: false, alt: false, shift: false, meta: false });
      }
      const selected = popup.getSelectedItem();
      // Should stop at last item
      expect(selected?.label).toBe('info');
    });

    test('ArrowUp stops at first item', () => {
      popup.handleInput({ key: 'ArrowUp', ctrl: false, alt: false, shift: false, meta: false });
      const selected = popup.getSelectedItem();
      // Should stay at first item
      expect(selected?.label).toBe('console');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Filtering
  // ─────────────────────────────────────────────────────────────────────────

  describe('Prefix Filtering', () => {
    beforeEach(() => {
      popup.showCompletions(createTestCompletions(), 10, 5);
    });

    test('updatePrefix filters items', () => {
      popup.updatePrefix('lo');
      const selected = popup.getSelectedItem();
      expect(selected?.label).toBe('log');
    });

    test('updatePrefix is case-insensitive', () => {
      popup.updatePrefix('LOG');
      const selected = popup.getSelectedItem();
      expect(selected?.label).toBe('log');
    });

    test('updatePrefix hides popup when no matches', () => {
      popup.updatePrefix('xyz');
      expect(popup.isVisible()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Accept/Hide
  // ─────────────────────────────────────────────────────────────────────────

  describe('Accept and Hide', () => {
    let selectedItem: LSPCompletionItem | null = null;

    beforeEach(() => {
      selectedItem = null;
      popup.onSelect((item) => {
        selectedItem = item;
      });
      popup.showCompletions(createTestCompletions(), 10, 5);
    });

    test('acceptSelected calls onSelect callback', () => {
      popup.acceptSelected();
      expect(selectedItem?.label).toBe('console');
    });

    test('acceptSelected hides popup', () => {
      popup.acceptSelected();
      expect(popup.isVisible()).toBe(false);
    });

    test('hide hides popup', () => {
      popup.hide();
      expect(popup.isVisible()).toBe(false);
    });

    test('hide marks dirty', () => {
      const countBeforeHide = callbacks.dirtyCount;
      popup.hide();
      expect(callbacks.dirtyCount).toBeGreaterThan(countBeforeHide);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  describe('Input Handling', () => {
    beforeEach(() => {
      popup.showCompletions(createTestCompletions(), 10, 5);
    });

    test('Escape key hides popup', () => {
      const result = popup.handleInput({ key: 'Escape', ctrl: false, alt: false, shift: false, meta: false });
      expect(result).toBe(true);
      expect(popup.isVisible()).toBe(false);
    });

    test('Enter accepts selected', () => {
      let accepted = false;
      popup.onSelect(() => { accepted = true; });
      popup.handleInput({ key: 'Enter', ctrl: false, alt: false, shift: false, meta: false });
      expect(accepted).toBe(true);
    });

    test('Tab accepts selected', () => {
      let accepted = false;
      popup.onSelect(() => { accepted = true; });
      popup.handleInput({ key: 'Tab', ctrl: false, alt: false, shift: false, meta: false });
      expect(accepted).toBe(true);
    });

    test('returns false for unhandled keys', () => {
      const result = popup.handleInput({ key: 'a', ctrl: false, alt: false, shift: false, meta: false });
      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  describe('Rendering', () => {
    test('renders visible popup without error', () => {
      popup.showCompletions(createTestCompletions(), 5, 5);
      // Set reasonable bounds for the popup
      popup.setBounds({ x: 5, y: 5, width: 30, height: 10 });
      const buffer = createScreenBuffer({ width: 80, height: 24 });
      expect(() => popup.render(buffer)).not.toThrow();
    });

    test('does not render when hidden', () => {
      const buffer = createScreenBuffer({ width: 80, height: 24 });
      // Rendering when hidden should be a no-op
      expect(() => popup.render(buffer)).not.toThrow();
    });
  });
});

describe('createAutocompletePopup', () => {
  test('returns AutocompletePopup instance', () => {
    const callbacks = createTestCallbacks();
    const popup = createAutocompletePopup('test', callbacks);
    expect(popup).toBeInstanceOf(AutocompletePopup);
  });
});
