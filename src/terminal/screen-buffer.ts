/**
 * Screen Buffer and ANSI Parser
 *
 * Terminal screen buffer and ANSI escape sequence parser.
 * This file is separated from pty.ts to avoid bun-pty imports in
 * contexts where bun-pty isn't available (e.g., bundled binary with IPC backend).
 */

import { debugLog } from '../debug.ts';

/**
 * Terminal cell with character and attributes
 */
export interface TerminalCell {
  char: string;
  fg: string | null; // Hex color or null for default
  bg: string | null; // Hex color or null for default
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
  inverse: boolean;
}

/**
 * Creates a default empty cell
 */
export function createEmptyCell(): TerminalCell {
  return {
    char: ' ',
    fg: null,
    bg: null,
    bold: false,
    italic: false,
    underline: false,
    dim: false,
    inverse: false,
  };
}

// Standard ANSI 16-color palette
const ANSI_COLORS = [
  '#000000',
  '#cd0000',
  '#00cd00',
  '#cdcd00',
  '#0000ee',
  '#cd00cd',
  '#00cdcd',
  '#e5e5e5',
  '#7f7f7f',
  '#ff0000',
  '#00ff00',
  '#ffff00',
  '#5c5cff',
  '#ff00ff',
  '#00ffff',
  '#ffffff',
];

/**
 * Convert ANSI color code to hex
 */
export function ansiToHex(code: number): string | null {
  if (code < 16) {
    return ANSI_COLORS[code] || null;
  }
  if (code < 232) {
    // 6x6x6 color cube
    const c = code - 16;
    const r = Math.floor(c / 36) * 51;
    const g = Math.floor((c % 36) / 6) * 51;
    const b = (c % 6) * 51;
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  // Grayscale (232-255)
  const gray = (code - 232) * 10 + 8;
  return `#${gray.toString(16).padStart(2, '0')}${gray.toString(16).padStart(2, '0')}${gray.toString(16).padStart(2, '0')}`;
}

/**
 * Simple screen buffer for terminal rendering
 */
export class ScreenBuffer {
  private buffer: TerminalCell[][];
  private scrollback: TerminalCell[][] = [];
  private viewOffset: number = 0; // How many lines scrolled back (0 = showing current)
  private cursorX: number = 0;
  private cursorY: number = 0;
  private savedCursorX: number = 0;
  private savedCursorY: number = 0;
  private cursorVisible: boolean = true; // DECTCEM cursor visibility

  // Scroll region (DECSTBM) - 0-indexed, inclusive
  private scrollTop: number = 0;
  private scrollBottom: number;

  // Alternate screen buffer (mode 1049)
  private alternateMode: boolean = false;
  private savedMainBuffer: TerminalCell[][] | null = null;
  private savedMainCursorX: number = 0;
  private savedMainCursorY: number = 0;
  private savedMainScrollback: TerminalCell[][] | null = null;

  // Current text attributes
  private currentFg: string | null = null;
  private currentBg: string | null = null;
  private bold: boolean = false;
  private italic: boolean = false;
  private underline: boolean = false;
  private dim: boolean = false;
  private inverse: boolean = false;

  constructor(
    private cols: number,
    private rows: number,
    private scrollbackLimit: number = 1000
  ) {
    this.buffer = this.createEmptyBuffer();
    this.scrollBottom = rows - 1;
  }

  private createEmptyBuffer(): TerminalCell[][] {
    const buffer: TerminalCell[][] = [];
    for (let y = 0; y < this.rows; y++) {
      buffer.push(this.createEmptyRow());
    }
    return buffer;
  }

  private createEmptyRow(): TerminalCell[] {
    const row: TerminalCell[] = [];
    for (let x = 0; x < this.cols; x++) {
      row.push(createEmptyCell());
    }
    return row;
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;

    // Resize existing rows
    for (let y = 0; y < this.buffer.length; y++) {
      while (this.buffer[y]!.length < cols) {
        this.buffer[y]!.push(createEmptyCell());
      }
      if (this.buffer[y]!.length > cols) {
        this.buffer[y]!.length = cols;
      }
    }

    // Add or remove rows
    while (this.buffer.length < rows) {
      this.buffer.push(this.createEmptyRow());
    }
    if (this.buffer.length > rows) {
      // Move extra rows to scrollback
      const extra = this.buffer.splice(0, this.buffer.length - rows);
      this.scrollback.push(...extra);
    }

    // Clamp cursor
    this.cursorX = Math.min(this.cursorX, cols - 1);
    this.cursorY = Math.min(this.cursorY, rows - 1);

    // Reset scroll region to full screen
    this.scrollTop = 0;
    this.scrollBottom = rows - 1;
  }

  /**
   * Write a character at current cursor position
   */
  writeChar(char: string): void {
    if (this.cursorX >= this.cols) {
      this.cursorX = 0;
      this.newLine();
    }

    if (
      this.cursorY >= 0 &&
      this.cursorY < this.rows &&
      this.cursorX >= 0 &&
      this.cursorX < this.cols
    ) {
      this.buffer[this.cursorY]![this.cursorX] = {
        char,
        fg: this.inverse ? this.currentBg : this.currentFg,
        bg: this.inverse ? this.currentFg : this.currentBg,
        bold: this.bold,
        italic: this.italic,
        underline: this.underline,
        dim: this.dim,
        inverse: false, // Already applied above
      };
    }
    this.cursorX++;
  }

  /**
   * Handle carriage return
   */
  carriageReturn(): void {
    this.cursorX = 0;
  }

  /**
   * Handle new line (line feed)
   */
  newLine(): void {
    debugLog(`[ScreenBuffer] newLine: cursorY=${this.cursorY}, scrollTop=${this.scrollTop}, scrollBottom=${this.scrollBottom}, rows=${this.rows}`);

    // Check if cursor is within the scroll region
    const inScrollRegion = this.cursorY >= this.scrollTop && this.cursorY <= this.scrollBottom;

    if (inScrollRegion && this.cursorY === this.scrollBottom) {
      // At bottom of scroll region - scroll the region up
      debugLog(`[ScreenBuffer] newLine: at scroll bottom (in region), scrolling region up`);
      this.scrollRegionUp();
    } else if (inScrollRegion && this.cursorY < this.scrollBottom) {
      // Inside scroll region but not at bottom - move down within region
      this.cursorY++;
      debugLog(`[ScreenBuffer] newLine: in scroll region, moved cursor to row ${this.cursorY}`);
    } else if (!inScrollRegion && this.cursorY < this.rows - 1) {
      // Outside scroll region - move down if not at screen bottom
      this.cursorY++;
      debugLog(`[ScreenBuffer] newLine: outside scroll region, moved cursor to row ${this.cursorY}`);
    } else {
      debugLog(`[ScreenBuffer] newLine: cursor at boundary, not moving (cursorY=${this.cursorY}, inRegion=${inScrollRegion})`);
    }
  }

  /**
   * Scroll the scroll region up by one line.
   * The top line of the region is removed, bottom gets a new empty line.
   */
  private scrollRegionUp(): void {
    if (this.scrollTop === 0) {
      // Scrolling from top of screen - save to scrollback for history
      const line = this.buffer.shift();
      if (line) {
        this.scrollback.push(line);
        if (this.scrollback.length > this.scrollbackLimit) {
          this.scrollback.shift();
        }
      }
      // Insert new row at bottom of scroll region
      this.buffer.splice(this.scrollBottom, 0, this.createEmptyRow());
    } else {
      // Scroll region doesn't start at top - no scrollback
      this.buffer.splice(this.scrollTop, 1);
      this.buffer.splice(this.scrollBottom, 0, this.createEmptyRow());
    }
  }

  /**
   * Scroll the scroll region down by one line (reverse index).
   * The bottom line of the region is removed, top gets a new empty line.
   */
  private scrollRegionDown(): void {
    this.buffer.splice(this.scrollBottom, 1);
    this.buffer.splice(this.scrollTop, 0, this.createEmptyRow());
  }

  /**
   * Set scroll region (DECSTBM).
   * @param top Top row (1-indexed, inclusive)
   * @param bottom Bottom row (1-indexed, inclusive)
   */
  setScrollRegion(top: number, bottom: number): void {
    // Convert from 1-indexed to 0-indexed
    this.scrollTop = Math.max(0, top - 1);
    this.scrollBottom = Math.min(this.rows - 1, bottom - 1);

    // Ensure top < bottom
    if (this.scrollTop >= this.scrollBottom) {
      this.scrollTop = 0;
      this.scrollBottom = this.rows - 1;
    }

    // Move cursor to home position (top-left of screen, not region)
    this.cursorX = 0;
    this.cursorY = 0;
  }

  /**
   * Reset scroll region to full screen.
   */
  resetScrollRegion(): void {
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
  }

  /**
   * Enter alternate screen buffer (mode 1049).
   * Saves main buffer and cursor, creates a fresh buffer with no scrollback.
   */
  enterAlternateScreen(): void {
    if (this.alternateMode) return; // Already in alternate mode

    // Save main buffer state
    this.savedMainBuffer = this.buffer;
    this.savedMainCursorX = this.cursorX;
    this.savedMainCursorY = this.cursorY;
    this.savedMainScrollback = this.scrollback;

    // Create fresh alternate buffer (no scrollback)
    this.buffer = this.createEmptyBuffer();
    this.scrollback = [];
    this.cursorX = 0;
    this.cursorY = 0;
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
    this.viewOffset = 0;
    this.alternateMode = true;
  }

  /**
   * Exit alternate screen buffer (mode 1049).
   * Restores main buffer and cursor.
   */
  exitAlternateScreen(): void {
    if (!this.alternateMode) return; // Not in alternate mode

    // Restore main buffer state
    if (this.savedMainBuffer) {
      this.buffer = this.savedMainBuffer;
      this.savedMainBuffer = null;
    }
    if (this.savedMainScrollback) {
      this.scrollback = this.savedMainScrollback;
      this.savedMainScrollback = null;
    }
    this.cursorX = this.savedMainCursorX;
    this.cursorY = this.savedMainCursorY;
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
    this.viewOffset = 0;
    this.alternateMode = false;
  }

  /**
   * Check if in alternate screen mode.
   */
  isAlternateScreen(): boolean {
    return this.alternateMode;
  }

  /**
   * Reverse index (ESC M) - move cursor up, scrolling region down if at top.
   */
  reverseIndex(): void {
    if (this.cursorY === this.scrollTop) {
      // At top of scroll region - scroll the region down
      this.scrollRegionDown();
    } else if (this.cursorY > 0) {
      // Not at top of screen - just move up
      this.cursorY--;
    }
  }

  /**
   * Handle backspace
   */
  backspace(): void {
    if (this.cursorX > 0) {
      this.cursorX--;
    }
  }

  /**
   * Handle tab
   */
  tab(): void {
    const tabStop = 8;
    this.cursorX = Math.min(this.cols - 1, (Math.floor(this.cursorX / tabStop) + 1) * tabStop);
  }

  /**
   * Move cursor to position (1-based coordinates from ANSI)
   */
  setCursor(row: number, col: number): void {
    const oldX = this.cursorX;
    const oldY = this.cursorY;
    this.cursorY = Math.max(0, Math.min(this.rows - 1, row - 1));
    this.cursorX = Math.max(0, Math.min(this.cols - 1, col - 1));
    debugLog(`[ScreenBuffer] setCursor: (${row},${col}) -> internal (${this.cursorY},${this.cursorX}) [was (${oldY},${oldX})]`);
  }

  /**
   * Move cursor up
   */
  cursorUp(n: number = 1): void {
    this.cursorY = Math.max(0, this.cursorY - n);
  }

  /**
   * Move cursor down
   */
  cursorDown(n: number = 1): void {
    this.cursorY = Math.min(this.rows - 1, this.cursorY + n);
  }

  /**
   * Move cursor forward (right)
   */
  cursorForward(n: number = 1): void {
    this.cursorX = Math.min(this.cols - 1, this.cursorX + n);
  }

  /**
   * Move cursor backward (left)
   */
  cursorBackward(n: number = 1): void {
    this.cursorX = Math.max(0, this.cursorX - n);
  }

  /**
   * Save cursor position
   */
  saveCursor(): void {
    this.savedCursorX = this.cursorX;
    this.savedCursorY = this.cursorY;
  }

  /**
   * Restore cursor position
   */
  restoreCursor(): void {
    this.cursorX = this.savedCursorX;
    this.cursorY = this.savedCursorY;
  }

  /**
   * Erase in display
   */
  eraseInDisplay(mode: number): void {
    switch (mode) {
      case 0: // Erase from cursor to end
        this.eraseInLine(0);
        for (let y = this.cursorY + 1; y < this.rows; y++) {
          this.buffer[y] = this.createEmptyRow();
        }
        break;
      case 1: // Erase from start to cursor
        this.eraseInLine(1);
        for (let y = 0; y < this.cursorY; y++) {
          this.buffer[y] = this.createEmptyRow();
        }
        break;
      case 2: // Erase entire display
      case 3: // Erase entire display and scrollback
        this.buffer = this.createEmptyBuffer();
        if (mode === 3) {
          this.scrollback = [];
        }
        break;
    }
  }

  /**
   * Erase in line
   */
  eraseInLine(mode: number): void {
    if (this.cursorY < 0 || this.cursorY >= this.rows) return;

    switch (mode) {
      case 0: // Erase from cursor to end of line
        for (let x = this.cursorX; x < this.cols; x++) {
          this.buffer[this.cursorY]![x] = createEmptyCell();
        }
        break;
      case 1: // Erase from start of line to cursor
        for (let x = 0; x <= this.cursorX; x++) {
          this.buffer[this.cursorY]![x] = createEmptyCell();
        }
        break;
      case 2: // Erase entire line
        this.buffer[this.cursorY] = this.createEmptyRow();
        break;
    }
  }

  /**
   * Insert n blank characters at cursor (ICH - CSI @ )
   */
  insertChars(n: number): void {
    if (this.cursorY < 0 || this.cursorY >= this.rows) return;
    const row = this.buffer[this.cursorY]!;

    // Shift characters right from cursor position
    for (let i = 0; i < n; i++) {
      row.pop(); // Remove last character
      row.splice(this.cursorX, 0, createEmptyCell()); // Insert blank at cursor
    }
  }

  /**
   * Delete n characters at cursor (DCH - CSI P)
   */
  deleteChars(n: number): void {
    if (this.cursorY < 0 || this.cursorY >= this.rows) return;
    const row = this.buffer[this.cursorY]!;

    // Remove n characters at cursor, add blanks at end
    for (let i = 0; i < n && this.cursorX < this.cols; i++) {
      row.splice(this.cursorX, 1);
      row.push(createEmptyCell());
    }
  }

  /**
   * Erase n characters at cursor (ECH - CSI X)
   */
  eraseChars(n: number): void {
    if (this.cursorY < 0 || this.cursorY >= this.rows) return;

    for (let i = 0; i < n && this.cursorX + i < this.cols; i++) {
      this.buffer[this.cursorY]![this.cursorX + i] = createEmptyCell();
    }
  }

  /**
   * Insert n blank lines at cursor (IL - CSI L)
   * Respects scroll region - only affects lines within the region.
   */
  insertLines(n: number): void {
    // Only works if cursor is within scroll region
    if (this.cursorY < this.scrollTop || this.cursorY > this.scrollBottom) {
      return;
    }

    for (let i = 0; i < n; i++) {
      // Remove line at bottom of scroll region, insert blank line at cursor
      this.buffer.splice(this.scrollBottom, 1);
      this.buffer.splice(this.cursorY, 0, this.createEmptyRow());
    }
  }

  /**
   * Delete n lines at cursor (DL - CSI M)
   * Respects scroll region - only affects lines within the region.
   */
  deleteLines(n: number): void {
    // Only works if cursor is within scroll region
    if (this.cursorY < this.scrollTop || this.cursorY > this.scrollBottom) {
      return;
    }

    for (let i = 0; i < n; i++) {
      // Remove line at cursor, add blank line at bottom of scroll region
      this.buffer.splice(this.cursorY, 1);
      this.buffer.splice(this.scrollBottom, 0, this.createEmptyRow());
    }
  }

  /**
   * Set graphics rendition (colors and attributes)
   */
  setGraphicsRendition(params: number[]): void {
    if (params.length === 0) params = [0];

    for (let i = 0; i < params.length; i++) {
      const p = params[i]!;

      if (p === 0) {
        // Reset all
        this.currentFg = null;
        this.currentBg = null;
        this.bold = false;
        this.italic = false;
        this.underline = false;
        this.dim = false;
        this.inverse = false;
      } else if (p === 1) {
        this.bold = true;
      } else if (p === 2) {
        this.dim = true;
      } else if (p === 3) {
        this.italic = true;
      } else if (p === 4) {
        this.underline = true;
      } else if (p === 7) {
        this.inverse = true;
      } else if (p === 22) {
        this.bold = false;
        this.dim = false;
      } else if (p === 23) {
        this.italic = false;
      } else if (p === 24) {
        this.underline = false;
      } else if (p === 27) {
        this.inverse = false;
      } else if (p >= 30 && p <= 37) {
        // Standard foreground colors
        this.currentFg = ANSI_COLORS[p - 30]!;
      } else if (p === 38) {
        // Extended foreground color
        if (params[i + 1] === 5 && params[i + 2] !== undefined) {
          // 256 color
          this.currentFg = ansiToHex(params[i + 2]!);
          i += 2;
        } else if (params[i + 1] === 2 && params[i + 4] !== undefined) {
          // RGB color
          const r = params[i + 2]!;
          const g = params[i + 3]!;
          const b = params[i + 4]!;
          this.currentFg = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
          i += 4;
        }
      } else if (p === 39) {
        this.currentFg = null;
      } else if (p >= 40 && p <= 47) {
        // Standard background colors
        this.currentBg = ANSI_COLORS[p - 40]!;
      } else if (p === 48) {
        // Extended background color
        if (params[i + 1] === 5 && params[i + 2] !== undefined) {
          // 256 color
          this.currentBg = ansiToHex(params[i + 2]!);
          i += 2;
        } else if (params[i + 1] === 2 && params[i + 4] !== undefined) {
          // RGB color
          const r = params[i + 2]!;
          const g = params[i + 3]!;
          const b = params[i + 4]!;
          this.currentBg = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
          i += 4;
        }
      } else if (p === 49) {
        this.currentBg = null;
      } else if (p >= 90 && p <= 97) {
        // Bright foreground colors
        this.currentFg = ANSI_COLORS[p - 90 + 8]!;
      } else if (p >= 100 && p <= 107) {
        // Bright background colors
        this.currentBg = ANSI_COLORS[p - 100 + 8]!;
      }
    }
  }

  /**
   * Get buffer for rendering (accounts for view offset when scrolled back)
   */
  getBuffer(): TerminalCell[][] {
    if (this.viewOffset === 0) {
      return this.buffer;
    }

    // When scrolled back, combine scrollback and buffer
    const allLines = [...this.scrollback, ...this.buffer];
    const startLine = allLines.length - this.rows - this.viewOffset;
    const endLine = startLine + this.rows;

    return allLines.slice(Math.max(0, startLine), endLine);
  }

  /**
   * Get cursor position
   */
  getCursor(): { x: number; y: number } {
    return { x: this.cursorX, y: this.cursorY };
  }

  /**
   * Get number of rows
   */
  getRows(): number {
    return this.rows;
  }

  /**
   * Get number of columns
   */
  getCols(): number {
    return this.cols;
  }

  /**
   * Get cursor visibility state (DECTCEM)
   */
  isCursorVisible(): boolean {
    return this.cursorVisible;
  }

  /**
   * Set cursor visibility (DECTCEM)
   */
  setCursorVisible(visible: boolean): void {
    this.cursorVisible = visible;
  }

  /**
   * Get scrollback buffer
   */
  getScrollback(): TerminalCell[][] {
    return this.scrollback;
  }

  /**
   * Scroll view up (into scrollback history)
   * @returns true if scroll position changed
   */
  scrollViewUp(lines: number): boolean {
    const maxOffset = this.scrollback.length;
    const newOffset = Math.min(this.viewOffset + lines, maxOffset);
    if (newOffset !== this.viewOffset) {
      this.viewOffset = newOffset;
      return true;
    }
    return false;
  }

  /**
   * Scroll view down (towards current)
   * @returns true if scroll position changed
   */
  scrollViewDown(lines: number): boolean {
    const newOffset = Math.max(this.viewOffset - lines, 0);
    if (newOffset !== this.viewOffset) {
      this.viewOffset = newOffset;
      return true;
    }
    return false;
  }

  /**
   * Reset view to current (scroll to bottom)
   */
  resetViewOffset(): void {
    this.viewOffset = 0;
  }

  /**
   * Get current view offset
   */
  getViewOffset(): number {
    return this.viewOffset;
  }

  /**
   * Get total number of lines (scrollback + visible buffer)
   */
  getTotalLines(): number {
    return this.scrollback.length + this.buffer.length;
  }
}

/**
 * Simple ANSI escape sequence parser
 */
export class AnsiParser {
  private state: 'normal' | 'escape' | 'csi' | 'osc' | 'charset' = 'normal';
  private csiParams: string = '';
  private oscData: string = '';

  /** Callback for OSC 99 notifications (used by Claude Code, etc.) */
  private onNotificationCallback?: (message: string) => void;

  /** Callback for sending data back to PTY (for DSR responses, etc.) */
  private onOutputCallback?: (data: string) => void;

  constructor(private screen: ScreenBuffer) {}

  /**
   * Set callback for PTY output (responses to queries like DSR).
   */
  onOutput(callback: (data: string) => void): void {
    this.onOutputCallback = callback;
  }

  /**
   * Send data back to PTY.
   */
  private sendOutput(data: string): void {
    if (this.onOutputCallback) {
      this.onOutputCallback(data);
    }
  }

  /**
   * Set notification callback for OSC 99 messages.
   */
  onNotification(callback: (message: string) => void): void {
    this.onNotificationCallback = callback;
  }

  /**
   * Process incoming data
   */
  process(data: string): void {
    for (let i = 0; i < data.length; i++) {
      const char = data[i]!;
      const code = char.charCodeAt(0);

      switch (this.state) {
        case 'normal':
          this.processNormal(char, code);
          break;
        case 'escape':
          this.processEscape(char, code);
          break;
        case 'csi':
          this.processCSI(char, code);
          break;
        case 'osc':
          this.processOSC(char, code);
          break;
        case 'charset':
          // Character set designation - just consume the designator and return to normal
          // ESC ( B = ASCII, ESC ( 0 = DEC Special Graphics, etc.
          // We don't actually change character sets, just acknowledge them
          this.state = 'normal';
          break;
      }
    }
  }

  private processNormal(char: string, code: number): void {
    if (code === 0x1b) {
      // ESC
      this.state = 'escape';
    } else if (code === 0x0d) {
      // CR
      this.screen.carriageReturn();
    } else if (code === 0x0a) {
      // LF
      this.screen.newLine();
    } else if (code === 0x08) {
      // BS
      this.screen.backspace();
    } else if (code === 0x09) {
      // TAB
      this.screen.tab();
    } else if (code === 0x07) {
      // BEL - ignore for now
    } else if (code >= 0x20) {
      // Printable
      this.screen.writeChar(char);
    }
  }

  private processEscape(char: string, code: number): void {
    if (char === '[') {
      this.state = 'csi';
      this.csiParams = '';
    } else if (char === ']') {
      this.state = 'osc';
      this.oscData = '';
    } else if (char === '(' || char === ')' || char === '*' || char === '+') {
      // Character set designation (G0-G3) - next char specifies the set
      // ESC ( B = ASCII, ESC ( 0 = DEC Special Graphics, etc.
      // We ignore this but need to consume the next character
      this.state = 'charset';
      return;
    } else if (char === '7') {
      this.screen.saveCursor();
      this.state = 'normal';
    } else if (char === '8') {
      this.screen.restoreCursor();
      this.state = 'normal';
    } else if (char === 'c') {
      // Reset terminal
      this.screen.eraseInDisplay(2);
      this.screen.setCursor(1, 1);
      this.state = 'normal';
    } else if (char === 'M') {
      // Reverse index - move up, scroll region down if at top
      this.screen.reverseIndex();
      this.state = 'normal';
    } else {
      // Unknown escape sequence
      debugLog(`[ANSI] Unknown ESC sequence: ESC ${char} (0x${code.toString(16)})`);
      this.state = 'normal';
    }
  }

  private processCSI(char: string, code: number): void {
    if ((code >= 0x30 && code <= 0x3f) || char === ';') {
      // Parameter bytes
      this.csiParams += char;
    } else if (code >= 0x40 && code <= 0x7e) {
      // Final byte - execute command
      this.executeCSI(char);
      this.state = 'normal';
    } else {
      // Invalid - abort
      this.state = 'normal';
    }
  }

  private executeCSI(command: string): void {
    const params = this.csiParams.split(';').map((p) => parseInt(p, 10) || 0);

    switch (command) {
      case 'A': // Cursor Up
        this.screen.cursorUp(params[0] || 1);
        break;
      case 'B': // Cursor Down
        this.screen.cursorDown(params[0] || 1);
        break;
      case 'C': // Cursor Forward
        this.screen.cursorForward(params[0] || 1);
        break;
      case 'D': // Cursor Backward
        this.screen.cursorBackward(params[0] || 1);
        break;
      case 'H': // Cursor Position
      case 'f':
        this.screen.setCursor(params[0] || 1, params[1] || 1);
        break;
      case 'J': // Erase in Display
        this.screen.eraseInDisplay(params[0] || 0);
        break;
      case 'K': // Erase in Line
        this.screen.eraseInLine(params[0] || 0);
        break;
      case 'm': // SGR (Select Graphic Rendition)
        this.screen.setGraphicsRendition(params);
        break;
      case 's': // Save cursor
        this.screen.saveCursor();
        break;
      case 'u': // Restore cursor
        this.screen.restoreCursor();
        break;
      case 'G': // Cursor Horizontal Absolute
        this.screen.setCursor(this.screen.getCursor().y + 1, params[0] || 1);
        break;
      case 'd': // Cursor Vertical Absolute
        this.screen.setCursor(params[0] || 1, this.screen.getCursor().x + 1);
        break;
      case 'h': // Set mode
      case 'l': // Reset mode
        // Handle private modes (CSI ? Ps h/l)
        if (this.csiParams.startsWith('?')) {
          const mode = parseInt(this.csiParams.slice(1), 10);
          if (mode === 25) {
            // DECTCEM - Cursor visibility
            this.screen.setCursorVisible(command === 'h');
          } else if (mode === 1049) {
            // Alternate screen buffer
            if (command === 'h') {
              this.screen.enterAlternateScreen();
            } else {
              this.screen.exitAlternateScreen();
            }
          } else if (mode === 2026) {
            // Synchronized updates (kitty/iTerm2 extension)
            // h = begin synchronized update, l = end synchronized update
            // We don't buffer, so just acknowledge and ignore
          } else if (mode === 1) {
            // DECCKM - Cursor keys mode (application vs normal)
            // Ignored - we always use normal mode cursor keys
          } else if (mode === 7) {
            // DECAWM - Auto-wrap mode
            // Ignored - we always have auto-wrap enabled
          } else if (mode === 12) {
            // Cursor blinking (AT&T 610)
            // Ignored - cursor blink is a visual preference
          } else {
            // Log unhandled private modes
            debugLog(`[ANSI] Unhandled private mode: CSI ? ${mode} ${command}`);
          }
        }
        break;
      case 'r': // DECSTBM - Set scroll region
        if (params.length === 0 || (params[0] === 0 && params[1] === 0)) {
          // CSI r with no params - reset to full screen
          debugLog(`[ANSI] Reset scroll region to full screen`);
          this.screen.resetScrollRegion();
        } else {
          // CSI Pt ; Pb r - set region from top to bottom
          const top = params[0] || 1;
          const bottom = params[1] || this.screen.getRows();
          debugLog(`[ANSI] Set scroll region: top=${top}, bottom=${bottom}`);
          this.screen.setScrollRegion(top, bottom);
        }
        break;
      case '@': // ICH - Insert Characters
        this.screen.insertChars(params[0] || 1);
        break;
      case 'P': // DCH - Delete Characters
        this.screen.deleteChars(params[0] || 1);
        break;
      case 'X': // ECH - Erase Characters
        this.screen.eraseChars(params[0] || 1);
        break;
      case 'L': // IL - Insert Lines
        this.screen.insertLines(params[0] || 1);
        break;
      case 'M': // DL - Delete Lines
        this.screen.deleteLines(params[0] || 1);
        break;
      case 'E': // CNL - Cursor Next Line
        this.screen.cursorDown(params[0] || 1);
        this.screen.carriageReturn();
        break;
      case 'F': // CPL - Cursor Previous Line
        this.screen.cursorUp(params[0] || 1);
        this.screen.carriageReturn();
        break;
      case 'n': // DSR - Device Status Report
        if (params[0] === 6) {
          // Cursor Position Report - respond with CSI row ; col R
          const cursor = this.screen.getCursor();
          // Convert 0-indexed to 1-indexed
          const response = `\x1b[${cursor.y + 1};${cursor.x + 1}R`;
          debugLog(`[ANSI] DSR 6: Reporting cursor position ${cursor.y + 1};${cursor.x + 1}, sending response`);
          this.sendOutput(response);
          debugLog(`[ANSI] DSR 6: Response sent (callback exists: ${!!this.onOutputCallback})`);
        } else if (params[0] === 5) {
          // Device status - respond "OK"
          debugLog(`[ANSI] DSR 5: Reporting OK status`);
          this.sendOutput('\x1b[0n');
        }
        break;
      case 'c': // DA - Device Attributes
        // Respond as VT100 with advanced video option
        // CSI ? 1 ; 2 c means "VT100 with Advanced Video Option"
        debugLog(`[ANSI] DA: Reporting device attributes`);
        this.sendOutput('\x1b[?1;2c');
        break;
      default:
        // Unknown CSI command - log for debugging
        debugLog(`[ANSI] Unknown CSI command: CSI ${this.csiParams} ${command}`);
        break;
    }
  }

  private processOSC(char: string, code: number): void {
    if (code === 0x07 || (code === 0x1b && this.oscData.endsWith('\\'))) {
      // OSC terminator (BEL or ESC \)
      this.handleOSC(this.oscData);
      this.oscData = '';
      this.state = 'normal';
    } else if (code === 0x1b) {
      // Might be ESC \ terminator
      this.oscData += char;
    } else {
      this.oscData += char;
      // Safety limit
      if (this.oscData.length > 4096) {
        this.state = 'normal';
      }
    }
  }

  /**
   * Handle a complete OSC sequence.
   */
  private handleOSC(data: string): void {
    // Remove trailing ESC if present (for ESC \ terminator)
    if (data.endsWith('\x1b')) {
      data = data.slice(0, -1);
    }

    // Parse OSC code (first part before semicolon)
    const semicolonIndex = data.indexOf(';');
    if (semicolonIndex === -1) return;

    const oscCode = parseInt(data.substring(0, semicolonIndex), 10);
    const oscContent = data.substring(semicolonIndex + 1);

    switch (oscCode) {
      case 0: // Set icon name and window title
      case 1: // Set icon name
      case 2: // Set window title
        // Title changes - could emit via callback if needed
        break;

      case 99:
        // OSC 99: Application notifications (used by Claude Code, etc.)
        // Format: 99;i=<id>:p=<part>;<message>
        // Example: 99;i=1242:p=body;Claude is waiting for your input
        this.parseOSC99(oscContent);
        break;
    }
  }

  /**
   * Parse OSC 99 notification format.
   * Format: i=<id>:p=<part>;<message>
   */
  private parseOSC99(content: string): void {
    // Find the message part after the metadata
    // Format: i=1242:p=body;Claude is waiting for your input
    const parts = content.split(';');
    if (parts.length < 2) return;

    // The message is everything after the first semicolon
    const message = parts.slice(1).join(';');

    // Check if this is a body message (the actual notification text)
    const metadata = parts[0] ?? '';
    if (metadata.includes('p=body') && message && this.onNotificationCallback) {
      this.onNotificationCallback(message);
    }
  }
}
