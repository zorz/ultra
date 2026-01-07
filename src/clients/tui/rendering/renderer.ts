/**
 * Renderer
 *
 * Renders the ScreenBuffer to the terminal using ANSI escape sequences.
 * Supports both real terminal output and captured output for testing.
 */

import type { Size, Cell } from '../types.ts';
import { ScreenBuffer } from './buffer.ts';
import {
  cursorHide,
  cursorShow,
  cursorToZero,
  cursorHome,
  clearScreen,
  alternateScreenOn,
  alternateScreenOff,
  mouseFullOn,
  mouseFullOff,
  bracketedPasteOn,
  bracketedPasteOff,
} from '../ansi/sequences.ts';
import { resetColor } from '../ansi/colors.ts';
import { transitionStyle } from '../ansi/styles.ts';
import { getCharWidth } from '../../../core/char-width.ts';

// ============================================
// Types
// ============================================

export interface RendererOptions {
  /** Output function. Defaults to process.stdout.write */
  output?: (data: string) => void;
  /** Enable alternate screen buffer */
  alternateScreen?: boolean;
  /** Enable mouse tracking */
  mouseTracking?: boolean;
  /** Enable bracketed paste */
  bracketedPaste?: boolean;
}

// ============================================
// Renderer Class
// ============================================

export class Renderer {
  private buffer: ScreenBuffer;
  private size: Size;
  private output: (data: string) => void;
  private initialized = false;
  private options: RendererOptions;

  // Track last rendered cell for style optimization
  private lastCell: Cell | null = null;

  constructor(size: Size, options: RendererOptions = {}) {
    this.size = size;
    this.buffer = new ScreenBuffer(size);
    this.output = options.output ?? ((data: string) => process.stdout.write(data));
    this.options = {
      alternateScreen: options.alternateScreen ?? true,
      mouseTracking: options.mouseTracking ?? true,
      bracketedPaste: options.bracketedPaste ?? true,
      ...options,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Initialize the terminal for TUI rendering.
   */
  initialize(): void {
    if (this.initialized) return;

    let initSequence = '';

    // Hide cursor
    initSequence += cursorHide();

    // Enable alternate screen buffer
    if (this.options.alternateScreen) {
      initSequence += alternateScreenOn();
    }

    // Clear screen and go home
    initSequence += clearScreen() + cursorHome();

    // Enable mouse tracking
    if (this.options.mouseTracking) {
      initSequence += mouseFullOn();
    }

    // Enable bracketed paste
    if (this.options.bracketedPaste) {
      initSequence += bracketedPasteOn();
    }

    this.output(initSequence);
    this.initialized = true;
  }

  /**
   * Clean up terminal state.
   */
  cleanup(): void {
    if (!this.initialized) return;

    let cleanupSequence = '';

    // Disable bracketed paste
    if (this.options.bracketedPaste) {
      cleanupSequence += bracketedPasteOff();
    }

    // Disable mouse tracking
    if (this.options.mouseTracking) {
      cleanupSequence += mouseFullOff();
    }

    // Disable alternate screen buffer
    if (this.options.alternateScreen) {
      cleanupSequence += alternateScreenOff();
    }

    // Show cursor
    cleanupSequence += cursorShow();

    // Reset colors
    cleanupSequence += resetColor();

    this.output(cleanupSequence);
    this.initialized = false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Size Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get current size.
   */
  getSize(): Size {
    return { ...this.size };
  }

  /**
   * Resize the renderer and buffer.
   */
  resize(size: Size): void {
    this.size = size;
    this.buffer.resize(size);
    this.lastCell = null; // Reset style tracking
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Buffer Access
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the screen buffer for drawing.
   */
  getBuffer(): ScreenBuffer {
    return this.buffer;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Flush dirty cells to terminal.
   */
  flush(): void {
    const dirtyCells = this.buffer.getDirtyCells();

    if (dirtyCells.length === 0) {
      return;
    }

    const output = this.buildOutput(dirtyCells);
    this.output(output);
    this.buffer.clearDirty();
  }

  /**
   * Force full redraw of entire buffer.
   */
  fullRedraw(): void {
    this.buffer.markAllDirty();
    this.lastCell = null;
    this.flush();
  }

  /**
   * Build output string from dirty cells.
   * Optimizes cursor movement and style changes.
   */
  private buildOutput(
    cells: Array<{ x: number; y: number; cell: Cell }>
  ): string {
    let output = '';
    let lastY = -1;
    let cursorX = -1; // Track actual terminal cursor position

    for (const { x, y, cell } of cells) {
      // Handle placeholder cells for wide characters
      if (cell.char === '') {
        // Check if the previous cell is a wide character
        // If so, skip - the wide char already cleared this position
        // If not, we need to write a space to clear old content
        const prevCell = x > 0 ? this.buffer.get(x - 1, y) : null;
        const prevCharWidth = prevCell?.char ? getCharWidth(prevCell.char) : 1;

        if (prevCharWidth === 2) {
          // Previous char is wide - it already cleared this cell, skip
          continue;
        }

        // Previous char is not wide - clear old content with a space
        output += cursorToZero(y, x);
        output += ' ';
        cursorX = x + 1;
        lastY = y;
        continue;
      }

      // Get character width for cursor tracking
      const charWidth = cell.char ? getCharWidth(cell.char) : 1;

      // For non-ASCII characters (code > 127), always reposition cursor
      // to avoid terminal width calculation mismatches
      const code = cell.char?.codePointAt(0) ?? 0;
      const isNonAscii = code > 127;

      // Move cursor if not at expected position or if we need to force reposition
      if (y !== lastY || x !== cursorX || isNonAscii) {
        output += cursorToZero(y, x);
        cursorX = x;
      }

      // Apply style changes
      const styleChange = transitionStyle(this.lastCell, cell);
      output += styleChange;

      // Write character
      output += cell.char;

      // Update cursor position accounting for character width
      // For non-ASCII characters, invalidate cursor position to force
      // repositioning for the next character (terminal may advance differently)
      if (isNonAscii) {
        cursorX = -1; // Force reposition for next char
      } else {
        cursorX += charWidth;
      }

      this.lastCell = cell;
      lastY = y;
    }

    return output;
  }

  /**
   * Render a specific region.
   */
  renderRegion(x: number, y: number, width: number, height: number): void {
    this.buffer.markDirty({ x, y, width, height });
    this.flush();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cursor Control
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the cursor at position.
   */
  showCursor(x: number, y: number): void {
    this.output(cursorToZero(y, x) + cursorShow());
  }

  /**
   * Hide the cursor.
   */
  hideCursor(): void {
    this.output(cursorHide());
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State Queries
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check if renderer is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// ============================================
// Factory Functions
// ============================================

/**
 * Create a renderer for the terminal.
 */
export function createRenderer(size: Size, options?: RendererOptions): Renderer {
  return new Renderer(size, options);
}

/**
 * Create a renderer that captures output (for testing).
 */
export function createTestRenderer(
  size: Size
): { renderer: Renderer; getOutput: () => string; clearOutput: () => void } {
  let captured = '';

  const renderer = new Renderer(size, {
    output: (data: string) => {
      captured += data;
    },
    alternateScreen: false,
    mouseTracking: false,
    bracketedPaste: false,
  });

  return {
    renderer,
    getOutput: () => captured,
    clearOutput: () => {
      captured = '';
    },
  };
}
