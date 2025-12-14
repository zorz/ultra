/**
 * Main Terminal-Kit Renderer
 * 
 * Handles terminal initialization, screen management, and rendering loop.
 */

import termkit from 'terminal-kit';

const { terminal: term } = termkit;

// Type for terminal instance
type Terminal = typeof term;

export interface ScreenBuffer {
  width: number;
  height: number;
}

export interface RenderContext {
  term: Terminal;
  width: number;
  height: number;
  draw: (x: number, y: number, text: string) => void;
  drawStyled: (x: number, y: number, text: string, fg?: string, bg?: string) => void;
  fill: (x: number, y: number, width: number, height: number, char: string, fg?: string, bg?: string) => void;
  clear: () => void;
}

export class Renderer {
  private term: Terminal;
  private _width: number = 0;
  private _height: number = 0;
  private isInitialized: boolean = false;
  private renderCallbacks: Set<(ctx: RenderContext) => void> = new Set();
  private needsRender: boolean = true;
  private renderScheduled: boolean = false;
  private cursorVisible: boolean = false;

  constructor() {
    this.term = term;
  }

  /**
   * Initialize the terminal
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;

    // Get terminal size
    this._width = this.term.width;
    this._height = this.term.height;

    // Setup terminal
    this.term.fullscreen(true);
    this.hideCursor();
    
    // Enable mouse tracking with motion
    this.term.grabInput({ mouse: 'motion' });

    // Handle resize
    this.term.on('resize', (width: number, height: number) => {
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
    this.term.grabInput(false);
    this.term.fullscreen(false);
    // Show cursor using ANSI escape
    process.stdout.write('\x1b[?25h');
    this.term.processExit(0);
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  get terminal(): Terminal {
    return this.term;
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
    
    const ctx = this.createRenderContext();
    
    for (const callback of this.renderCallbacks) {
      callback(ctx);
    }
  }

  /**
   * Create render context
   */
  private createRenderContext(): RenderContext {
    return {
      term: this.term,
      width: this._width,
      height: this._height,
      
      draw: (x: number, y: number, text: string) => {
        if (y < 1 || y > this._height || x < 1 || x > this._width) return;
        this.term.moveTo(x, y, text);
      },
      
      drawStyled: (x: number, y: number, text: string, fg?: string, bg?: string) => {
        if (y < 1 || y > this._height || x < 1 || x > this._width) return;
        this.term.moveTo(x, y);
        if (fg) this.term.color(fg as Parameters<Terminal['color']>[0]);
        if (bg) this.term.bgColor(bg as Parameters<Terminal['bgColor']>[0]);
        this.term(text);
        this.term.styleReset();
      },
      
      fill: (x: number, y: number, width: number, height: number, char: string, fg?: string, bg?: string) => {
        const line = char.repeat(width);
        for (let row = 0; row < height; row++) {
          const targetY = y + row;
          if (targetY < 1 || targetY > this._height) continue;
          this.term.moveTo(x, targetY);
          if (fg) this.term.color(fg as Parameters<Terminal['color']>[0]);
          if (bg) this.term.bgColor(bg as Parameters<Terminal['bgColor']>[0]);
          this.term(line);
          this.term.styleReset();
        }
      },
      
      clear: () => {
        this.term.clear();
      }
    };
  }

  /**
   * Position cursor for text input
   */
  positionCursor(x: number, y: number): void {
    this.term.moveTo(x, y);
  }

  /**
   * Hide cursor (minimize ANSI output by tracking state)
   */
  hideCursor(): void {
    if (this.cursorVisible) {
      // Hide cursor using ANSI escape
      process.stdout.write('\x1b[?25l');
      this.cursorVisible = false;
    }
  }
  
  /**
   * Show cursor
   */
  showCursor(): void {
    if (!this.cursorVisible) {
      process.stdout.write('\x1b[?25h');
      this.cursorVisible = true;
    }
  }

  /**
   * Set cursor shape
   */
  setCursorShape(shape: 'block' | 'underline' | 'bar'): void {
    // Terminal-kit doesn't directly support cursor shape, 
    // but we can use ANSI escape codes
    const shapes: Record<string, string> = {
      'block': '\x1b[2 q',
      'underline': '\x1b[4 q',
      'bar': '\x1b[6 q'
    };
    process.stdout.write(shapes[shape] || shapes['block']!);
  }
}

// Singleton instance
export const renderer = new Renderer();

export default renderer;
