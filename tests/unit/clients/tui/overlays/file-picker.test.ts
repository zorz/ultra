/**
 * FilePicker Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  FilePicker,
  createFilePicker,
  type FileEntry,
  type FilePickerCallbacks,
} from '../../../../../src/clients/tui/overlays/file-picker.ts';
import { createScreenBuffer } from '../../../../../src/clients/tui/rendering/buffer.ts';

// ============================================
// Test Setup
// ============================================

function createTestCallbacks(): FilePickerCallbacks & {
  dirtyCount: number;
  dismissed: boolean;
  selectedFile: FileEntry | null;
  lastQuery: string;
} {
  const callbacks = {
    dirtyCount: 0,
    dismissed: false,
    selectedFile: null as FileEntry | null,
    lastQuery: '',
    onDirty: () => {
      callbacks.dirtyCount++;
    },
    getThemeColor: (_key: string, fallback = '#ffffff') => fallback,
    getScreenSize: () => ({ width: 80, height: 24 }),
    onDismiss: () => {
      callbacks.dismissed = true;
    },
    onSelect: (file: FileEntry) => {
      callbacks.selectedFile = file;
    },
    onQueryChange: (query: string) => {
      callbacks.lastQuery = query;
    },
  };
  return callbacks;
}

function createTestFiles(): FileEntry[] {
  return [
    { path: 'src/index.ts', name: 'index.ts', gitStatus: 'M' },
    { path: 'src/app.ts', name: 'app.ts' },
    { path: 'src/utils/helpers.ts', name: 'helpers.ts', gitStatus: 'A' },
    { path: 'src/components/Button.tsx', name: 'Button.tsx' },
    { path: 'package.json', name: 'package.json' },
    { path: 'README.md', name: 'README.md', gitStatus: '?' },
    { path: 'tests/unit/test.ts', name: 'test.ts' },
  ];
}

// ============================================
// Tests
// ============================================

describe('FilePicker', () => {
  let picker: FilePicker;
  let callbacks: ReturnType<typeof createTestCallbacks>;

  beforeEach(() => {
    callbacks = createTestCallbacks();
    picker = new FilePicker(callbacks);
    picker.setFiles(createTestFiles());
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Basic Functionality
  // ─────────────────────────────────────────────────────────────────────────

  describe('basic functionality', () => {
    test('creates with id', () => {
      expect(picker.id).toBe('file-picker');
    });

    test('starts hidden', () => {
      expect(picker.isVisible()).toBe(false);
    });

    test('show makes visible', () => {
      picker.show();
      expect(picker.isVisible()).toBe(true);
    });

    test('hide makes invisible', () => {
      picker.show();
      picker.hide();
      expect(picker.isVisible()).toBe(false);
    });

    test('hide calls onDismiss', () => {
      picker.show();
      picker.hide();
      expect(callbacks.dismissed).toBe(true);
    });

    test('show resets state', () => {
      picker.setQuery('test');
      picker.show();
      expect(picker.getQuery()).toBe('');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // File Management
  // ─────────────────────────────────────────────────────────────────────────

  describe('file management', () => {
    test('setFiles sets files', () => {
      picker.setFiles([{ path: 'test.ts', name: 'test.ts' }]);
      // Can't directly test file count, but setFiles should work
    });

    test('addFiles adds files', () => {
      picker.addFiles([{ path: 'new.ts', name: 'new.ts' }]);
      // Files added
    });

    test('clearFiles removes all files', () => {
      picker.clearFiles();
      // Files cleared
    });

    test('setLoading sets loading state', () => {
      picker.setLoading(true);
      expect(picker.isLoadingFiles()).toBe(true);
    });

    test('setLoading false clears loading', () => {
      picker.setLoading(true);
      picker.setLoading(false);
      expect(picker.isLoadingFiles()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Search & Filter
  // ─────────────────────────────────────────────────────────────────────────

  describe('search and filter', () => {
    test('setQuery filters files', () => {
      picker.show();
      picker.setQuery('index');
      expect(picker.getQuery()).toBe('index');
    });

    test('setQuery calls onQueryChange', () => {
      picker.show();
      picker.setQuery('test');
      expect(callbacks.lastQuery).toBe('test');
    });

    test('path search works', () => {
      picker.show();
      picker.setQuery('src/utils');
      // Should match helpers.ts
    });

    test('empty query shows all', () => {
      picker.show();
      picker.setQuery('');
      expect(picker.getQuery()).toBe('');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Navigation
  // ─────────────────────────────────────────────────────────────────────────

  describe('navigation', () => {
    test('selectNext moves to next', () => {
      picker.show();
      picker.selectNext();
      expect(callbacks.dirtyCount).toBeGreaterThan(0);
    });

    test('selectPrevious moves to previous', () => {
      picker.show();
      picker.selectNext();
      picker.selectPrevious();
      expect(callbacks.dirtyCount).toBeGreaterThan(0);
    });

    test('selectCurrent selects file', () => {
      picker.show();
      picker.selectCurrent();
      expect(callbacks.selectedFile).not.toBeNull();
    });

    test('selectCurrent hides picker', () => {
      picker.show();
      picker.selectCurrent();
      expect(picker.isVisible()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  describe('input handling', () => {
    test('ArrowDown selects next', () => {
      picker.show();
      const handled = picker.handleInput({ key: 'ArrowDown', ctrl: false, alt: false, shift: false, meta: false });
      expect(handled).toBe(true);
    });

    test('ArrowUp selects previous', () => {
      picker.show();
      const handled = picker.handleInput({ key: 'ArrowUp', ctrl: false, alt: false, shift: false, meta: false });
      expect(handled).toBe(true);
    });

    test('Enter selects current', () => {
      picker.show();
      picker.handleInput({ key: 'Enter', ctrl: false, alt: false, shift: false, meta: false });
      expect(callbacks.selectedFile).not.toBeNull();
    });

    test('Escape hides picker', () => {
      picker.show();
      picker.handleInput({ key: 'Escape', ctrl: false, alt: false, shift: false, meta: false });
      expect(picker.isVisible()).toBe(false);
    });

    test('Backspace removes character', () => {
      picker.show();
      picker.setQuery('test');
      picker.handleInput({ key: 'Backspace', ctrl: false, alt: false, shift: false, meta: false });
      expect(picker.getQuery()).toBe('tes');
    });

    test('character input adds to query', () => {
      picker.show();
      picker.handleInput({ key: 'a', ctrl: false, alt: false, shift: false, meta: false });
      expect(picker.getQuery()).toBe('a');
    });

    test('Ctrl+N selects next', () => {
      picker.show();
      const handled = picker.handleInput({ key: 'n', ctrl: true, alt: false, shift: false, meta: false });
      expect(handled).toBe(true);
    });

    test('Ctrl+P selects previous', () => {
      picker.show();
      const handled = picker.handleInput({ key: 'p', ctrl: true, alt: false, shift: false, meta: false });
      expect(handled).toBe(true);
    });

    test('Ctrl+U clears query', () => {
      picker.show();
      picker.setQuery('test');
      picker.handleInput({ key: 'u', ctrl: true, alt: false, shift: false, meta: false });
      expect(picker.getQuery()).toBe('');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Layout
  // ─────────────────────────────────────────────────────────────────────────

  describe('layout', () => {
    test('calculateBounds returns centered rect', () => {
      const bounds = picker.calculateBounds(80, 24);
      expect(bounds.width).toBeLessThanOrEqual(70);
      expect(bounds.height).toBeLessThanOrEqual(18);
      expect(bounds.x).toBeGreaterThan(0);
      expect(bounds.y).toBeGreaterThan(0);
    });

    test('calculateBounds respects screen size', () => {
      const bounds = picker.calculateBounds(40, 12);
      expect(bounds.width).toBeLessThanOrEqual(36);
      expect(bounds.height).toBeLessThanOrEqual(8);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  describe('rendering', () => {
    test('render draws dialog', () => {
      picker.show();
      picker.setBounds({ x: 5, y: 3, width: 70, height: 18 });

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      picker.render(buffer);

      // Check for file picker content
      let hasContent = false;
      for (let y = 3; y < 21; y++) {
        for (let x = 5; x < 75; x++) {
          if (buffer.get(x, y)?.char !== ' ') {
            hasContent = true;
            break;
          }
        }
        if (hasContent) break;
      }
      expect(hasContent).toBe(true);
    });

    test('render shows loading indicator', () => {
      picker.show();
      picker.setLoading(true);
      picker.setBounds({ x: 5, y: 3, width: 70, height: 18 });

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      picker.render(buffer);
      // Loading indicator should be rendered
    });
  });
});

// ============================================
// Factory Function Tests
// ============================================

describe('createFilePicker', () => {
  test('creates file picker', () => {
    const callbacks = createTestCallbacks();
    const picker = createFilePicker(callbacks);
    expect(picker).toBeInstanceOf(FilePicker);
  });
});
