/**
 * Screen Buffer
 *
 * Double-buffered screen buffer for efficient terminal rendering.
 * Tracks dirty cells to minimize output.
 */

import {
  type Cell,
  type Rect,
  type Size,
  createEmptyCell,
  cellsEqual,
  cloneCell,
} from '../types.ts';

// Import shared character width utility (single source of truth)
import { getCharWidth as getCharDisplayWidth } from '../../../core/char-width.ts';

// ============================================
// ScreenBuffer Class
// ============================================

export class ScreenBuffer {
  private width: number;
  private height: number;
  private cells: Cell[][];
  private dirty: boolean[][];

  constructor(size: Size) {
    this.width = size.width;
    this.height = size.height;
    this.cells = this.createGrid();
    this.dirty = this.createDirtyGrid(true); // Initially all dirty
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Grid Creation
  // ─────────────────────────────────────────────────────────────────────────

  private createGrid(): Cell[][] {
    return Array.from({ length: this.height }, () =>
      Array.from({ length: this.width }, () => createEmptyCell())
    );
  }

  private createDirtyGrid(initialValue: boolean): boolean[][] {
    return Array.from({ length: this.height }, () =>
      Array.from({ length: this.width }, () => initialValue)
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Size Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get current buffer size.
   */
  getSize(): Size {
    return { width: this.width, height: this.height };
  }

  /**
   * Resize the buffer. Contents are cleared.
   */
  resize(size: Size): void {
    this.width = size.width;
    this.height = size.height;
    this.cells = this.createGrid();
    this.dirty = this.createDirtyGrid(true);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cell Access
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a cell at position. Returns null if out of bounds.
   */
  get(x: number, y: number): Cell | null {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return null;
    }
    return this.cells[y]![x]!;
  }

  /**
   * Set a cell at position. Marks as dirty if changed.
   * Out of bounds writes are silently ignored.
   */
  set(x: number, y: number, cell: Cell): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return;
    }

    const existing = this.cells[y]![x]!;
    if (!cellsEqual(existing, cell)) {
      this.cells[y]![x] = cloneCell(cell);
      this.dirty[y]![x] = true;
    }
  }

  /**
   * Set cell character only, preserving other attributes.
   */
  setChar(x: number, y: number, char: string): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return;
    }

    const existing = this.cells[y]![x]!;
    if (existing.char !== char) {
      this.cells[y]![x] = { ...existing, char };
      this.dirty[y]![x] = true;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Bulk Operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Clear the entire buffer.
   */
  clear(bg = 'default', fg = 'default'): void {
    const emptyCell = createEmptyCell(bg, fg);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!cellsEqual(this.cells[y]![x]!, emptyCell)) {
          this.cells[y]![x] = cloneCell(emptyCell);
          this.dirty[y]![x] = true;
        }
      }
    }
  }

  /**
   * Write a string starting at position.
   * Properly handles Unicode characters including emoji (which may be 2 cells wide).
   */
  writeString(
    x: number,
    y: number,
    text: string,
    fg: string,
    bg: string,
    options: {
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      strikethrough?: boolean;
      dim?: boolean;
    } = {}
  ): number {
    let written = 0;
    let px = x;

    // Use for...of to properly iterate Unicode code points (not UTF-16 code units)
    for (const char of text) {
      if (px >= this.width) break;

      const charWidth = getCharDisplayWidth(char);

      // Skip zero-width characters (variation selectors, combining marks)
      if (charWidth === 0) {
        continue;
      }

      if (px < 0) {
        px += charWidth;
        continue;
      }
      if (y < 0 || y >= this.height) continue;

      this.set(px, y, {
        char,
        fg,
        bg,
        bold: options.bold,
        italic: options.italic,
        underline: options.underline,
        strikethrough: options.strikethrough,
        dim: options.dim,
      });
      written++;
      px++;

      // For wide characters (emoji, CJK), fill the next cell with empty
      // to prevent it from being overwritten with stale content
      if (charWidth === 2 && px < this.width) {
        this.set(px, y, {
          char: '', // Empty placeholder for second cell of wide char
          fg,
          bg,
          bold: options.bold,
          italic: options.italic,
          underline: options.underline,
          strikethrough: options.strikethrough,
          dim: options.dim,
        });
        px++;
      }
    }
    return written;
  }

  /**
   * Fill a rectangle with a cell.
   */
  fillRect(rect: Rect, cell: Cell): void {
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        this.set(x, y, cell);
      }
    }
  }

  /**
   * Fill a rectangle with empty cells.
   */
  clearRect(rect: Rect, bg = 'default', fg = 'default'): void {
    this.fillRect(rect, createEmptyCell(bg, fg));
  }

  /**
   * Draw a box border.
   */
  drawBox(
    rect: Rect,
    fg: string,
    bg: string,
    style: 'single' | 'double' | 'rounded' = 'single'
  ): void {
    const chars = BOX_CHARS[style];
    const { x, y, width, height } = rect;

    if (width < 2 || height < 2) return;

    // Corners
    this.set(x, y, { char: chars.topLeft, fg, bg });
    this.set(x + width - 1, y, { char: chars.topRight, fg, bg });
    this.set(x, y + height - 1, { char: chars.bottomLeft, fg, bg });
    this.set(x + width - 1, y + height - 1, { char: chars.bottomRight, fg, bg });

    // Top/bottom edges
    for (let i = 1; i < width - 1; i++) {
      this.set(x + i, y, { char: chars.horizontal, fg, bg });
      this.set(x + i, y + height - 1, { char: chars.horizontal, fg, bg });
    }

    // Left/right edges
    for (let i = 1; i < height - 1; i++) {
      this.set(x, y + i, { char: chars.vertical, fg, bg });
      this.set(x + width - 1, y + i, { char: chars.vertical, fg, bg });
    }
  }

  /**
   * Draw a horizontal line.
   */
  drawHLine(x: number, y: number, length: number, fg: string, bg: string): void {
    for (let i = 0; i < length; i++) {
      this.set(x + i, y, { char: '─', fg, bg });
    }
  }

  /**
   * Draw a vertical line.
   */
  drawVLine(x: number, y: number, length: number, fg: string, bg: string): void {
    for (let i = 0; i < length; i++) {
      this.set(x, y + i, { char: '│', fg, bg });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Dirty Tracking
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check if a cell is dirty.
   */
  isDirty(x: number, y: number): boolean {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return false;
    }
    return this.dirty[y]![x]!;
  }

  /**
   * Mark a region as dirty.
   */
  markDirty(rect: Rect): void {
    for (let y = rect.y; y < rect.y + rect.height && y < this.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width && x < this.width; x++) {
        if (y >= 0 && x >= 0) {
          this.dirty[y]![x] = true;
        }
      }
    }
  }

  /**
   * Mark entire buffer as dirty.
   */
  markAllDirty(): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.dirty[y]![x] = true;
      }
    }
  }

  /**
   * Clear all dirty flags.
   */
  clearDirty(): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.dirty[y]![x] = false;
      }
    }
  }

  /**
   * Get all dirty cells.
   */
  getDirtyCells(): Array<{ x: number; y: number; cell: Cell }> {
    const result: Array<{ x: number; y: number; cell: Cell }> = [];

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.dirty[y]![x]) {
          result.push({ x, y, cell: this.cells[y]![x]! });
        }
      }
    }

    return result;
  }

  /**
   * Count dirty cells.
   */
  getDirtyCount(): number {
    let count = 0;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.dirty[y]![x]) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Check if any cell is dirty.
   */
  hasDirty(): boolean {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.dirty[y]![x]) {
          return true;
        }
      }
    }
    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Iteration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Iterate over all cells in a region.
   */
  *iterateRect(
    rect: Rect
  ): Generator<{ x: number; y: number; cell: Cell }, void, unknown> {
    for (let y = rect.y; y < rect.y + rect.height && y < this.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width && x < this.width; x++) {
        if (y >= 0 && x >= 0) {
          yield { x, y, cell: this.cells[y]![x]! };
        }
      }
    }
  }

  /**
   * Iterate over all cells row by row.
   */
  *iterateAll(): Generator<{ x: number; y: number; cell: Cell }, void, unknown> {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        yield { x, y, cell: this.cells[y]![x]! };
      }
    }
  }
}

// ============================================
// Box Drawing Characters
// ============================================

interface BoxChars {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  horizontal: string;
  vertical: string;
}

const BOX_CHARS: Record<'single' | 'double' | 'rounded', BoxChars> = {
  single: {
    topLeft: '┌',
    topRight: '┐',
    bottomLeft: '└',
    bottomRight: '┘',
    horizontal: '─',
    vertical: '│',
  },
  double: {
    topLeft: '╔',
    topRight: '╗',
    bottomLeft: '╚',
    bottomRight: '╝',
    horizontal: '═',
    vertical: '║',
  },
  rounded: {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    horizontal: '─',
    vertical: '│',
  },
};

// ============================================
// Factory Function
// ============================================

/**
 * Create a new screen buffer.
 */
export function createScreenBuffer(size: Size): ScreenBuffer {
  return new ScreenBuffer(size);
}
