/**
 * Raw Terminal Input Handler
 * 
 * Parses stdin input into key and mouse events.
 * Supports:
 *   - Standard escape sequences
 *   - CSI u (fixterms) encoding for proper modifier support
 *   - Mouse tracking (SGR and X10)
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
const ESCAPE_SEQUENCES: Record<string, { key: string; shift?: boolean; ctrl?: boolean; alt?: boolean }> = {
  // Arrow keys
  '[A': { key: 'UP' },
  '[B': { key: 'DOWN' },
  '[C': { key: 'RIGHT' },
  '[D': { key: 'LEFT' },
  'OA': { key: 'UP' },
  'OB': { key: 'DOWN' },
  'OC': { key: 'RIGHT' },
  'OD': { key: 'LEFT' },
  // Arrow keys with modifiers (xterm style: 1;modifier)
  // modifier: 2=shift, 3=alt, 4=alt+shift, 5=ctrl, 6=ctrl+shift, 7=ctrl+alt, 8=ctrl+alt+shift
  '[1;2A': { key: 'UP', shift: true },
  '[1;2B': { key: 'DOWN', shift: true },
  '[1;2C': { key: 'RIGHT', shift: true },
  '[1;2D': { key: 'LEFT', shift: true },
  '[1;3A': { key: 'UP', alt: true },
  '[1;3B': { key: 'DOWN', alt: true },
  '[1;3C': { key: 'RIGHT', alt: true },
  '[1;3D': { key: 'LEFT', alt: true },
  '[1;4A': { key: 'UP', alt: true, shift: true },
  '[1;4B': { key: 'DOWN', alt: true, shift: true },
  '[1;4C': { key: 'RIGHT', alt: true, shift: true },
  '[1;4D': { key: 'LEFT', alt: true, shift: true },
  '[1;5A': { key: 'UP', ctrl: true },
  '[1;5B': { key: 'DOWN', ctrl: true },
  '[1;5C': { key: 'RIGHT', ctrl: true },
  '[1;5D': { key: 'LEFT', ctrl: true },
  '[1;6A': { key: 'UP', ctrl: true, shift: true },
  '[1;6B': { key: 'DOWN', ctrl: true, shift: true },
  '[1;6C': { key: 'RIGHT', ctrl: true, shift: true },
  '[1;6D': { key: 'LEFT', ctrl: true, shift: true },
  '[1;7A': { key: 'UP', ctrl: true, alt: true },
  '[1;7B': { key: 'DOWN', ctrl: true, alt: true },
  '[1;7C': { key: 'RIGHT', ctrl: true, alt: true },
  '[1;7D': { key: 'LEFT', ctrl: true, alt: true },
  // Home/End
  '[H': { key: 'HOME' },
  '[F': { key: 'END' },
  'OH': { key: 'HOME' },
  'OF': { key: 'END' },
  '[1~': { key: 'HOME' },
  '[4~': { key: 'END' },
  '[7~': { key: 'HOME' },
  '[8~': { key: 'END' },
  // Home/End with modifiers
  '[1;2H': { key: 'HOME', shift: true },
  '[1;2F': { key: 'END', shift: true },
  '[1;5H': { key: 'HOME', ctrl: true },
  '[1;5F': { key: 'END', ctrl: true },
  // Insert/Delete
  '[2~': { key: 'INSERT' },
  '[3~': { key: 'DELETE' },
  '[3;5~': { key: 'DELETE', ctrl: true },
  // Page Up/Down
  '[5~': { key: 'PAGEUP' },
  '[6~': { key: 'PAGEDOWN' },
  '[5;5~': { key: 'PAGEUP', ctrl: true },
  '[6;5~': { key: 'PAGEDOWN', ctrl: true },
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
  // Function keys with shift
  '[1;2P': { key: 'F1', shift: true },
  '[1;2Q': { key: 'F2', shift: true },
  '[1;2R': { key: 'F3', shift: true },
  '[1;2S': { key: 'F4', shift: true },
  '[15;2~': { key: 'F5', shift: true },
  '[17;2~': { key: 'F6', shift: true },
  '[18;2~': { key: 'F7', shift: true },
  '[19;2~': { key: 'F8', shift: true },
  '[20;2~': { key: 'F9', shift: true },
  '[21;2~': { key: 'F10', shift: true },
  '[23;2~': { key: 'F11', shift: true },
  '[24;2~': { key: 'F12', shift: true },
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
  // Tab with shift (some terminals)
  '[Z': { key: 'TAB', shift: true },
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

// CSI u key code mappings
const CSI_U_KEYS: Record<number, string> = {
  9: 'TAB',
  13: 'ENTER',
  27: 'ESCAPE',
  127: 'BACKSPACE',
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
    } else {
      // Log to stderr for debugging
      process.stderr.write('WARNING: stdin is not a TTY\n');
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    // Enable enhanced keyboard protocols for better modifier key support
    // modifyOtherKeys mode 2: Report all keys with modifiers
    process.stdout.write('\x1b[>4;2m');
    // Kitty keyboard protocol (CSI u mode): Full modifier support including ctrl+shift
    process.stdout.write('\x1b[>1u');
    
    // Use 'readable' event with read() for more reliable input handling
    // This works better with Bun's compiled binaries
    process.stdin.on('readable', () => {
      let chunk: string | null;
      while ((chunk = process.stdin.read() as string | null) !== null) {
        this.processInput(chunk);
      }
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

    // Disable enhanced keyboard protocols
    process.stdout.write('\x1b[>4;0m');  // Disable modifyOtherKeys
    process.stdout.write('\x1b[<u');      // Disable Kitty keyboard protocol

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
        if (this.buffer.startsWith(ESC) && this.buffer.length < 20) {
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

    // Check for CSI u format: ESC [ keycode ; modifiers u
    // This is the "fixterms" / "libtermkey" / Kitty protocol encoding
    // Kitty extended format: ESC [ keycode ; modifiers : event-type u
    if (this.buffer.startsWith(`${ESC}[`)) {
      // Match both basic CSI u and extended Kitty format
      const csiUMatch = this.buffer.match(/^\x1b\[(\d+)(?:;(\d+))?(?::(\d+))?u/);
      if (csiUMatch) {
        const keycode = parseInt(csiUMatch[1]!, 10);
        const modifiers = csiUMatch[2] ? parseInt(csiUMatch[2], 10) : 1;
        const eventType = csiUMatch[3] ? parseInt(csiUMatch[3], 10) : 1; // 1=press, 2=repeat, 3=release
        
        // Skip release events (we only care about press/repeat)
        if (eventType === 3) {
          return csiUMatch[0].length;
        }
        
        // Decode modifiers: 1=none, 2=shift, 3=alt, 4=alt+shift, 5=ctrl, 6=ctrl+shift, 7=ctrl+alt, 8=all
        const shift = (modifiers - 1) & 1;
        const alt = (modifiers - 1) & 2;
        const ctrl = (modifiers - 1) & 4;
        const meta = (modifiers - 1) & 8;  // Kitty also reports super/meta
        
        // Get key name
        let key = CSI_U_KEYS[keycode] || String.fromCharCode(keycode).toUpperCase();
        
        this.emitKey({
          key,
          char: keycode >= 32 && keycode < 127 ? String.fromCharCode(keycode) : undefined,
          ctrl: ctrl !== 0,
          alt: alt !== 0,
          shift: shift !== 0,
          meta: meta !== 0
        });
        return csiUMatch[0].length;
      }
      
      // Check for modified key format: ESC [ 27 ; modifiers ; keycode ~
      // Some terminals use this format
      const modKeyMatch = this.buffer.match(/^\x1b\[27;(\d+);(\d+)~/);
      if (modKeyMatch) {
        const modifiers = parseInt(modKeyMatch[1]!, 10);
        const keycode = parseInt(modKeyMatch[2]!, 10);
        
        const shift = (modifiers - 1) & 1;
        const alt = (modifiers - 1) & 2;
        const ctrl = (modifiers - 1) & 4;
        
        let key = String.fromCharCode(keycode).toUpperCase();
        
        this.emitKey({
          key,
          char: keycode >= 32 && keycode < 127 ? String.fromCharCode(keycode) : undefined,
          ctrl: ctrl !== 0,
          alt: alt !== 0,
          shift: shift !== 0,
          meta: false
        });
        return modKeyMatch[0].length;
      }
    }

    // Check for escape sequences
    if (firstChar === ESC && this.buffer.length > 1) {
      // Try to match known escape sequences (longest first for proper matching)
      const sortedSeqs = Object.entries(ESCAPE_SEQUENCES).sort((a, b) => b[0].length - a[0].length);
      for (const [seq, mapping] of sortedSeqs) {
        if (this.buffer.startsWith(ESC + seq)) {
          this.emitKey({
            key: mapping.key,
            ctrl: mapping.ctrl || false,
            alt: mapping.alt || false,
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
      case 8:  // Ctrl+H (historically same as backspace, but we treat as Ctrl+H)
        // Real backspace usually comes as DEL (127) or escape sequence
        return { key: 'H', ctrl: true, alt: false, shift: false, meta: false };
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
