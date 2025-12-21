/**
 * TerminalSession Element
 *
 * An embedded terminal element for running shell commands.
 */

import { BaseElement, type ElementContext } from './base.ts';
import type { KeyEvent, MouseEvent, Cell } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';

// ============================================
// Types
// ============================================

/**
 * Terminal line with styled cells.
 */
export interface TerminalLine {
  cells: Cell[];
}

/**
 * Callbacks for terminal session.
 */
export interface TerminalSessionCallbacks {
  /** Called when data should be written to the PTY */
  onData?: (data: string) => void;
  /** Called when terminal is resized */
  onResize?: (cols: number, rows: number) => void;
  /** Called when terminal title changes */
  onTitleChange?: (title: string) => void;
  /** Called when terminal exits */
  onExit?: (code: number) => void;
}

/**
 * Terminal state for serialization.
 */
export interface TerminalSessionState {
  cwd?: string;
  scrollTop: number;
}

// ============================================
// TerminalSession Element
// ============================================

export class TerminalSession extends BaseElement {
  /** Terminal lines (scrollback + visible) */
  private lines: TerminalLine[] = [];

  /** Cursor position */
  private cursorX = 0;
  private cursorY = 0;

  /** Scroll offset (for scrollback) */
  private scrollTop = 0;

  /** Scrollback limit */
  private scrollbackLimit = 1000;

  /** Current working directory */
  private cwd: string = '';

  /** Whether terminal has exited */
  private exited = false;

  /** Exit code (if exited) */
  private exitCode: number | null = null;

  /** Callbacks */
  private callbacks: TerminalSessionCallbacks;

  /** Current text style */
  private currentFg = '#cccccc';
  private currentBg = '#1e1e1e';
  private currentBold = false;

  /** Number of visible rows */
  private visibleRows = 24;
  private visibleCols = 80;

  /** Alternate screen buffer (for programs like vim) */
  private alternateScreen = false;
  private savedLines: TerminalLine[] = [];
  private savedCursorX = 0;
  private savedCursorY = 0;

  constructor(id: string, title: string, ctx: ElementContext, callbacks: TerminalSessionCallbacks = {}) {
    super('TerminalSession', id, title, ctx);
    this.callbacks = callbacks;
    this.initializeBuffer();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Callback Configuration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set callbacks after construction.
   * Useful when element is created via factory.
   */
  setCallbacks(callbacks: TerminalSessionCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Get current callbacks.
   */
  getCallbacks(): TerminalSessionCallbacks {
    return this.callbacks;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Initialization
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Initialize terminal buffer.
   */
  private initializeBuffer(): void {
    this.lines = [];
    for (let i = 0; i < this.visibleRows; i++) {
      this.lines.push(this.createEmptyLine());
    }
  }

  /**
   * Create an empty line.
   */
  private createEmptyLine(): TerminalLine {
    const cells: Cell[] = [];
    for (let i = 0; i < this.visibleCols; i++) {
      cells.push({ char: ' ', fg: this.currentFg, bg: this.currentBg });
    }
    return { cells };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Output Processing
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Write output data to terminal.
   * Processes ANSI escape sequences.
   */
  write(data: string): void {
    let i = 0;
    while (i < data.length) {
      const char = data[i];

      if (char === '\x1b') {
        // Start of escape sequence
        const result = this.parseEscapeSequence(data, i);
        if (result) {
          i = result.nextIndex;
          continue;
        }
      }

      // Handle control characters
      if (char === '\n') {
        this.newLine();
      } else if (char === '\r') {
        this.cursorX = 0;
      } else if (char === '\b') {
        if (this.cursorX > 0) this.cursorX--;
      } else if (char === '\t') {
        // Tab to next 8-column boundary
        const nextTab = (Math.floor(this.cursorX / 8) + 1) * 8;
        this.cursorX = Math.min(nextTab, this.visibleCols - 1);
      } else if (char && char >= ' ') {
        // Printable character
        this.writeChar(char);
      }

      i++;
    }

    this.ctx.markDirty();
  }

  /**
   * Write a character at cursor position.
   */
  private writeChar(char: string): void {
    const lineIdx = this.getBufferLineIndex();
    if (lineIdx >= this.lines.length) {
      this.lines.push(this.createEmptyLine());
    }

    const line = this.lines[lineIdx]!;
    if (this.cursorX >= this.visibleCols) {
      // Wrap to next line
      this.newLine();
    }

    // Ensure line has enough cells
    while (line.cells.length <= this.cursorX) {
      line.cells.push({ char: ' ', fg: this.currentFg, bg: this.currentBg });
    }

    line.cells[this.cursorX]! = {
      char,
      fg: this.currentFg,
      bg: this.currentBg,
      bold: this.currentBold || undefined,
    };
    this.cursorX++;
  }

  /**
   * Handle newline.
   */
  private newLine(): void {
    this.cursorX = 0;
    this.cursorY++;

    // Scroll if at bottom
    if (this.cursorY >= this.visibleRows) {
      if (!this.alternateScreen) {
        // Normal mode: scroll buffer
        this.lines.push(this.createEmptyLine());
        // Trim scrollback
        while (this.lines.length > this.scrollbackLimit + this.visibleRows) {
          this.lines.shift();
        }
      } else {
        // Alternate screen: scroll within visible area
        const start = this.lines.length - this.visibleRows;
        this.lines.splice(start, 1);
        this.lines.push(this.createEmptyLine());
      }
      this.cursorY = this.visibleRows - 1;
    }
  }

  /**
   * Get line index in buffer for current cursor position.
   */
  private getBufferLineIndex(): number {
    if (this.alternateScreen) {
      return this.lines.length - this.visibleRows + this.cursorY;
    }
    return this.lines.length - this.visibleRows + this.cursorY;
  }

  /**
   * Parse escape sequence.
   */
  private parseEscapeSequence(data: string, start: number): { nextIndex: number } | null {
    if (start + 1 >= data.length) return null;

    const next = data[start + 1];

    // CSI sequence
    if (next === '[') {
      return this.parseCSI(data, start + 2);
    }

    // OSC sequence (Operating System Command)
    if (next === ']') {
      return this.parseOSC(data, start + 2);
    }

    // Simple escape sequences
    if (next === 'c') {
      // Reset terminal
      this.initializeBuffer();
      return { nextIndex: start + 2 };
    }

    return null;
  }

  /**
   * Parse CSI (Control Sequence Introducer) sequence.
   */
  private parseCSI(data: string, start: number): { nextIndex: number } | null {
    let i = start;
    let params = '';

    // Collect parameters
    while (i < data.length && (data[i]! >= '0' && data[i]! <= '9' || data[i] === ';' || data[i] === '?')) {
      params += data[i]!;
      i++;
    }

    if (i >= data.length) return null;

    const command = data[i]!;
    const args = params.split(';').map((p) => parseInt(p, 10) || 0);

    this.executeCSI(command, args, params.startsWith('?'));

    return { nextIndex: i + 1 };
  }

  /**
   * Execute CSI command.
   */
  private executeCSI(command: string, args: number[], isPrivate: boolean): void {
    switch (command) {
      case 'A': // Cursor up
        this.cursorY = Math.max(0, this.cursorY - (args[0] || 1));
        break;
      case 'B': // Cursor down
        this.cursorY = Math.min(this.visibleRows - 1, this.cursorY + (args[0] || 1));
        break;
      case 'C': // Cursor forward
        this.cursorX = Math.min(this.visibleCols - 1, this.cursorX + (args[0] || 1));
        break;
      case 'D': // Cursor back
        this.cursorX = Math.max(0, this.cursorX - (args[0] || 1));
        break;
      case 'H': // Cursor position
      case 'f':
        this.cursorY = Math.max(0, Math.min(this.visibleRows - 1, (args[0] || 1) - 1));
        this.cursorX = Math.max(0, Math.min(this.visibleCols - 1, (args[1] || 1) - 1));
        break;
      case 'J': // Erase in display
        this.eraseDisplay(args[0] || 0);
        break;
      case 'K': // Erase in line
        this.eraseLine(args[0] || 0);
        break;
      case 'm': // SGR (Select Graphic Rendition)
        this.processSGR(args);
        break;
      case 'h': // Set mode
        if (isPrivate && args[0] === 1049) {
          // Enable alternate screen buffer
          this.enterAlternateScreen();
        }
        break;
      case 'l': // Reset mode
        if (isPrivate && args[0] === 1049) {
          // Disable alternate screen buffer
          this.exitAlternateScreen();
        }
        break;
    }
  }

  /**
   * Process SGR (text styling) sequence.
   */
  private processSGR(args: number[]): void {
    if (args.length === 0) args = [0];

    let i = 0;
    while (i < args.length) {
      const code = args[i]!;

      if (code === 0) {
        // Reset
        this.currentFg = '#cccccc';
        this.currentBg = '#1e1e1e';
        this.currentBold = false;
      } else if (code === 1) {
        this.currentBold = true;
      } else if (code === 22) {
        this.currentBold = false;
      } else if (code >= 30 && code <= 37) {
        // Standard foreground colors
        this.currentFg = this.getStandardColor(code - 30);
      } else if (code >= 40 && code <= 47) {
        // Standard background colors
        this.currentBg = this.getStandardColor(code - 40);
      } else if (code === 38 && args[i + 1] === 5) {
        // 256-color foreground
        this.currentFg = this.get256Color(args[i + 2] || 0);
        i += 2;
      } else if (code === 48 && args[i + 1] === 5) {
        // 256-color background
        this.currentBg = this.get256Color(args[i + 2] || 0);
        i += 2;
      } else if (code === 38 && args[i + 1] === 2) {
        // True color foreground
        const r = args[i + 2] || 0;
        const g = args[i + 3] || 0;
        const b = args[i + 4] || 0;
        this.currentFg = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        i += 4;
      } else if (code === 48 && args[i + 1] === 2) {
        // True color background
        const r = args[i + 2] || 0;
        const g = args[i + 3] || 0;
        const b = args[i + 4] || 0;
        this.currentBg = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        i += 4;
      } else if (code === 39) {
        // Default foreground
        this.currentFg = '#cccccc';
      } else if (code === 49) {
        // Default background
        this.currentBg = '#1e1e1e';
      }

      i++;
    }
  }

  /**
   * Get standard ANSI color.
   */
  private getStandardColor(index: number): string {
    const colors = [
      '#000000', // Black
      '#cd0000', // Red
      '#00cd00', // Green
      '#cdcd00', // Yellow
      '#0000ee', // Blue
      '#cd00cd', // Magenta
      '#00cdcd', // Cyan
      '#e5e5e5', // White
    ];
    return colors[index] ?? '#cccccc';
  }

  /**
   * Get 256-color palette color.
   */
  private get256Color(index: number): string {
    if (index < 16) {
      // Standard colors + bright colors
      const colors = [
        '#000000', '#cd0000', '#00cd00', '#cdcd00',
        '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
        '#7f7f7f', '#ff0000', '#00ff00', '#ffff00',
        '#5c5cff', '#ff00ff', '#00ffff', '#ffffff',
      ];
      return colors[index]!;
    }

    if (index < 232) {
      // 216-color cube
      const i = index - 16;
      const r = Math.floor(i / 36);
      const g = Math.floor((i % 36) / 6);
      const b = i % 6;
      const toHex = (v: number) => (v === 0 ? 0 : 55 + v * 40).toString(16).padStart(2, '0');
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    // Grayscale
    const gray = 8 + (index - 232) * 10;
    const hex = gray.toString(16).padStart(2, '0');
    return `#${hex}${hex}${hex}`;
  }

  /**
   * Parse OSC (Operating System Command) sequence.
   */
  private parseOSC(data: string, start: number): { nextIndex: number } | null {
    // Find terminator (BEL or ST)
    let end = start;
    while (end < data.length) {
      if (data[end] === '\x07') {
        break;
      }
      if (data[end] === '\x1b' && data[end + 1] === '\\') {
        break;
      }
      end++;
    }

    if (end >= data.length) return null;

    const content = data.slice(start, end);
    const termLen = data[end] === '\x07' ? 1 : 2;

    // Parse OSC
    const semicolon = content.indexOf(';');
    if (semicolon !== -1) {
      const code = parseInt(content.slice(0, semicolon), 10);
      const value = content.slice(semicolon + 1);

      if (code === 0 || code === 2) {
        // Set window title
        this.setTitle(value);
        this.callbacks.onTitleChange?.(value);
      }
    }

    return { nextIndex: end + termLen };
  }

  /**
   * Erase display.
   */
  private eraseDisplay(mode: number): void {
    const lineIdx = this.getBufferLineIndex();

    if (mode === 0) {
      // Erase from cursor to end
      this.eraseLine(0);
      for (let i = lineIdx + 1; i < this.lines.length; i++) {
        this.lines[i] = this.createEmptyLine();
      }
    } else if (mode === 1) {
      // Erase from start to cursor
      for (let i = 0; i < lineIdx; i++) {
        this.lines[i] = this.createEmptyLine();
      }
      this.eraseLine(1);
    } else if (mode === 2 || mode === 3) {
      // Erase all
      for (let i = 0; i < this.lines.length; i++) {
        this.lines[i] = this.createEmptyLine();
      }
    }
  }

  /**
   * Erase line.
   */
  private eraseLine(mode: number): void {
    const lineIdx = this.getBufferLineIndex();
    if (lineIdx >= this.lines.length) return;

    const line = this.lines[lineIdx]!;

    if (mode === 0) {
      // Erase from cursor to end of line
      for (let i = this.cursorX; i < line.cells.length; i++) {
        line.cells[i]! = { char: ' ', fg: this.currentFg, bg: this.currentBg };
      }
    } else if (mode === 1) {
      // Erase from start of line to cursor
      for (let i = 0; i <= this.cursorX && i < line.cells.length; i++) {
        line.cells[i]! = { char: ' ', fg: this.currentFg, bg: this.currentBg };
      }
    } else if (mode === 2) {
      // Erase entire line
      this.lines[lineIdx] = this.createEmptyLine();
    }
  }

  /**
   * Enter alternate screen buffer.
   */
  private enterAlternateScreen(): void {
    if (this.alternateScreen) return;
    this.savedLines = this.lines;
    this.savedCursorX = this.cursorX;
    this.savedCursorY = this.cursorY;
    this.lines = [];
    for (let i = 0; i < this.visibleRows; i++) {
      this.lines.push(this.createEmptyLine());
    }
    this.cursorX = 0;
    this.cursorY = 0;
    this.alternateScreen = true;
  }

  /**
   * Exit alternate screen buffer.
   */
  private exitAlternateScreen(): void {
    if (!this.alternateScreen) return;
    this.lines = this.savedLines;
    this.cursorX = this.savedCursorX;
    this.cursorY = this.savedCursorY;
    this.savedLines = [];
    this.alternateScreen = false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set current working directory.
   */
  setCwd(cwd: string): void {
    this.cwd = cwd;
  }

  /**
   * Get current working directory.
   */
  getCwd(): string {
    return this.cwd;
  }

  /**
   * Mark terminal as exited.
   */
  setExited(code: number): void {
    this.exited = true;
    this.exitCode = code;
    this.callbacks.onExit?.(code);
    this.ctx.markDirty();
  }

  /**
   * Check if terminal has exited.
   */
  hasExited(): boolean {
    return this.exited;
  }

  /**
   * Clear terminal.
   */
  clear(): void {
    this.initializeBuffer();
    this.cursorX = 0;
    this.cursorY = 0;
    this.scrollTop = 0;
    this.ctx.markDirty();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  override onResize(size: { width: number; height: number }): void {
    super.onResize(size);

    const newCols = Math.max(1, size.width);
    const newRows = Math.max(1, size.height);

    if (newCols !== this.visibleCols || newRows !== this.visibleRows) {
      this.visibleCols = newCols;
      this.visibleRows = newRows;

      // Resize existing lines
      for (const line of this.lines) {
        while (line.cells.length < newCols) {
          line.cells.push({ char: ' ', fg: this.currentFg, bg: this.currentBg });
        }
      }

      // Add/remove rows
      while (this.lines.length < newRows) {
        this.lines.push(this.createEmptyLine());
      }

      this.callbacks.onResize?.(newCols, newRows);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  render(buffer: ScreenBuffer): void {
    const { x, y, width, height } = this.bounds;
    const defaultBg = this.ctx.getThemeColor('terminal.background', '#1e1e1e');
    const defaultFg = this.ctx.getThemeColor('terminal.foreground', '#cccccc');
    const cursorBg = this.ctx.getThemeColor('terminalCursor.foreground', '#ffffff');

    // Calculate visible range
    const startLine = this.lines.length - this.visibleRows - this.scrollTop;

    for (let row = 0; row < height; row++) {
      const lineIdx = startLine + row;
      const screenY = y + row;

      if (lineIdx < 0 || lineIdx >= this.lines.length) {
        // Empty row
        buffer.writeString(x, screenY, ' '.repeat(width), defaultFg, defaultBg);
        continue;
      }

      const line = this.lines[lineIdx]!;

      for (let col = 0; col < width; col++) {
        const cell = line.cells[col];
        if (cell) {
          buffer.set(x + col, screenY, {
            char: cell.char,
            fg: cell.fg ?? defaultFg,
            bg: cell.bg ?? defaultBg,
            bold: cell.bold,
          });
        } else {
          buffer.set(x + col, screenY, { char: ' ', fg: defaultFg, bg: defaultBg });
        }
      }

      // Render cursor
      if (this.focused && !this.alternateScreen && this.scrollTop === 0) {
        const cursorLine = this.lines.length - this.visibleRows + this.cursorY;
        if (lineIdx === cursorLine && this.cursorX < width) {
          const cursorCell = buffer.get(x + this.cursorX, screenY);
          buffer.set(x + this.cursorX, screenY, {
            char: cursorCell?.char ?? ' ',
            fg: defaultBg,
            bg: cursorBg,
          });
        }
      }
    }

    // Show exit status if terminal has exited
    if (this.exited) {
      const msg = `[Process exited with code ${this.exitCode}]`;
      const msgX = x + Math.floor((width - msg.length) / 2);
      const msgY = y + height - 1;
      buffer.writeString(msgX, msgY, msg, '#888888', defaultBg);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  override handleKey(event: KeyEvent): boolean {
    if (this.exited) return false;

    // Convert key event to terminal input
    let data = '';

    if (event.ctrl) {
      // Control sequences
      if (event.key.length === 1) {
        const code = event.key.toLowerCase().charCodeAt(0);
        if (code >= 97 && code <= 122) {
          // Ctrl+A = 1, Ctrl+Z = 26
          data = String.fromCharCode(code - 96);
        }
      }
    } else if (event.key.length === 1) {
      // Regular character
      data = event.key;
    } else {
      // Special keys
      switch (event.key) {
        case 'Enter':
          data = '\r';
          break;
        case 'Backspace':
          data = '\x7f';
          break;
        case 'Tab':
          data = '\t';
          break;
        case 'Escape':
          data = '\x1b';
          break;
        case 'ArrowUp':
          data = '\x1b[A';
          break;
        case 'ArrowDown':
          data = '\x1b[B';
          break;
        case 'ArrowRight':
          data = '\x1b[C';
          break;
        case 'ArrowLeft':
          data = '\x1b[D';
          break;
        case 'Home':
          data = '\x1b[H';
          break;
        case 'End':
          data = '\x1b[F';
          break;
        case 'Delete':
          data = '\x1b[3~';
          break;
        case 'PageUp':
          data = '\x1b[5~';
          break;
        case 'PageDown':
          data = '\x1b[6~';
          break;
      }
    }

    if (data) {
      this.callbacks.onData?.(data);
      return true;
    }

    return false;
  }

  override handleMouse(event: MouseEvent): boolean {
    if (event.type === 'scroll') {
      // Scrollback
      const delta = event.y > 0 ? 3 : -3;
      const maxScroll = Math.max(0, this.lines.length - this.visibleRows);
      this.scrollTop = Math.max(0, Math.min(this.scrollTop - delta, maxScroll));
      this.ctx.markDirty();
      return true;
    }

    if (event.type === 'press') {
      this.ctx.requestFocus();
      return true;
    }

    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State Serialization
  // ─────────────────────────────────────────────────────────────────────────

  override getState(): TerminalSessionState {
    return {
      cwd: this.cwd || undefined,
      scrollTop: this.scrollTop,
    };
  }

  override setState(state: unknown): void {
    const s = state as TerminalSessionState;
    if (s.cwd) {
      this.cwd = s.cwd;
    }
    if (s.scrollTop !== undefined) {
      this.scrollTop = s.scrollTop;
    }
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a terminal session element.
 */
export function createTerminalSession(
  id: string,
  title: string,
  ctx: ElementContext,
  callbacks?: TerminalSessionCallbacks
): TerminalSession {
  return new TerminalSession(id, title, ctx, callbacks);
}
