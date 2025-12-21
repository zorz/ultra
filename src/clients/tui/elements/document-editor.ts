/**
 * DocumentEditor Element
 *
 * A text editor element for displaying and editing documents.
 * Renders lines with syntax highlighting, handles cursor movement and text input.
 */

import { BaseElement, type ElementContext } from './base.ts';
import type { KeyEvent, MouseEvent, Position } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';

// ============================================
// Types
// ============================================

/**
 * Line of text with optional syntax tokens.
 */
export interface DocumentLine {
  text: string;
  tokens?: SyntaxToken[];
}

/**
 * Syntax token for highlighting.
 */
export interface SyntaxToken {
  start: number;
  end: number;
  type: string; // e.g., 'keyword', 'string', 'comment'
  color?: string; // Override color
}

/**
 * Cursor position.
 */
export interface CursorPosition {
  line: number; // 0-indexed line number
  column: number; // 0-indexed column
}

/**
 * Text selection.
 */
export interface Selection {
  start: CursorPosition;
  end: CursorPosition;
}

/**
 * Document state for serialization.
 */
export interface DocumentEditorState {
  uri?: string;
  scrollTop: number;
  cursor: CursorPosition;
  selection?: Selection;
}

/**
 * Callbacks for document editor.
 */
export interface DocumentEditorCallbacks {
  /** Called when content changes */
  onContentChange?: (content: string) => void;
  /** Called when cursor moves */
  onCursorChange?: (cursor: CursorPosition) => void;
  /** Called when selection changes */
  onSelectionChange?: (selection: Selection | null) => void;
  /** Called when document is saved */
  onSave?: () => void;
}

// ============================================
// DocumentEditor Element
// ============================================

export class DocumentEditor extends BaseElement {
  /** Document lines */
  private lines: DocumentLine[] = [{ text: '' }];

  /** Cursor position */
  private cursor: CursorPosition = { line: 0, column: 0 };

  /** Current selection */
  private selection: Selection | null = null;

  /** Scroll offset (lines from top) */
  private scrollTop = 0;

  /** Horizontal scroll offset */
  private scrollLeft = 0;

  /** Document URI */
  private uri: string | null = null;

  /** Whether document is modified */
  private modified = false;

  /** Callbacks */
  private callbacks: DocumentEditorCallbacks;

  /** Line number gutter width */
  private gutterWidth = 4;

  /** Scrollbar width (1 character) */
  private static readonly SCROLLBAR_WIDTH = 1;

  /** Minimap width in characters */
  private static readonly MINIMAP_WIDTH = 10;

  /** Minimap scale - how many source lines per minimap row */
  private static readonly MINIMAP_SCALE = 3;

  /** Whether minimap is enabled */
  private minimapEnabled = false;

  /** Minimap scroll offset (in minimap rows) */
  private minimapScrollTop = 0;

  /** Whether scrollbar dragging is active */
  private scrollbarDragging = false;

  constructor(id: string, title: string, ctx: ElementContext, callbacks: DocumentEditorCallbacks = {}) {
    super('DocumentEditor', id, title, ctx);
    this.callbacks = callbacks;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Callback Configuration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set callbacks after construction.
   * Useful when element is created via factory.
   */
  setCallbacks(callbacks: DocumentEditorCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Get current callbacks.
   */
  getCallbacks(): DocumentEditorCallbacks {
    return this.callbacks;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Minimap Configuration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Enable or disable the minimap.
   */
  setMinimapEnabled(enabled: boolean): void {
    this.minimapEnabled = enabled;
    this.ctx.markDirty();
  }

  /**
   * Check if minimap is enabled.
   */
  isMinimapEnabled(): boolean {
    return this.minimapEnabled;
  }

  /**
   * Get the width of the right margin (scrollbar + minimap).
   */
  private getRightMarginWidth(): number {
    let width = DocumentEditor.SCROLLBAR_WIDTH;
    if (this.minimapEnabled) {
      width += DocumentEditor.MINIMAP_WIDTH;
    }
    return width;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Content Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set document content.
   */
  setContent(content: string): void {
    this.lines = content.split('\n').map((text) => ({ text }));
    if (this.lines.length === 0) {
      this.lines = [{ text: '' }];
    }
    this.modified = false;
    this.ensureCursorInBounds();
    this.updateGutterWidth();
    this.ctx.markDirty();
  }

  /**
   * Get document content.
   */
  getContent(): string {
    return this.lines.map((l) => l.text).join('\n');
  }

  /**
   * Set document URI.
   */
  setUri(uri: string): void {
    this.uri = uri;
    // Update title to filename
    const filename = uri.split('/').pop() ?? uri;
    this.setTitle(filename);
  }

  /**
   * Get document URI.
   */
  getUri(): string | null {
    return this.uri;
  }

  /**
   * Check if document is modified.
   */
  isModified(): boolean {
    return this.modified;
  }

  /**
   * Set syntax tokens for a line.
   */
  setLineTokens(lineNum: number, tokens: SyntaxToken[]): void {
    if (lineNum >= 0 && lineNum < this.lines.length) {
      this.lines[lineNum]!.tokens = tokens;
      this.ctx.markDirty();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cursor & Selection
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get cursor position.
   */
  getCursor(): CursorPosition {
    return { ...this.cursor };
  }

  /**
   * Set cursor position.
   */
  setCursor(pos: CursorPosition): void {
    this.cursor = { ...pos };
    this.ensureCursorInBounds();
    this.ensureCursorVisible();
    this.callbacks.onCursorChange?.(this.cursor);
    this.ctx.markDirty();
  }

  /**
   * Get current selection.
   */
  getSelection(): Selection | null {
    return this.selection ? { ...this.selection } : null;
  }

  /**
   * Set selection.
   */
  setSelection(selection: Selection | null): void {
    this.selection = selection ? { ...selection } : null;
    this.callbacks.onSelectionChange?.(this.selection);
    this.ctx.markDirty();
  }

  /**
   * Clear selection.
   */
  clearSelection(): void {
    this.setSelection(null);
  }

  /**
   * Move cursor.
   */
  moveCursor(direction: 'up' | 'down' | 'left' | 'right', extend = false): void {
    const oldCursor = { ...this.cursor };

    switch (direction) {
      case 'up':
        if (this.cursor.line > 0) {
          this.cursor.line--;
          this.ensureColumnInBounds();
        }
        break;
      case 'down':
        if (this.cursor.line < this.lines.length - 1) {
          this.cursor.line++;
          this.ensureColumnInBounds();
        }
        break;
      case 'left':
        if (this.cursor.column > 0) {
          this.cursor.column--;
        } else if (this.cursor.line > 0) {
          this.cursor.line--;
          this.cursor.column = this.lines[this.cursor.line]!.text.length;
        }
        break;
      case 'right':
        if (this.cursor.column < this.lines[this.cursor.line]!.text.length) {
          this.cursor.column++;
        } else if (this.cursor.line < this.lines.length - 1) {
          this.cursor.line++;
          this.cursor.column = 0;
        }
        break;
    }

    if (extend) {
      this.extendSelection(oldCursor, this.cursor);
    } else {
      this.clearSelection();
    }

    this.ensureCursorVisible();
    this.callbacks.onCursorChange?.(this.cursor);
    this.ctx.markDirty();
  }

  /**
   * Move cursor to start of line.
   */
  moveCursorToLineStart(extend = false): void {
    const oldCursor = { ...this.cursor };
    this.cursor.column = 0;

    if (extend) {
      this.extendSelection(oldCursor, this.cursor);
    } else {
      this.clearSelection();
    }

    this.ensureCursorVisible();
    this.callbacks.onCursorChange?.(this.cursor);
    this.ctx.markDirty();
  }

  /**
   * Move cursor to end of line.
   */
  moveCursorToLineEnd(extend = false): void {
    const oldCursor = { ...this.cursor };
    this.cursor.column = this.lines[this.cursor.line]!.text.length;

    if (extend) {
      this.extendSelection(oldCursor, this.cursor);
    } else {
      this.clearSelection();
    }

    this.ensureCursorVisible();
    this.callbacks.onCursorChange?.(this.cursor);
    this.ctx.markDirty();
  }

  /**
   * Move cursor to document start.
   */
  moveCursorToDocStart(extend = false): void {
    const oldCursor = { ...this.cursor };
    this.cursor = { line: 0, column: 0 };

    if (extend) {
      this.extendSelection(oldCursor, this.cursor);
    } else {
      this.clearSelection();
    }

    this.ensureCursorVisible();
    this.callbacks.onCursorChange?.(this.cursor);
    this.ctx.markDirty();
  }

  /**
   * Move cursor to document end.
   */
  moveCursorToDocEnd(extend = false): void {
    const oldCursor = { ...this.cursor };
    this.cursor.line = this.lines.length - 1;
    this.cursor.column = this.lines[this.cursor.line]!.text.length;

    if (extend) {
      this.extendSelection(oldCursor, this.cursor);
    } else {
      this.clearSelection();
    }

    this.ensureCursorVisible();
    this.callbacks.onCursorChange?.(this.cursor);
    this.ctx.markDirty();
  }

  /**
   * Extend selection from old cursor to new cursor.
   */
  private extendSelection(from: CursorPosition, to: CursorPosition): void {
    if (!this.selection) {
      this.selection = { start: { ...from }, end: { ...to } };
    } else {
      this.selection.end = { ...to };
    }
    this.callbacks.onSelectionChange?.(this.selection);
  }

  /**
   * Ensure cursor is within document bounds.
   */
  private ensureCursorInBounds(): void {
    this.cursor.line = Math.max(0, Math.min(this.cursor.line, this.lines.length - 1));
    this.ensureColumnInBounds();
  }

  /**
   * Ensure column is within current line bounds.
   */
  private ensureColumnInBounds(): void {
    const lineLen = this.lines[this.cursor.line]!.text.length;
    this.cursor.column = Math.max(0, Math.min(this.cursor.column, lineLen));
  }

  /**
   * Ensure cursor is visible in viewport.
   */
  private ensureCursorVisible(): void {
    const viewportHeight = this.bounds.height;
    const rightMargin = this.getRightMarginWidth();
    const viewportWidth = this.bounds.width - this.gutterWidth - rightMargin;

    // Vertical scrolling
    if (this.cursor.line < this.scrollTop) {
      this.scrollTop = this.cursor.line;
    } else if (this.cursor.line >= this.scrollTop + viewportHeight) {
      this.scrollTop = this.cursor.line - viewportHeight + 1;
    }

    // Horizontal scrolling
    if (this.cursor.column < this.scrollLeft) {
      this.scrollLeft = this.cursor.column;
    } else if (this.cursor.column >= this.scrollLeft + viewportWidth) {
      this.scrollLeft = this.cursor.column - viewportWidth + 1;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Editing
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Insert text at cursor.
   */
  insertText(text: string): void {
    // Delete selection first if any
    if (this.selection) {
      this.deleteSelection();
    }

    const line = this.lines[this.cursor.line]!;
    const before = line.text.slice(0, this.cursor.column);
    const after = line.text.slice(this.cursor.column);

    // Handle newlines
    const insertLines = text.split('\n');
    if (insertLines.length === 1) {
      line.text = before + text + after;
      this.cursor.column += text.length;
    } else {
      // Multi-line insert
      line.text = before + insertLines[0]!;
      const newLines: DocumentLine[] = [];
      for (let i = 1; i < insertLines.length - 1; i++) {
        newLines.push({ text: insertLines[i]! });
      }
      newLines.push({ text: insertLines[insertLines.length - 1]! + after });
      this.lines.splice(this.cursor.line + 1, 0, ...newLines);
      this.cursor.line += insertLines.length - 1;
      this.cursor.column = insertLines[insertLines.length - 1]!.length;
    }

    this.modified = true;
    this.updateGutterWidth();
    this.ensureCursorVisible();
    this.callbacks.onContentChange?.(this.getContent());
    this.ctx.markDirty();
  }

  /**
   * Delete character before cursor (backspace).
   */
  deleteBackward(): void {
    if (this.selection) {
      this.deleteSelection();
      return;
    }

    if (this.cursor.column > 0) {
      const line = this.lines[this.cursor.line]!;
      line.text = line.text.slice(0, this.cursor.column - 1) + line.text.slice(this.cursor.column);
      this.cursor.column--;
    } else if (this.cursor.line > 0) {
      // Join with previous line
      const prevLine = this.lines[this.cursor.line - 1]!;
      const currLine = this.lines[this.cursor.line]!;
      const newColumn = prevLine.text.length;
      prevLine.text += currLine.text;
      this.lines.splice(this.cursor.line, 1);
      this.cursor.line--;
      this.cursor.column = newColumn;
      this.updateGutterWidth();
    }

    this.modified = true;
    this.ensureCursorVisible();
    this.callbacks.onContentChange?.(this.getContent());
    this.ctx.markDirty();
  }

  /**
   * Delete character at cursor (delete key).
   */
  deleteForward(): void {
    if (this.selection) {
      this.deleteSelection();
      return;
    }

    const line = this.lines[this.cursor.line]!;
    if (this.cursor.column < line.text.length) {
      line.text = line.text.slice(0, this.cursor.column) + line.text.slice(this.cursor.column + 1);
    } else if (this.cursor.line < this.lines.length - 1) {
      // Join with next line
      const nextLine = this.lines[this.cursor.line + 1]!;
      line.text += nextLine.text;
      this.lines.splice(this.cursor.line + 1, 1);
      this.updateGutterWidth();
    }

    this.modified = true;
    this.callbacks.onContentChange?.(this.getContent());
    this.ctx.markDirty();
  }

  /**
   * Delete selected text.
   */
  private deleteSelection(): void {
    if (!this.selection) return;

    // Normalize selection (start before end)
    const { start, end } = this.normalizeSelection(this.selection);

    if (start.line === end.line) {
      // Single line
      const line = this.lines[start.line]!;
      line.text = line.text.slice(0, start.column) + line.text.slice(end.column);
    } else {
      // Multi-line
      const startLine = this.lines[start.line]!;
      const endLine = this.lines[end.line]!;
      startLine.text = startLine.text.slice(0, start.column) + endLine.text.slice(end.column);
      this.lines.splice(start.line + 1, end.line - start.line);
      this.updateGutterWidth();
    }

    this.cursor = { ...start };
    this.selection = null;
    this.modified = true;
    this.callbacks.onContentChange?.(this.getContent());
    this.callbacks.onSelectionChange?.(null);
    this.ctx.markDirty();
  }

  /**
   * Normalize selection so start is before end.
   */
  private normalizeSelection(sel: Selection): Selection {
    if (
      sel.start.line < sel.end.line ||
      (sel.start.line === sel.end.line && sel.start.column <= sel.end.column)
    ) {
      return sel;
    }
    return { start: sel.end, end: sel.start };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scrolling
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Scroll by lines.
   */
  scroll(lines: number): void {
    this.scrollTop = Math.max(0, Math.min(this.scrollTop + lines, this.lines.length - 1));
    this.ctx.markDirty();
  }

  /**
   * Scroll to line.
   */
  scrollToLine(line: number): void {
    this.scrollTop = Math.max(0, Math.min(line, this.lines.length - 1));
    this.ctx.markDirty();
  }

  /**
   * Get scroll position.
   */
  getScrollTop(): number {
    return this.scrollTop;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  render(buffer: ScreenBuffer): void {
    const { x, y, width, height } = this.bounds;
    const bg = this.ctx.getThemeColor('editor.background', '#1e1e1e');
    const fg = this.ctx.getThemeColor('editor.foreground', '#cccccc');
    const gutterBg = this.ctx.getThemeColor('editorGutter.background', '#1e1e1e');
    const gutterFg = this.ctx.getThemeColor('editorLineNumber.foreground', '#858585');
    const cursorBg = this.ctx.getThemeColor('editorCursor.foreground', '#aeafad');
    const selectionBg = this.ctx.getThemeColor('editor.selectionBackground', '#264f78');
    const lineHighlight = this.ctx.getThemeColor('editor.lineHighlightBackground', '#2a2d2e');

    // Calculate layout dimensions
    const rightMargin = this.getRightMarginWidth();
    const contentWidth = width - this.gutterWidth - rightMargin;
    const contentX = x + this.gutterWidth;

    // Render each visible line
    for (let row = 0; row < height; row++) {
      const lineNum = this.scrollTop + row;
      const screenY = y + row;

      if (lineNum >= this.lines.length) {
        // Empty area
        buffer.writeString(x, screenY, ' '.repeat(width - rightMargin), fg, bg);
        continue;
      }

      // Render gutter (line number)
      const lineNumStr = String(lineNum + 1).padStart(this.gutterWidth - 1, ' ') + ' ';
      buffer.writeString(x, screenY, lineNumStr, gutterFg, gutterBg);

      // Determine line background
      const isCurrentLine = lineNum === this.cursor.line;
      const lineBg = isCurrentLine && this.focused ? lineHighlight : bg;

      // Render line content
      const line = this.lines[lineNum]!;
      const visibleText = line.text.slice(this.scrollLeft, this.scrollLeft + contentWidth);

      // Fill background
      buffer.writeString(contentX, screenY, ' '.repeat(contentWidth), fg, lineBg);

      // Render text with tokens
      if (line.tokens && line.tokens.length > 0) {
        this.renderLineWithTokens(buffer, contentX, screenY, line, contentWidth, lineBg);
      } else {
        buffer.writeString(contentX, screenY, visibleText, fg, lineBg);
      }

      // Render selection highlight
      if (this.selection) {
        this.renderSelectionOnLine(buffer, contentX, screenY, lineNum, contentWidth, selectionBg);
      }

      // Render cursor
      if (isCurrentLine && this.focused && this.cursor.column >= this.scrollLeft) {
        const cursorX = contentX + this.cursor.column - this.scrollLeft;
        if (cursorX < x + width - rightMargin) {
          const cursorChar = buffer.get(cursorX, screenY)?.char ?? ' ';
          buffer.set(cursorX, screenY, { char: cursorChar, fg: bg, bg: cursorBg });
        }
      }
    }

    // Render minimap if enabled
    if (this.minimapEnabled) {
      this.renderMinimap(buffer);
    }

    // Render scrollbar
    this.renderScrollbar(buffer);
  }

  /**
   * Render a line with syntax tokens.
   */
  private renderLineWithTokens(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    line: DocumentLine,
    width: number,
    bg: string
  ): void {
    const fg = this.ctx.getThemeColor('editor.foreground', '#cccccc');
    const text = line.text;
    const tokens = line.tokens ?? [];

    // Sort tokens by start position
    const sortedTokens = [...tokens].sort((a, b) => a.start - b.start);

    let col = 0;
    let tokenIdx = 0;

    while (col < width && this.scrollLeft + col < text.length) {
      const charIdx = this.scrollLeft + col;

      // Find applicable token
      while (tokenIdx < sortedTokens.length && sortedTokens[tokenIdx]!.end <= charIdx) {
        tokenIdx++;
      }

      let color = fg;
      if (tokenIdx < sortedTokens.length) {
        const token = sortedTokens[tokenIdx]!;
        if (charIdx >= token.start && charIdx < token.end) {
          color = token.color ?? this.getTokenColor(token.type);
        }
      }

      buffer.set(x + col, y, { char: text[charIdx]!, fg: color, bg });
      col++;
    }
  }

  /**
   * Get color for a token type.
   */
  private getTokenColor(type: string): string {
    switch (type) {
      case 'keyword':
        return this.ctx.getThemeColor('keyword.foreground', '#569cd6');
      case 'string':
        return this.ctx.getThemeColor('string.foreground', '#ce9178');
      case 'comment':
        return this.ctx.getThemeColor('comment.foreground', '#6a9955');
      case 'number':
        return this.ctx.getThemeColor('number.foreground', '#b5cea8');
      case 'function':
        return this.ctx.getThemeColor('function.foreground', '#dcdcaa');
      case 'variable':
        return this.ctx.getThemeColor('variable.foreground', '#9cdcfe');
      case 'type':
        return this.ctx.getThemeColor('type.foreground', '#4ec9b0');
      case 'operator':
        return this.ctx.getThemeColor('operator.foreground', '#d4d4d4');
      default:
        return this.ctx.getThemeColor('editor.foreground', '#cccccc');
    }
  }

  /**
   * Render selection highlight on a line.
   */
  private renderSelectionOnLine(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    lineNum: number,
    width: number,
    selectionBg: string
  ): void {
    if (!this.selection) return;

    const sel = this.normalizeSelection(this.selection);
    const line = this.lines[lineNum]!;

    // Check if line is in selection
    if (lineNum < sel.start.line || lineNum > sel.end.line) return;

    let startCol = 0;
    let endCol = line.text.length;

    if (lineNum === sel.start.line) {
      startCol = sel.start.column;
    }
    if (lineNum === sel.end.line) {
      endCol = sel.end.column;
    }

    // Adjust for scroll
    startCol = Math.max(startCol - this.scrollLeft, 0);
    endCol = Math.min(endCol - this.scrollLeft, width);

    // Highlight selection
    for (let col = startCol; col < endCol; col++) {
      const cell = buffer.get(x + col, y);
      if (cell) {
        buffer.set(x + col, y, { ...cell, bg: selectionBg });
      }
    }
  }

  /**
   * Update gutter width based on line count.
   */
  private updateGutterWidth(): void {
    const digits = String(this.lines.length).length;
    this.gutterWidth = Math.max(4, digits + 2);
  }

  /**
   * Render the vertical scrollbar.
   */
  private renderScrollbar(buffer: ScreenBuffer): void {
    const { x, y, width, height } = this.bounds;
    const scrollbarX = x + width - DocumentEditor.SCROLLBAR_WIDTH;

    const trackBg = this.ctx.getThemeColor('scrollbarSlider.background', '#4a4a4a');
    const thumbBg = this.ctx.getThemeColor('scrollbarSlider.activeBackground', '#6a6a6a');

    // Calculate thumb size and position
    const totalLines = this.lines.length;
    const visibleLines = height;

    // Minimum thumb height of 1
    const thumbHeight = Math.max(1, Math.round((visibleLines / Math.max(totalLines, 1)) * height));

    // Calculate thumb position
    const maxScroll = Math.max(0, totalLines - visibleLines);
    const scrollRatio = maxScroll > 0 ? this.scrollTop / maxScroll : 0;
    const thumbTop = Math.round(scrollRatio * (height - thumbHeight));

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
   * Render the minimap.
   * The minimap scrolls with the editor and uses a scale factor
   * (multiple source lines per minimap row).
   */
  private renderMinimap(buffer: ScreenBuffer): void {
    const { x, y, width, height } = this.bounds;
    const minimapWidth = DocumentEditor.MINIMAP_WIDTH;
    const minimapX = x + width - DocumentEditor.SCROLLBAR_WIDTH - minimapWidth;
    const scale = DocumentEditor.MINIMAP_SCALE;

    const bg = this.ctx.getThemeColor('minimap.background', '#1e1e1e');
    const fg = this.ctx.getThemeColor('minimap.foreground', '#6a6a6a');
    const viewportBg = this.ctx.getThemeColor('minimapSlider.background', '#ffffff20');

    // Calculate minimap metrics
    const totalLines = this.lines.length;
    const totalMinimapRows = Math.ceil(totalLines / scale);

    // Update minimap scroll to follow editor scroll
    this.updateMinimapScroll(height);

    // Calculate viewport indicator position (in minimap rows)
    const viewportStartRow = Math.floor(this.scrollTop / scale);
    const viewportEndRow = Math.ceil((this.scrollTop + height) / scale);

    // Render each minimap row
    for (let row = 0; row < height; row++) {
      const screenY = y + row;
      const minimapRow = row + this.minimapScrollTop;

      // Calculate source lines for this minimap row
      const startLine = minimapRow * scale;
      const endLine = Math.min(startLine + scale, totalLines);

      // Check if this row is in the visible viewport
      const isInViewport = minimapRow >= viewportStartRow && minimapRow < viewportEndRow;
      const rowBg = isInViewport ? viewportBg : bg;

      // Fill background first
      for (let col = 0; col < minimapWidth; col++) {
        buffer.set(minimapX + col, screenY, { char: ' ', fg, bg: rowBg });
      }

      // Skip if no content for this row
      if (startLine >= totalLines) continue;

      // How many source columns per minimap column
      const maxColumn = 120; // Max columns to consider
      const colsPerChar = Math.ceil(maxColumn / minimapWidth);

      // Render content for this minimap row
      for (let col = 0; col < minimapWidth; col++) {
        const colStart = col * colsPerChar;
        const colEnd = colStart + colsPerChar;

        // Aggregate density across all lines in this row
        let totalDensity = 0;

        for (let lineNum = startLine; lineNum < endLine && lineNum < totalLines; lineNum++) {
          const line = this.lines[lineNum]!;
          const text = line.text;

          for (let c = colStart; c < colEnd && c < text.length; c++) {
            const char = text[c];
            if (char && char !== ' ' && char !== '\t') {
              totalDensity++;
            }
          }
        }

        // Convert density to block character
        if (totalDensity > 0) {
          const numLines = endLine - startLine;
          const normalizedDensity = totalDensity / numLines;
          let char = ' ';
          if (normalizedDensity > colsPerChar * 0.75) char = '█';
          else if (normalizedDensity > colsPerChar * 0.5) char = '▓';
          else if (normalizedDensity > colsPerChar * 0.25) char = '▒';
          else if (normalizedDensity > 0) char = '░';

          buffer.set(minimapX + col, screenY, { char, fg, bg: rowBg });
        }
      }
    }
  }

  /**
   * Update minimap scroll position to follow editor scroll.
   */
  private updateMinimapScroll(viewportHeight: number): void {
    const scale = DocumentEditor.MINIMAP_SCALE;
    const totalLines = this.lines.length;
    const totalMinimapRows = Math.ceil(totalLines / scale);

    // If whole file fits in minimap, no scrolling needed
    if (totalMinimapRows <= viewportHeight) {
      this.minimapScrollTop = 0;
      return;
    }

    // Scroll proportionally with the editor
    const editorMaxScroll = Math.max(1, totalLines - viewportHeight);
    const minimapMaxScroll = totalMinimapRows - viewportHeight;
    const scrollRatio = this.scrollTop / editorMaxScroll;
    this.minimapScrollTop = Math.floor(scrollRatio * minimapMaxScroll);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  override handleKey(event: KeyEvent): boolean {
    // Navigation
    if (event.key === 'ArrowUp') {
      this.moveCursor('up', event.shift);
      return true;
    }
    if (event.key === 'ArrowDown') {
      this.moveCursor('down', event.shift);
      return true;
    }
    if (event.key === 'ArrowLeft') {
      this.moveCursor('left', event.shift);
      return true;
    }
    if (event.key === 'ArrowRight') {
      this.moveCursor('right', event.shift);
      return true;
    }
    if (event.key === 'Home') {
      if (event.ctrl) {
        this.moveCursorToDocStart(event.shift);
      } else {
        this.moveCursorToLineStart(event.shift);
      }
      return true;
    }
    if (event.key === 'End') {
      if (event.ctrl) {
        this.moveCursorToDocEnd(event.shift);
      } else {
        this.moveCursorToLineEnd(event.shift);
      }
      return true;
    }
    if (event.key === 'PageUp') {
      const jump = Math.max(1, this.bounds.height - 1);
      for (let i = 0; i < jump; i++) {
        this.moveCursor('up', event.shift);
      }
      return true;
    }
    if (event.key === 'PageDown') {
      const jump = Math.max(1, this.bounds.height - 1);
      for (let i = 0; i < jump; i++) {
        this.moveCursor('down', event.shift);
      }
      return true;
    }

    // Editing
    if (event.key === 'Backspace') {
      this.deleteBackward();
      return true;
    }
    if (event.key === 'Delete') {
      this.deleteForward();
      return true;
    }
    if (event.key === 'Enter') {
      this.insertText('\n');
      return true;
    }
    if (event.key === 'Tab') {
      this.insertText('  '); // Insert spaces for tab
      return true;
    }

    // Save (Ctrl+S)
    if (event.ctrl && event.key === 's') {
      this.callbacks.onSave?.();
      return true;
    }

    // Select all (Ctrl+A)
    if (event.ctrl && event.key === 'a') {
      this.selection = {
        start: { line: 0, column: 0 },
        end: {
          line: this.lines.length - 1,
          column: this.lines[this.lines.length - 1]!.text.length,
        },
      };
      this.callbacks.onSelectionChange?.(this.selection);
      this.ctx.markDirty();
      return true;
    }

    // Regular character input
    if (event.key.length === 1 && !event.ctrl && !event.alt && !event.meta) {
      this.insertText(event.key);
      return true;
    }

    return false;
  }

  override handleMouse(event: MouseEvent): boolean {
    const { x, y, width, height } = this.bounds;
    const rightMargin = this.getRightMarginWidth();
    const scrollbarX = x + width - DocumentEditor.SCROLLBAR_WIDTH;
    const minimapX = this.minimapEnabled
      ? x + width - DocumentEditor.SCROLLBAR_WIDTH - DocumentEditor.MINIMAP_WIDTH
      : scrollbarX;

    // Check if click is on scrollbar
    if (event.x >= scrollbarX && event.x < x + width) {
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

    // Check if click is on minimap
    if (this.minimapEnabled && event.x >= minimapX && event.x < scrollbarX) {
      if (event.type === 'press' && event.button === 'left') {
        this.handleMinimapClick(event.y);
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

    if (event.type === 'press' && event.button === 'left') {
      // Calculate clicked position in content area
      const relX = event.x - this.bounds.x - this.gutterWidth;
      const relY = event.y - this.bounds.y;
      const contentWidth = width - this.gutterWidth - rightMargin;

      if (relX >= 0 && relX < contentWidth && this.lines.length > 0) {
        const line = Math.max(0, Math.min(this.scrollTop + relY, this.lines.length - 1));
        const lineText = this.lines[line];
        if (lineText) {
          const column = Math.min(this.scrollLeft + relX, lineText.text.length);
          this.setCursor({ line, column });
          this.clearSelection();
          this.ctx.requestFocus();
        }
        return true;
      }
    }

    if (event.type === 'scroll') {
      // Scroll wheel - use scrollDirection (1=down, -1=up), multiply by 3 for faster scroll
      const direction = (event.scrollDirection ?? 1) * 3;
      this.scroll(direction);
      return true;
    }

    return false;
  }

  /**
   * Handle click/drag on the scrollbar.
   */
  private handleScrollbarClick(mouseY: number): void {
    const { y, height } = this.bounds;
    const relY = mouseY - y;

    // Calculate scroll position from click position
    const totalLines = this.lines.length;
    const visibleLines = height;
    const maxScroll = Math.max(0, totalLines - visibleLines);

    // Map click position to scroll position
    const scrollRatio = Math.max(0, Math.min(1, relY / height));
    const newScrollTop = Math.round(scrollRatio * maxScroll);

    if (newScrollTop !== this.scrollTop) {
      this.scrollTop = newScrollTop;
      this.ctx.markDirty();
    }
  }

  /**
   * Handle click on the minimap.
   */
  private handleMinimapClick(mouseY: number): void {
    const { y, height } = this.bounds;
    const relY = mouseY - y;
    const scale = DocumentEditor.MINIMAP_SCALE;

    // Calculate which minimap row was clicked
    const clickedMinimapRow = relY + this.minimapScrollTop;

    // Convert to source line
    const clickedLine = clickedMinimapRow * scale;

    // Center the viewport on the clicked line
    const totalLines = this.lines.length;
    const visibleLines = height;
    const targetScrollTop = Math.max(0, clickedLine - Math.floor(visibleLines / 2));
    const maxScroll = Math.max(0, totalLines - visibleLines);

    this.scrollTop = Math.min(targetScrollTop, maxScroll);
    this.ctx.markDirty();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State Serialization
  // ─────────────────────────────────────────────────────────────────────────

  override getState(): DocumentEditorState {
    return {
      uri: this.uri ?? undefined,
      scrollTop: this.scrollTop,
      cursor: { ...this.cursor },
      selection: this.selection ? { ...this.selection } : undefined,
    };
  }

  override setState(state: unknown): void {
    const s = state as DocumentEditorState;
    if (s.scrollTop !== undefined) {
      this.scrollTop = s.scrollTop;
    }
    if (s.cursor) {
      this.cursor = { ...s.cursor };
    }
    if (s.selection) {
      this.selection = { ...s.selection };
    }
    this.ctx.markDirty();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Utility
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get line count.
   */
  getLineCount(): number {
    return this.lines.length;
  }

  /**
   * Get line at index.
   */
  getLine(index: number): string | null {
    if (index >= 0 && index < this.lines.length) {
      return this.lines[index]!.text;
    }
    return null;
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a document editor element.
 */
export function createDocumentEditor(
  id: string,
  title: string,
  ctx: ElementContext,
  callbacks?: DocumentEditorCallbacks
): DocumentEditor {
  return new DocumentEditor(id, title, ctx, callbacks);
}
