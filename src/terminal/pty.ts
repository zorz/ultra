/**
 * PTY (Pseudo-Terminal) Support
 * 
 * Provides full terminal emulation using native PTY support.
 * Uses Bun's spawn capabilities with PTY mode.
 */

import { spawn, type Subprocess } from 'bun';

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

/**
 * PTY Terminal Emulator
 * 
 * Manages a pseudo-terminal session with full ANSI escape sequence parsing.
 */
export class PTY {
  private process: Subprocess<'pipe', 'pipe', 'pipe'> | null = null;
  private _cols: number;
  private _rows: number;
  private shell: string;
  private cwd: string;
  private env: Record<string, string>;
  
  // Screen buffer
  private buffer: TerminalCell[][] = [];
  private cursorX: number = 0;
  private cursorY: number = 0;
  private scrollTop: number = 0;
  private scrollBottom: number = 0;
  
  // Scroll back buffer
  private scrollback: TerminalCell[][] = [];
  private maxScrollback: number = 1000;
  private scrollOffset: number = 0;  // How many lines scrolled back
  
  // Parser state
  private parseState: 'normal' | 'escape' | 'csi' | 'osc' = 'normal';
  private escapeBuffer: string = '';
  private oscBuffer: string = '';
  
  // Attributes
  private currentFg: string | null = null;
  private currentBg: string | null = null;
  private currentBold: boolean = false;
  private currentItalic: boolean = false;
  private currentUnderline: boolean = false;
  private currentDim: boolean = false;
  private currentInverse: boolean = false;
  
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
      LANG: process.env.LANG || 'en_US.UTF-8',
      ...options.env
    };
    
    this.scrollBottom = this._rows - 1;
    this.initBuffer();
  }

  /**
   * Initialize the screen buffer
   */
  private initBuffer(): void {
    this.buffer = [];
    for (let y = 0; y < this._rows; y++) {
      this.buffer.push(this.createEmptyLine());
    }
  }

  /**
   * Create an empty line
   */
  private createEmptyLine(): TerminalCell[] {
    const line: TerminalCell[] = [];
    for (let x = 0; x < this._cols; x++) {
      line.push(createEmptyCell());
    }
    return line;
  }

  /**
   * Start the PTY process
   */
  async start(): Promise<void> {
    if (this.process) {
      return;
    }

    try {
      // Run shell directly - Bun doesn't have native PTY support
      // Use /bin/bash or /bin/sh which handle non-TTY better than zsh
      // Determine which shell to use - prefer bash for better non-TTY support
      let shellCmd: string[];
      if (this.shell.includes('zsh')) {
        // For zsh, use bash instead since zsh requires a real TTY
        shellCmd = ['/bin/bash', '--norc', '--noprofile'];
      } else if (this.shell.includes('bash')) {
        shellCmd = [this.shell, '--norc', '--noprofile'];
      } else {
        shellCmd = [this.shell];
      }
      
      this.process = spawn({
        cmd: shellCmd,
        cwd: this.cwd,
        env: {
          PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
          HOME: process.env.HOME || '',
          USER: process.env.USER || '',
          TERM: 'dumb',
          COLUMNS: String(this._cols),
          LINES: String(this._rows),
          PS1: '$ ',
        },
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Read stdout
      this.readStream(this.process.stdout);
      
      // Also read stderr and merge it
      this.readStream(this.process.stderr);
      
      // Handle process exit
      this.process.exited.then((code) => {
        this.process = null;
        if (this.onExitCallback) {
          this.onExitCallback(code);
        }
      });

    } catch (error) {
      console.error('Failed to start PTY:', error);
      throw error;
    }
  }

  /**
   * Read from a stream and process data
   */
  private async readStream(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const data = decoder.decode(value, { stream: true });
        this.processOutput(data);
        
        if (this.onDataCallback) {
          this.onDataCallback(data);
        }
      }
    } catch (error) {
      // Stream closed
    }
  }

  /**
   * Process output from the PTY
   */
  private processOutput(data: string): void {
    for (const char of data) {
      this.processChar(char);
    }
    
    if (this.onUpdateCallback) {
      this.onUpdateCallback();
    }
  }

  /**
   * Process a single character
   */
  private processChar(char: string): void {
    const code = char.charCodeAt(0);
    
    switch (this.parseState) {
      case 'normal':
        if (code === 0x1b) {  // ESC
          this.parseState = 'escape';
          this.escapeBuffer = '';
        } else if (code === 0x07) {  // BEL
          // Bell - ignore
        } else if (code === 0x08) {  // BS
          this.cursorX = Math.max(0, this.cursorX - 1);
        } else if (code === 0x09) {  // TAB
          this.cursorX = Math.min(this._cols - 1, (Math.floor(this.cursorX / 8) + 1) * 8);
        } else if (code === 0x0a) {  // LF
          this.lineFeed();
        } else if (code === 0x0d) {  // CR
          this.cursorX = 0;
        } else if (code >= 0x20) {  // Printable
          this.putChar(char);
        }
        break;
        
      case 'escape':
        if (char === '[') {
          this.parseState = 'csi';
          this.escapeBuffer = '';
        } else if (char === ']') {
          this.parseState = 'osc';
          this.oscBuffer = '';
        } else if (char === '(') {
          // Designate G0 character set - skip next char
          this.parseState = 'normal';
        } else if (char === ')') {
          // Designate G1 character set - skip next char
          this.parseState = 'normal';
        } else if (char === 'M') {
          // Reverse index
          this.reverseIndex();
          this.parseState = 'normal';
        } else if (char === 'D') {
          // Index (line feed)
          this.lineFeed();
          this.parseState = 'normal';
        } else if (char === 'E') {
          // Next line
          this.cursorX = 0;
          this.lineFeed();
          this.parseState = 'normal';
        } else if (char === '7') {
          // Save cursor
          this.parseState = 'normal';
        } else if (char === '8') {
          // Restore cursor
          this.parseState = 'normal';
        } else if (char === 'c') {
          // Reset
          this.reset();
          this.parseState = 'normal';
        } else {
          this.parseState = 'normal';
        }
        break;
        
      case 'csi':
        if (char >= '0' && char <= '9' || char === ';' || char === '?' || char === '>' || char === '!' || char === '"' || char === ' ') {
          this.escapeBuffer += char;
        } else {
          this.processCSI(char);
          this.parseState = 'normal';
        }
        break;
        
      case 'osc':
        if (code === 0x07 || (code === 0x1b && this.oscBuffer.endsWith('\\'))) {
          // End of OSC
          this.processOSC();
          this.parseState = 'normal';
        } else if (code === 0x1b) {
          this.oscBuffer += char;
        } else {
          this.oscBuffer += char;
        }
        break;
    }
  }

  /**
   * Process CSI (Control Sequence Introducer) escape sequences
   */
  private processCSI(finalChar: string): void {
    const params = this.escapeBuffer.split(';').map(p => parseInt(p) || 0);
    
    switch (finalChar) {
      case 'A':  // Cursor Up
        this.cursorY = Math.max(0, this.cursorY - (params[0] || 1));
        break;
      case 'B':  // Cursor Down
        this.cursorY = Math.min(this._rows - 1, this.cursorY + (params[0] || 1));
        break;
      case 'C':  // Cursor Forward
        this.cursorX = Math.min(this._cols - 1, this.cursorX + (params[0] || 1));
        break;
      case 'D':  // Cursor Backward
        this.cursorX = Math.max(0, this.cursorX - (params[0] || 1));
        break;
      case 'E':  // Cursor Next Line
        this.cursorX = 0;
        this.cursorY = Math.min(this._rows - 1, this.cursorY + (params[0] || 1));
        break;
      case 'F':  // Cursor Previous Line
        this.cursorX = 0;
        this.cursorY = Math.max(0, this.cursorY - (params[0] || 1));
        break;
      case 'G':  // Cursor Horizontal Absolute
        this.cursorX = Math.min(this._cols - 1, Math.max(0, (params[0] || 1) - 1));
        break;
      case 'H':  // Cursor Position
      case 'f':
        this.cursorY = Math.min(this._rows - 1, Math.max(0, (params[0] || 1) - 1));
        this.cursorX = Math.min(this._cols - 1, Math.max(0, (params[1] || 1) - 1));
        break;
      case 'J':  // Erase in Display
        this.eraseInDisplay(params[0] || 0);
        break;
      case 'K':  // Erase in Line
        this.eraseInLine(params[0] || 0);
        break;
      case 'L':  // Insert Lines
        this.insertLines(params[0] || 1);
        break;
      case 'M':  // Delete Lines
        this.deleteLines(params[0] || 1);
        break;
      case 'P':  // Delete Characters
        this.deleteChars(params[0] || 1);
        break;
      case '@':  // Insert Characters
        this.insertChars(params[0] || 1);
        break;
      case 'S':  // Scroll Up
        this.scrollUp(params[0] || 1);
        break;
      case 'T':  // Scroll Down
        this.scrollDown(params[0] || 1);
        break;
      case 'd':  // Line Position Absolute
        this.cursorY = Math.min(this._rows - 1, Math.max(0, (params[0] || 1) - 1));
        break;
      case 'm':  // SGR (Select Graphic Rendition)
        this.processSGR(params);
        break;
      case 'r':  // Set Scrolling Region
        this.scrollTop = Math.max(0, (params[0] || 1) - 1);
        this.scrollBottom = Math.min(this._rows - 1, (params[1] || this._rows) - 1);
        this.cursorX = 0;
        this.cursorY = 0;
        break;
      case 's':  // Save Cursor Position
        // Simplified - just ignore
        break;
      case 'u':  // Restore Cursor Position
        // Simplified - just ignore
        break;
      case 'h':  // Set Mode
      case 'l':  // Reset Mode
        // Handle common modes - mostly ignore for now
        break;
      case 'n':  // Device Status Report
        if (params[0] === 6) {
          // Report cursor position
          this.write(`\x1b[${this.cursorY + 1};${this.cursorX + 1}R`);
        }
        break;
      case 'c':  // Device Attributes
        // Report as VT100
        this.write('\x1b[?1;2c');
        break;
    }
  }

  /**
   * Process SGR (Select Graphic Rendition) parameters
   */
  private processSGR(params: number[]): void {
    if (params.length === 0) params = [0];
    
    let i = 0;
    while (i < params.length) {
      const code = params[i]!;
      
      switch (code) {
        case 0:  // Reset
          this.currentFg = null;
          this.currentBg = null;
          this.currentBold = false;
          this.currentItalic = false;
          this.currentUnderline = false;
          this.currentDim = false;
          this.currentInverse = false;
          break;
        case 1:  // Bold
          this.currentBold = true;
          break;
        case 2:  // Dim
          this.currentDim = true;
          break;
        case 3:  // Italic
          this.currentItalic = true;
          break;
        case 4:  // Underline
          this.currentUnderline = true;
          break;
        case 7:  // Inverse
          this.currentInverse = true;
          break;
        case 22:  // Normal intensity
          this.currentBold = false;
          this.currentDim = false;
          break;
        case 23:  // Not italic
          this.currentItalic = false;
          break;
        case 24:  // Not underlined
          this.currentUnderline = false;
          break;
        case 27:  // Not inverse
          this.currentInverse = false;
          break;
        case 30: case 31: case 32: case 33:
        case 34: case 35: case 36: case 37:
          // Standard foreground colors
          this.currentFg = this.standardColorToHex(code - 30);
          break;
        case 38:
          // Extended foreground color
          if (params[i + 1] === 5) {
            // 256 color
            this.currentFg = this.color256ToHex(params[i + 2] || 0);
            i += 2;
          } else if (params[i + 1] === 2) {
            // RGB
            this.currentFg = this.rgbToHex(params[i + 2] || 0, params[i + 3] || 0, params[i + 4] || 0);
            i += 4;
          }
          break;
        case 39:  // Default foreground
          this.currentFg = null;
          break;
        case 40: case 41: case 42: case 43:
        case 44: case 45: case 46: case 47:
          // Standard background colors
          this.currentBg = this.standardColorToHex(code - 40);
          break;
        case 48:
          // Extended background color
          if (params[i + 1] === 5) {
            // 256 color
            this.currentBg = this.color256ToHex(params[i + 2] || 0);
            i += 2;
          } else if (params[i + 1] === 2) {
            // RGB
            this.currentBg = this.rgbToHex(params[i + 2] || 0, params[i + 3] || 0, params[i + 4] || 0);
            i += 4;
          }
          break;
        case 49:  // Default background
          this.currentBg = null;
          break;
        case 90: case 91: case 92: case 93:
        case 94: case 95: case 96: case 97:
          // Bright foreground colors
          this.currentFg = this.brightColorToHex(code - 90);
          break;
        case 100: case 101: case 102: case 103:
        case 104: case 105: case 106: case 107:
          // Bright background colors
          this.currentBg = this.brightColorToHex(code - 100);
          break;
      }
      i++;
    }
  }

  /**
   * Convert standard color code to hex
   */
  private standardColorToHex(code: number): string {
    const colors = [
      '#000000', '#cc0000', '#4e9a06', '#c4a000',
      '#3465a4', '#75507b', '#06989a', '#d3d7cf'
    ];
    return colors[code] || '#d3d7cf';
  }

  /**
   * Convert bright color code to hex
   */
  private brightColorToHex(code: number): string {
    const colors = [
      '#555753', '#ef2929', '#8ae234', '#fce94f',
      '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec'
    ];
    return colors[code] || '#eeeeec';
  }

  /**
   * Convert 256 color code to hex
   */
  private color256ToHex(code: number): string {
    if (code < 16) {
      // Standard colors
      return code < 8 ? this.standardColorToHex(code) : this.brightColorToHex(code - 8);
    } else if (code < 232) {
      // Color cube (6x6x6)
      const n = code - 16;
      const b = n % 6;
      const g = Math.floor(n / 6) % 6;
      const r = Math.floor(n / 36);
      const toVal = (v: number) => v === 0 ? 0 : 55 + v * 40;
      return this.rgbToHex(toVal(r), toVal(g), toVal(b));
    } else {
      // Grayscale
      const gray = (code - 232) * 10 + 8;
      return this.rgbToHex(gray, gray, gray);
    }
  }

  /**
   * Convert RGB to hex
   */
  private rgbToHex(r: number, g: number, b: number): string {
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Process OSC (Operating System Command) sequences
   */
  private processOSC(): void {
    const parts = this.oscBuffer.split(';');
    const cmd = parseInt(parts[0] || '0');
    
    switch (cmd) {
      case 0:  // Set icon name and window title
      case 2:  // Set window title
        if (this.onTitleCallback && parts[1]) {
          this.onTitleCallback(parts[1]);
        }
        break;
    }
  }

  /**
   * Put a character at current cursor position
   */
  private putChar(char: string): void {
    if (this.cursorX >= this._cols) {
      this.cursorX = 0;
      this.lineFeed();
    }
    
    if (this.buffer[this.cursorY]) {
      this.buffer[this.cursorY]![this.cursorX] = {
        char,
        fg: this.currentFg,
        bg: this.currentBg,
        bold: this.currentBold,
        italic: this.currentItalic,
        underline: this.currentUnderline,
        dim: this.currentDim,
        inverse: this.currentInverse
      };
    }
    
    this.cursorX++;
  }

  /**
   * Line feed (move cursor down, scroll if needed)
   */
  private lineFeed(): void {
    if (this.cursorY >= this.scrollBottom) {
      this.scrollUp(1);
    } else {
      this.cursorY++;
    }
  }

  /**
   * Reverse index (move cursor up, scroll if needed)
   */
  private reverseIndex(): void {
    if (this.cursorY <= this.scrollTop) {
      this.scrollDown(1);
    } else {
      this.cursorY--;
    }
  }

  /**
   * Scroll up by n lines
   */
  private scrollUp(n: number): void {
    for (let i = 0; i < n; i++) {
      // Move top line to scrollback
      if (this.scrollTop === 0 && this.buffer[0]) {
        this.scrollback.push(this.buffer[0]);
        if (this.scrollback.length > this.maxScrollback) {
          this.scrollback.shift();
        }
      }
      
      // Shift lines up
      for (let y = this.scrollTop; y < this.scrollBottom; y++) {
        this.buffer[y] = this.buffer[y + 1] || this.createEmptyLine();
      }
      this.buffer[this.scrollBottom] = this.createEmptyLine();
    }
  }

  /**
   * Scroll down by n lines
   */
  private scrollDown(n: number): void {
    for (let i = 0; i < n; i++) {
      // Shift lines down
      for (let y = this.scrollBottom; y > this.scrollTop; y--) {
        this.buffer[y] = this.buffer[y - 1] || this.createEmptyLine();
      }
      this.buffer[this.scrollTop] = this.createEmptyLine();
    }
  }

  /**
   * Erase in display
   */
  private eraseInDisplay(mode: number): void {
    switch (mode) {
      case 0:  // Cursor to end
        this.eraseInLine(0);
        for (let y = this.cursorY + 1; y < this._rows; y++) {
          this.buffer[y] = this.createEmptyLine();
        }
        break;
      case 1:  // Start to cursor
        this.eraseInLine(1);
        for (let y = 0; y < this.cursorY; y++) {
          this.buffer[y] = this.createEmptyLine();
        }
        break;
      case 2:  // Entire screen
      case 3:  // Entire screen + scrollback
        for (let y = 0; y < this._rows; y++) {
          this.buffer[y] = this.createEmptyLine();
        }
        if (mode === 3) {
          this.scrollback = [];
        }
        break;
    }
  }

  /**
   * Erase in line
   */
  private eraseInLine(mode: number): void {
    const line = this.buffer[this.cursorY];
    if (!line) return;
    
    switch (mode) {
      case 0:  // Cursor to end
        for (let x = this.cursorX; x < this._cols; x++) {
          line[x] = createEmptyCell();
        }
        break;
      case 1:  // Start to cursor
        for (let x = 0; x <= this.cursorX; x++) {
          line[x] = createEmptyCell();
        }
        break;
      case 2:  // Entire line
        this.buffer[this.cursorY] = this.createEmptyLine();
        break;
    }
  }

  /**
   * Insert lines at cursor
   */
  private insertLines(n: number): void {
    for (let i = 0; i < n; i++) {
      this.buffer.splice(this.cursorY, 0, this.createEmptyLine());
      this.buffer.splice(this.scrollBottom + 1, 1);
    }
  }

  /**
   * Delete lines at cursor
   */
  private deleteLines(n: number): void {
    for (let i = 0; i < n; i++) {
      this.buffer.splice(this.cursorY, 1);
      this.buffer.splice(this.scrollBottom, 0, this.createEmptyLine());
    }
  }

  /**
   * Delete characters at cursor
   */
  private deleteChars(n: number): void {
    const line = this.buffer[this.cursorY];
    if (!line) return;
    
    for (let i = 0; i < n; i++) {
      line.splice(this.cursorX, 1);
      line.push(createEmptyCell());
    }
  }

  /**
   * Insert characters at cursor
   */
  private insertChars(n: number): void {
    const line = this.buffer[this.cursorY];
    if (!line) return;
    
    for (let i = 0; i < n; i++) {
      line.splice(this.cursorX, 0, createEmptyCell());
      line.pop();
    }
  }

  /**
   * Reset terminal state
   */
  private reset(): void {
    this.initBuffer();
    this.cursorX = 0;
    this.cursorY = 0;
    this.scrollTop = 0;
    this.scrollBottom = this._rows - 1;
    this.currentFg = null;
    this.currentBg = null;
    this.currentBold = false;
    this.currentItalic = false;
    this.currentUnderline = false;
    this.currentDim = false;
    this.currentInverse = false;
  }

  /**
   * Write data to the PTY
   */
  write(data: string): void {
    if (this.process?.stdin) {
      try {
        // Bun's stdin is a FileSink, which has write() and flush()
        // Write the data as bytes
        const bytes = new TextEncoder().encode(data);
        this.process.stdin.write(bytes);
        this.process.stdin.flush();
      } catch (error) {
        // Silently ignore write errors (process may have exited)
      }
    }
  }

  /**
   * Resize the terminal
   */
  resize(cols: number, rows: number): void {
    const oldRows = this._rows;
    const oldCols = this._cols;
    
    this._cols = cols;
    this._rows = rows;
    this.scrollBottom = rows - 1;
    
    // Resize buffer
    while (this.buffer.length < rows) {
      this.buffer.push(this.createEmptyLine());
    }
    while (this.buffer.length > rows) {
      const removed = this.buffer.shift();
      if (removed) {
        this.scrollback.push(removed);
        if (this.scrollback.length > this.maxScrollback) {
          this.scrollback.shift();
        }
      }
    }
    
    // Resize each line
    for (const line of this.buffer) {
      while (line.length < cols) {
        line.push(createEmptyCell());
      }
      while (line.length > cols) {
        line.pop();
      }
    }
    
    // Ensure cursor is in bounds
    this.cursorX = Math.min(this.cursorX, cols - 1);
    this.cursorY = Math.min(this.cursorY, rows - 1);
    
    // Send resize signal to PTY
    if (this.process) {
      this.write(`stty cols ${cols} rows ${rows}\n`);
    }
  }

  /**
   * Get the screen buffer for rendering
   */
  getBuffer(): TerminalCell[][] {
    return this.buffer;
  }

  /**
   * Get cursor position
   */
  getCursor(): { x: number; y: number } {
    return { x: this.cursorX, y: this.cursorY };
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
   * Check if terminal is running
   */
  isRunning(): boolean {
    return this.process !== null;
  }

  /**
   * Kill the PTY process
   */
  kill(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  /**
   * Scroll viewport up (show more scrollback)
   */
  scrollViewUp(lines: number = 1): void {
    this.scrollOffset = Math.min(this.scrollback.length, this.scrollOffset + lines);
  }

  /**
   * Scroll viewport down (show less scrollback)
   */
  scrollViewDown(lines: number = 1): void {
    this.scrollOffset = Math.max(0, this.scrollOffset - lines);
  }

  /**
   * Get visible buffer including scrollback
   */
  getVisibleBuffer(): TerminalCell[][] {
    if (this.scrollOffset === 0) {
      return this.buffer;
    }
    
    const start = this.scrollback.length - this.scrollOffset;
    const scrollbackPart = this.scrollback.slice(start, start + this._rows);
    const bufferPart = this.buffer.slice(0, this._rows - scrollbackPart.length);
    
    return [...scrollbackPart, ...bufferPart];
  }

  /**
   * Register callbacks
   */
  onData(callback: (data: string) => void): void {
    this.onDataCallback = callback;
  }

  onExit(callback: (code: number) => void): void {
    this.onExitCallback = callback;
  }

  onTitle(callback: (title: string) => void): void {
    this.onTitleCallback = callback;
  }

  onUpdate(callback: () => void): void {
    this.onUpdateCallback = callback;
  }
}

export default PTY;
