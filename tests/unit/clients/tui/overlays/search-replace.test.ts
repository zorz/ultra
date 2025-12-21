/**
 * SearchReplaceDialog Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  SearchReplaceDialog,
  createSearchReplaceDialog,
  type SearchReplaceCallbacks,
  type SearchOptions,
} from '../../../../../src/clients/tui/overlays/search-replace.ts';
import { createScreenBuffer } from '../../../../../src/clients/tui/rendering/buffer.ts';

// ============================================
// Test Setup
// ============================================

function createTestCallbacks(): SearchReplaceCallbacks & {
  dirtyCount: number;
  dismissed: boolean;
  searchQuery: string;
  searchOptions: SearchOptions | null;
  findNextCalled: boolean;
  findPrevCalled: boolean;
  replaceText: string;
  replaceAllText: string;
} {
  const callbacks = {
    dirtyCount: 0,
    dismissed: false,
    searchQuery: '',
    searchOptions: null as SearchOptions | null,
    findNextCalled: false,
    findPrevCalled: false,
    replaceText: '',
    replaceAllText: '',
    onDirty: () => {
      callbacks.dirtyCount++;
    },
    getThemeColor: (_key: string, fallback = '#ffffff') => fallback,
    getScreenSize: () => ({ width: 80, height: 24 }),
    onDismiss: () => {
      callbacks.dismissed = true;
    },
    onSearch: (query: string, options: SearchOptions) => {
      callbacks.searchQuery = query;
      callbacks.searchOptions = options;
    },
    onFindNext: () => {
      callbacks.findNextCalled = true;
    },
    onFindPrevious: () => {
      callbacks.findPrevCalled = true;
    },
    onReplace: (replacement: string) => {
      callbacks.replaceText = replacement;
    },
    onReplaceAll: (replacement: string) => {
      callbacks.replaceAllText = replacement;
    },
  };
  return callbacks;
}

// ============================================
// Tests
// ============================================

describe('SearchReplaceDialog', () => {
  let dialog: SearchReplaceDialog;
  let callbacks: ReturnType<typeof createTestCallbacks>;

  beforeEach(() => {
    callbacks = createTestCallbacks();
    dialog = new SearchReplaceDialog(callbacks);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Basic Functionality
  // ─────────────────────────────────────────────────────────────────────────

  describe('basic functionality', () => {
    test('creates with id', () => {
      expect(dialog.id).toBe('search-replace');
    });

    test('starts hidden', () => {
      expect(dialog.isVisible()).toBe(false);
    });

    test('show makes visible', () => {
      dialog.show();
      expect(dialog.isVisible()).toBe(true);
    });

    test('show with replace enables replace mode', () => {
      dialog.show(true);
      expect(dialog.isReplaceEnabled()).toBe(true);
    });

    test('show without replace disables replace mode', () => {
      dialog.show(false);
      expect(dialog.isReplaceEnabled()).toBe(false);
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
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Search State
  // ─────────────────────────────────────────────────────────────────────────

  describe('search state', () => {
    test('setSearchQuery updates query', () => {
      dialog.setSearchQuery('hello');
      expect(dialog.getSearchQuery()).toBe('hello');
    });

    test('setSearchQuery calls onSearch', () => {
      dialog.setSearchQuery('hello');
      expect(callbacks.searchQuery).toBe('hello');
    });

    test('setReplaceText updates replace text', () => {
      dialog.setReplaceText('world');
      expect(dialog.getReplaceText()).toBe('world');
    });

    test('setMatches updates match info', () => {
      dialog.setMatches([{ line: 0, column: 5, length: 5, text: 'hello' }], 0);
      expect(dialog.getMatchCount()).toBe(1);
      expect(dialog.getCurrentMatchIndex()).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Search Options
  // ─────────────────────────────────────────────────────────────────────────

  describe('search options', () => {
    test('getOptions returns default options', () => {
      const options = dialog.getOptions();
      expect(options.caseSensitive).toBe(false);
      expect(options.wholeWord).toBe(false);
      expect(options.useRegex).toBe(false);
      expect(options.inSelection).toBe(false);
    });

    test('setOptions updates options', () => {
      dialog.setOptions({ caseSensitive: true });
      expect(dialog.getOptions().caseSensitive).toBe(true);
    });

    test('setOptions calls onSearch', () => {
      dialog.setSearchQuery('test');
      dialog.setOptions({ caseSensitive: true });
      expect(callbacks.searchOptions?.caseSensitive).toBe(true);
    });

    test('toggleOption toggles option', () => {
      dialog.toggleOption('wholeWord');
      expect(dialog.getOptions().wholeWord).toBe(true);
    });

    test('toggleOption toggles back', () => {
      dialog.toggleOption('wholeWord');
      dialog.toggleOption('wholeWord');
      expect(dialog.getOptions().wholeWord).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Replace Mode
  // ─────────────────────────────────────────────────────────────────────────

  describe('replace mode', () => {
    test('setReplaceMode enables replace', () => {
      dialog.setReplaceMode(true);
      expect(dialog.isReplaceEnabled()).toBe(true);
    });

    test('setReplaceMode disables replace', () => {
      dialog.setReplaceMode(true);
      dialog.setReplaceMode(false);
      expect(dialog.isReplaceEnabled()).toBe(false);
    });

    test('toggleReplaceMode toggles', () => {
      dialog.toggleReplaceMode();
      expect(dialog.isReplaceEnabled()).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────────────────

  describe('actions', () => {
    test('findNext calls callback', () => {
      dialog.findNext();
      expect(callbacks.findNextCalled).toBe(true);
    });

    test('findPrevious calls callback', () => {
      dialog.findPrevious();
      expect(callbacks.findPrevCalled).toBe(true);
    });

    test('replaceCurrent calls callback', () => {
      dialog.setReplaceText('new');
      dialog.replaceCurrent();
      expect(callbacks.replaceText).toBe('new');
    });

    test('replaceAll calls callback', () => {
      dialog.setReplaceText('new');
      dialog.replaceAll();
      expect(callbacks.replaceAllText).toBe('new');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  describe('input handling', () => {
    test('Enter finds next', () => {
      dialog.show();
      dialog.handleInput({ key: 'Enter', ctrl: false, alt: false, shift: false, meta: false });
      expect(callbacks.findNextCalled).toBe(true);
    });

    test('Shift+Enter finds previous', () => {
      dialog.show();
      dialog.handleInput({ key: 'Enter', ctrl: false, alt: false, shift: true, meta: false });
      expect(callbacks.findPrevCalled).toBe(true);
    });

    test('Escape hides dialog', () => {
      dialog.show();
      dialog.handleInput({ key: 'Escape', ctrl: false, alt: false, shift: false, meta: false });
      expect(dialog.isVisible()).toBe(false);
    });

    test('Tab switches fields in replace mode', () => {
      dialog.show(true);
      const handled = dialog.handleInput({ key: 'Tab', ctrl: false, alt: false, shift: false, meta: false });
      expect(handled).toBe(true);
    });

    test('Tab does nothing without replace mode', () => {
      dialog.show(false);
      const handled = dialog.handleInput({ key: 'Tab', ctrl: false, alt: false, shift: false, meta: false });
      expect(handled).toBe(false);
    });

    test('Alt+C toggles case sensitive', () => {
      dialog.show();
      dialog.handleInput({ key: 'c', ctrl: false, alt: true, shift: false, meta: false });
      expect(dialog.getOptions().caseSensitive).toBe(true);
    });

    test('Alt+W toggles whole word', () => {
      dialog.show();
      dialog.handleInput({ key: 'w', ctrl: false, alt: true, shift: false, meta: false });
      expect(dialog.getOptions().wholeWord).toBe(true);
    });

    test('Alt+R toggles regex', () => {
      dialog.show();
      dialog.handleInput({ key: 'r', ctrl: false, alt: true, shift: false, meta: false });
      expect(dialog.getOptions().useRegex).toBe(true);
    });

    test('Ctrl+H toggles replace mode', () => {
      dialog.show();
      dialog.handleInput({ key: 'h', ctrl: true, alt: false, shift: false, meta: false });
      expect(dialog.isReplaceEnabled()).toBe(true);
    });

    test('Backspace removes character', () => {
      dialog.show();
      dialog.setSearchQuery('test');
      dialog.handleInput({ key: 'Backspace', ctrl: false, alt: false, shift: false, meta: false });
      expect(dialog.getSearchQuery()).toBe('tes');
    });

    test('character input adds to search query', () => {
      dialog.show();
      dialog.handleInput({ key: 'a', ctrl: false, alt: false, shift: false, meta: false });
      expect(dialog.getSearchQuery()).toBe('a');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Layout
  // ─────────────────────────────────────────────────────────────────────────

  describe('layout', () => {
    test('calculateBounds returns rect for find mode', () => {
      dialog.setReplaceMode(false);
      const bounds = dialog.calculateBounds(80, 24);
      expect(bounds.width).toBeLessThanOrEqual(60);
      expect(bounds.height).toBe(6);
    });

    test('calculateBounds returns larger rect for replace mode', () => {
      dialog.setReplaceMode(true);
      const bounds = dialog.calculateBounds(80, 24);
      expect(bounds.width).toBeLessThanOrEqual(60);
      expect(bounds.height).toBe(8);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  describe('rendering', () => {
    test('render draws find dialog', () => {
      dialog.show();
      dialog.setBounds({ x: 10, y: 3, width: 60, height: 6 });

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      dialog.render(buffer);

      // Check for content
      let hasContent = false;
      for (let y = 3; y < 9; y++) {
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

    test('render draws replace dialog', () => {
      dialog.show(true);
      dialog.setBounds({ x: 10, y: 3, width: 60, height: 8 });

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      dialog.render(buffer);

      // Check for content
      let hasContent = false;
      for (let y = 3; y < 11; y++) {
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
  });
});

// ============================================
// Factory Function Tests
// ============================================

describe('createSearchReplaceDialog', () => {
  test('creates search replace dialog', () => {
    const callbacks = createTestCallbacks();
    const dialog = createSearchReplaceDialog(callbacks);
    expect(dialog).toBeInstanceOf(SearchReplaceDialog);
  });
});
