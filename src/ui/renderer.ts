/**
 * Main Renderer
 * 
 * Handles terminal initialization, screen management, and rendering loop.
 * Uses raw ANSI escape codes instead of terminal-kit.
 */

import { terminal, type KeyEvent, type MouseEventData } from '../terminal/index.ts';
import { CURSOR, STYLE, fgHex, bgHex } from '../terminal/ansi.ts';

export interface ScreenBuffer {
  width: number;
  height: number;
}

interface StyleOpts {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  dim?: boolean;
}

export interface RenderContext {
  width: number;
  height: number;
  buffer: (str: string) => void;
  moveTo: (row: number, col: number) => void;
  draw: (x: number, y: number, text: string) => void;
  drawStyled: (x: number, y: number, text: string, fg?: string, bg?: string, opts?: StyleOpts) => void;
  fill: (x: number, y: number, width: number, height: number, char: string, fg?: string, bg?: string) => void;
  setFg: (hex: string) => void;
  setBg: (hex: string) => void;
  resetStyle: () => void;
  bold: () => void;
  italic: () => void;
  underline: () => void;
  inverse: () => void;
  dim: () => void;
  clear: () => void;
}

export class Renderer {
  private _width: number = 0;
  private _height: number = 0;
  private isInitialized: boolean = false;
  private renderCallbacks: Set<(ctx: RenderContext) => void> = new Set();
  private needsRender: boolean = true;
  private renderScheduled: boolean = false;
  private cursorVisible: boolean = false;
  private outputBuffer: string = '';

  constructor() {}

  /**
   * Initialize the terminal
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;

    // Initialize terminal
    terminal.init();

    // Get terminal size
    this._width = terminal.width;
    this._height = terminal.height;

    // Enable mouse tracking
    terminal.enableMouse();

    // Handle resize
    terminal.onResize((width, height) => {
      this._width = width;
      this._height = height;
      this.scheduleRender();
    });

    this.isInitialized = true;
  }

  /**
   * Cleanup and restore terminal
   */
  cleanup(): void {
    terminal.exit(0);
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  /**
   * Register key event handler
   */
  onKey(callback: (event: KeyEvent) => void): () => void {
    return terminal.onKey(callback);
  }

  /**
   * Register mouse event handler
   */
  onMouse(callback: (event: MouseEventData) => void): () => void {
    return terminal.onMouse(callback);
  }

  /**
   * Register a render callback
   */
  onRender(callback: (ctx: RenderContext) => void): () => void {
    this.renderCallbacks.add(callback);
    return () => this.renderCallbacks.delete(callback);
  }

  /**
   * Schedule a render on next tick
   */
  scheduleRender(): void {
    this.needsRender = true;
    
    if (!this.renderScheduled) {
      this.renderScheduled = true;
      setImmediate(() => {
        this.renderScheduled = false;
        if (this.needsRender) {
          this.render();
        }
      });
    }
  }

  /**
   * Force immediate render
   */
  render(): void {
    this.needsRender = false;
    
    // Start buffering for this frame
    this.outputBuffer = '';
    
    const ctx = this.createRenderContext();
    
    for (const callback of this.renderCallbacks) {
      callback(ctx);
    }
    
    // Flush all buffered output in a single write
    if (this.outputBuffer) {
      process.stdout.write(this.outputBuffer);
      this.outputBuffer = '';
    }
  }
  
  /**
   * Buffer output for atomic write at end of render
   */
  bufferOutput(str: string): void {
    this.outputBuffer += str;
  }

  /**
   * Create render context
   */
  private createRenderContext(): RenderContext {
    return {
      width: this._width,
      height: this._height,
      
      buffer: (str: string) => {
        this.outputBuffer += str;
      },
      
      moveTo: (row: number, col: number) => {
        this.outputBuffer += CURSOR.moveTo(row, col);
      },
      
      draw: (x: number, y: number, text: string) => {
        if (y < 1 || y > this._height || x < 1 || x > this._width) return;
        this.outputBuffer += CURSOR.moveTo(y, x) + text;
      },
      
      drawStyled: (x: number, y: number, text: string, fg?: string, bg?: string, opts?: StyleOpts) => {
        if (y < 1 || y > this._height || x < 1 || x > this._width) return;
        
        let codes = CURSOR.moveTo(y, x);
        if (opts?.bold) codes += STYLE.bold;
        if (opts?.italic) codes += STYLE.italic;
        if (opts?.underline) codes += STYLE.underline;
        if (opts?.inverse) codes += STYLE.inverse;
        if (opts?.dim) codes += STYLE.dim;
        if (fg) codes += fgHex(fg);
        if (bg) codes += bgHex(bg);
        
        this.outputBuffer += codes + text + STYLE.reset;
      },
      
      fill: (x: number, y: number, width: number, height: number, char: string, fg?: string, bg?: string) => {
        const line = char.repeat(width);
        let style = '';
        if (fg) style += fgHex(fg);
        if (bg) style += bgHex(bg);
        
        for (let row = 0; row < height; row++) {
          const targetY = y + row;
          if (targetY < 1 || targetY > this._height) continue;
          this.outputBuffer += CURSOR.moveTo(targetY, x) + style + line + STYLE.reset;
        }
      },

      setFg: (hex: string) => {
        this.outputBuffer += fgHex(hex);
      },

      setBg: (hex: string) => {
        this.outputBuffer += bgHex(hex);
      },

      resetStyle: () => {
        this.outputBuffer += STYLE.reset;
      },

      bold: () => {
        this.outputBuffer += STYLE.bold;
      },

      italic: () => {
        this.outputBuffer += STYLE.italic;
      },

      underline: () => {
        this.outputBuffer += STYLE.underline;
      },

      inverse: () => {
        this.outputBuffer += STYLE.inverse;
      },

      dim: () => {
        this.outputBuffer += STYLE.dim;
      },
      
      clear: () => {
        this.outputBuffer += '\x1b[2J\x1b[1;1H';
      }
    };
  }

  /**
   * Position cursor for text input
   */
  positionCursor(x: number, y: number): void {
    terminal.moveTo(y, x);
  }

  /**
   * Hide cursor
   */
  hideCursor(): void {
    if (this.cursorVisible) {
      this.outputBuffer += CURSOR.hide;
      this.cursorVisible = false;
    }
  }
  
  /**
   * Show cursor
   */
  showCursor(): void {
    if (!this.cursorVisible) {
      this.outputBuffer += CURSOR.show;
      this.cursorVisible = true;
    }
  }

  /**
   * Set cursor shape
   */
  setCursorShape(shape: 'block' | 'underline' | 'bar'): void {
    terminal.setCursorShape(shape);
  }
}

// Singleton instance
export const renderer = new Renderer();

export default renderer;
