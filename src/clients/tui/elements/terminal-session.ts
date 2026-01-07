/**
 * TerminalSession Element
 *
 * An embedded terminal element for running shell commands.
 * Can optionally be connected to a PTYBackend for live terminal emulation.
 */

import { BaseElement, type ElementContext } from './base.ts';
import type { KeyEvent, MouseEvent, Cell } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import type {
  PTYBackend,
  TerminalCell,
  Unsubscribe,
} from '../../../terminal/pty-backend.ts';

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
  /** Scrollbar width in characters */
  private static readonly SCROLLBAR_WIDTH = 1;

  /** Terminal lines (scrollback + visible) */
  private lines: TerminalLine[] = [];

  /** Cursor position */
  private cursorX = 0;
  private cursorY = 0;

  /** Scroll offset (for scrollback) */
  private scrollTop = 0;

  /** Scrollback limit */
  private scrollbackLimit = 1000;

  /** Whether scrollbar dragging is active */
  private scrollbarDragging = false;

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

  /** PTY Backend (optional - for live terminal emulation) */
  private pty: PTYBackend | null = null;
  private ptyUnsubscribes: Unsubscribe[] = [];

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
  // PTY Backend Connection
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Attach a PTY backend for live terminal emulation.
   * When attached, rendering uses the PTY buffer and input is forwarded to PTY.
   */
  attachPty(pty: PTYBackend): void {
    // Detach existing PTY if any
    this.detachPty();

    this.pty = pty;

    // Wire up PTY callbacks
    this.ptyUnsubscribes.push(
      pty.onUpdate(() => {
        this.ctx.markDirty();
      })
    );

    this.ptyUnsubscribes.push(
      pty.onTitle((title) => {
        this.setTitle(title);
        this.callbacks.onTitleChange?.(title);
      })
    );

    this.ptyUnsubscribes.push(
      pty.onExit((code) => {
        this.exited = true;
        this.exitCode = code;
        this.callbacks.onExit?.(code);
        this.ctx.markDirty();
      })
    );

    // Sync initial size
    const size = pty.getSize();
    this.visibleCols = size.cols;
    this.visibleRows = size.rows;

    // Sync CWD if available
    const cwd = pty.getCwd();
    if (cwd) {
      this.cwd = cwd;
    }
  }

  /**
   * Detach the PTY backend.
   */
  detachPty(): void {
    // Unsubscribe all PTY callbacks
    for (const unsub of this.ptyUnsubscribes) {
      unsub();
    }
    this.ptyUnsubscribes = [];
    this.pty = null;
  }

  /**
   * Check if PTY is attached.
   */
  hasPty(): boolean {
    return this.pty !== null;
  }

  /**
   * Get the attached PTY backend.
   */
  getPty(): PTYBackend | null {
    return this.pty;
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

      // Resize PTY if attached
      if (this.pty) {
        this.pty.resize(newCols, newRows);
      } else {
        // Resize internal buffer (only when no PTY)
        for (const line of this.lines) {
          while (line.cells.length < newCols) {
            line.cells.push({ char: ' ', fg: this.currentFg, bg: this.currentBg });
          }
        }

        // Add/remove rows
        while (this.lines.length < newRows) {
          this.lines.push(this.createEmptyLine());
        }
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

    // Reserve space for scrollbar
    const contentWidth = width - TerminalSession.SCROLLBAR_WIDTH;

    // Use PTY buffer if attached, otherwise use internal buffer
    if (this.pty) {
      this.renderFromPty(buffer, x, y, contentWidth, height, defaultFg, defaultBg, cursorBg);
    } else {
      this.renderFromInternal(buffer, x, y, contentWidth, height, defaultFg, defaultBg, cursorBg);
    }

    // Render scrollbar
    this.renderScrollbar(buffer);

    // Show exit status if terminal has exited
    if (this.exited) {
      const msg = `[Process exited with code ${this.exitCode}]`;
      const msgX = x + Math.floor((contentWidth - msg.length) / 2);
      const msgY = y + height - 1;
      buffer.writeString(msgX, msgY, msg, '#888888', defaultBg);
    }
  }

  /**
   * Render from PTY backend buffer.
   */
  private renderFromPty(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number,
    height: number,
    defaultFg: string,
    defaultBg: string,
    cursorBg: string
  ): void {
    if (!this.pty) return;

    // getBuffer() returns view-adjusted content (already accounts for viewOffset)
    const ptyBuffer = this.pty.getBuffer();
    const cursor = this.pty.getCursor();
    const viewOffset = this.pty.getViewOffset();

    for (let row = 0; row < height; row++) {
      const screenY = y + row;

      if (row >= ptyBuffer.length) {
        // Empty row (buffer smaller than display area)
        buffer.writeString(x, screenY, ' '.repeat(width), defaultFg, defaultBg);
        continue;
      }

      const line = ptyBuffer[row]!;

      for (let col = 0; col < width; col++) {
        const cell = line[col];
        if (cell) {
          const converted = this.convertTerminalCell(cell, defaultFg, defaultBg);
          buffer.set(x + col, screenY, converted);
        } else {
          buffer.set(x + col, screenY, { char: ' ', fg: defaultFg, bg: defaultBg });
        }
      }

      // Render cursor (only when not scrolled back and focused)
      if (this.focused && viewOffset === 0 && row === cursor.y && cursor.x < width) {
        const cursorCell = buffer.get(x + cursor.x, screenY);
        buffer.set(x + cursor.x, screenY, {
          char: cursorCell?.char ?? ' ',
          fg: defaultBg,
          bg: cursorBg,
        });
      }
    }
  }

  /**
   * Render from internal buffer (when no PTY attached).
   */
  private renderFromInternal(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number,
    height: number,
    defaultFg: string,
    defaultBg: string,
    cursorBg: string
  ): void {
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
  }

  /**
   * Convert PTY TerminalCell to TUI Cell.
   */
  private convertTerminalCell(cell: TerminalCell, defaultFg: string, defaultBg: string): Cell {
    return {
      // Keep placeholder cells (char === '') as empty - the wide character
      // before them already clears both terminal cells when written.
      char: cell.char,
      fg: cell.fg ?? defaultFg,
      bg: cell.bg ?? defaultBg,
      bold: cell.bold || undefined,
      italic: cell.italic || undefined,
      underline: cell.underline || undefined,
      dim: cell.dim || undefined,
    };
  }

  /**
   * Render the vertical scrollbar.
   */
  private renderScrollbar(buffer: ScreenBuffer): void {
    const { x, y, width, height } = this.bounds;
    const scrollbarX = x + width - TerminalSession.SCROLLBAR_WIDTH;

    const trackBg = this.ctx.getThemeColor('scrollbarSlider.background', '#4a4a4a');
    const thumbBg = this.ctx.getThemeColor('scrollbarSlider.activeBackground', '#6a6a6a');

    // Calculate total lines and view offset
    let totalLines: number;
    let viewOffset: number;

    if (this.pty) {
      totalLines = this.pty.getTotalLines();
      viewOffset = this.pty.getViewOffset();
    } else {
      totalLines = this.lines.length;
      viewOffset = this.scrollTop;
    }

    // Calculate thumb size and position
    const visibleLines = height;

    if (totalLines <= visibleLines) {
      // No scrollback, just show empty track
      for (let row = 0; row < height; row++) {
        buffer.set(scrollbarX, y + row, { char: '░', fg: trackBg, bg: trackBg });
      }
      return;
    }

    // Thumb height proportional to visible content
    const thumbHeight = Math.max(1, Math.round((visibleLines / totalLines) * height));

    // Thumb position: viewOffset 0 means at bottom, higher means scrolled up
    const maxOffset = totalLines - visibleLines;
    const scrollRatio = viewOffset / maxOffset;
    // When scrolled to top (max offset), thumb at top; when at bottom (0 offset), thumb at bottom
    const thumbTop = Math.round((1 - scrollRatio) * (height - thumbHeight));

    // Render scrollbar track and thumb
    for (let row = 0; row < height; row++) {
      const screenY = y + row;
      const isThumb = row >= thumbTop && row < thumbTop + thumbHeight;
      const bg = isThumb ? thumbBg : trackBg;
      const char = isThumb ? '█' : '░';

      buffer.set(scrollbarX, screenY, { char, fg: bg, bg: trackBg });
    }
  }

  /**
   * Get scrollbar X position.
   */
  private getScrollbarX(): number {
    return this.bounds.x + this.bounds.width - TerminalSession.SCROLLBAR_WIDTH;
  }

  /**
   * Handle scrollbar click/drag.
   */
  private handleScrollbarClick(mouseY: number): void {
    const { y, height } = this.bounds;
    const relY = mouseY - y;

    // Calculate target scroll position
    const ratio = Math.max(0, Math.min(1, relY / height));

    if (this.pty) {
      const totalLines = this.pty.getTotalLines();
      const visibleLines = height;
      const maxOffset = Math.max(0, totalLines - visibleLines);
      // Invert ratio: clicking at top means scroll to beginning (max offset)
      const targetOffset = Math.round((1 - ratio) * maxOffset);

      // Calculate how much to scroll
      const currentOffset = this.pty.getViewOffset();
      const delta = targetOffset - currentOffset;

      if (delta > 0) {
        this.pty.scrollViewUp(delta);
      } else if (delta < 0) {
        this.pty.scrollViewDown(-delta);
      }
    } else {
      const maxScroll = Math.max(0, this.lines.length - this.visibleRows);
      // Invert ratio: clicking at top means scroll to beginning (max scroll)
      this.scrollTop = Math.round((1 - ratio) * maxScroll);
    }

    this.ctx.markDirty();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  override handleKey(event: KeyEvent): boolean {
    if (this.exited) return false;

    // Convert key event to terminal input sequence
    const data = this.keyToSequence(event);

    if (data) {
      // Write to PTY if attached, otherwise use callback
      if (this.pty) {
        this.pty.write(data);
      } else {
        this.callbacks.onData?.(data);
      }
      return true;
    }

    return false;
  }

  /**
   * Convert key event to terminal escape sequence.
   */
  private keyToSequence(event: KeyEvent): string {
    if (event.ctrl) {
      // Control sequences
      if (event.key.length === 1) {
        const code = event.key.toLowerCase().charCodeAt(0);
        if (code >= 97 && code <= 122) {
          // Ctrl+A = 1, Ctrl+Z = 26
          return String.fromCharCode(code - 96);
        }
      }
    } else if (event.key.length === 1) {
      // Regular character
      return event.key;
    } else {
      // Special keys
      switch (event.key) {
        case 'Enter':
          return '\r';
        case 'Backspace':
          return '\x7f';
        case 'Tab':
          return '\t';
        case 'Escape':
          return '\x1b';
        case 'ArrowUp':
          return '\x1b[A';
        case 'ArrowDown':
          return '\x1b[B';
        case 'ArrowRight':
          return '\x1b[C';
        case 'ArrowLeft':
          return '\x1b[D';
        case 'Home':
          return '\x1b[H';
        case 'End':
          return '\x1b[F';
        case 'Delete':
          return '\x1b[3~';
        case 'PageUp':
          return '\x1b[5~';
        case 'PageDown':
          return '\x1b[6~';
      }
    }
    return '';
  }

  override handleMouse(event: MouseEvent): boolean {
    const scrollbarX = this.getScrollbarX();

    // Handle scrollbar interactions
    if (event.x >= scrollbarX) {
      if (event.type === 'press' && event.button === 'left') {
        this.scrollbarDragging = true;
        this.handleScrollbarClick(event.y);
        return true;
      }
      if (event.type === 'drag') {
        this.handleScrollbarClick(event.y);
        return true;
      }
      if (event.type === 'release') {
        this.scrollbarDragging = false;
        return true;
      }
    }

    // Handle scrollbar drag release anywhere
    if (event.type === 'release' && this.scrollbarDragging) {
      this.scrollbarDragging = false;
      return true;
    }

    // Continue scrollbar drag even if mouse moves off scrollbar
    if (event.type === 'drag' && this.scrollbarDragging) {
      this.handleScrollbarClick(event.y);
      return true;
    }

    if (event.type === 'scroll') {
      // Scroll direction: -1 = up, 1 = down
      const direction = event.scrollDirection ?? 1;
      const lines = 3;
      let scrolled = false;

      if (this.pty) {
        if (direction < 0) {
          // Scroll up (view earlier content)
          scrolled = this.pty.scrollViewUp(lines);
        } else {
          // Scroll down (view later content)
          scrolled = this.pty.scrollViewDown(lines);
        }
      } else {
        // For internal buffer: scrollTop increases when scrolling up (viewing earlier content)
        const delta = direction < 0 ? lines : -lines;
        const maxScroll = Math.max(0, this.lines.length - this.visibleRows);
        const newScrollTop = Math.max(0, Math.min(this.scrollTop + delta, maxScroll));
        if (newScrollTop !== this.scrollTop) {
          this.scrollTop = newScrollTop;
          scrolled = true;
        }
      }
      if (scrolled) {
        this.ctx.markDirty();
      }
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
