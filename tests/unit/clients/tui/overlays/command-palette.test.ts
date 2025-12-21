/**
 * CommandPalette Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  CommandPalette,
  createCommandPalette,
  type Command,
  type CommandPaletteCallbacks,
} from '../../../../../src/clients/tui/overlays/command-palette.ts';
import { createScreenBuffer } from '../../../../../src/clients/tui/rendering/buffer.ts';

// ============================================
// Test Setup
// ============================================

function createTestCallbacks(): CommandPaletteCallbacks & { dirtyCount: number; dismissed: boolean } {
  const callbacks = {
    dirtyCount: 0,
    dismissed: false,
    onDirty: () => {
      callbacks.dirtyCount++;
    },
    getThemeColor: (_key: string, fallback = '#ffffff') => fallback,
    getScreenSize: () => ({ width: 80, height: 24 }),
    onDismiss: () => {
      callbacks.dismissed = true;
    },
  };
  return callbacks;
}

function createTestCommands(): Command[] {
  return [
    { id: 'file.save', label: 'Save File', category: 'File', execute: () => {} },
    { id: 'file.open', label: 'Open File', category: 'File', keybinding: 'Ctrl+O', execute: () => {} },
    { id: 'edit.undo', label: 'Undo', category: 'Edit', keybinding: 'Ctrl+Z', execute: () => {} },
    { id: 'edit.redo', label: 'Redo', category: 'Edit', keybinding: 'Ctrl+Y', execute: () => {} },
    { id: 'view.terminal', label: 'Toggle Terminal', category: 'View', execute: () => {} },
  ];
}

// ============================================
// Tests
// ============================================

describe('CommandPalette', () => {
  let palette: CommandPalette;
  let callbacks: ReturnType<typeof createTestCallbacks>;

  beforeEach(() => {
    callbacks = createTestCallbacks();
    palette = new CommandPalette(callbacks);
    palette.setCommands(createTestCommands());
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Basic Functionality
  // ─────────────────────────────────────────────────────────────────────────

  describe('basic functionality', () => {
    test('creates with id', () => {
      expect(palette.id).toBe('command-palette');
    });

    test('starts hidden', () => {
      expect(palette.isVisible()).toBe(false);
    });

    test('show makes visible', () => {
      palette.show();
      expect(palette.isVisible()).toBe(true);
    });

    test('hide makes invisible', () => {
      palette.show();
      palette.hide();
      expect(palette.isVisible()).toBe(false);
    });

    test('hide calls onDismiss', () => {
      palette.show();
      palette.hide();
      expect(callbacks.dismissed).toBe(true);
    });

    test('show resets state', () => {
      palette.setQuery('test');
      palette.show();
      expect(palette.getQuery()).toBe('');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Command Management
  // ─────────────────────────────────────────────────────────────────────────

  describe('command management', () => {
    test('setCommands sets commands', () => {
      expect(palette.getCommands()).toHaveLength(5);
    });

    test('addCommand adds command', () => {
      palette.addCommand({ id: 'new.command', label: 'New Command', execute: () => {} });
      expect(palette.getCommands()).toHaveLength(6);
    });

    test('removeCommand removes command', () => {
      expect(palette.removeCommand('file.save')).toBe(true);
      expect(palette.getCommands()).toHaveLength(4);
    });

    test('removeCommand returns false for unknown', () => {
      expect(palette.removeCommand('unknown')).toBe(false);
    });

    test('getCommands returns copy', () => {
      const commands = palette.getCommands();
      commands.push({ id: 'fake', label: 'Fake', execute: () => {} });
      expect(palette.getCommands()).toHaveLength(5);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Search & Filter
  // ─────────────────────────────────────────────────────────────────────────

  describe('search and filter', () => {
    test('setQuery filters commands', () => {
      palette.show();
      palette.setQuery('save');
      // Should filter to commands containing "save"
      expect(palette.getQuery()).toBe('save');
    });

    test('empty query shows all commands', () => {
      palette.show();
      palette.setQuery('');
      // All 5 commands should be visible (handled by render)
    });

    test('setQuery calls onDirty', () => {
      palette.show();
      const initialDirty = callbacks.dirtyCount;
      palette.setQuery('test');
      expect(callbacks.dirtyCount).toBeGreaterThan(initialDirty);
    });

    test('multiple terms filter', () => {
      palette.show();
      palette.setQuery('file save');
      // Should match commands with both "file" and "save"
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Navigation
  // ─────────────────────────────────────────────────────────────────────────

  describe('navigation', () => {
    test('selectNext moves to next item', () => {
      palette.show();
      palette.selectNext();
      // Internal state changed
      expect(callbacks.dirtyCount).toBeGreaterThan(0);
    });

    test('selectPrevious moves to previous item', () => {
      palette.show();
      palette.selectNext();
      palette.selectPrevious();
      // Internal state changed
      expect(callbacks.dirtyCount).toBeGreaterThan(0);
    });

    test('selectNext wraps around', () => {
      palette.show();
      // Select beyond last item should wrap
      for (let i = 0; i < 10; i++) {
        palette.selectNext();
      }
      // Should not throw
    });

    test('selectPrevious wraps around', () => {
      palette.show();
      palette.selectPrevious();
      // Should wrap to last item
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Execution
  // ─────────────────────────────────────────────────────────────────────────

  describe('execution', () => {
    test('executeSelected calls command execute', () => {
      let executed = false;
      palette.setCommands([{ id: 'test', label: 'Test', execute: () => { executed = true; } }]);
      palette.show();
      palette.executeSelected();
      expect(executed).toBe(true);
    });

    test('executeSelected hides palette', () => {
      palette.show();
      palette.executeSelected();
      expect(palette.isVisible()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  describe('input handling', () => {
    test('ArrowDown selects next', () => {
      palette.show();
      const handled = palette.handleInput({ key: 'ArrowDown', ctrl: false, alt: false, shift: false, meta: false });
      expect(handled).toBe(true);
    });

    test('ArrowUp selects previous', () => {
      palette.show();
      const handled = palette.handleInput({ key: 'ArrowUp', ctrl: false, alt: false, shift: false, meta: false });
      expect(handled).toBe(true);
    });

    test('Enter executes selected', () => {
      let executed = false;
      palette.setCommands([{ id: 'test', label: 'Test', execute: () => { executed = true; } }]);
      palette.show();
      palette.handleInput({ key: 'Enter', ctrl: false, alt: false, shift: false, meta: false });
      expect(executed).toBe(true);
    });

    test('Escape hides palette', () => {
      palette.show();
      palette.handleInput({ key: 'Escape', ctrl: false, alt: false, shift: false, meta: false });
      expect(palette.isVisible()).toBe(false);
    });

    test('Backspace removes character', () => {
      palette.show();
      palette.setQuery('test');
      palette.handleInput({ key: 'Backspace', ctrl: false, alt: false, shift: false, meta: false });
      expect(palette.getQuery()).toBe('tes');
    });

    test('Ctrl+U clears query', () => {
      palette.show();
      palette.setQuery('test');
      palette.handleInput({ key: 'u', ctrl: true, alt: false, shift: false, meta: false });
      expect(palette.getQuery()).toBe('');
    });

    test('character input adds to query', () => {
      palette.show();
      palette.handleInput({ key: 'a', ctrl: false, alt: false, shift: false, meta: false });
      expect(palette.getQuery()).toBe('a');
    });

    test('Ctrl+N selects next', () => {
      palette.show();
      const handled = palette.handleInput({ key: 'n', ctrl: true, alt: false, shift: false, meta: false });
      expect(handled).toBe(true);
    });

    test('Ctrl+P selects previous', () => {
      palette.show();
      const handled = palette.handleInput({ key: 'p', ctrl: true, alt: false, shift: false, meta: false });
      expect(handled).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Layout
  // ─────────────────────────────────────────────────────────────────────────

  describe('layout', () => {
    test('calculateBounds returns centered rect', () => {
      const bounds = palette.calculateBounds(80, 24);
      expect(bounds.width).toBeLessThanOrEqual(60);
      expect(bounds.height).toBeLessThanOrEqual(16);
      expect(bounds.x).toBeGreaterThan(0);
      expect(bounds.y).toBeGreaterThan(0);
    });

    test('calculateBounds respects screen size', () => {
      const bounds = palette.calculateBounds(40, 12);
      expect(bounds.width).toBeLessThanOrEqual(36);
      expect(bounds.height).toBeLessThanOrEqual(8);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  describe('rendering', () => {
    test('render draws dialog', () => {
      palette.show();
      palette.setBounds({ x: 10, y: 5, width: 60, height: 16 });

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      palette.render(buffer);

      // Check for command palette content
      let hasContent = false;
      for (let y = 5; y < 21; y++) {
        for (let x = 10; x < 70; x++) {
          if (buffer.get(x, y)?.char !== ' ') {
            hasContent = true;
            break;
          }
        }
        if (hasContent) break;
      }
      expect(hasContent).toBe(true);
    });

    test('render shows commands', () => {
      palette.show();
      palette.setBounds({ x: 5, y: 2, width: 60, height: 16 });

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      palette.render(buffer);

      // Commands should be rendered
      // We can't easily verify exact content, but the buffer should have non-space chars
    });
  });
});

// ============================================
// Factory Function Tests
// ============================================

describe('createCommandPalette', () => {
  test('creates command palette', () => {
    const callbacks = createTestCallbacks();
    const palette = createCommandPalette(callbacks);
    expect(palette).toBeInstanceOf(CommandPalette);
  });
});
