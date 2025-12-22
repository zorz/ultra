/**
 * Inline Diff Expander Component
 *
 * Renders inline diffs within the document editor when clicking on
 * git-modified lines in the gutter. Shows old/new content below the
 * changed line with collapsible expansion.
 */

import type { ScreenBuffer } from '../rendering/buffer.ts';
import type { ElementContext } from '../elements/base.ts';
import type { GitDiffHunk, DiffLine } from '../../../services/git/types.ts';

// ============================================
// Types
// ============================================

/**
 * An inline diff region displayed within the editor.
 */
export interface InlineDiffRegion {
  /** Buffer line where diff is anchored (after this line) */
  bufferLine: number;
  /** The hunk being shown */
  hunk: GitDiffHunk;
  /** Whether the inline diff is expanded */
  expanded: boolean;
  /** Calculated visible row count */
  visibleRows: number;
}

/**
 * Callback to fetch a diff hunk for a given line.
 */
export type GetDiffHunkCallback = (bufferLine: number) => Promise<GitDiffHunk | null>;

// ============================================
// Inline Diff Expander
// ============================================

export class InlineDiffExpander {
  /** Active diff regions keyed by buffer line */
  private regions: Map<number, InlineDiffRegion> = new Map();

  /** Element context for theme colors */
  private ctx: ElementContext;

  /** Maximum height for inline diff (in rows) */
  private maxHeight = 20;

  constructor(ctx: ElementContext) {
    this.ctx = ctx;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Region Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Toggle inline diff at a specific buffer line.
   *
   * @param bufferLine 0-based buffer line number
   * @param hunk Diff hunk to display (null to just collapse)
   * @returns true if now expanded, false if collapsed
   */
  toggle(bufferLine: number, hunk: GitDiffHunk | null): boolean {
    if (this.regions.has(bufferLine)) {
      // Collapse existing region
      this.regions.delete(bufferLine);
      return false;
    }

    if (hunk) {
      // Create new expanded region
      const visibleRows = this.calculateRows(hunk);
      this.regions.set(bufferLine, {
        bufferLine,
        hunk,
        expanded: true,
        visibleRows,
      });
      return true;
    }

    return false;
  }

  /**
   * Expand diff at a specific line.
   */
  expand(bufferLine: number, hunk: GitDiffHunk): void {
    const visibleRows = this.calculateRows(hunk);
    this.regions.set(bufferLine, {
      bufferLine,
      hunk,
      expanded: true,
      visibleRows,
    });
  }

  /**
   * Collapse diff at a specific line.
   */
  collapse(bufferLine: number): void {
    this.regions.delete(bufferLine);
  }

  /**
   * Check if a line has an expanded diff.
   */
  isExpanded(bufferLine: number): boolean {
    return this.regions.has(bufferLine);
  }

  /**
   * Get the region at a specific line.
   */
  getRegion(bufferLine: number): InlineDiffRegion | null {
    return this.regions.get(bufferLine) ?? null;
  }

  /**
   * Get all active regions.
   */
  getRegions(): InlineDiffRegion[] {
    return Array.from(this.regions.values());
  }

  /**
   * Get the number of extra rows needed after a buffer line.
   * This is used by the editor to adjust line positions.
   */
  getExtraRows(bufferLine: number): number {
    const region = this.regions.get(bufferLine);
    return region?.expanded ? region.visibleRows : 0;
  }

  /**
   * Get total extra rows for all lines up to (and including) the given line.
   * Useful for scroll offset calculations.
   */
  getTotalExtraRowsBefore(bufferLine: number): number {
    let total = 0;
    for (const [line, region] of this.regions) {
      if (line < bufferLine && region.expanded) {
        total += region.visibleRows;
      }
    }
    return total;
  }

  /**
   * Clear all regions.
   */
  clear(): void {
    this.regions.clear();
  }

  /**
   * Set maximum height for inline diffs.
   */
  setMaxHeight(height: number): void {
    this.maxHeight = height;
  }

  /**
   * Calculate the number of visible rows for a hunk.
   */
  private calculateRows(hunk: GitDiffHunk): number {
    // +2 for separator lines (top and bottom)
    const contentRows = hunk.lines.length + 2;
    return Math.min(contentRows, this.maxHeight);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Render an inline diff region.
   *
   * @param buffer Screen buffer to render to
   * @param bufferLine The buffer line this diff is attached to
   * @param startY Screen Y position to start rendering
   * @param x Left edge X position
   * @param width Available width
   * @param gutterWidth Width of the gutter (for proper alignment)
   * @returns Number of rows rendered
   */
  render(
    buffer: ScreenBuffer,
    bufferLine: number,
    startY: number,
    x: number,
    width: number,
    gutterWidth: number
  ): number {
    const region = this.regions.get(bufferLine);
    if (!region?.expanded) return 0;

    // Colors
    const separatorBg = this.ctx.getThemeColor('diffEditor.diagonalFill', '#444444');
    const separatorFg = this.ctx.getThemeColor('editorLineNumber.foreground', '#858585');
    const addedBg = this.ctx.getThemeColor('diffEditor.insertedLineBackground', '#1e3a21');
    const deletedBg = this.ctx.getThemeColor('diffEditor.removedLineBackground', '#3a1e1e');
    const contextBg = this.ctx.getThemeColor('editor.background', '#1e1e1e');
    const addedFg = this.ctx.getThemeColor('gitDecoration.addedResourceForeground', '#81b88b');
    const deletedFg = this.ctx.getThemeColor('gitDecoration.deletedResourceForeground', '#c74e39');
    const contextFg = this.ctx.getThemeColor('editor.foreground', '#d4d4d4');
    const gutterBg = this.ctx.getThemeColor('editorGutter.background', '#1e1e1e');

    let rowOffset = 0;
    const contentX = x + gutterWidth;
    const contentWidth = width - gutterWidth;
    const hunk = region.hunk;

    // Top separator
    this.renderSeparator(buffer, x, startY + rowOffset, width, gutterWidth, separatorFg, separatorBg, gutterBg, '┬');
    rowOffset++;

    // Render diff lines (up to maxHeight - 2 for separators)
    const maxContentRows = this.maxHeight - 2;
    const linesToRender = Math.min(hunk.lines.length, maxContentRows);

    for (let i = 0; i < linesToRender; i++) {
      const line = hunk.lines[i]!;
      const screenY = startY + rowOffset;

      // Determine colors based on line type
      let lineBg = contextBg;
      let lineFg = contextFg;
      let prefix = ' ';

      if (line.type === 'added') {
        lineBg = addedBg;
        lineFg = addedFg;
        prefix = '+';
      } else if (line.type === 'deleted') {
        lineBg = deletedBg;
        lineFg = deletedFg;
        prefix = '-';
      }

      // Render gutter area (blank for inline diff)
      const gutterText = '│'.padStart(gutterWidth, ' ');
      buffer.writeString(x, screenY, gutterText, separatorFg, gutterBg);

      // Render line content
      let lineText = `${prefix} ${line.content}`;
      if (lineText.length > contentWidth) {
        lineText = lineText.slice(0, contentWidth - 1) + '…';
      }
      lineText = lineText.padEnd(contentWidth, ' ').slice(0, contentWidth);
      buffer.writeString(contentX, screenY, lineText, lineFg, lineBg);

      rowOffset++;
    }

    // Show truncation indicator if needed
    if (hunk.lines.length > maxContentRows) {
      const screenY = startY + rowOffset;
      const truncMsg = ` ... ${hunk.lines.length - maxContentRows} more lines `;
      const gutterText = '│'.padStart(gutterWidth, ' ');
      buffer.writeString(x, screenY, gutterText, separatorFg, gutterBg);
      buffer.writeString(contentX, screenY, truncMsg.padEnd(contentWidth, ' ').slice(0, contentWidth), separatorFg, contextBg);
      rowOffset++;
    }

    // Bottom separator
    this.renderSeparator(buffer, x, startY + rowOffset, width, gutterWidth, separatorFg, separatorBg, gutterBg, '┴');
    rowOffset++;

    return rowOffset;
  }

  /**
   * Render a separator line.
   */
  private renderSeparator(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number,
    gutterWidth: number,
    fg: string,
    bg: string,
    gutterBg: string,
    gutterChar: string
  ): void {
    // Gutter part
    const gutterText = gutterChar.padStart(gutterWidth, '─');
    buffer.writeString(x, y, gutterText, fg, gutterBg);

    // Content part
    const contentWidth = width - gutterWidth;
    buffer.writeString(x + gutterWidth, y, '─'.repeat(contentWidth), fg, bg);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Line Mapping
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Convert a screen row to a buffer line, accounting for expanded diffs.
   *
   * @param screenRow The screen row (relative to content area)
   * @param scrollTop Current scroll offset
   * @returns The buffer line number, or null if in an expanded diff
   */
  screenRowToBufferLine(screenRow: number, scrollTop: number): number | null {
    let currentScreenRow = 0;
    let bufferLine = scrollTop;

    // Walk through lines, accounting for expanded diffs
    const sortedRegions = Array.from(this.regions.entries()).sort((a, b) => a[0] - b[0]);

    for (const [regionLine, region] of sortedRegions) {
      if (regionLine < scrollTop) continue;

      // Rows before this region
      const linesBeforeRegion = regionLine - bufferLine;
      if (currentScreenRow + linesBeforeRegion > screenRow) {
        // Target is before this region
        return bufferLine + (screenRow - currentScreenRow);
      }

      currentScreenRow += linesBeforeRegion;
      bufferLine = regionLine;

      // Check if target is within the expanded region
      if (region.expanded) {
        // The region line itself
        if (currentScreenRow === screenRow) {
          return bufferLine;
        }
        currentScreenRow++;

        // Within the expanded diff content
        if (currentScreenRow + region.visibleRows > screenRow) {
          return null; // Click is within expanded diff, not a buffer line
        }

        currentScreenRow += region.visibleRows;
        bufferLine++;
      } else {
        if (currentScreenRow === screenRow) {
          return bufferLine;
        }
        currentScreenRow++;
        bufferLine++;
      }
    }

    // After all regions
    return bufferLine + (screenRow - currentScreenRow);
  }

  /**
   * Convert a buffer line to a screen row, accounting for expanded diffs.
   *
   * @param bufferLine The buffer line number
   * @param scrollTop Current scroll offset
   * @returns The screen row (relative to content area)
   */
  bufferLineToScreenRow(bufferLine: number, scrollTop: number): number {
    let screenRow = bufferLine - scrollTop;

    // Add extra rows for all expanded diffs before this line
    for (const [regionLine, region] of this.regions) {
      if (regionLine >= scrollTop && regionLine < bufferLine && region.expanded) {
        screenRow += region.visibleRows;
      }
    }

    return screenRow;
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create an inline diff expander.
 */
export function createInlineDiffExpander(ctx: ElementContext): InlineDiffExpander {
  return new InlineDiffExpander(ctx);
}
