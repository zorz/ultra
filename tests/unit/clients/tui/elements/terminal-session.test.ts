/**
 * TerminalSession Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  TerminalSession,
  createTerminalSession,
} from '../../../../../src/clients/tui/elements/terminal-session.ts';
import { createTestContext, type ElementContext } from '../../../../../src/clients/tui/elements/base.ts';
import { createScreenBuffer } from '../../../../../src/clients/tui/rendering/buffer.ts';

// ============================================
// Tests
// ============================================

describe('TerminalSession', () => {
  let terminal: TerminalSession;
  let ctx: ElementContext;

  beforeEach(() => {
    ctx = createTestContext();
    terminal = new TerminalSession('term1', 'Terminal', ctx);
    terminal.setBounds({ x: 0, y: 0, width: 80, height: 24 });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // State Management
  // ─────────────────────────────────────────────────────────────────────────

  describe('state management', () => {
    test('starts with empty cwd', () => {
      expect(terminal.getCwd()).toBe('');
    });

    test('setCwd sets working directory', () => {
      terminal.setCwd('/home/user');
      expect(terminal.getCwd()).toBe('/home/user');
    });

    test('hasExited returns false initially', () => {
      expect(terminal.hasExited()).toBe(false);
    });

    test('setExited marks terminal as exited', () => {
      terminal.setExited(0);
      expect(terminal.hasExited()).toBe(true);
    });

    test('clear resets terminal', () => {
      terminal.write('Hello World');
      terminal.clear();

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      terminal.render(buffer);

      // Should be empty after clear
      let foundH = false;
      for (let x = 0; x < 80; x++) {
        if (buffer.get(x, 0)?.char === 'H') {
          foundH = true;
          break;
        }
      }
      expect(foundH).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Output Processing
  // ─────────────────────────────────────────────────────────────────────────

  describe('output processing', () => {
    test('write outputs text', () => {
      terminal.write('Hello');

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      terminal.render(buffer);

      // Check for 'H' in output
      expect(buffer.get(0, 0)?.char).toBe('H');
      expect(buffer.get(1, 0)?.char).toBe('e');
      expect(buffer.get(2, 0)?.char).toBe('l');
      expect(buffer.get(3, 0)?.char).toBe('l');
      expect(buffer.get(4, 0)?.char).toBe('o');
    });

    test('write handles newlines', () => {
      terminal.write('Line1\nLine2');

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      terminal.render(buffer);

      expect(buffer.get(0, 0)?.char).toBe('L');
      expect(buffer.get(0, 1)?.char).toBe('L');
    });

    test('write handles carriage return', () => {
      terminal.write('Hello\rWorld');

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      terminal.render(buffer);

      // 'World' should overwrite 'Hello'
      expect(buffer.get(0, 0)?.char).toBe('W');
    });

    test('write handles tabs', () => {
      terminal.write('A\tB');

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      terminal.render(buffer);

      expect(buffer.get(0, 0)?.char).toBe('A');
      expect(buffer.get(8, 0)?.char).toBe('B');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ANSI Escape Sequences
  // ─────────────────────────────────────────────────────────────────────────

  describe('ANSI escape sequences', () => {
    test('handles cursor up', () => {
      terminal.write('Line1\nLine2');
      terminal.write('\x1b[1A'); // cursor up 1
      terminal.write('X');

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      terminal.render(buffer);

      // X should appear on first line
      let foundX = false;
      for (let x = 0; x < 80; x++) {
        if (buffer.get(x, 0)?.char === 'X') {
          foundX = true;
          break;
        }
      }
      expect(foundX).toBe(true);
    });

    test('handles cursor position', () => {
      terminal.write('\x1b[3;5H'); // row 3, col 5 (1-indexed)
      terminal.write('X');

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      terminal.render(buffer);

      expect(buffer.get(4, 2)?.char).toBe('X'); // 0-indexed: col 4, row 2
    });

    test('handles erase display', () => {
      terminal.write('Hello World');
      terminal.write('\x1b[2J'); // erase all

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      terminal.render(buffer);

      // Should be cleared
      expect(buffer.get(0, 0)?.char).toBe(' ');
    });

    test('handles erase line', () => {
      terminal.write('Hello World');
      terminal.write('\x1b[H'); // Move to home position
      terminal.write('\x1b[2K'); // Erase entire line

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      terminal.render(buffer);

      // Line should be empty
      expect(buffer.get(0, 0)?.char).toBe(' ');
    });

    test('handles SGR reset', () => {
      terminal.write('\x1b[31mRed\x1b[0mNormal');

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      terminal.render(buffer);

      // Both should render (colors tested in visual inspection)
      expect(buffer.get(0, 0)?.char).toBe('R');
      expect(buffer.get(3, 0)?.char).toBe('N');
    });

    test('handles 256 color', () => {
      terminal.write('\x1b[38;5;196mRed');

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      terminal.render(buffer);

      // Should render text
      expect(buffer.get(0, 0)?.char).toBe('R');
    });

    test('handles true color', () => {
      terminal.write('\x1b[38;2;255;0;0mRed');

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      terminal.render(buffer);

      // Should render text
      expect(buffer.get(0, 0)?.char).toBe('R');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Alternate Screen
  // ─────────────────────────────────────────────────────────────────────────

  describe('alternate screen', () => {
    test('entering alternate screen clears display', () => {
      terminal.write('Normal content');
      terminal.write('\x1b[?1049h'); // Enter alternate screen
      terminal.write('\x1b[2J'); // Clear screen

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      terminal.render(buffer);

      // Should be clear
      expect(buffer.get(0, 0)?.char).toBe(' ');
    });

    test('exiting alternate screen restores content', () => {
      terminal.write('Normal');
      terminal.write('\x1b[?1049h'); // Enter alternate screen
      terminal.write('Alternate');
      terminal.write('\x1b[?1049l'); // Exit alternate screen

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      terminal.render(buffer);

      // Should see 'Normal' again
      expect(buffer.get(0, 0)?.char).toBe('N');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  describe('rendering', () => {
    test('renders content', () => {
      terminal.write('$ ls');

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      terminal.render(buffer);

      expect(buffer.get(0, 0)?.char).toBe('$');
      expect(buffer.get(1, 0)?.char).toBe(' ');
      expect(buffer.get(2, 0)?.char).toBe('l');
      expect(buffer.get(3, 0)?.char).toBe('s');
    });

    test('renders exit status when exited', () => {
      terminal.setExited(0);

      const buffer = createScreenBuffer({ width: 80, height: 24 });
      terminal.render(buffer);

      // Check for exit message
      let foundExit = false;
      for (let x = 0; x < 80; x++) {
        if (buffer.get(x, 23)?.char === 'e' &&
            buffer.get(x + 1, 23)?.char === 'x') {
          foundExit = true;
          break;
        }
      }
      expect(foundExit).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  describe('input handling', () => {
    test('character input calls onData', () => {
      let receivedData = '';
      const termWithCallback = new TerminalSession('term2', 'Terminal', ctx, {
        onData: (data) => {
          receivedData = data;
        },
      });

      termWithCallback.handleKey({ key: 'a', ctrl: false, alt: false, shift: false, meta: false });
      expect(receivedData).toBe('a');
    });

    test('Enter sends carriage return', () => {
      let receivedData = '';
      const termWithCallback = new TerminalSession('term2', 'Terminal', ctx, {
        onData: (data) => {
          receivedData = data;
        },
      });

      termWithCallback.handleKey({ key: 'Enter', ctrl: false, alt: false, shift: false, meta: false });
      expect(receivedData).toBe('\r');
    });

    test('Arrow keys send escape sequences', () => {
      let receivedData = '';
      const termWithCallback = new TerminalSession('term2', 'Terminal', ctx, {
        onData: (data) => {
          receivedData = data;
        },
      });

      termWithCallback.handleKey({ key: 'ArrowUp', ctrl: false, alt: false, shift: false, meta: false });
      expect(receivedData).toBe('\x1b[A');
    });

    test('Ctrl+C sends control character', () => {
      let receivedData = '';
      const termWithCallback = new TerminalSession('term2', 'Terminal', ctx, {
        onData: (data) => {
          receivedData = data;
        },
      });

      termWithCallback.handleKey({ key: 'c', ctrl: true, alt: false, shift: false, meta: false });
      expect(receivedData).toBe('\x03'); // Ctrl+C
    });

    test('exited terminal ignores input', () => {
      let receivedData = '';
      const termWithCallback = new TerminalSession('term2', 'Terminal', ctx, {
        onData: (data) => {
          receivedData = data;
        },
      });
      termWithCallback.setExited(0);

      const handled = termWithCallback.handleKey({ key: 'a', ctrl: false, alt: false, shift: false, meta: false });
      expect(handled).toBe(false);
      expect(receivedData).toBe('');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    test('onResize calls resize callback', () => {
      let resizeCols = 0;
      let resizeRows = 0;

      const termWithCallback = new TerminalSession('term2', 'Terminal', ctx, {
        onResize: (cols, rows) => {
          resizeCols = cols;
          resizeRows = rows;
        },
      });

      termWithCallback.onResize({ width: 100, height: 30 });

      expect(resizeCols).toBe(100);
      expect(resizeRows).toBe(30);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // State Serialization
  // ─────────────────────────────────────────────────────────────────────────

  describe('serialization', () => {
    test('getState returns state', () => {
      terminal.setCwd('/home/user');

      const state = terminal.getState();
      expect(state.cwd).toBe('/home/user');
    });

    test('setState restores state', () => {
      terminal.setState({ cwd: '/tmp', scrollTop: 0 });
      expect(terminal.getCwd()).toBe('/tmp');
    });
  });
});

// ============================================
// Factory Function Tests
// ============================================

describe('createTerminalSession', () => {
  test('creates terminal session', () => {
    const ctx = createTestContext();
    const terminal = createTerminalSession('term1', 'Terminal', ctx);

    expect(terminal).toBeInstanceOf(TerminalSession);
    expect(terminal.id).toBe('term1');
  });
});
