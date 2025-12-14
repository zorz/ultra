/**
 * Raw Terminal Input Handler
 * 
 * Parses stdin input into key and mouse events.
 */

import { ESC } from './ansi.ts';

export interface KeyEvent {
  key: string;        // Key name (e.g., 'a', 'A', 'ENTER', 'UP', 'F1')
  char?: string;      // Original character(s) if printable
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;      // Cmd on macOS (rarely available in terminal)
}

export interface MouseEventData {
  type: 'press' | 'release' | 'move' | 'wheel';
  button: 'left' | 'middle' | 'right' | 'none' | 'wheelUp' | 'wheelDown';
  x: number;          // 1-indexed column
  y: number;          // 1-indexed row
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

type KeyCallback = (event: KeyEvent) => void;
type MouseCallback = (event: MouseEventData) => void;
type ResizeCallback = (width: number, height: number) => void;

// Special key mappings for escape sequences
const ESCAPE_SEQUENCES: Record<string, { key: string; shift?: boolean }> = {
  // Arrow keys
  '[A': { key: 'UP' },
  '[B': { key: 'DOWN' },
  '[C': { key: 'RIGHT' },
  '[D': { key: 'LEFT' },
  'OA': { key: 'UP' },
  'OB': { key: 'DOWN' },
  'OC': { key: 'RIGHT' },
  'OD': { key: 'LEFT' },
  // Arrow keys with modifiers (xterm style)
  '[1;2A': { key: 'UP', shift: true },
  '[1;2B': { key: 'DOWN', shift: true },
  '[1;2C': { key: 'RIGHT', shift: true },
  '[1;2D': { key: 'LEFT', shift: true },
  '[1;5A': { key: 'UP' },  // Ctrl+Up
  '[1;5B': { key: 'DOWN' },
  '[1;5C': { key: 'RIGHT' },
  '[1;5D': { key: 'LEFT' },
  '[1;3A': { key: 'UP' },  // Alt+Up
  '[1;3B': { key: 'DOWN' },
  '[1;3C': { key: 'RIGHT' },
  '[1;3D': { key: 'LEFT' },
  // Home/End
  '[H': { key: 'HOME' },
  '[F': { key: 'END' },
  'OH': { key: 'HOME' },
  'OF': { key: 'END' },
  '[1~': { key: 'HOME' },
  '[4~': { key: 'END' },
  '[7~': { key: 'HOME' },
  '[8~': { key: 'END' },
  // Insert/Delete
  '[2~': { key: 'INSERT' },
  '[3~': { key: 'DELETE' },
  // Page Up/Down
  '[5~': { key: 'PAGEUP' },
  '[6~': { key: 'PAGEDOWN' },
  // Function keys
  'OP': { key: 'F1' },
  'OQ': { key: 'F2' },
  'OR': { key: 'F3' },
  'OS': { key: 'F4' },
  '[15~': { key: 'F5' },
  '[17~': { key: 'F6' },
  '[18~': { key: 'F7' },
  '[19~': { key: 'F8' },
  '[20~': { key: 'F9' },
  '[21~': { key: 'F10' },
  '[23~': { key: 'F11' },
  '[24~': { key: 'F12' },
  // Alternative function key sequences
  '[[A': { key: 'F1' },
  '[[B': { key: 'F2' },
  '[[C': { key: 'F3' },
  '[[D': { key: 'F4' },
  '[[E': { key: 'F5' },
  '[11~': { key: 'F1' },
  '[12~': { key: 'F2' },
  '[13~': { key: 'F3' },
  '[14~': { key: 'F4' },
};

// Control character mappings
const CTRL_CHARS: Record<number, string> = {
  0: '@',    // Ctrl+@
  1: 'a',
  2: 'b',
  3: 'c',
  4: 'd',
  5: 'e',
  6: 'f',
  7: 'g',
  8: 'h',    // or BACKSPACE
  9: 'i',    // or TAB
  10: 'j',   // or ENTER (LF)
  11: 'k',
  12: 'l',
  13: 'm',   // or ENTER (CR)
  14: 'n',
  15: 'o',
  16: 'p',
  17: 'q',
  18: 'r',
  19: 's',
  20: 't',
  21: 'u',
  22: 'v',
  23: 'w',
  24: 'x',
  25: 'y',
  26: 'z',
  27: '[',   // ESC
  28: '\\',
  29: ']',
  30: '^',
  31: '_',
};

export class InputHandler {
  private keyCallbacks: Set<KeyCallback> = new Set();
  private mouseCallbacks: Set<MouseCallback> = new Set();
  private resizeCallbacks: Set<ResizeCallback> = new Set();
  private isRunning: boolean = false;
  private buffer: string = '';
  private escapeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly escapeTimeout = 50;  // ms to wait for escape sequence

  /**
   * Start listening for input
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Set raw mode to get individual keypresses
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (data: string) => {
      this.processInput(data);
    });

    // Handle resize
    process.stdout.on('resize', () => {
      const width = process.stdout.columns || 80;
      const height = process.stdout.rows || 24;
      for (const callback of this.resizeCallbacks) {
        callback(width, height);
      }
    });
  }

  /**
   * Stop listening for input
   */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  }

  /**
   * Register key event callback
   */
  onKey(callback: KeyCallback): () => void {
    this.keyCallbacks.add(callback);
    return () => this.keyCallbacks.delete(callback);
  }

  /**
   * Register mouse event callback
   */
  onMouse(callback: MouseCallback): () => void {
    this.mouseCallbacks.add(callback);
    return () => this.mouseCallbacks.delete(callback);
  }

  /**
   * Register resize callback
   */
  onResize(callback: ResizeCallback): () => void {
    this.resizeCallbacks.add(callback);
    return () => this.resizeCallbacks.delete(callback);
  }

  /**
   * Process raw input data
   */
  private processInput(data: string): void {
    this.buffer += data;
    this.parseBuffer();
  }

  /**
   * Parse the input buffer
   */
  private parseBuffer(): void {
    while (this.buffer.length > 0) {
      // Clear any pending escape timer
      if (this.escapeTimer) {
        clearTimeout(this.escapeTimer);
        this.escapeTimer = null;
      }

      const consumed = this.tryParse();
      if (consumed === 0) {
        // Couldn't parse anything yet - might be incomplete escape sequence
        if (this.buffer.startsWith(ESC) && this.buffer.length < 10) {
          // Wait a bit for more data
          this.escapeTimer = setTimeout(() => {
            // Timeout - treat as plain ESC key
            if (this.buffer.startsWith(ESC)) {
              this.emitKey({ key: 'ESCAPE', ctrl: false, alt: false, shift: false, meta: false });
              this.buffer = this.buffer.slice(1);
              this.parseBuffer();
            }
          }, this.escapeTimeout);
          return;
        }
        // Unknown sequence - skip one character
        this.buffer = this.buffer.slice(1);
      } else {
        this.buffer = this.buffer.slice(consumed);
      }
    }
  }

  /**
   * Try to parse the current buffer
   * Returns number of characters consumed
   */
  private tryParse(): number {
    if (this.buffer.length === 0) return 0;

    const firstChar = this.buffer[0]!;
    const firstCode = firstChar.charCodeAt(0);

    // Check for mouse events (SGR format: ESC [ < Cb ; Cx ; Cy M/m)
    if (this.buffer.startsWith(`${ESC}[<`)) {
      const match = this.buffer.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
      if (match) {
        this.parseSGRMouse(match);
        return match[0].length;
      }
      // Incomplete - wait for more
      if (this.buffer.length < 20) return 0;
    }

    // Check for legacy mouse events (X10 format: ESC [ M Cb Cx Cy)
    if (this.buffer.startsWith(`${ESC}[M`) && this.buffer.length >= 6) {
      this.parseX10Mouse();
      return 6;
    }

    // Check for escape sequences
    if (firstChar === ESC && this.buffer.length > 1) {
      // Try to match known escape sequences
      for (const [seq, mapping] of Object.entries(ESCAPE_SEQUENCES)) {
        if (this.buffer.startsWith(ESC + seq)) {
          this.emitKey({
            key: mapping.key,
            ctrl: false,
            alt: false,
            shift: mapping.shift || false,
            meta: false
          });
          return 1 + seq.length;
        }
      }

      // Alt+key (ESC followed by key)
      if (this.buffer.length >= 2) {
        const nextChar = this.buffer[1]!;
        const nextCode = nextChar.charCodeAt(0);
        
        // Don't treat escape sequences as alt+key
        if (nextChar !== '[' && nextChar !== 'O') {
          // Alt+letter
          if (nextCode >= 32 && nextCode < 127) {
            this.emitKey({
              key: nextChar.toUpperCase(),
              char: nextChar,
              ctrl: false,
              alt: true,
              shift: nextChar !== nextChar.toLowerCase(),
              meta: false
            });
            return 2;
          }
        }
      }

      // Unknown escape sequence - wait a bit or process as ESC
      return 0;
    }

    // Lone ESC key
    if (firstChar === ESC && this.buffer.length === 1) {
      return 0;  // Wait for potential sequence
    }

    // Control characters
    if (firstCode < 32) {
      const event = this.parseControlChar(firstCode);
      if (event) {
        this.emitKey(event);
        return 1;
      }
    }

    // DEL (backspace on some terminals)
    if (firstCode === 127) {
      this.emitKey({ key: 'BACKSPACE', ctrl: false, alt: false, shift: false, meta: false });
      return 1;
    }

    // Regular printable character
    if (firstCode >= 32) {
      // Handle multi-byte UTF-8
      let char = firstChar;
      let consumed = 1;
      
      // Check for surrogate pairs or multi-codepoint characters
      if (firstCode >= 0xD800 && firstCode <= 0xDBFF && this.buffer.length >= 2) {
        const second = this.buffer.charCodeAt(1);
        if (second >= 0xDC00 && second <= 0xDFFF) {
          char = this.buffer.slice(0, 2);
          consumed = 2;
        }
      }

      this.emitKey({
        key: char.toUpperCase(),
        char: char,
        ctrl: false,
        alt: false,
        shift: char !== char.toLowerCase() && char.toLowerCase() !== char.toUpperCase(),
        meta: false
      });
      return consumed;
    }

    return 1;  // Skip unknown
  }

  /**
   * Parse control character
   */
  private parseControlChar(code: number): KeyEvent | null {
    switch (code) {
      case 8:  // Ctrl+H or Backspace
        return { key: 'BACKSPACE', ctrl: false, alt: false, shift: false, meta: false };
      case 9:  // Tab
        return { key: 'TAB', ctrl: false, alt: false, shift: false, meta: false };
      case 10: // Line feed (Enter on Unix)
      case 13: // Carriage return (Enter)
        return { key: 'ENTER', ctrl: false, alt: false, shift: false, meta: false };
      case 27: // ESC
        return { key: 'ESCAPE', ctrl: false, alt: false, shift: false, meta: false };
      default:
        // Ctrl+letter
        if (CTRL_CHARS[code]) {
          return {
            key: CTRL_CHARS[code]!.toUpperCase(),
            ctrl: true,
            alt: false,
            shift: false,
            meta: false
          };
        }
        return null;
    }
  }

  /**
   * Parse SGR mouse event
   */
  private parseSGRMouse(match: RegExpMatchArray): void {
    const cb = parseInt(match[1]!, 10);
    const cx = parseInt(match[2]!, 10);
    const cy = parseInt(match[3]!, 10);
    const isRelease = match[4] === 'm';

    // Decode button
    const buttonNum = cb & 0x03;
    const motion = (cb & 0x20) !== 0;
    const wheel = (cb & 0x40) !== 0;
    const shift = (cb & 0x04) !== 0;
    const alt = (cb & 0x08) !== 0;
    const ctrl = (cb & 0x10) !== 0;

    let button: MouseEventData['button'];
    let type: MouseEventData['type'];

    if (wheel) {
      type = 'wheel';
      button = buttonNum === 0 ? 'wheelUp' : 'wheelDown';
    } else if (motion) {
      type = 'move';
      button = buttonNum === 0 ? 'left' : buttonNum === 1 ? 'middle' : buttonNum === 2 ? 'right' : 'none';
    } else if (isRelease) {
      type = 'release';
      button = 'none';  // SGR release doesn't specify which button
    } else {
      type = 'press';
      button = buttonNum === 0 ? 'left' : buttonNum === 1 ? 'middle' : 'right';
    }

    this.emitMouse({ type, button, x: cx, y: cy, ctrl, alt, shift });
  }

  /**
   * Parse X10 mouse event
   */
  private parseX10Mouse(): void {
    const cb = this.buffer.charCodeAt(3) - 32;
    const cx = this.buffer.charCodeAt(4) - 32;
    const cy = this.buffer.charCodeAt(5) - 32;

    const buttonNum = cb & 0x03;
    const shift = (cb & 0x04) !== 0;
    const alt = (cb & 0x08) !== 0;
    const ctrl = (cb & 0x10) !== 0;
    const motion = (cb & 0x20) !== 0;
    const wheel = (cb & 0x40) !== 0;

    let button: MouseEventData['button'];
    let type: MouseEventData['type'];

    if (wheel) {
      type = 'wheel';
      button = buttonNum === 0 ? 'wheelUp' : 'wheelDown';
    } else if (buttonNum === 3) {
      type = 'release';
      button = 'none';
    } else if (motion) {
      type = 'move';
      button = buttonNum === 0 ? 'left' : buttonNum === 1 ? 'middle' : 'right';
    } else {
      type = 'press';
      button = buttonNum === 0 ? 'left' : buttonNum === 1 ? 'middle' : 'right';
    }

    this.emitMouse({ type, button, x: cx, y: cy, ctrl, alt, shift });
  }

  /**
   * Emit key event
   */
  private emitKey(event: KeyEvent): void {
    for (const callback of this.keyCallbacks) {
      callback(event);
    }
  }

  /**
   * Emit mouse event
   */
  private emitMouse(event: MouseEventData): void {
    for (const callback of this.mouseCallbacks) {
      callback(event);
    }
  }
}

// Singleton instance
export const inputHandler = new InputHandler();
export default inputHandler;
