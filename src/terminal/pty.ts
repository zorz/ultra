/**
 * PTY (Pseudo-Terminal) Support
 * 
 * Uses bun-pty for real PTY support with a simple built-in ANSI parser.
 */

import { spawn } from 'bun-pty';

export interface PTYSize {
  cols: number;
  rows: number;
}

export interface PTYOptions {
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  scrollback?: number;
}

/**
 * Terminal cell with character and attributes
 */
export interface TerminalCell {
  char: string;
  fg: string | null;  // Hex color or null for default
  bg: string | null;  // Hex color or null for default
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
  inverse: boolean;
}

/**
 * Creates a default empty cell
 */
function createEmptyCell(): TerminalCell {
  return {
    char: ' ',
    fg: null,
    bg: null,
    bold: false,
    italic: false,
    underline: false,
    dim: false,
    inverse: false
  };
}

// Standard ANSI 16-color palette
const ANSI_COLORS = [
  '#000000', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
  '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff'
];

/**
 * Convert ANSI color code to hex
 */
function ansiToHex(code: number): string | null {
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
  private viewOffset: number = 0;  // How many lines scrolled back (0 = showing current)
  private cursorX: number = 0;
  private cursorY: number = 0;
  private savedCursorX: number = 0;
  private savedCursorY: number = 0;
  private cursorVisible: boolean = true;  // DECTCEM cursor visibility

  // Current text attributes
  private currentFg: string | null = null;
  private currentBg: string | null = null;
  private bold: boolean = false;
  private italic: boolean = false;
  private underline: boolean = false;
  private dim: boolean = false;
  private inverse: boolean = false;
  
  constructor(private cols: number, private rows: number, private scrollbackLimit: number = 1000) {
    this.buffer = this.createEmptyBuffer();
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
      while (this.buffer[y].length < cols) {
        this.buffer[y].push(createEmptyCell());
      }
      if (this.buffer[y].length > cols) {
        this.buffer[y].length = cols;
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
  }
  
  /**
   * Write a character at current cursor position
   */
  writeChar(char: string): void {
    if (this.cursorX >= this.cols) {
      this.cursorX = 0;
      this.newLine();
    }
    
    if (this.cursorY >= 0 && this.cursorY < this.rows && 
        this.cursorX >= 0 && this.cursorX < this.cols) {
      this.buffer[this.cursorY][this.cursorX] = {
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
    this.cursorY++;
    if (this.cursorY >= this.rows) {
      this.scrollUp();
      this.cursorY = this.rows - 1;
    }
  }
  
  /**
   * Scroll buffer up by one line
   */
  private scrollUp(): void {
    const line = this.buffer.shift();
    if (line) {
      this.scrollback.push(line);
      // Limit scrollback
      if (this.scrollback.length > this.scrollbackLimit) {
        this.scrollback.shift();
      }
    }
    this.buffer.push(this.createEmptyRow());
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
    this.cursorY = Math.max(0, Math.min(this.rows - 1, row - 1));
    this.cursorX = Math.max(0, Math.min(this.cols - 1, col - 1));
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
          this.buffer[this.cursorY][x] = createEmptyCell();
        }
        break;
      case 1: // Erase from start of line to cursor
        for (let x = 0; x <= this.cursorX; x++) {
          this.buffer[this.cursorY][x] = createEmptyCell();
        }
        break;
      case 2: // Erase entire line
        this.buffer[this.cursorY] = this.createEmptyRow();
        break;
    }
  }
  
  /**
   * Set graphics rendition (colors and attributes)
   */
  setGraphicsRendition(params: number[]): void {
    if (params.length === 0) params = [0];
    
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      
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
        this.currentFg = ANSI_COLORS[p - 30];
      } else if (p === 38) {
        // Extended foreground color
        if (params[i + 1] === 5 && params[i + 2] !== undefined) {
          // 256 color
          this.currentFg = ansiToHex(params[i + 2]);
          i += 2;
        } else if (params[i + 1] === 2 && params[i + 4] !== undefined) {
          // RGB color
          const r = params[i + 2];
          const g = params[i + 3];
          const b = params[i + 4];
          this.currentFg = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
          i += 4;
        }
      } else if (p === 39) {
        this.currentFg = null;
      } else if (p >= 40 && p <= 47) {
        // Standard background colors
        this.currentBg = ANSI_COLORS[p - 40];
      } else if (p === 48) {
        // Extended background color
        if (params[i + 1] === 5 && params[i + 2] !== undefined) {
          // 256 color
          this.currentBg = ansiToHex(params[i + 2]);
          i += 2;
        } else if (params[i + 1] === 2 && params[i + 4] !== undefined) {
          // RGB color
          const r = params[i + 2];
          const g = params[i + 3];
          const b = params[i + 4];
          this.currentBg = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
          i += 4;
        }
      } else if (p === 49) {
        this.currentBg = null;
      } else if (p >= 90 && p <= 97) {
        // Bright foreground colors
        this.currentFg = ANSI_COLORS[p - 90 + 8];
      } else if (p >= 100 && p <= 107) {
        // Bright background colors
        this.currentBg = ANSI_COLORS[p - 100 + 8];
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
   */
  scrollViewUp(lines: number): void {
    const maxOffset = this.scrollback.length;
    this.viewOffset = Math.min(this.viewOffset + lines, maxOffset);
  }
  
  /**
   * Scroll view down (towards current)
   */
  scrollViewDown(lines: number): void {
    this.viewOffset = Math.max(this.viewOffset - lines, 0);
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
  private state: 'normal' | 'escape' | 'csi' | 'osc' = 'normal';
  private csiParams: string = '';
  private oscData: string = '';

  /** Callback for OSC 99 notifications (used by Claude Code, etc.) */
  private onNotificationCallback?: (message: string) => void;

  constructor(private screen: ScreenBuffer) {}

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
      const char = data[i];
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
      }
    }
  }
  
  private processNormal(char: string, code: number): void {
    if (code === 0x1b) { // ESC
      this.state = 'escape';
    } else if (code === 0x0d) { // CR
      this.screen.carriageReturn();
    } else if (code === 0x0a) { // LF
      this.screen.newLine();
    } else if (code === 0x08) { // BS
      this.screen.backspace();
    } else if (code === 0x09) { // TAB
      this.screen.tab();
    } else if (code === 0x07) { // BEL
      // Bell - ignore for now
    } else if (code >= 0x20) { // Printable
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
      // Reverse index (scroll down)
      this.screen.cursorUp(1);
      this.state = 'normal';
    } else {
      // Unknown escape sequence
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
    const params = this.csiParams.split(';').map(p => parseInt(p, 10) || 0);
    
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
          }
          // Other private modes (1049 for alternate screen, etc.) ignored for now
        }
        break;
      case 'r': // Set scroll region
        // Ignore for now
        break;
      default:
        // Unknown CSI command - ignore
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

/**
 * PTY Terminal Emulator
 * 
 * Manages a pseudo-terminal session using bun-pty.
 */
export class PTY {
  private ptyProcess: ReturnType<typeof spawn> | null = null;
  private screen: ScreenBuffer;
  private parser: AnsiParser;
  private _cols: number;
  private _rows: number;
  private shell: string;
  private cwd: string;
  private env: Record<string, string>;
  
  // Callbacks
  private onDataCallback?: (data: string) => void;
  private onExitCallback?: (code: number) => void;
  private onTitleCallback?: (title: string) => void;
  private onUpdateCallback?: () => void;

  constructor(options: PTYOptions = {}) {
    this._cols = options.cols || 80;
    this._rows = options.rows || 24;
    this.shell = options.shell || process.env.SHELL || '/bin/zsh';
    this.cwd = options.cwd || process.cwd();
    this.env = {
      ...process.env as Record<string, string>,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      ...options.env
    };
    
    // Create screen buffer and ANSI parser
    const scrollbackLimit = options.scrollback || 1000;
    this.screen = new ScreenBuffer(this._cols, this._rows, scrollbackLimit);
    this.parser = new AnsiParser(this.screen);
  }

  /**
   * Start the PTY process
   */
  async start(): Promise<void> {
    if (this.ptyProcess) {
      return;
    }

    try {
      // Spawn PTY process using bun-pty
      this.ptyProcess = spawn(this.shell, [], {
        name: 'xterm-256color',
        cols: this._cols,
        rows: this._rows,
        cwd: this.cwd,
        env: this.env,
      });

      // Handle data from PTY
      this.ptyProcess.onData((data: string) => {
        // Parse ANSI sequences and update screen buffer
        this.parser.process(data);
        
        if (this.onDataCallback) {
          this.onDataCallback(data);
        }
        
        if (this.onUpdateCallback) {
          this.onUpdateCallback();
        }
      });

      // Handle exit
      this.ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        this.ptyProcess = null;
        if (this.onExitCallback) {
          this.onExitCallback(exitCode);
        }
      });

    } catch (error) {
      console.error('Failed to start PTY:', error);
      throw error;
    }
  }

  /**
   * Write data to the PTY
   */
  write(data: string): void {
    if (this.ptyProcess) {
      this.ptyProcess.write(data);
    }
  }

  /**
   * Resize the terminal
   */
  resize(cols: number, rows: number): void {
    this._cols = cols;
    this._rows = rows;
    
    if (this.ptyProcess) {
      this.ptyProcess.resize(cols, rows);
    }
    this.screen.resize(cols, rows);
  }

  /**
   * Kill the PTY process
   */
  kill(): void {
    if (this.ptyProcess) {
      this.ptyProcess.kill();
      this.ptyProcess = null;
    }
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this.ptyProcess !== null;
  }

  /**
   * Get terminal dimensions
   */
  get cols(): number {
    return this._cols;
  }

  get rows(): number {
    return this._rows;
  }

  /**
   * Get the terminal buffer for rendering
   */
  getBuffer(): TerminalCell[][] {
    return this.screen.getBuffer();
  }

  /**
   * Get cursor position
   */
  getCursor(): { x: number; y: number } {
    return this.screen.getCursor();
  }

  /**
   * Check if cursor is visible (DECTCEM state)
   */
  isCursorVisible(): boolean {
    return this.screen.isCursorVisible();
  }

  /**
   * Scroll view up (into scrollback history)
   */
  scrollViewUp(lines: number): void {
    this.screen.scrollViewUp(lines);
  }

  /**
   * Scroll view down (towards current)
   */
  scrollViewDown(lines: number): void {
    this.screen.scrollViewDown(lines);
  }

  /**
   * Reset view to bottom (current output)
   */
  resetViewOffset(): void {
    this.screen.resetViewOffset();
  }

  /**
   * Get current view offset
   */
  getViewOffset(): number {
    return this.screen.getViewOffset();
  }

  /**
   * Get total number of lines (scrollback + visible)
   */
  getTotalLines(): number {
    return this.screen.getTotalLines();
  }

  /**
   * Set callback for data events
   */
  onData(callback: (data: string) => void): void {
    this.onDataCallback = callback;
  }

  /**
   * Set callback for exit events
   */
  onExit(callback: (code: number) => void): void {
    this.onExitCallback = callback;
  }

  /**
   * Set callback for title changes
   */
  onTitle(callback: (title: string) => void): void {
    this.onTitleCallback = callback;
  }

  /**
   * Set callback for update events
   */
  onUpdate(callback: () => void): void {
    this.onUpdateCallback = callback;
  }

  /**
   * Set callback for OSC 99 notifications (used by Claude Code, etc.)
   */
  onNotification(callback: (message: string) => void): void {
    this.parser.onNotification(callback);
  }
}
