/**
 * Editor Pane Component
 * 
 * Renders a single editor pane with document content, line numbers,
 * cursor, and selection highlighting.
 */

import type { Document } from '../../core/document.ts';
import type { RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import type { Position } from '../../core/buffer.ts';
import { hasSelection, getSelectionRange } from '../../core/cursor.ts';

export interface EditorTheme {
  background: string;
  foreground: string;
  lineNumberForeground: string;
  lineNumberActiveForeground: string;
  gutterBackground: string;
  selectionBackground: string;
  cursorForeground: string;
  lineHighlightBackground: string;
}

const defaultTheme: EditorTheme = {
  background: '#282c34',
  foreground: '#abb2bf',
  lineNumberForeground: '#495162',
  lineNumberActiveForeground: '#abb2bf',
  gutterBackground: '#282c34',
  selectionBackground: '#3e4451',
  cursorForeground: '#528bff',
  lineHighlightBackground: '#2c313c'
};

export class EditorPane implements MouseHandler {
  private document: Document | null = null;
  private rect: Rect = { x: 1, y: 1, width: 80, height: 24 };
  private scrollTop: number = 0;
  private scrollLeft: number = 0;
  private gutterWidth: number = 5;  // Line numbers + margin
  private theme: EditorTheme = defaultTheme;
  private isFocused: boolean = true;

  // Callbacks
  private onClickCallback?: (position: Position, clickCount: number, event: MouseEvent) => void;
  private onDragCallback?: (position: Position, event: MouseEvent) => void;
  private onScrollCallback?: (deltaX: number, deltaY: number) => void;

  /**
   * Set the document to display
   */
  setDocument(doc: Document | null): void {
    this.document = doc;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.updateGutterWidth();
  }

  /**
   * Get the current document
   */
  getDocument(): Document | null {
    return this.document;
  }

  /**
   * Set the pane rect
   */
  setRect(rect: Rect): void {
    this.rect = rect;
    this.updateGutterWidth();
  }

  /**
   * Set theme
   */
  setTheme(theme: Partial<EditorTheme>): void {
    this.theme = { ...defaultTheme, ...theme };
  }

  /**
   * Set focus state
   */
  setFocused(focused: boolean): void {
    this.isFocused = focused;
  }

  /**
   * Set click callback
   */
  onClick(callback: (position: Position, clickCount: number, event: MouseEvent) => void): void {
    this.onClickCallback = callback;
  }

  /**
   * Set drag callback
   */
  onDrag(callback: (position: Position, event: MouseEvent) => void): void {
    this.onDragCallback = callback;
  }

  /**
   * Set scroll callback
   */
  onScroll(callback: (deltaX: number, deltaY: number) => void): void {
    this.onScrollCallback = callback;
  }

  /**
   * Scroll to ensure cursor is visible
   */
  ensureCursorVisible(): void {
    if (!this.document) return;

    const cursor = this.document.primaryCursor;
    const visibleLines = this.getVisibleLineCount();
    const visibleCols = this.getVisibleColumnCount();

    // Vertical scrolling
    if (cursor.position.line < this.scrollTop) {
      this.scrollTop = cursor.position.line;
    } else if (cursor.position.line >= this.scrollTop + visibleLines) {
      this.scrollTop = cursor.position.line - visibleLines + 1;
    }

    // Horizontal scrolling
    if (cursor.position.column < this.scrollLeft) {
      this.scrollLeft = cursor.position.column;
    } else if (cursor.position.column >= this.scrollLeft + visibleCols) {
      this.scrollLeft = cursor.position.column - visibleCols + 1;
    }
  }

  /**
   * Scroll by delta
   */
  scroll(deltaX: number, deltaY: number): void {
    if (!this.document) return;

    const maxScrollTop = Math.max(0, this.document.lineCount - this.getVisibleLineCount());
    this.scrollTop = Math.max(0, Math.min(maxScrollTop, this.scrollTop + deltaY));
    this.scrollLeft = Math.max(0, this.scrollLeft + deltaX);
  }

  /**
   * Get visible line count
   */
  getVisibleLineCount(): number {
    return this.rect.height;
  }

  /**
   * Get visible column count (after gutter)
   */
  getVisibleColumnCount(): number {
    return this.rect.width - this.gutterWidth;
  }

  /**
   * Render the editor pane
   */
  render(ctx: RenderContext): void {
    if (!this.document) {
      this.renderEmptyState(ctx);
      return;
    }

    // Update gutter width based on line count
    this.updateGutterWidth();

    const visibleLines = this.getVisibleLineCount();
    const textStartX = this.rect.x + this.gutterWidth;
    const textWidth = this.rect.width - this.gutterWidth;

    // Get all selection ranges for highlighting
    const selections = this.document.cursors
      .filter(c => c.selection && hasSelection(c.selection))
      .map(c => getSelectionRange(c.selection!));

    // Render each visible line
    for (let i = 0; i < visibleLines; i++) {
      const lineNum = this.scrollTop + i;
      const screenY = this.rect.y + i;

      if (lineNum >= this.document.lineCount) {
        // Empty line after document end
        this.renderGutter(ctx, screenY, -1);
        this.renderEmptyLine(ctx, textStartX, screenY, textWidth);
        continue;
      }

      // Render gutter (line number)
      this.renderGutter(ctx, screenY, lineNum);

      // Get line content
      const line = this.document.getLine(lineNum);
      
      // Check if this line is the cursor line for highlighting
      const isCursorLine = this.document.cursors.some(c => c.position.line === lineNum);

      // Render line content with selection highlighting
      this.renderLine(ctx, textStartX, screenY, textWidth, line, lineNum, selections, isCursorLine);
    }

    // Render cursor(s)
    this.renderCursors(ctx, textStartX);
  }

  /**
   * Render empty state (no document)
   */
  private renderEmptyState(ctx: RenderContext): void {
    // Fill with background
    for (let y = 0; y < this.rect.height; y++) {
      const screenY = this.rect.y + y;
      ctx.term.moveTo(this.rect.x, screenY);
      ctx.term.bgColor256(236);  // Dark gray
      ctx.term(' '.repeat(this.rect.width));
      ctx.term.styleReset();
    }

    // Center message
    const message = 'No file open';
    const msgX = this.rect.x + Math.floor((this.rect.width - message.length) / 2);
    const msgY = this.rect.y + Math.floor(this.rect.height / 2);
    ctx.term.moveTo(msgX, msgY);
    ctx.term.color256(245);  // Gray
    ctx.term(message);
    ctx.term.styleReset();
  }

  /**
   * Render gutter (line numbers)
   */
  private renderGutter(ctx: RenderContext, screenY: number, lineNum: number): void {
    ctx.term.moveTo(this.rect.x, screenY);
    ctx.term.bgColor256(236);  // Gutter background
    
    if (lineNum >= 0) {
      const isCursorLine = this.document?.cursors.some(c => c.position.line === lineNum);
      if (isCursorLine) {
        ctx.term.color256(252);  // Bright for cursor line
      } else {
        ctx.term.color256(241);  // Dim for other lines
      }
      const numStr = String(lineNum + 1).padStart(this.gutterWidth - 1, ' ');
      ctx.term(numStr + ' ');
    } else {
      ctx.term(' '.repeat(this.gutterWidth));
    }
    
    ctx.term.styleReset();
  }

  /**
   * Render an empty line
   */
  private renderEmptyLine(ctx: RenderContext, x: number, y: number, width: number): void {
    ctx.term.moveTo(x, y);
    ctx.term.bgColor256(235);  // Editor background
    ctx.term(' '.repeat(width));
    ctx.term.styleReset();
  }

  /**
   * Render a line of text with selection highlighting
   */
  private renderLine(
    ctx: RenderContext,
    x: number,
    y: number,
    width: number,
    line: string,
    lineNum: number,
    selections: { start: Position; end: Position }[],
    isCursorLine: boolean
  ): void {
    ctx.term.moveTo(x, y);
    
    // Background color
    if (isCursorLine && this.isFocused) {
      ctx.term.bgColor256(237);  // Slightly lighter for cursor line
    } else {
      ctx.term.bgColor256(235);  // Editor background
    }

    // Get visible portion of line
    const visibleStart = this.scrollLeft;
    const visibleEnd = this.scrollLeft + width;
    
    // Build the line character by character to handle selection
    let output = '';
    let currentBg = isCursorLine && this.isFocused ? 237 : 235;

    for (let col = visibleStart; col < visibleEnd; col++) {
      const char = col < line.length ? line[col]! : ' ';
      
      // Check if this position is selected
      const isSelected = selections.some(sel => {
        if (lineNum < sel.start.line || lineNum > sel.end.line) return false;
        if (lineNum === sel.start.line && lineNum === sel.end.line) {
          return col >= sel.start.column && col < sel.end.column;
        }
        if (lineNum === sel.start.line) return col >= sel.start.column;
        if (lineNum === sel.end.line) return col < sel.end.column;
        return true;
      });

      const newBg = isSelected ? 24 : (isCursorLine && this.isFocused ? 237 : 235);  // 24 = dark blue for selection
      
      if (newBg !== currentBg) {
        // Flush current output
        ctx.term(output);
        output = '';
        currentBg = newBg;
        ctx.term.bgColor256(currentBg);
      }
      
      output += char === '\t' ? '  ' : char;  // Simple tab handling
    }
    
    ctx.term.color256(252);  // Text color
    ctx.term(output);
    ctx.term.styleReset();
  }

  /**
   * Render cursors
   */
  private renderCursors(ctx: RenderContext, textStartX: number): void {
    if (!this.document || !this.isFocused) return;

    for (const cursor of this.document.cursors) {
      const screenLine = cursor.position.line - this.scrollTop;
      const screenCol = cursor.position.column - this.scrollLeft;

      if (screenLine < 0 || screenLine >= this.rect.height) continue;
      if (screenCol < 0 || screenCol >= this.getVisibleColumnCount()) continue;

      const cursorX = textStartX + screenCol;
      const cursorY = this.rect.y + screenLine;

      // Draw cursor (block style)
      ctx.term.moveTo(cursorX, cursorY);
      ctx.term.bgColor256(75);  // Blue cursor
      
      // Get character under cursor
      const line = this.document.getLine(cursor.position.line);
      const char = cursor.position.column < line.length ? line[cursor.position.column]! : ' ';
      ctx.term.color256(235);  // Dark text on cursor
      ctx.term(char);
      ctx.term.styleReset();
    }
  }

  /**
   * Update gutter width based on line count
   */
  private updateGutterWidth(): void {
    if (!this.document) {
      this.gutterWidth = 5;
      return;
    }
    const lineCount = this.document.lineCount;
    const digits = Math.max(3, String(lineCount).length);
    this.gutterWidth = digits + 2;  // digits + space + margin
  }

  /**
   * Convert screen coordinates to buffer position
   */
  screenToBufferPosition(screenX: number, screenY: number): Position | null {
    if (!this.document) return null;

    // Check if in text area (not gutter)
    const textStartX = this.rect.x + this.gutterWidth;
    if (screenX < textStartX) {
      screenX = textStartX;  // Snap to text area
    }

    const line = (screenY - this.rect.y) + this.scrollTop;
    const col = (screenX - textStartX) + this.scrollLeft;

    if (line < 0) return { line: 0, column: 0 };
    if (line >= this.document.lineCount) {
      const lastLine = Math.max(0, this.document.lineCount - 1);
      return { line: lastLine, column: this.document.getLineLength(lastLine) };
    }

    const lineLength = this.document.getLineLength(line);
    return {
      line,
      column: Math.max(0, Math.min(col, lineLength))
    };
  }

  // MouseHandler implementation

  containsPoint(x: number, y: number): boolean {
    return (
      x >= this.rect.x &&
      x < this.rect.x + this.rect.width &&
      y >= this.rect.y &&
      y < this.rect.y + this.rect.height
    );
  }

  onMouseEvent(event: MouseEvent): boolean {
    if (!this.document) return false;

    // Ignore pure motion events - only handle clicks, drags, and scrolls
    if (event.name === 'MOUSE_MOTION' || event.name === 'MOUSE_OTHER_BUTTON_PRESSED') {
      return false;
    }

    const position = this.screenToBufferPosition(event.x, event.y);
    if (!position) return false;

    switch (event.name) {
      case 'MOUSE_LEFT_BUTTON_PRESSED':
        if (this.onClickCallback) {
          // Click count is handled by MouseManager
          this.onClickCallback(position, 1, event);
        }
        return true;

      case 'MOUSE_DRAG':
        if (this.onDragCallback) {
          this.onDragCallback(position, event);
        }
        return true;

      case 'MOUSE_WHEEL_UP':
        this.scroll(0, -3);
        if (this.onScrollCallback) {
          this.onScrollCallback(0, -3);
        }
        return true;

      case 'MOUSE_WHEEL_DOWN':
        this.scroll(0, 3);
        if (this.onScrollCallback) {
          this.onScrollCallback(0, 3);
        }
        return true;
    }

    return false;
  }

  /**
   * Get scroll position
   */
  getScrollTop(): number {
    return this.scrollTop;
  }

  getScrollLeft(): number {
    return this.scrollLeft;
  }

  /**
   * Set scroll position
   */
  setScrollTop(value: number): void {
    if (!this.document) return;
    const maxScrollTop = Math.max(0, this.document.lineCount - this.getVisibleLineCount());
    this.scrollTop = Math.max(0, Math.min(maxScrollTop, value));
  }

  setScrollLeft(value: number): void {
    this.scrollLeft = Math.max(0, value);
  }
}

export default EditorPane;
