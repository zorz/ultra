/**
 * Inline Diff Expander Component
 *
 * Renders inline diffs within the document editor when clicking on
 * git-modified lines in the gutter. Shows old/new content below the
 * changed line with collapsible expansion, scrolling, and action buttons.
 */

import type { ScreenBuffer } from '../rendering/buffer.ts';
import type { ElementContext } from '../elements/base.ts';
import type { GitDiffHunk, DiffLine } from '../../../services/git/types.ts';
import type { MouseEvent, KeyEvent } from '../types.ts';

// ============================================
// Types
// ============================================

/**
 * Syntax token for highlighting.
 */
export interface SyntaxToken {
  start: number;
  end: number;
  type: string;
  color?: string;
}

/**
 * Function to get syntax tokens for a buffer line.
 */
export type TokenProvider = (bufferLine: number) => SyntaxToken[] | undefined;

/**
 * Actions that can be performed on an inline diff.
 */
export type InlineDiffAction = 'stage' | 'revert' | 'close';

/**
 * Callbacks for inline diff actions.
 */
export interface InlineDiffCallbacks {
  /** Stage the hunk */
  onStage?: (bufferLine: number, hunk: GitDiffHunk) => void | Promise<void>;
  /** Revert/discard the hunk (called after confirmation) */
  onRevert?: (bufferLine: number, hunk: GitDiffHunk) => void | Promise<void>;
  /** Close the inline diff */
  onClose?: (bufferLine: number) => void;
  /** Show confirmation dialog for revert */
  onConfirmRevert?: (message: string) => Promise<boolean>;
}

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
  /** Scroll offset within the diff content */
  scrollOffset: number;
  /** Whether this region is focused (receives keyboard input) */
  focused: boolean;
  /** Index of focused button (0=stage, 1=revert, 2=close) */
  focusedButton: number;
}

/**
 * Button definition for rendering.
 */
interface DiffButton {
  label: string;
  shortcut: string;
  action: InlineDiffAction;
  width: number;
}

// ============================================
// Inline Diff Expander
// ============================================

export class InlineDiffExpander {
  /** Active diff regions keyed by buffer line */
  private regions: Map<number, InlineDiffRegion> = new Map();

  /** Element context for theme colors and settings */
  private ctx: ElementContext;

  /** Callbacks for actions */
  private callbacks: InlineDiffCallbacks = {};

  /** Maximum height for inline diff content (configurable) */
  private maxHeight = 15;

  /** Number of context lines to show (configurable) */
  private contextLines = 3;

  /** Button definitions */
  private readonly buttons: DiffButton[] = [
    { label: 'Stage', shortcut: 's', action: 'stage', width: 9 },
    { label: 'Revert', shortcut: 'd', action: 'revert', width: 10 },
    { label: 'Close', shortcut: 'Esc', action: 'close', width: 9 },
  ];

  /** Height of the button bar (1 row) */
  private readonly buttonBarHeight = 1;

  constructor(ctx: ElementContext) {
    this.ctx = ctx;
    this.loadSettings();
  }

  /**
   * Load settings from context.
   */
  private loadSettings(): void {
    this.maxHeight = this.ctx.getSetting('git.inlineDiff.maxHeight', 15);
    this.contextLines = this.ctx.getSetting('git.inlineDiff.contextLines', 3);
  }

  /**
   * Set callbacks for actions.
   */
  setCallbacks(callbacks: InlineDiffCallbacks): void {
    this.callbacks = callbacks;
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
      this.regions.set(bufferLine, {
        bufferLine,
        hunk,
        expanded: true,
        scrollOffset: 0,
        focused: true,
        focusedButton: 0,
      });
      // Unfocus other regions
      for (const [line, region] of this.regions) {
        if (line !== bufferLine) {
          region.focused = false;
        }
      }
      return true;
    }

    return false;
  }

  /**
   * Expand diff at a specific line.
   */
  expand(bufferLine: number, hunk: GitDiffHunk): void {
    this.regions.set(bufferLine, {
      bufferLine,
      hunk,
      expanded: true,
      scrollOffset: 0,
      focused: true,
      focusedButton: 0,
    });
    // Unfocus other regions
    for (const [line, region] of this.regions) {
      if (line !== bufferLine) {
        region.focused = false;
      }
    }
  }

  /**
   * Collapse diff at a specific line.
   */
  collapse(bufferLine: number): void {
    this.regions.delete(bufferLine);
    this.callbacks.onClose?.(bufferLine);
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
   * Get the focused region, if any.
   */
  getFocusedRegion(): InlineDiffRegion | null {
    for (const region of this.regions.values()) {
      if (region.focused) return region;
    }
    return null;
  }

  /**
   * Focus a specific region.
   */
  focusRegion(bufferLine: number): void {
    for (const [line, region] of this.regions) {
      region.focused = line === bufferLine;
    }
  }

  /**
   * Unfocus all regions.
   */
  unfocusAll(): void {
    for (const region of this.regions.values()) {
      region.focused = false;
    }
  }

  /**
   * Get the number of extra rows needed after a buffer line.
   * This is used by the editor to adjust line positions.
   */
  getExtraRows(bufferLine: number): number {
    const region = this.regions.get(bufferLine);
    if (!region?.expanded) return 0;
    return this.calculateVisibleRows(region);
  }

  /**
   * Get total extra rows for all lines up to (and including) the given line.
   * Useful for scroll offset calculations.
   */
  getTotalExtraRowsBefore(bufferLine: number): number {
    let total = 0;
    for (const [line, region] of this.regions) {
      if (line < bufferLine && region.expanded) {
        total += this.calculateVisibleRows(region);
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
   * Calculate the number of visible rows for a region.
   * Includes: top separator, content (up to maxHeight), button bar, bottom separator
   */
  private calculateVisibleRows(region: InlineDiffRegion): number {
    const contentRows = Math.min(region.hunk.lines.length, this.maxHeight);
    // +3 for: top separator, button bar, bottom separator
    return contentRows + 3;
  }

  /**
   * Calculate total scrollable content height.
   */
  private getTotalContentHeight(region: InlineDiffRegion): number {
    return region.hunk.lines.length;
  }

  /**
   * Check if region needs scrolling.
   */
  private needsScrolling(region: InlineDiffRegion): boolean {
    return region.hunk.lines.length > this.maxHeight;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Execute an action on a region.
   */
  async executeAction(bufferLine: number, action: InlineDiffAction): Promise<void> {
    const region = this.regions.get(bufferLine);
    if (!region) return;

    switch (action) {
      case 'stage':
        await this.callbacks.onStage?.(bufferLine, region.hunk);
        this.collapse(bufferLine);
        break;

      case 'revert':
        // Show confirmation
        const confirmed = await this.callbacks.onConfirmRevert?.(
          'Discard changes? This cannot be undone.'
        );
        if (confirmed) {
          await this.callbacks.onRevert?.(bufferLine, region.hunk);
          this.collapse(bufferLine);
        }
        break;

      case 'close':
        this.collapse(bufferLine);
        break;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scrolling
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Scroll the focused region up.
   */
  scrollUp(lines: number = 1): boolean {
    const region = this.getFocusedRegion();
    if (!region || !this.needsScrolling(region)) return false;

    const oldOffset = region.scrollOffset;
    region.scrollOffset = Math.max(0, region.scrollOffset - lines);
    return region.scrollOffset !== oldOffset;
  }

  /**
   * Scroll the focused region down.
   */
  scrollDown(lines: number = 1): boolean {
    const region = this.getFocusedRegion();
    if (!region || !this.needsScrolling(region)) return false;

    const maxScroll = Math.max(0, this.getTotalContentHeight(region) - this.maxHeight);
    const oldOffset = region.scrollOffset;
    region.scrollOffset = Math.min(maxScroll, region.scrollOffset + lines);
    return region.scrollOffset !== oldOffset;
  }

  /**
   * Move button focus left.
   */
  focusPreviousButton(): boolean {
    const region = this.getFocusedRegion();
    if (!region) return false;

    if (region.focusedButton > 0) {
      region.focusedButton--;
      return true;
    }
    return false;
  }

  /**
   * Move button focus right.
   */
  focusNextButton(): boolean {
    const region = this.getFocusedRegion();
    if (!region) return false;

    if (region.focusedButton < this.buttons.length - 1) {
      region.focusedButton++;
      return true;
    }
    return false;
  }

  /**
   * Activate the focused button.
   */
  async activateFocusedButton(): Promise<boolean> {
    const region = this.getFocusedRegion();
    if (!region) return false;

    const button = this.buttons[region.focusedButton];
    if (button) {
      await this.executeAction(region.bufferLine, button.action);
      return true;
    }
    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Handle keyboard input for the focused region.
   * Returns true if the event was handled.
   */
  async handleKeyEvent(event: KeyEvent): Promise<boolean> {
    const region = this.getFocusedRegion();
    if (!region) return false;

    const { key, ctrl, shift } = event;

    // Scrolling with arrow keys
    if (key === 'ArrowUp' || key === 'Up') {
      if (this.scrollUp()) {
        this.ctx.markDirty();
        return true;
      }
    }

    if (key === 'ArrowDown' || key === 'Down') {
      if (this.scrollDown()) {
        this.ctx.markDirty();
        return true;
      }
    }

    // Page up/down for faster scrolling
    if (key === 'PageUp') {
      if (this.scrollUp(this.maxHeight - 2)) {
        this.ctx.markDirty();
        return true;
      }
    }

    if (key === 'PageDown') {
      if (this.scrollDown(this.maxHeight - 2)) {
        this.ctx.markDirty();
        return true;
      }
    }

    // Button navigation with left/right
    if (key === 'ArrowLeft' || key === 'Left') {
      if (this.focusPreviousButton()) {
        this.ctx.markDirty();
        return true;
      }
    }

    if (key === 'ArrowRight' || key === 'Right') {
      if (this.focusNextButton()) {
        this.ctx.markDirty();
        return true;
      }
    }

    // Enter to activate focused button
    if (key === 'Enter' || key === 'Return') {
      await this.activateFocusedButton();
      this.ctx.markDirty();
      return true;
    }

    // Escape to close
    if (key === 'Escape') {
      this.collapse(region.bufferLine);
      this.ctx.markDirty();
      return true;
    }

    // Shortcut keys
    if (key === 's' && !ctrl && !shift) {
      await this.executeAction(region.bufferLine, 'stage');
      this.ctx.markDirty();
      return true;
    }

    if (key === 'd' && !ctrl && !shift) {
      await this.executeAction(region.bufferLine, 'revert');
      this.ctx.markDirty();
      return true;
    }

    return false;
  }

  /**
   * Handle mouse event for a region.
   * Returns true if the event was handled.
   *
   * @param event Mouse event
   * @param bufferLine Buffer line the region is attached to
   * @param regionStartY Screen Y where the region starts
   * @param x Left edge X position
   * @param width Available width
   * @param gutterWidth Width of the gutter
   */
  async handleMouseEvent(
    event: MouseEvent,
    bufferLine: number,
    regionStartY: number,
    x: number,
    width: number,
    gutterWidth: number
  ): Promise<boolean> {
    const region = this.regions.get(bufferLine);
    if (!region?.expanded) return false;

    const relY = event.y - regionStartY;
    const relX = event.x - x;
    const contentX = gutterWidth;
    const contentWidth = width - gutterWidth;

    // Check if click is within the region
    const visibleRows = this.calculateVisibleRows(region);
    if (relY < 0 || relY >= visibleRows) return false;

    // Focus this region
    this.focusRegion(bufferLine);

    // Check for scroll wheel
    if (event.type === 'scroll') {
      if (event.scrollDirection === -1) {
        // Scroll up
        if (this.scrollUp(3)) {
          this.ctx.markDirty();
        }
      } else if (event.scrollDirection === 1) {
        // Scroll down
        if (this.scrollDown(3)) {
          this.ctx.markDirty();
        }
      }
      return true;
    }

    // Check for button bar click (row after content, before bottom separator)
    const buttonBarRow = 1 + Math.min(region.hunk.lines.length, this.maxHeight);
    if (relY === buttonBarRow && event.type === 'press') {
      // Calculate button positions
      const buttonStartX = contentX + 1;
      let buttonX = buttonStartX;

      for (let i = 0; i < this.buttons.length; i++) {
        const button = this.buttons[i]!;
        if (relX >= buttonX && relX < buttonX + button.width) {
          // Click on this button
          region.focusedButton = i;
          await this.executeAction(bufferLine, button.action);
          this.ctx.markDirty();
          return true;
        }
        buttonX += button.width + 1; // +1 for spacing
      }
    }

    // Click in content area - focus but don't do anything else
    if (event.type === 'press') {
      this.ctx.markDirty();
      return true;
    }

    return false;
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
   * @param tokenProvider Optional function to get syntax tokens for a buffer line
   * @returns Number of rows rendered
   */
  render(
    buffer: ScreenBuffer,
    bufferLine: number,
    startY: number,
    x: number,
    width: number,
    gutterWidth: number,
    tokenProvider?: TokenProvider
  ): number {
    const region = this.regions.get(bufferLine);
    if (!region?.expanded) return 0;

    // Reload settings in case they changed
    this.loadSettings();

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
    const buttonBg = this.ctx.getThemeColor('button.background', '#0e639c');
    const buttonFg = this.ctx.getThemeColor('button.foreground', '#ffffff');
    const buttonHoverBg = this.ctx.getThemeColor('button.hoverBackground', '#1177bb');
    const focusBorder = this.ctx.getThemeColor('focusBorder', '#007fd4');

    let rowOffset = 0;
    const contentX = x + gutterWidth;
    const contentWidth = width - gutterWidth;
    const hunk = region.hunk;

    // Top separator with scroll indicator
    const needsScroll = this.needsScrolling(region);
    const scrollIndicator = needsScroll
      ? ` ↑${region.scrollOffset + 1}/${hunk.lines.length} `
      : '';
    this.renderSeparator(
      buffer, x, startY + rowOffset, width, gutterWidth,
      separatorFg, separatorBg, gutterBg, '┬', scrollIndicator
    );
    rowOffset++;

    // Render diff lines (with scrolling)
    const visibleContentRows = Math.min(hunk.lines.length, this.maxHeight);
    const startLine = region.scrollOffset;
    const endLine = Math.min(startLine + visibleContentRows, hunk.lines.length);

    // Calculate the buffer line for the first visible line
    // newStart is 1-based, convert to 0-based
    let currentBufferLine = hunk.newStart - 1;
    // Advance for lines before startLine (accounting for deleted lines)
    for (let i = 0; i < startLine; i++) {
      const line = hunk.lines[i]!;
      if (line.type !== 'deleted') {
        currentBufferLine++;
      }
    }

    for (let i = startLine; i < endLine; i++) {
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

      // Get syntax tokens for added/context lines (they exist in the buffer)
      const tokens = (line.type !== 'deleted' && tokenProvider)
        ? tokenProvider(currentBufferLine)
        : undefined;

      // Render prefix
      buffer.writeString(contentX, screenY, `${prefix} `, lineFg, lineBg);

      // Render line content with syntax highlighting if available
      const contentStartX = contentX + 2; // After "X " prefix
      const availableWidth = contentWidth - 2;

      if (tokens && tokens.length > 0) {
        // Render with syntax tokens
        this.renderLineWithTokens(
          buffer, contentStartX, screenY, line.content,
          tokens, availableWidth, lineFg, lineBg
        );
      } else {
        // Render plain text
        let lineText = line.content;
        if (lineText.length > availableWidth) {
          lineText = lineText.slice(0, availableWidth - 1) + '…';
        }
        lineText = lineText.padEnd(availableWidth, ' ').slice(0, availableWidth);
        buffer.writeString(contentStartX, screenY, lineText, lineFg, lineBg);
      }

      // Advance buffer line for added/context lines
      if (line.type !== 'deleted') {
        currentBufferLine++;
      }

      rowOffset++;
    }

    // Button bar
    const buttonY = startY + rowOffset;
    // Gutter for button row
    const buttonGutter = '│'.padStart(gutterWidth, ' ');
    buffer.writeString(x, buttonY, buttonGutter, separatorFg, gutterBg);

    // Clear button row background
    buffer.writeString(contentX, buttonY, ' '.repeat(contentWidth), contextFg, contextBg);

    // Render buttons
    let buttonX = contentX + 1;
    for (let i = 0; i < this.buttons.length; i++) {
      const button = this.buttons[i]!;
      const isFocused = region.focused && region.focusedButton === i;
      const bg = isFocused ? buttonHoverBg : buttonBg;

      // Button text: [shortcut:label]
      const buttonText = `[${button.shortcut}:${button.label}]`;
      const paddedText = buttonText.padEnd(button.width, ' ').slice(0, button.width);

      buffer.writeString(buttonX, buttonY, paddedText, buttonFg, bg);

      // Draw focus border if focused
      if (isFocused && region.focused) {
        // Underline effect for focus
        for (let j = 0; j < button.width; j++) {
          const cell = buffer.get(buttonX + j, buttonY);
          if (cell) {
            buffer.set(buttonX + j, buttonY, {
              ...cell,
              underline: true,
              underlineColor: focusBorder,
            });
          }
        }
      }

      buttonX += button.width + 1;
    }

    // Add keyboard hint at the end
    const hintText = ' ←→:nav ↑↓:scroll Enter:select';
    const hintX = buttonX + 1;
    if (hintX + hintText.length < x + width) {
      buffer.writeString(hintX, buttonY, hintText, separatorFg, contextBg);
    }

    rowOffset++;

    // Bottom separator with scroll indicator
    const bottomIndicator = needsScroll && endLine < hunk.lines.length
      ? ` ↓${hunk.lines.length - endLine} more `
      : '';
    this.renderSeparator(
      buffer, x, startY + rowOffset, width, gutterWidth,
      separatorFg, separatorBg, gutterBg, '┴', bottomIndicator
    );
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
    gutterChar: string,
    indicator: string = ''
  ): void {
    // Gutter part
    const gutterText = gutterChar.padStart(gutterWidth, '─');
    buffer.writeString(x, y, gutterText, fg, gutterBg);

    // Content part
    const contentWidth = width - gutterWidth;
    const lineContent = indicator
      ? '─'.repeat(2) + indicator + '─'.repeat(Math.max(0, contentWidth - indicator.length - 2))
      : '─'.repeat(contentWidth);
    buffer.writeString(x + gutterWidth, y, lineContent.slice(0, contentWidth), fg, bg);
  }

  /**
   * Render a line with syntax tokens.
   */
  private renderLineWithTokens(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    text: string,
    tokens: SyntaxToken[],
    maxWidth: number,
    defaultFg: string,
    bg: string
  ): void {
    // Fill with spaces first
    buffer.writeString(x, y, ' '.repeat(maxWidth), defaultFg, bg);

    // Render each character with its token color
    let col = 0;
    for (let i = 0; i < text.length && col < maxWidth; i++) {
      const char = text[i]!;
      // Find token for this position
      let fg = defaultFg;
      for (const token of tokens) {
        if (i >= token.start && i < token.end && token.color) {
          fg = token.color;
          break;
        }
      }
      buffer.set(x + col, y, { char, fg, bg });
      col++;
    }

    // Add ellipsis if truncated
    if (text.length > maxWidth && maxWidth > 0) {
      buffer.set(x + maxWidth - 1, y, { char: '…', fg: defaultFg, bg });
    }
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
        const visibleRows = this.calculateVisibleRows(region);
        if (currentScreenRow + visibleRows > screenRow) {
          return null; // Click is within expanded diff, not a buffer line
        }

        currentScreenRow += visibleRows;
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
        screenRow += this.calculateVisibleRows(region);
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
