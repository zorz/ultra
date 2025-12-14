/**
 * Terminal Control
 * 
 * High-level terminal abstraction using raw ANSI escape codes.
 */

import { 
  CURSOR, SCREEN, STYLE, MOUSE, PASTE,
  FG, BG, fgHex, bgHex, 
  getDisplayWidth, truncateToWidth, padToWidth
} from './ansi.ts';
import { inputHandler, type KeyEvent, type MouseEventData } from './input.ts';

export interface TerminalSize {
  width: number;
  height: number;
}

export class Terminal {
  private _width: number = 80;
  private _height: number = 24;
  private outputBuffer: string = '';
  private isBuffering: boolean = false;
  private isInitialized: boolean = false;
  private mouseEnabled: boolean = false;

  constructor() {
    this.updateSize();
  }

  /**
   * Initialize the terminal for fullscreen app
   */
  init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    this.updateSize();

    // Enter alternate screen buffer
    this.write(SCREEN.enterAlt);
    
    // Hide cursor initially
    this.write(CURSOR.hide);
    
    // Clear screen
    this.write(SCREEN.clear);
    this.write(CURSOR.moveTo(1, 1));

    // Enable bracketed paste
    this.write(PASTE.enable);

    // Start input handler
    inputHandler.start();

    // Handle resize
    inputHandler.onResize((width, height) => {
      this._width = width;
      this._height = height;
    });
  }

  /**
   * Cleanup and restore terminal state
   */
  cleanup(): void {
    if (!this.isInitialized) return;
    this.isInitialized = false;

    // Disable mouse tracking
    this.disableMouse();

    // Disable bracketed paste
    this.write(PASTE.disable);

    // Show cursor
    this.write(CURSOR.show);

    // Reset cursor shape
    this.write(CURSOR.shape.block);

    // Reset colors and styles
    this.write(STYLE.reset);

    // Exit alternate screen buffer
    this.write(SCREEN.exitAlt);

    // Stop input handler
    inputHandler.stop();
  }

  /**
   * Update terminal size
   */
  private updateSize(): void {
    this._width = process.stdout.columns || 80;
    this._height = process.stdout.rows || 24;
  }

  /**
   * Get terminal width
   */
  get width(): number {
    return this._width;
  }

  /**
   * Get terminal height
   */
  get height(): number {
    return this._height;
  }

  /**
   * Get terminal size
   */
  get size(): TerminalSize {
    return { width: this._width, height: this._height };
  }

  /**
   * Write directly to stdout
   */
  write(data: string): void {
    if (this.isBuffering) {
      this.outputBuffer += data;
    } else {
      process.stdout.write(data);
    }
  }

  /**
   * Start buffering output
   */
  startBuffer(): void {
    this.isBuffering = true;
    this.outputBuffer = '';
  }

  /**
   * Flush buffer to stdout
   */
  flushBuffer(): void {
    if (this.outputBuffer) {
      process.stdout.write(this.outputBuffer);
      this.outputBuffer = '';
    }
    this.isBuffering = false;
  }

  /**
   * Clear the screen
   */
  clear(): void {
    this.write(SCREEN.clear);
    this.write(CURSOR.moveTo(1, 1));
  }

  /**
   * Move cursor to position (1-indexed)
   */
  moveTo(row: number, col: number): void {
    this.write(CURSOR.moveTo(row, col));
  }

  /**
   * Hide cursor
   */
  hideCursor(): void {
    this.write(CURSOR.hide);
  }

  /**
   * Show cursor
   */
  showCursor(): void {
    this.write(CURSOR.show);
  }

  /**
   * Set cursor shape
   */
  setCursorShape(shape: 'block' | 'underline' | 'bar'): void {
    this.write(CURSOR.shape[shape]);
  }

  /**
   * Enable mouse tracking
   */
  enableMouse(): void {
    if (this.mouseEnabled) return;
    this.mouseEnabled = true;
    // Enable button + motion tracking with SGR extended mode
    this.write(MOUSE.enableAny);
    this.write(MOUSE.enableSGR);
  }

  /**
   * Disable mouse tracking
   */
  disableMouse(): void {
    if (!this.mouseEnabled) return;
    this.mouseEnabled = false;
    this.write(MOUSE.disableSGR);
    this.write(MOUSE.disableAny);
  }

  /**
   * Reset all styles
   */
  resetStyle(): void {
    this.write(STYLE.reset);
  }

  /**
   * Set foreground color (basic color name)
   */
  setFg(color: keyof typeof FG): void {
    const code = FG[color];
    if (typeof code === 'string') {
      this.write(code);
    }
  }

  /**
   * Set foreground color from hex
   */
  setFgHex(hex: string): void {
    this.write(fgHex(hex));
  }

  /**
   * Set background color (basic color name)
   */
  setBg(color: keyof typeof BG): void {
    const code = BG[color];
    if (typeof code === 'string') {
      this.write(code);
    }
  }

  /**
   * Set background color from hex
   */
  setBgHex(hex: string): void {
    this.write(bgHex(hex));
  }

  /**
   * Set 256 color foreground
   */
  setFg256(n: number): void {
    this.write(FG.color256(n));
  }

  /**
   * Set 256 color background
   */
  setBg256(n: number): void {
    this.write(BG.color256(n));
  }

  /**
   * Set RGB foreground color
   */
  setFgRgb(r: number, g: number, b: number): void {
    this.write(FG.rgb(r, g, b));
  }

  /**
   * Set RGB background color
   */
  setBgRgb(r: number, g: number, b: number): void {
    this.write(BG.rgb(r, g, b));
  }

  /**
   * Set bold
   */
  bold(): void {
    this.write(STYLE.bold);
  }

  /**
   * Set italic
   */
  italic(): void {
    this.write(STYLE.italic);
  }

  /**
   * Set underline
   */
  underline(): void {
    this.write(STYLE.underline);
  }

  /**
   * Set inverse (swap fg/bg)
   */
  inverse(): void {
    this.write(STYLE.inverse);
  }

  /**
   * Set dim
   */
  dim(): void {
    this.write(STYLE.dim);
  }

  /**
   * Draw text at position (1-indexed)
   */
  drawAt(row: number, col: number, text: string): void {
    this.moveTo(row, col);
    this.write(text);
  }

  /**
   * Draw styled text at position
   */
  drawStyledAt(row: number, col: number, text: string, opts?: {
    fg?: string;
    bg?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    inverse?: boolean;
    dim?: boolean;
  }): void {
    this.moveTo(row, col);
    
    if (opts) {
      if (opts.bold) this.bold();
      if (opts.italic) this.italic();
      if (opts.underline) this.underline();
      if (opts.inverse) this.inverse();
      if (opts.dim) this.dim();
      if (opts.fg) this.setFgHex(opts.fg);
      if (opts.bg) this.setBgHex(opts.bg);
    }
    
    this.write(text);
    this.resetStyle();
  }

  /**
   * Fill a region with a character
   */
  fillRect(row: number, col: number, width: number, height: number, char: string = ' ', opts?: {
    fg?: string;
    bg?: string;
  }): void {
    const line = char.repeat(width);
    
    for (let r = 0; r < height; r++) {
      this.moveTo(row + r, col);
      if (opts?.fg) this.setFgHex(opts.fg);
      if (opts?.bg) this.setBgHex(opts.bg);
      this.write(line);
      if (opts) this.resetStyle();
    }
  }

  /**
   * Clear a line
   */
  clearLine(row: number): void {
    this.moveTo(row, 1);
    this.write(SCREEN.clearLine);
  }

  /**
   * Register key event handler
   */
  onKey(callback: (event: KeyEvent) => void): () => void {
    return inputHandler.onKey(callback);
  }

  /**
   * Register mouse event handler
   */
  onMouse(callback: (event: MouseEventData) => void): () => void {
    return inputHandler.onMouse(callback);
  }

  /**
   * Register resize handler
   */
  onResize(callback: (width: number, height: number) => void): () => void {
    return inputHandler.onResize(callback);
  }

  /**
   * Exit the process
   */
  exit(code: number = 0): void {
    this.cleanup();
    process.exit(code);
  }
}

// Singleton instance
export const terminal = new Terminal();
export default terminal;

// Re-export utilities
export { getDisplayWidth, truncateToWidth, padToWidth } from './ansi.ts';
export type { KeyEvent, MouseEventData } from './input.ts';
