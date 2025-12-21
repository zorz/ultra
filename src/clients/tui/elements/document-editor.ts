/**
 * DocumentEditor Element
 *
 * A text editor element for displaying and editing documents.
 * Renders lines with syntax highlighting, handles cursor movement and text input.
 */

import { BaseElement, type ElementContext } from './base.ts';
import type { KeyEvent, MouseEvent, Position } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import { darken, lighten } from '../../../ui/colors.ts';
import { FoldManager } from '../../../core/fold.ts';

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
  foldedRegions?: number[];
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
  /** Called when fold state changes */
  onFoldChange?: () => void;
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

  /** Fold manager for code folding */
  private foldManager: FoldManager = new FoldManager();

  /** Whether folding is enabled */
  private foldingEnabled = true;

  /** Version of content when fold regions were last computed */
  private lastFoldVersion = -1;

  /** Current content version (increments on change) */
  private contentVersion = 0;

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
  // Folding
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Enable or disable code folding.
   */
  setFoldingEnabled(enabled: boolean): void {
    this.foldingEnabled = enabled;
    this.updateGutterWidth();
    this.ctx.markDirty();
  }

  /**
   * Check if folding is enabled.
   */
  isFoldingEnabled(): boolean {
    return this.foldingEnabled;
  }

  /**
   * Get the fold manager.
   */
  getFoldManager(): FoldManager {
    return this.foldManager;
  }

  /**
   * Toggle fold at the current cursor line.
   */
  toggleFoldAtCursor(): boolean {
    if (!this.foldingEnabled) return false;

    // First check if cursor line starts a fold
    if (this.foldManager.canFold(this.cursor.line) || this.foldManager.isFolded(this.cursor.line)) {
      const result = this.foldManager.toggleFold(this.cursor.line);
      if (result) {
        this.callbacks.onFoldChange?.();
        this.ctx.markDirty();
      }
      return result;
    }

    // Otherwise, try to fold the containing region
    const region = this.foldManager.findRegionContaining(this.cursor.line);
    if (region) {
      const result = this.foldManager.toggleFold(region.startLine);
      if (result) {
        // Move cursor to fold start line if it would be hidden
        if (this.foldManager.isHidden(this.cursor.line)) {
          this.cursor.line = region.startLine;
          this.ensureColumnInBounds();
        }
        this.callbacks.onFoldChange?.();
        this.ctx.markDirty();
      }
      return result;
    }

    return false;
  }

  /**
   * Toggle fold at a specific line.
   */
  toggleFoldAt(line: number): boolean {
    if (!this.foldingEnabled) return false;

    const result = this.foldManager.toggleFold(line);
    if (result) {
      // Move cursor if it would be hidden
      if (this.foldManager.isHidden(this.cursor.line)) {
        this.cursor.line = line;
        this.ensureColumnInBounds();
      }
      this.callbacks.onFoldChange?.();
      this.ctx.markDirty();
    }
    return result;
  }

  /**
   * Fold at the current cursor line.
   */
  foldAtCursor(): boolean {
    if (!this.foldingEnabled) return false;

    // First check if cursor line starts a fold
    if (this.foldManager.canFold(this.cursor.line)) {
      const result = this.foldManager.fold(this.cursor.line);
      if (result) {
        this.callbacks.onFoldChange?.();
        this.ctx.markDirty();
      }
      return result;
    }

    // Otherwise, fold the containing region
    const result = this.foldManager.foldContaining(this.cursor.line);
    if (result) {
      this.callbacks.onFoldChange?.();
      this.ctx.markDirty();
    }
    return result;
  }

  /**
   * Unfold at the current cursor line.
   */
  unfoldAtCursor(): boolean {
    if (!this.foldingEnabled) return false;

    // First check if cursor line starts a fold
    if (this.foldManager.isFolded(this.cursor.line)) {
      const result = this.foldManager.unfold(this.cursor.line);
      if (result) {
        this.callbacks.onFoldChange?.();
        this.ctx.markDirty();
      }
      return result;
    }

    // Find containing folded region
    const region = this.foldManager.findRegionContaining(this.cursor.line);
    if (region && region.isFolded) {
      const result = this.foldManager.unfold(region.startLine);
      if (result) {
        this.callbacks.onFoldChange?.();
        this.ctx.markDirty();
      }
      return result;
    }

    return false;
  }

  /**
   * Fold all regions.
   */
  foldAll(): void {
    if (!this.foldingEnabled) return;

    this.foldManager.foldAll();

    // Move cursor if it would be hidden
    if (this.foldManager.isHidden(this.cursor.line)) {
      // Find nearest visible line before cursor
      for (let i = this.cursor.line; i >= 0; i--) {
        if (!this.foldManager.isHidden(i)) {
          this.cursor.line = i;
          break;
        }
      }
      this.ensureColumnInBounds();
    }

    this.callbacks.onFoldChange?.();
    this.ctx.markDirty();
  }

  /**
   * Unfold all regions.
   */
  unfoldAll(): void {
    if (!this.foldingEnabled) return;

    this.foldManager.unfoldAll();
    this.callbacks.onFoldChange?.();
    this.ctx.markDirty();
  }

  /**
   * Update fold regions when content changes.
   */
  private updateFoldRegions(): void {
    if (!this.foldingEnabled) return;
    if (this.contentVersion === this.lastFoldVersion) return;

    const lineTexts = this.lines.map((l) => l.text);
    this.foldManager.computeRegions(lineTexts);
    this.lastFoldVersion = this.contentVersion;
  }

  /**
   * Get the fold indicator character for a line.
   */
  private getFoldIndicator(line: number): string {
    if (!this.foldingEnabled) return ' ';

    if (this.foldManager.isFolded(line)) {
      return '▸';
    } else if (this.foldManager.canFold(line)) {
      return '▾';
    }
    return ' ';
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
    this.contentVersion++;
    this.ensureCursorInBounds();
    this.updateGutterWidth();
    this.updateFoldRegions();
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
    this.contentVersion++;
    this.updateGutterWidth();
    this.updateFoldRegions();
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
    this.contentVersion++;
    this.updateFoldRegions();
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
    this.contentVersion++;
    this.updateFoldRegions();
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
    this.contentVersion++;
    this.updateFoldRegions();
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
    const foldEllipsisFg = this.ctx.getThemeColor('editorGutter.foldingControlForeground', '#c5c5c5');

    // Calculate layout dimensions
    const rightMargin = this.getRightMarginWidth();
    const contentWidth = width - this.gutterWidth - rightMargin;
    const contentX = x + this.gutterWidth;

    // Calculate gutter component widths
    const digits = String(this.lines.length).length;
    const lineNumWidth = Math.max(3, digits);
    const foldIndicatorWidth = this.foldingEnabled ? 1 : 0;

    // Get visible lines starting from scrollTop, skipping hidden lines
    let bufferLine = this.scrollTop;
    let row = 0;

    while (row < height && bufferLine < this.lines.length) {
      const screenY = y + row;

      // Skip hidden lines (inside folded regions)
      if (this.foldManager.isHidden(bufferLine)) {
        bufferLine++;
        continue;
      }

      // Determine line background
      const isCurrentLine = bufferLine === this.cursor.line;
      const lineBg = isCurrentLine && this.focused ? lineHighlight : bg;
      const currentGutterBg = isCurrentLine && this.focused ? lineHighlight : gutterBg;

      // Render gutter: [line number][fold indicator][space]
      const lineNumStr = String(bufferLine + 1).padStart(lineNumWidth, ' ');
      const foldIndicator = this.foldingEnabled ? this.getFoldIndicator(bufferLine) : '';
      const gutterStr = lineNumStr + foldIndicator + ' ';
      buffer.writeString(x, screenY, gutterStr, gutterFg, currentGutterBg);

      // Render line content
      const line = this.lines[bufferLine]!;
      const visibleText = line.text.slice(this.scrollLeft, this.scrollLeft + contentWidth);

      // Fill background
      buffer.writeString(contentX, screenY, ' '.repeat(contentWidth), fg, lineBg);

      // Render text with tokens
      if (line.tokens && line.tokens.length > 0) {
        this.renderLineWithTokens(buffer, contentX, screenY, line, contentWidth, lineBg);
      } else {
        buffer.writeString(contentX, screenY, visibleText, fg, lineBg);
      }

      // If this line is folded, show ellipsis indicator after content
      if (this.foldManager.isFolded(bufferLine)) {
        const foldedCount = this.foldManager.getFoldedLineCount(bufferLine);
        const ellipsis = ` ... ${foldedCount} lines`;
        const textLen = line.text.length - this.scrollLeft;
        const ellipsisX = contentX + Math.max(0, textLen);
        if (ellipsisX < x + width - rightMargin - ellipsis.length) {
          buffer.writeString(ellipsisX, screenY, ellipsis, foldEllipsisFg, lineBg);
        }
      }

      // Render selection highlight
      if (this.selection) {
        this.renderSelectionOnLine(buffer, contentX, screenY, bufferLine, contentWidth, selectionBg);
      }

      // Render cursor
      if (isCurrentLine && this.focused && this.cursor.column >= this.scrollLeft) {
        const cursorX = contentX + this.cursor.column - this.scrollLeft;
        if (cursorX < x + width - rightMargin) {
          const cursorChar = buffer.get(cursorX, screenY)?.char ?? ' ';
          buffer.set(cursorX, screenY, { char: cursorChar, fg: bg, bg: cursorBg });
        }
      }

      bufferLine++;
      row++;
    }

    // Fill remaining rows with empty lines
    while (row < height) {
      const screenY = y + row;
      buffer.writeString(x, screenY, ' '.repeat(width - rightMargin), fg, bg);
      row++;
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
   * Gutter layout: [line number][fold indicator][space]
   */
  private updateGutterWidth(): void {
    const digits = String(this.lines.length).length;
    // digits + 1 (fold indicator) + 1 (space) = digits + 2
    // Add 1 more for fold indicator when folding is enabled
    const foldWidth = this.foldingEnabled ? 1 : 0;
    this.gutterWidth = Math.max(4, digits + 1 + foldWidth + 1);
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

    // Derive minimap background from editor background (slightly darker)
    const editorBg = this.ctx.getThemeColor('editor.background', '#1e1e1e');
    const bg = darken(editorBg, 8);
    const defaultFg = this.ctx.getThemeColor('editor.foreground', '#cccccc');

    // Viewport slider background - lighten the minimap background
    const viewportBg = lighten(bg, 15);

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
        buffer.set(minimapX + col, screenY, { char: ' ', fg: defaultFg, bg: rowBg });
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

        // Aggregate density and collect colors across all lines in this row
        let totalDensity = 0;
        let segmentColor: string | undefined;

        for (let lineNum = startLine; lineNum < endLine && lineNum < totalLines; lineNum++) {
          const line = this.lines[lineNum]!;
          const text = line.text;
          const tokens = line.tokens;

          for (let c = colStart; c < colEnd && c < text.length; c++) {
            const char = text[c];
            if (char && char !== ' ' && char !== '\t') {
              totalDensity++;

              // Get color from token if available and we don't have one yet
              if (!segmentColor && tokens) {
                const token = tokens.find((t) => c >= t.start && c < t.end);
                if (token?.color) {
                  segmentColor = token.color;
                }
              }
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

          const fg = segmentColor || defaultFg;
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
      // Calculate clicked position
      const relX = event.x - this.bounds.x;
      const relY = event.y - this.bounds.y;
      const contentWidth = width - this.gutterWidth - rightMargin;

      // Convert screen row to buffer line (accounting for hidden lines)
      const bufferLine = this.screenRowToBufferLine(relY);

      // Check if click is in gutter area
      if (relX >= 0 && relX < this.gutterWidth && bufferLine !== null) {
        // Calculate fold indicator column position
        const digits = String(this.lines.length).length;
        const lineNumWidth = Math.max(3, digits);
        const foldIndicatorCol = lineNumWidth;

        // Check if click is on fold indicator
        if (this.foldingEnabled && relX === foldIndicatorCol) {
          if (this.foldManager.canFold(bufferLine) || this.foldManager.isFolded(bufferLine)) {
            this.toggleFoldAt(bufferLine);
            return true;
          }
        }

        // Click elsewhere in gutter - move cursor to that line
        this.setCursor({ line: bufferLine, column: 0 });
        this.clearSelection();
        this.ctx.requestFocus();
        return true;
      }

      // Click in content area
      const contentRelX = relX - this.gutterWidth;
      if (contentRelX >= 0 && contentRelX < contentWidth && bufferLine !== null) {
        const lineText = this.lines[bufferLine];
        if (lineText) {
          const column = Math.min(this.scrollLeft + contentRelX, lineText.text.length);
          this.setCursor({ line: bufferLine, column });
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
   * Convert a screen row to a buffer line number.
   * Accounts for hidden (folded) lines.
   */
  private screenRowToBufferLine(screenRow: number): number | null {
    let bufferLine = this.scrollTop;
    let row = 0;

    while (bufferLine < this.lines.length) {
      // Skip hidden lines
      if (this.foldManager.isHidden(bufferLine)) {
        bufferLine++;
        continue;
      }

      if (row === screenRow) {
        return bufferLine;
      }

      bufferLine++;
      row++;
    }

    return null;
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
      foldedRegions: this.foldManager.getFoldedLines(),
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
    // Restore folded regions
    if (s.foldedRegions && s.foldedRegions.length > 0) {
      for (const line of s.foldedRegions) {
        this.foldManager.fold(line);
      }
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
