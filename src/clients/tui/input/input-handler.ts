/**
 * TUI Input Handler
 *
 * Handles keyboard and mouse input for the TUI.
 * Adapts the terminal input parser to TUI event types.
 */

import type { KeyEvent, MouseEvent, InputEvent } from '../types.ts';

// ============================================
// Constants
// ============================================

const ESC = '\x1b';

// Special key mappings for escape sequences
const ESCAPE_SEQUENCES: Record<string, { key: string; shift?: boolean; ctrl?: boolean; alt?: boolean }> = {
  // Arrow keys
  '[A': { key: 'ArrowUp' },
  '[B': { key: 'ArrowDown' },
  '[C': { key: 'ArrowRight' },
  '[D': { key: 'ArrowLeft' },
  'OA': { key: 'ArrowUp' },
  'OB': { key: 'ArrowDown' },
  'OC': { key: 'ArrowRight' },
  'OD': { key: 'ArrowLeft' },
  // Arrow keys with modifiers
  '[1;2A': { key: 'ArrowUp', shift: true },
  '[1;2B': { key: 'ArrowDown', shift: true },
  '[1;2C': { key: 'ArrowRight', shift: true },
  '[1;2D': { key: 'ArrowLeft', shift: true },
  '[1;3A': { key: 'ArrowUp', alt: true },
  '[1;3B': { key: 'ArrowDown', alt: true },
  '[1;3C': { key: 'ArrowRight', alt: true },
  '[1;3D': { key: 'ArrowLeft', alt: true },
  '[1;5A': { key: 'ArrowUp', ctrl: true },
  '[1;5B': { key: 'ArrowDown', ctrl: true },
  '[1;5C': { key: 'ArrowRight', ctrl: true },
  '[1;5D': { key: 'ArrowLeft', ctrl: true },
  // Home/End
  '[H': { key: 'Home' },
  '[F': { key: 'End' },
  'OH': { key: 'Home' },
  'OF': { key: 'End' },
  '[1~': { key: 'Home' },
  '[4~': { key: 'End' },
  // Insert/Delete/PageUp/PageDown
  '[2~': { key: 'Insert' },
  '[3~': { key: 'Delete' },
  '[5~': { key: 'PageUp' },
  '[6~': { key: 'PageDown' },
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
  // Shift+Tab
  '[Z': { key: 'Tab', shift: true },
};

// Control character to key mappings
const CTRL_CHARS: Record<number, string> = {
  1: 'a', 2: 'b', 3: 'c', 4: 'd', 5: 'e', 6: 'f', 7: 'g',
  8: 'Backspace', 9: 'Tab', 10: 'Enter', 11: 'k', 12: 'l',
  13: 'Enter', 14: 'n', 15: 'o', 16: 'p', 17: 'q', 18: 'r',
  19: 's', 20: 't', 21: 'u', 22: 'v', 23: 'w', 24: 'x',
  25: 'y', 26: 'z',
};

// ============================================
// Types
// ============================================

export type KeyEventCallback = (event: KeyEvent) => void;
export type MouseEventCallback = (event: MouseEvent) => void;
export type ResizeCallback = (width: number, height: number) => void;
export type InputEventCallback = (event: InputEvent) => void;

// ============================================
// TUI Input Handler
// ============================================

export class TUIInputHandler {
  private keyCallbacks: Set<KeyEventCallback> = new Set();
  private mouseCallbacks: Set<MouseEventCallback> = new Set();
  private resizeCallbacks: Set<ResizeCallback> = new Set();
  private inputCallbacks: Set<InputEventCallback> = new Set();

  private isRunning = false;
  private buffer = '';
  private escapeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly escapeTimeout = 50;

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start listening for input.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    // Enable enhanced keyboard protocols
    process.stdout.write('\x1b[>4;2m');  // modifyOtherKeys
    process.stdout.write('\x1b[>1u');    // Kitty protocol

    process.stdin.on('readable', this.handleReadable);
    process.stdout.on('resize', this.handleResize);
  }

  /**
   * Stop listening for input.
   */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.escapeTimer) {
      clearTimeout(this.escapeTimer);
      this.escapeTimer = null;
    }

    // Disable enhanced keyboard protocols
    process.stdout.write('\x1b[>4;0m');
    process.stdout.write('\x1b[<u');

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();

    process.stdin.off('readable', this.handleReadable);
    process.stdout.off('resize', this.handleResize);
  }

  /**
   * Check if running.
   */
  isActive(): boolean {
    return this.isRunning;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event Registration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Register key event callback.
   */
  onKey(callback: KeyEventCallback): () => void {
    this.keyCallbacks.add(callback);
    return () => this.keyCallbacks.delete(callback);
  }

  /**
   * Register mouse event callback.
   */
  onMouse(callback: MouseEventCallback): () => void {
    this.mouseCallbacks.add(callback);
    return () => this.mouseCallbacks.delete(callback);
  }

  /**
   * Register resize callback.
   */
  onResize(callback: ResizeCallback): () => void {
    this.resizeCallbacks.add(callback);
    return () => this.resizeCallbacks.delete(callback);
  }

  /**
   * Register callback for any input event.
   */
  onInput(callback: InputEventCallback): () => void {
    this.inputCallbacks.add(callback);
    return () => this.inputCallbacks.delete(callback);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event Handlers
  // ─────────────────────────────────────────────────────────────────────────

  private handleReadable = (): void => {
    let chunk: string | null;
    while ((chunk = process.stdin.read() as string | null) !== null) {
      this.buffer += chunk;
      this.parseBuffer();
    }
  };

  private handleResize = (): void => {
    const width = process.stdout.columns || 80;
    const height = process.stdout.rows || 24;
    for (const callback of this.resizeCallbacks) {
      callback(width, height);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Parsing
  // ─────────────────────────────────────────────────────────────────────────

  private parseBuffer(): void {
    while (this.buffer.length > 0) {
      if (this.escapeTimer) {
        clearTimeout(this.escapeTimer);
        this.escapeTimer = null;
      }

      const consumed = this.tryParse();
      if (consumed === 0) {
        if (this.buffer.startsWith(ESC) && this.buffer.length < 20) {
          this.escapeTimer = setTimeout(() => {
            if (this.buffer.startsWith(ESC)) {
              this.emitKey({ key: 'Escape', ctrl: false, alt: false, shift: false, meta: false });
              this.buffer = this.buffer.slice(1);
              this.parseBuffer();
            }
          }, this.escapeTimeout);
          return;
        }
        this.buffer = this.buffer.slice(1);
      } else {
        this.buffer = this.buffer.slice(consumed);
      }
    }
  }

  private tryParse(): number {
    if (this.buffer.length === 0) return 0;

    const firstChar = this.buffer[0]!;
    const firstCode = firstChar.charCodeAt(0);

    // SGR mouse: ESC [ < Cb ; Cx ; Cy M/m
    if (this.buffer.startsWith(`${ESC}[<`)) {
      const match = this.buffer.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
      if (match) {
        this.parseSGRMouse(match);
        return match[0].length;
      }
      if (this.buffer.length < 20) return 0;
    }

    // X10 mouse: ESC [ M Cb Cx Cy
    if (this.buffer.startsWith(`${ESC}[M`) && this.buffer.length >= 6) {
      this.parseX10Mouse();
      return 6;
    }

    // CSI u format: ESC [ keycode ; modifiers u
    if (this.buffer.startsWith(`${ESC}[`)) {
      const csiUMatch = this.buffer.match(/^\x1b\[(\d+)(?:;(\d+))?(?::(\d+))?u/);
      if (csiUMatch) {
        const keycode = parseInt(csiUMatch[1]!, 10);
        const modifiers = csiUMatch[2] ? parseInt(csiUMatch[2], 10) : 1;
        const eventType = csiUMatch[3] ? parseInt(csiUMatch[3], 10) : 1;

        if (eventType === 3) return csiUMatch[0].length; // Skip release

        const shift = ((modifiers - 1) & 1) !== 0;
        const alt = ((modifiers - 1) & 2) !== 0;
        const ctrl = ((modifiers - 1) & 4) !== 0;
        const meta = ((modifiers - 1) & 8) !== 0;

        const key = this.getKeyName(keycode);

        this.emitKey({ key, ctrl, alt, shift, meta });
        return csiUMatch[0].length;
      }
    }

    // Known escape sequences
    if (firstChar === ESC && this.buffer.length > 1) {
      const sortedSeqs = Object.entries(ESCAPE_SEQUENCES)
        .sort((a, b) => b[0].length - a[0].length);

      for (const [seq, mapping] of sortedSeqs) {
        if (this.buffer.startsWith(ESC + seq)) {
          this.emitKey({
            key: mapping.key,
            ctrl: mapping.ctrl || false,
            alt: mapping.alt || false,
            shift: mapping.shift || false,
            meta: false,
          });
          return 1 + seq.length;
        }
      }

      // Alt+key
      if (this.buffer.length >= 2) {
        const nextChar = this.buffer[1]!;
        const nextCode = nextChar.charCodeAt(0);

        if (nextChar !== '[' && nextChar !== 'O' && nextCode >= 32 && nextCode < 127) {
          this.emitKey({
            key: nextChar,
            ctrl: false,
            alt: true,
            shift: nextChar !== nextChar.toLowerCase(),
            meta: false,
          });
          return 2;
        }
      }

      return 0; // Wait for more
    }

    // Lone ESC
    if (firstChar === ESC && this.buffer.length === 1) {
      return 0;
    }

    // Control characters
    if (firstCode < 32) {
      const event = this.parseControlChar(firstCode);
      if (event) {
        this.emitKey(event);
        return 1;
      }
    }

    // DEL (backspace)
    if (firstCode === 127) {
      this.emitKey({ key: 'Backspace', ctrl: false, alt: false, shift: false, meta: false });
      return 1;
    }

    // Regular printable character
    if (firstCode >= 32) {
      this.emitKey({
        key: firstChar,
        ctrl: false,
        alt: false,
        shift: firstChar !== firstChar.toLowerCase() && firstChar.toLowerCase() !== firstChar.toUpperCase(),
        meta: false,
      });
      return 1;
    }

    return 1;
  }

  private getKeyName(keycode: number): string {
    const special: Record<number, string> = {
      9: 'Tab',
      13: 'Enter',
      27: 'Escape',
      127: 'Backspace',
    };
    return special[keycode] || String.fromCharCode(keycode);
  }

  private parseControlChar(code: number): KeyEvent | null {
    switch (code) {
      case 8:
        return { key: 'Backspace', ctrl: false, alt: false, shift: false, meta: false };
      case 9:
        return { key: 'Tab', ctrl: false, alt: false, shift: false, meta: false };
      case 10:
      case 13:
        return { key: 'Enter', ctrl: false, alt: false, shift: false, meta: false };
      case 27:
        return { key: 'Escape', ctrl: false, alt: false, shift: false, meta: false };
      default:
        const char = CTRL_CHARS[code];
        if (char && char.length === 1) {
          return { key: char, ctrl: true, alt: false, shift: false, meta: false };
        }
        return null;
    }
  }

  private parseSGRMouse(match: RegExpMatchArray): void {
    const cb = parseInt(match[1]!, 10);
    const cx = parseInt(match[2]!, 10);
    const cy = parseInt(match[3]!, 10);
    const isRelease = match[4] === 'm';

    const buttonNum = cb & 0x03;
    const motion = (cb & 0x20) !== 0;
    const wheel = (cb & 0x40) !== 0;
    const shift = (cb & 0x04) !== 0;
    const alt = (cb & 0x08) !== 0;
    const ctrl = (cb & 0x10) !== 0;

    let button: MouseEvent['button'];
    let type: MouseEvent['type'];

    if (wheel) {
      type = 'scroll';
      button = 'none';
      // buttonNum 0 = scroll up, buttonNum 1 = scroll down
      const scrollDirection = buttonNum === 0 ? -1 : 1;
      this.emitMouse({ type, button, x: cx - 1, y: cy - 1, ctrl, alt, shift, scrollDirection });
      return;
    } else if (motion) {
      type = isRelease ? 'move' : 'drag';
      button = buttonNum === 0 ? 'left' : buttonNum === 1 ? 'middle' : buttonNum === 2 ? 'right' : 'none';
    } else if (isRelease) {
      type = 'release';
      button = 'none';
    } else {
      type = 'press';
      button = buttonNum === 0 ? 'left' : buttonNum === 1 ? 'middle' : 'right';
    }

    // Convert to 0-indexed
    this.emitMouse({ type, button, x: cx - 1, y: cy - 1, ctrl, alt, shift });
  }

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

    let button: MouseEvent['button'];
    let type: MouseEvent['type'];

    if (wheel) {
      type = 'scroll';
      button = 'none';
      // buttonNum 0 = scroll up, buttonNum 1 = scroll down
      const scrollDirection = buttonNum === 0 ? -1 : 1;
      this.emitMouse({ type, button, x: cx - 1, y: cy - 1, ctrl, alt, shift, scrollDirection });
      return;
    } else if (buttonNum === 3) {
      type = 'release';
      button = 'none';
    } else if (motion) {
      type = 'drag';
      button = buttonNum === 0 ? 'left' : buttonNum === 1 ? 'middle' : 'right';
    } else {
      type = 'press';
      button = buttonNum === 0 ? 'left' : buttonNum === 1 ? 'middle' : 'right';
    }

    // Convert to 0-indexed
    this.emitMouse({ type, button, x: cx - 1, y: cy - 1, ctrl, alt, shift });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event Emission
  // ─────────────────────────────────────────────────────────────────────────

  private emitKey(event: KeyEvent): void {
    for (const callback of this.keyCallbacks) {
      callback(event);
    }
    for (const callback of this.inputCallbacks) {
      callback(event);
    }
  }

  private emitMouse(event: MouseEvent): void {
    for (const callback of this.mouseCallbacks) {
      callback(event);
    }
    for (const callback of this.inputCallbacks) {
      callback(event);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Testing Support
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Simulate input for testing.
   */
  simulateInput(data: string): void {
    this.buffer += data;
    this.parseBuffer();
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a new TUI input handler.
 */
export function createInputHandler(): TUIInputHandler {
  return new TUIInputHandler();
}
