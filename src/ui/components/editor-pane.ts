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
    const textWidth = this.rect.width - this.gutterWidth;

    // Get all selection ranges for highlighting
    const selections = this.document.cursors
      .filter(c => c.selection && hasSelection(c.selection))
      .map(c => getSelectionRange(c.selection!));

    // Render each visible line as a single string with embedded ANSI
    for (let i = 0; i < visibleLines; i++) {
      const lineNum = this.scrollTop + i;
      const screenY = this.rect.y + i;

      // Build the entire line as a single string
      const lineOutput = this.buildLineString(lineNum, textWidth, selections);
      
      // Single moveTo + write for the entire line
      ctx.term.moveTo(this.rect.x, screenY);
      process.stdout.write(lineOutput);
    }

    // Render cursor(s) - these are overlaid on top
    this.renderCursors(ctx);
  }

  /**
   * Build a complete line string with ANSI codes (gutter + content)
   */
  private buildLineString(
    lineNum: number,
    textWidth: number,
    selections: { start: Position; end: Position }[]
  ): string {
    // ANSI escape helpers
    const bg = (n: number) => `\x1b[48;5;${n}m`;
    const fg = (n: number) => `\x1b[38;5;${n}m`;
    const reset = '\x1b[0m';
    
    let output = '';
    
    // Gutter
    const gutterBg = bg(236);
    if (lineNum >= 0 && lineNum < (this.document?.lineCount || 0)) {
      const isCursorLine = this.document?.cursors.some(c => c.position.line === lineNum);
      const gutterFg = isCursorLine ? fg(252) : fg(241);
      const numStr = String(lineNum + 1).padStart(this.gutterWidth - 1, ' ') + ' ';
      output += gutterBg + gutterFg + numStr;
    } else {
      output += gutterBg + ' '.repeat(this.gutterWidth);
    }
    
    // Line content
    if (lineNum < 0 || lineNum >= (this.document?.lineCount || 0)) {
      // Empty line after document end
      output += bg(235) + ' '.repeat(textWidth);
    } else {
      const line = this.document!.getLine(lineNum);
      const isCursorLine = this.document?.cursors.some(c => c.position.line === lineNum);
      const baseBg = isCursorLine && this.isFocused ? 237 : 235;
      const selectionBg = 24;
      
      const visibleStart = this.scrollLeft;
      const visibleEnd = this.scrollLeft + textWidth;
      
      let currentBg = baseBg;
      output += bg(baseBg) + fg(252);
      
      for (let col = visibleStart; col < visibleEnd; col++) {
        const char = col < line.length ? line[col]! : ' ';
        
        // Check if selected
        const isSelected = selections.some(sel => {
          if (lineNum < sel.start.line || lineNum > sel.end.line) return false;
          if (lineNum === sel.start.line && lineNum === sel.end.line) {
            return col >= sel.start.column && col < sel.end.column;
          }
          if (lineNum === sel.start.line) return col >= sel.start.column;
          if (lineNum === sel.end.line) return col < sel.end.column;
          return true;
        });
        
        const newBg = isSelected ? selectionBg : baseBg;
        if (newBg !== currentBg) {
          currentBg = newBg;
          output += bg(currentBg);
        }
        
        output += char === '\t' ? '  ' : char;
      }
    }
    
    output += reset;
    return output;
  }

  /**
   * Render empty state (no document)
   */
  private renderEmptyState(ctx: RenderContext): void {
    const bg = (n: number) => `\x1b[48;5;${n}m`;
    const fg = (n: number) => `\x1b[38;5;${n}m`;
    const reset = '\x1b[0m';
    
    const emptyLine = bg(236) + ' '.repeat(Math.max(0, this.rect.width)) + reset;
    for (let y = 0; y < this.rect.height; y++) {
      ctx.term.moveTo(this.rect.x, this.rect.y + y);
      process.stdout.write(emptyLine);
    }

    // Center message
    const message = 'No file open';
    const msgX = this.rect.x + Math.floor((this.rect.width - message.length) / 2);
    const msgY = this.rect.y + Math.floor(this.rect.height / 2);
    ctx.term.moveTo(msgX, msgY);
    process.stdout.write(fg(245) + message + reset);
  }

  /**
   * Render cursors - overlaid on content
   */
  private renderCursors(ctx: RenderContext): void {
    if (!this.document || !this.isFocused) return;

    const textStartX = this.rect.x + this.gutterWidth;
    const bg = (n: number) => `\x1b[48;5;${n}m`;
    const fg = (n: number) => `\x1b[38;5;${n}m`;
    const reset = '\x1b[0m';

    for (const cursor of this.document.cursors) {
      const screenLine = cursor.position.line - this.scrollTop;
      const screenCol = cursor.position.column - this.scrollLeft;

      if (screenLine < 0 || screenLine >= this.rect.height) continue;
      if (screenCol < 0 || screenCol >= this.getVisibleColumnCount()) continue;

      const cursorX = textStartX + screenCol;
      const cursorY = this.rect.y + screenLine;

      // Get character under cursor
      const line = this.document.getLine(cursor.position.line);
      const char = cursor.position.column < line.length ? line[cursor.position.column]! : ' ';
      
      ctx.term.moveTo(cursorX, cursorY);
      process.stdout.write(bg(75) + fg(235) + char + reset);
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
