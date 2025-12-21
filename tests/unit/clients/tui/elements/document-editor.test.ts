/**
 * DocumentEditor Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  DocumentEditor,
  createDocumentEditor,
} from '../../../../../src/clients/tui/elements/document-editor.ts';
import { createTestContext, type ElementContext } from '../../../../../src/clients/tui/elements/base.ts';
import { createScreenBuffer } from '../../../../../src/clients/tui/rendering/buffer.ts';

// ============================================
// Tests
// ============================================

describe('DocumentEditor', () => {
  let editor: DocumentEditor;
  let ctx: ElementContext;

  beforeEach(() => {
    ctx = createTestContext();
    editor = new DocumentEditor('doc1', 'test.ts', ctx);
    editor.setBounds({ x: 0, y: 0, width: 80, height: 24 });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Content Management
  // ─────────────────────────────────────────────────────────────────────────

  describe('content management', () => {
    test('starts with empty content', () => {
      expect(editor.getContent()).toBe('');
      expect(editor.getLineCount()).toBe(1);
    });

    test('setContent sets content', () => {
      editor.setContent('Hello\nWorld');
      expect(editor.getContent()).toBe('Hello\nWorld');
      expect(editor.getLineCount()).toBe(2);
    });

    test('getLine returns line at index', () => {
      editor.setContent('Line 1\nLine 2\nLine 3');
      expect(editor.getLine(0)).toBe('Line 1');
      expect(editor.getLine(1)).toBe('Line 2');
      expect(editor.getLine(2)).toBe('Line 3');
    });

    test('getLine returns null for invalid index', () => {
      editor.setContent('Hello');
      expect(editor.getLine(-1)).toBeNull();
      expect(editor.getLine(10)).toBeNull();
    });

    test('setUri updates uri and title', () => {
      editor.setUri('/path/to/file.ts');
      expect(editor.getUri()).toBe('/path/to/file.ts');
      expect(editor.getTitle()).toBe('file.ts');
    });

    test('isModified starts false', () => {
      expect(editor.isModified()).toBe(false);
    });

    test('isModified true after edit', () => {
      editor.setContent('Hello');
      editor.setCursor({ line: 0, column: 5 });
      editor.insertText('!');
      expect(editor.isModified()).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Cursor & Selection
  // ─────────────────────────────────────────────────────────────────────────

  describe('cursor and selection', () => {
    beforeEach(() => {
      editor.setContent('Hello World\nSecond Line\nThird Line');
    });

    test('getCursor returns cursor position', () => {
      expect(editor.getCursor()).toEqual({ line: 0, column: 0 });
    });

    test('setCursor sets cursor position', () => {
      editor.setCursor({ line: 1, column: 5 });
      expect(editor.getCursor()).toEqual({ line: 1, column: 5 });
    });

    test('setCursor clamps to valid range', () => {
      editor.setCursor({ line: 100, column: 100 });
      const cursor = editor.getCursor();
      expect(cursor.line).toBe(2);
      expect(cursor.column).toBeLessThanOrEqual(editor.getLine(2)!.length);
    });

    test('moveCursor up', () => {
      editor.setCursor({ line: 1, column: 3 });
      editor.moveCursor('up');
      expect(editor.getCursor()).toEqual({ line: 0, column: 3 });
    });

    test('moveCursor down', () => {
      editor.setCursor({ line: 0, column: 3 });
      editor.moveCursor('down');
      expect(editor.getCursor()).toEqual({ line: 1, column: 3 });
    });

    test('moveCursor left', () => {
      editor.setCursor({ line: 0, column: 5 });
      editor.moveCursor('left');
      expect(editor.getCursor()).toEqual({ line: 0, column: 4 });
    });

    test('moveCursor right', () => {
      editor.setCursor({ line: 0, column: 5 });
      editor.moveCursor('right');
      expect(editor.getCursor()).toEqual({ line: 0, column: 6 });
    });

    test('moveCursor left wraps to previous line', () => {
      editor.setCursor({ line: 1, column: 0 });
      editor.moveCursor('left');
      expect(editor.getCursor()).toEqual({ line: 0, column: 11 }); // 'Hello World'.length
    });

    test('moveCursor right wraps to next line', () => {
      editor.setCursor({ line: 0, column: 11 });
      editor.moveCursor('right');
      expect(editor.getCursor()).toEqual({ line: 1, column: 0 });
    });

    test('moveCursorToLineStart', () => {
      editor.setCursor({ line: 0, column: 5 });
      editor.moveCursorToLineStart();
      expect(editor.getCursor()).toEqual({ line: 0, column: 0 });
    });

    test('moveCursorToLineEnd', () => {
      editor.setCursor({ line: 0, column: 0 });
      editor.moveCursorToLineEnd();
      expect(editor.getCursor()).toEqual({ line: 0, column: 11 });
    });

    test('moveCursorToDocStart', () => {
      editor.setCursor({ line: 2, column: 5 });
      editor.moveCursorToDocStart();
      expect(editor.getCursor()).toEqual({ line: 0, column: 0 });
    });

    test('moveCursorToDocEnd', () => {
      editor.setCursor({ line: 0, column: 0 });
      editor.moveCursorToDocEnd();
      expect(editor.getCursor()).toEqual({ line: 2, column: 10 }); // 'Third Line'.length
    });

    test('selection starts null', () => {
      expect(editor.getSelection()).toBeNull();
    });

    test('setSelection sets selection', () => {
      editor.setSelection({
        start: { line: 0, column: 0 },
        end: { line: 0, column: 5 },
      });
      expect(editor.getSelection()).toEqual({
        start: { line: 0, column: 0 },
        end: { line: 0, column: 5 },
      });
    });

    test('clearSelection clears selection', () => {
      editor.setSelection({
        start: { line: 0, column: 0 },
        end: { line: 0, column: 5 },
      });
      editor.clearSelection();
      expect(editor.getSelection()).toBeNull();
    });

    test('moveCursor with extend creates selection', () => {
      editor.setCursor({ line: 0, column: 0 });
      editor.moveCursor('right', true);
      editor.moveCursor('right', true);

      const selection = editor.getSelection();
      expect(selection).not.toBeNull();
      expect(selection?.start).toEqual({ line: 0, column: 0 });
      expect(selection?.end).toEqual({ line: 0, column: 2 });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Editing
  // ─────────────────────────────────────────────────────────────────────────

  describe('editing', () => {
    test('insertText inserts at cursor', () => {
      editor.setContent('Hello');
      editor.setCursor({ line: 0, column: 5 });
      editor.insertText(' World');
      expect(editor.getContent()).toBe('Hello World');
    });

    test('insertText with newline splits line', () => {
      editor.setContent('HelloWorld');
      editor.setCursor({ line: 0, column: 5 });
      editor.insertText('\n');
      expect(editor.getContent()).toBe('Hello\nWorld');
      expect(editor.getLineCount()).toBe(2);
    });

    test('insertText replaces selection', () => {
      editor.setContent('Hello World');
      editor.setSelection({
        start: { line: 0, column: 6 },
        end: { line: 0, column: 11 },
      });
      editor.insertText('Universe');
      expect(editor.getContent()).toBe('Hello Universe');
      expect(editor.getSelection()).toBeNull();
    });

    test('deleteBackward deletes character before cursor', () => {
      editor.setContent('Hello');
      editor.setCursor({ line: 0, column: 5 });
      editor.deleteBackward();
      expect(editor.getContent()).toBe('Hell');
    });

    test('deleteBackward at line start joins lines', () => {
      editor.setContent('Hello\nWorld');
      editor.setCursor({ line: 1, column: 0 });
      editor.deleteBackward();
      expect(editor.getContent()).toBe('HelloWorld');
      expect(editor.getCursor()).toEqual({ line: 0, column: 5 });
    });

    test('deleteBackward deletes selection', () => {
      editor.setContent('Hello World');
      editor.setSelection({
        start: { line: 0, column: 0 },
        end: { line: 0, column: 6 },
      });
      editor.deleteBackward();
      expect(editor.getContent()).toBe('World');
    });

    test('deleteForward deletes character at cursor', () => {
      editor.setContent('Hello');
      editor.setCursor({ line: 0, column: 0 });
      editor.deleteForward();
      expect(editor.getContent()).toBe('ello');
    });

    test('deleteForward at line end joins lines', () => {
      editor.setContent('Hello\nWorld');
      editor.setCursor({ line: 0, column: 5 });
      editor.deleteForward();
      expect(editor.getContent()).toBe('HelloWorld');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scrolling
  // ─────────────────────────────────────────────────────────────────────────

  describe('scrolling', () => {
    beforeEach(() => {
      // Create content taller than viewport
      const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`);
      editor.setContent(lines.join('\n'));
    });

    test('getScrollTop returns scroll position', () => {
      expect(editor.getScrollTop()).toBe(0);
    });

    test('scroll moves scroll position', () => {
      editor.scroll(10);
      expect(editor.getScrollTop()).toBe(10);
    });

    test('scroll clamps to valid range', () => {
      editor.scroll(-10);
      expect(editor.getScrollTop()).toBe(0);
    });

    test('scrollToLine sets scroll position', () => {
      editor.scrollToLine(20);
      expect(editor.getScrollTop()).toBe(20);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  describe('rendering', () => {
    test('renders content', () => {
      editor.setContent('Hello World');
      const buffer = createScreenBuffer({ width: 80, height: 24 });

      editor.render(buffer);

      // Check for 'H' from 'Hello' somewhere in first line
      let foundH = false;
      for (let x = 0; x < 80; x++) {
        if (buffer.get(x, 0)?.char === 'H') {
          foundH = true;
          break;
        }
      }
      expect(foundH).toBe(true);
    });

    test('renders line numbers', () => {
      editor.setContent('Line 1\nLine 2');
      const buffer = createScreenBuffer({ width: 80, height: 24 });

      editor.render(buffer);

      // Check for '1' in gutter
      let found1 = false;
      for (let x = 0; x < 5; x++) {
        if (buffer.get(x, 0)?.char === '1') {
          found1 = true;
          break;
        }
      }
      expect(found1).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  describe('input handling', () => {
    test('arrow keys move cursor', () => {
      editor.setContent('Hello\nWorld');
      editor.setCursor({ line: 0, column: 2 });

      editor.handleKey({ key: 'ArrowRight', ctrl: false, alt: false, shift: false, meta: false });
      expect(editor.getCursor().column).toBe(3);

      editor.handleKey({ key: 'ArrowDown', ctrl: false, alt: false, shift: false, meta: false });
      expect(editor.getCursor().line).toBe(1);
    });

    test('character input inserts text', () => {
      editor.setContent('Hello');
      editor.setCursor({ line: 0, column: 5 });

      editor.handleKey({ key: '!', ctrl: false, alt: false, shift: false, meta: false });
      expect(editor.getContent()).toBe('Hello!');
    });

    test('Enter inserts newline', () => {
      editor.setContent('HelloWorld');
      editor.setCursor({ line: 0, column: 5 });

      editor.handleKey({ key: 'Enter', ctrl: false, alt: false, shift: false, meta: false });
      expect(editor.getContent()).toBe('Hello\nWorld');
    });

    test('Backspace deletes', () => {
      editor.setContent('Hello');
      editor.setCursor({ line: 0, column: 5 });

      editor.handleKey({ key: 'Backspace', ctrl: false, alt: false, shift: false, meta: false });
      expect(editor.getContent()).toBe('Hell');
    });

    test('Delete deletes forward', () => {
      editor.setContent('Hello');
      editor.setCursor({ line: 0, column: 0 });

      editor.handleKey({ key: 'Delete', ctrl: false, alt: false, shift: false, meta: false });
      expect(editor.getContent()).toBe('ello');
    });

    test('Home moves to line start', () => {
      editor.setContent('Hello World');
      editor.setCursor({ line: 0, column: 5 });

      editor.handleKey({ key: 'Home', ctrl: false, alt: false, shift: false, meta: false });
      expect(editor.getCursor().column).toBe(0);
    });

    test('End moves to line end', () => {
      editor.setContent('Hello World');
      editor.setCursor({ line: 0, column: 0 });

      editor.handleKey({ key: 'End', ctrl: false, alt: false, shift: false, meta: false });
      expect(editor.getCursor().column).toBe(11);
    });

    test('Ctrl+Home moves to document start', () => {
      editor.setContent('Hello\nWorld');
      editor.setCursor({ line: 1, column: 5 });

      editor.handleKey({ key: 'Home', ctrl: true, alt: false, shift: false, meta: false });
      expect(editor.getCursor()).toEqual({ line: 0, column: 0 });
    });

    test('Ctrl+End moves to document end', () => {
      editor.setContent('Hello\nWorld');
      editor.setCursor({ line: 0, column: 0 });

      editor.handleKey({ key: 'End', ctrl: true, alt: false, shift: false, meta: false });
      expect(editor.getCursor()).toEqual({ line: 1, column: 5 });
    });

    test('Ctrl+A selects all', () => {
      editor.setContent('Hello\nWorld');

      editor.handleKey({ key: 'a', ctrl: true, alt: false, shift: false, meta: false });

      const selection = editor.getSelection();
      expect(selection).not.toBeNull();
      expect(selection?.start).toEqual({ line: 0, column: 0 });
      expect(selection?.end).toEqual({ line: 1, column: 5 });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // State Serialization
  // ─────────────────────────────────────────────────────────────────────────

  describe('serialization', () => {
    test('getState returns state', () => {
      editor.setContent('Hello');
      editor.setCursor({ line: 0, column: 3 });

      const state = editor.getState();
      expect(state.cursor).toEqual({ line: 0, column: 3 });
      expect(state.scrollTop).toBe(0);
    });

    test('setState restores state', () => {
      editor.setContent('Hello\nWorld\nTest');
      editor.setState({
        scrollTop: 5,
        cursor: { line: 1, column: 2 },
      });

      expect(editor.getCursor()).toEqual({ line: 1, column: 2 });
    });
  });
});

// ============================================
// Factory Function Tests
// ============================================

describe('createDocumentEditor', () => {
  test('creates document editor', () => {
    const ctx = createTestContext();
    const editor = createDocumentEditor('doc1', 'test.ts', ctx);

    expect(editor).toBeInstanceOf(DocumentEditor);
    expect(editor.id).toBe('doc1');
  });
});
