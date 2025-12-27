/**
 * SQL Editor Element
 *
 * A specialized text editor for writing and executing SQL queries.
 * Features:
 * - Syntax highlighting for SQL
 * - Connection context (which database to query)
 * - Query execution with Ctrl+Enter
 * - Transaction controls
 * - Integration with postgres_lsp for completions
 */

import { BaseElement, type ElementContext } from './base.ts';
import type { KeyEvent, MouseEvent, Rect } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import { debugLog } from '../../../debug.ts';
import type { ConnectionInfo, QueryResult } from '../../../services/database/types.ts';

// ============================================
// Types
// ============================================

/**
 * SQL Editor state for serialization.
 */
export interface SQLEditorState {
  content: string;
  connectionId: string | null;
  cursorLine: number;
  cursorColumn: number;
  scrollTop: number;
}

/**
 * Callbacks for SQL editor.
 */
export interface SQLEditorCallbacks {
  /** Called when query is executed (Ctrl+Enter) */
  onExecuteQuery?: (sql: string, connectionId: string) => Promise<QueryResult>;
  /** Called to open connection picker */
  onPickConnection?: () => Promise<ConnectionInfo | null>;
  /** Called when content changes */
  onContentChange?: (content: string) => void;
  /** Called to get current connection info */
  getConnection?: (connectionId: string) => ConnectionInfo | null;
}

/**
 * Cursor position in the editor.
 */
interface CursorPos {
  line: number;
  column: number;
}

// ============================================
// SQL Editor Element
// ============================================

/**
 * SQL Editor for database queries.
 */
export class SQLEditor extends BaseElement {
  // Content
  private lines: string[] = [''];
  private cursor: CursorPos = { line: 0, column: 0 };
  private scrollTop: number = 0;
  private scrollLeft: number = 0;

  // Connection
  private connectionId: string | null = null;
  private connectionName: string = 'No connection';

  // Execution state
  private isExecuting: boolean = false;
  private lastResult: QueryResult | null = null;
  private lastError: string | null = null;

  // Callbacks
  private callbacks: SQLEditorCallbacks;

  // UI constants
  private readonly GUTTER_WIDTH = 5; // Line numbers
  private readonly STATUS_HEIGHT = 1; // Status bar at bottom

  constructor(id: string, ctx: ElementContext, callbacks: SQLEditorCallbacks = {}) {
    super('SQLEditor', id, 'SQL Query', ctx);
    this.callbacks = callbacks;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set the content of the editor.
   */
  setContent(content: string): void {
    this.lines = content.split('\n');
    if (this.lines.length === 0) {
      this.lines = [''];
    }
    this.cursor = { line: 0, column: 0 };
    this.scrollTop = 0;
    this.ctx.markDirty();
  }

  /**
   * Get the content of the editor.
   */
  getContent(): string {
    return this.lines.join('\n');
  }

  /**
   * Set the connection to use for queries.
   */
  setConnection(connectionId: string | null, connectionName?: string): void {
    this.connectionId = connectionId;
    this.connectionName = connectionName || 'No connection';
    this.updateTitle();
    this.ctx.markDirty();
  }

  /**
   * Get the current connection ID.
   */
  getConnectionId(): string | null {
    return this.connectionId;
  }

  /**
   * Get selected text or all text if no selection.
   */
  getQueryText(): string {
    // For now, return all content
    // TODO: Support text selection
    return this.getContent();
  }

  /**
   * Execute the current query.
   */
  async executeQuery(): Promise<void> {
    if (!this.connectionId) {
      this.lastError = 'No connection selected';
      this.ctx.markDirty();
      return;
    }

    if (this.isExecuting) {
      return;
    }

    const sql = this.getQueryText().trim();
    if (!sql) {
      return;
    }

    this.isExecuting = true;
    this.lastError = null;
    this.lastResult = null;
    this.ctx.markDirty();

    try {
      if (this.callbacks.onExecuteQuery) {
        this.lastResult = await this.callbacks.onExecuteQuery(sql, this.connectionId);
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      debugLog(`[SQLEditor] Query error: ${this.lastError}`);
    } finally {
      this.isExecuting = false;
      this.ctx.markDirty();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  render(buffer: ScreenBuffer): void {
    const { x, y, width, height } = this.bounds;

    // Colors
    const bg = this.ctx.getThemeColor('editor.background', '#1e1e1e');
    const fg = this.ctx.getThemeColor('editor.foreground', '#d4d4d4');
    const gutterBg = this.ctx.getThemeColor('editorLineNumber.background', '#1e1e1e');
    const gutterFg = this.ctx.getThemeColor('editorLineNumber.foreground', '#858585');
    const cursorLineBg = this.ctx.getThemeColor('editor.lineHighlightBackground', '#2a2a2a');
    const statusBg = this.ctx.getThemeColor('statusBar.background', '#007acc');
    const statusFg = this.ctx.getThemeColor('statusBar.foreground', '#ffffff');

    // Calculate content area
    const contentHeight = height - this.STATUS_HEIGHT;
    const contentWidth = width - this.GUTTER_WIDTH;

    // Clear background
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        buffer.set(x + col, y + row, { char: ' ', fg, bg });
      }
    }

    // Render lines
    const visibleLines = Math.min(contentHeight, this.lines.length - this.scrollTop);

    for (let i = 0; i < visibleLines; i++) {
      const lineIndex = this.scrollTop + i;
      const line = this.lines[lineIndex] || '';
      const screenY = y + i;
      const isCurrentLine = lineIndex === this.cursor.line;

      // Line number gutter
      const lineNum = String(lineIndex + 1).padStart(this.GUTTER_WIDTH - 1, ' ');
      for (let col = 0; col < this.GUTTER_WIDTH - 1; col++) {
        buffer.set(x + col, screenY, {
          char: lineNum[col] || ' ',
          fg: gutterFg,
          bg: gutterBg,
        });
      }
      buffer.set(x + this.GUTTER_WIDTH - 1, screenY, { char: ' ', fg, bg });

      // Line content
      const lineBg = isCurrentLine && this.focused ? cursorLineBg : bg;
      const visibleChars = Math.min(contentWidth, line.length - this.scrollLeft);

      for (let col = 0; col < contentWidth; col++) {
        const charIndex = this.scrollLeft + col;
        const char = charIndex < line.length ? line[charIndex] : ' ';
        const screenX = x + this.GUTTER_WIDTH + col;

        // Apply syntax highlighting (simplified)
        let charFg = fg;
        if (this.isKeyword(line, charIndex)) {
          charFg = this.ctx.getThemeColor('keyword', '#569cd6');
        } else if (this.isString(line, charIndex)) {
          charFg = this.ctx.getThemeColor('string', '#ce9178');
        } else if (this.isComment(line, charIndex)) {
          charFg = this.ctx.getThemeColor('comment', '#6a9955');
        } else if (this.isNumber(line, charIndex)) {
          charFg = this.ctx.getThemeColor('number', '#b5cea8');
        }

        buffer.set(screenX, screenY, { char, fg: charFg, bg: lineBg });
      }

      // Cursor
      if (isCurrentLine && this.focused) {
        const cursorScreenX = x + this.GUTTER_WIDTH + (this.cursor.column - this.scrollLeft);
        if (cursorScreenX >= x + this.GUTTER_WIDTH && cursorScreenX < x + width) {
          const cursorChar = this.cursor.column < line.length ? line[this.cursor.column] : ' ';
          buffer.set(cursorScreenX, screenY, {
            char: cursorChar,
            fg: bg,
            bg: this.ctx.getThemeColor('editorCursor.foreground', '#ffffff'),
          });
        }
      }
    }

    // Status bar
    this.renderStatusBar(buffer, x, y + height - 1, width, statusBg, statusFg);
  }

  private renderStatusBar(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number,
    bg: string,
    fg: string
  ): void {
    // Clear status bar
    for (let col = 0; col < width; col++) {
      buffer.set(x + col, y, { char: ' ', fg, bg });
    }

    // Connection indicator
    const connStatus = this.connectionId ? `[${this.connectionName}]` : '[No Connection]';
    const connColor = this.connectionId ? fg : this.ctx.getThemeColor('errorForeground', '#f48771');

    for (let i = 0; i < connStatus.length && i < width; i++) {
      buffer.set(x + i, y, { char: connStatus[i], fg: connColor, bg });
    }

    // Execution status
    let statusText = '';
    if (this.isExecuting) {
      statusText = ' Running...';
    } else if (this.lastError) {
      statusText = ` Error: ${this.lastError.substring(0, 30)}`;
    } else if (this.lastResult) {
      statusText = ` ${this.lastResult.rowCount} rows (${this.lastResult.durationMs}ms)`;
    }

    const statusStart = connStatus.length;
    for (let i = 0; i < statusText.length && statusStart + i < width; i++) {
      const color = this.lastError ? this.ctx.getThemeColor('errorForeground', '#f48771') : fg;
      buffer.set(x + statusStart + i, y, { char: statusText[i], fg: color, bg });
    }

    // Cursor position (right side)
    const posText = `Ln ${this.cursor.line + 1}, Col ${this.cursor.column + 1}`;
    const posStart = width - posText.length - 1;
    if (posStart > statusStart + statusText.length) {
      for (let i = 0; i < posText.length; i++) {
        buffer.set(x + posStart + i, y, { char: posText[i], fg, bg });
      }
    }

    // Hint for execute
    const hint = 'Ctrl+Enter: Run';
    const hintStart = Math.floor((width - hint.length) / 2);
    if (hintStart > statusStart + statusText.length && hintStart + hint.length < posStart) {
      for (let i = 0; i < hint.length; i++) {
        buffer.set(x + hintStart + i, y, {
          char: hint[i],
          fg: this.ctx.getThemeColor('descriptionForeground', '#858585'),
          bg,
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Syntax Highlighting Helpers (Simplified)
  // ─────────────────────────────────────────────────────────────────────────

  private readonly SQL_KEYWORDS = new Set([
    'select', 'from', 'where', 'and', 'or', 'not', 'in', 'is', 'null',
    'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'table',
    'drop', 'alter', 'index', 'view', 'function', 'trigger', 'procedure',
    'begin', 'end', 'commit', 'rollback', 'transaction', 'as', 'on', 'join',
    'left', 'right', 'inner', 'outer', 'cross', 'natural', 'using', 'order',
    'by', 'group', 'having', 'limit', 'offset', 'union', 'intersect', 'except',
    'case', 'when', 'then', 'else', 'if', 'exists', 'between', 'like', 'ilike',
    'distinct', 'all', 'any', 'some', 'true', 'false', 'primary', 'key',
    'foreign', 'references', 'unique', 'check', 'default', 'constraint',
    'cascade', 'restrict', 'returning', 'with', 'recursive', 'grant', 'revoke',
  ]);

  private isKeyword(line: string, charIndex: number): boolean {
    // Find word boundaries
    let start = charIndex;
    let end = charIndex;

    while (start > 0 && /\w/.test(line[start - 1])) start--;
    while (end < line.length && /\w/.test(line[end])) end++;

    const word = line.slice(start, end).toLowerCase();
    return this.SQL_KEYWORDS.has(word);
  }

  private isString(line: string, charIndex: number): boolean {
    // Simple single-quote string detection
    let inString = false;
    for (let i = 0; i < charIndex; i++) {
      if (line[i] === "'" && (i === 0 || line[i - 1] !== '\\')) {
        inString = !inString;
      }
    }
    return inString || line[charIndex] === "'";
  }

  private isComment(line: string, charIndex: number): boolean {
    // Check for -- comment
    const dashDash = line.indexOf('--');
    return dashDash >= 0 && charIndex >= dashDash;
  }

  private isNumber(line: string, charIndex: number): boolean {
    const char = line[charIndex];
    if (!/\d/.test(char)) return false;

    // Check it's not part of an identifier
    if (charIndex > 0 && /\w/.test(line[charIndex - 1])) return false;

    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  handleKey(event: KeyEvent): boolean {
    // Execute query: Ctrl+Enter
    if (event.ctrl && event.key === 'enter') {
      this.executeQuery();
      return true;
    }

    // Pick connection: Ctrl+Shift+C
    if (event.ctrl && event.shift && event.key === 'c') {
      this.pickConnection();
      return true;
    }

    // Navigation
    if (event.key === 'up') {
      this.moveCursor(-1, 0);
      return true;
    }
    if (event.key === 'down') {
      this.moveCursor(1, 0);
      return true;
    }
    if (event.key === 'left') {
      this.moveCursor(0, -1);
      return true;
    }
    if (event.key === 'right') {
      this.moveCursor(0, 1);
      return true;
    }
    if (event.key === 'home') {
      this.cursor.column = 0;
      this.ensureCursorVisible();
      this.ctx.markDirty();
      return true;
    }
    if (event.key === 'end') {
      this.cursor.column = this.lines[this.cursor.line].length;
      this.ensureCursorVisible();
      this.ctx.markDirty();
      return true;
    }

    // Editing
    if (event.key === 'backspace') {
      this.handleBackspace();
      return true;
    }
    if (event.key === 'delete') {
      this.handleDelete();
      return true;
    }
    if (event.key === 'enter') {
      this.handleEnter();
      return true;
    }
    if (event.key === 'tab') {
      this.insertText('  '); // 2 spaces
      return true;
    }

    // Character input
    if (event.key.length === 1 && !event.ctrl && !event.alt) {
      this.insertText(event.key);
      return true;
    }

    return false;
  }

  handleMouse(event: MouseEvent): boolean {
    if (event.type === 'mousedown') {
      // Click to position cursor
      const relX = event.x - this.bounds.x - this.GUTTER_WIDTH;
      const relY = event.y - this.bounds.y;

      if (relX >= 0 && relY < this.bounds.height - this.STATUS_HEIGHT) {
        const line = this.scrollTop + relY;
        const column = this.scrollLeft + relX;

        if (line < this.lines.length) {
          this.cursor.line = line;
          this.cursor.column = Math.min(column, this.lines[line].length);
          this.ctx.markDirty();
        }
        return true;
      }
    }

    if (event.type === 'wheel') {
      const delta = event.button === 4 ? -3 : 3;
      this.scrollTop = Math.max(0, Math.min(this.lines.length - 1, this.scrollTop + delta));
      this.ctx.markDirty();
      return true;
    }

    return false;
  }

  private moveCursor(deltaLine: number, deltaCol: number): void {
    const newLine = Math.max(0, Math.min(this.lines.length - 1, this.cursor.line + deltaLine));
    const newCol = Math.max(0, Math.min(this.lines[newLine].length, this.cursor.column + deltaCol));

    this.cursor.line = newLine;
    this.cursor.column = newCol;
    this.ensureCursorVisible();
    this.ctx.markDirty();
  }

  private ensureCursorVisible(): void {
    const contentHeight = this.bounds.height - this.STATUS_HEIGHT;
    const contentWidth = this.bounds.width - this.GUTTER_WIDTH;

    // Vertical scrolling
    if (this.cursor.line < this.scrollTop) {
      this.scrollTop = this.cursor.line;
    } else if (this.cursor.line >= this.scrollTop + contentHeight) {
      this.scrollTop = this.cursor.line - contentHeight + 1;
    }

    // Horizontal scrolling
    if (this.cursor.column < this.scrollLeft) {
      this.scrollLeft = this.cursor.column;
    } else if (this.cursor.column >= this.scrollLeft + contentWidth) {
      this.scrollLeft = this.cursor.column - contentWidth + 1;
    }
  }

  private insertText(text: string): void {
    const line = this.lines[this.cursor.line];
    this.lines[this.cursor.line] =
      line.slice(0, this.cursor.column) + text + line.slice(this.cursor.column);
    this.cursor.column += text.length;
    this.ensureCursorVisible();
    this.ctx.markDirty();
    this.callbacks.onContentChange?.(this.getContent());
  }

  private handleBackspace(): void {
    if (this.cursor.column > 0) {
      const line = this.lines[this.cursor.line];
      this.lines[this.cursor.line] =
        line.slice(0, this.cursor.column - 1) + line.slice(this.cursor.column);
      this.cursor.column--;
    } else if (this.cursor.line > 0) {
      const prevLine = this.lines[this.cursor.line - 1];
      this.cursor.column = prevLine.length;
      this.lines[this.cursor.line - 1] = prevLine + this.lines[this.cursor.line];
      this.lines.splice(this.cursor.line, 1);
      this.cursor.line--;
    }
    this.ensureCursorVisible();
    this.ctx.markDirty();
    this.callbacks.onContentChange?.(this.getContent());
  }

  private handleDelete(): void {
    const line = this.lines[this.cursor.line];
    if (this.cursor.column < line.length) {
      this.lines[this.cursor.line] =
        line.slice(0, this.cursor.column) + line.slice(this.cursor.column + 1);
    } else if (this.cursor.line < this.lines.length - 1) {
      this.lines[this.cursor.line] = line + this.lines[this.cursor.line + 1];
      this.lines.splice(this.cursor.line + 1, 1);
    }
    this.ctx.markDirty();
    this.callbacks.onContentChange?.(this.getContent());
  }

  private handleEnter(): void {
    const line = this.lines[this.cursor.line];
    const before = line.slice(0, this.cursor.column);
    const after = line.slice(this.cursor.column);

    // Auto-indent: copy leading whitespace
    const indent = before.match(/^\s*/)?.[0] || '';

    this.lines[this.cursor.line] = before;
    this.lines.splice(this.cursor.line + 1, 0, indent + after);
    this.cursor.line++;
    this.cursor.column = indent.length;
    this.ensureCursorVisible();
    this.ctx.markDirty();
    this.callbacks.onContentChange?.(this.getContent());
  }

  private async pickConnection(): Promise<void> {
    if (this.callbacks.onPickConnection) {
      const conn = await this.callbacks.onPickConnection();
      if (conn) {
        this.setConnection(conn.id, conn.name);
      }
    }
  }

  private updateTitle(): void {
    const connLabel = this.connectionId ? ` [${this.connectionName}]` : '';
    this.setTitle(`SQL Query${connLabel}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State Serialization
  // ─────────────────────────────────────────────────────────────────────────

  override getState(): SQLEditorState {
    return {
      content: this.getContent(),
      connectionId: this.connectionId,
      cursorLine: this.cursor.line,
      cursorColumn: this.cursor.column,
      scrollTop: this.scrollTop,
    };
  }

  override setState(state: unknown): void {
    const s = state as SQLEditorState;
    if (s.content !== undefined) {
      this.setContent(s.content);
    }
    if (s.connectionId !== undefined) {
      this.connectionId = s.connectionId;
      // Try to get connection name
      if (s.connectionId && this.callbacks.getConnection) {
        const conn = this.callbacks.getConnection(s.connectionId);
        if (conn) {
          this.connectionName = conn.name;
        }
      }
      this.updateTitle();
    }
    if (s.cursorLine !== undefined) {
      this.cursor.line = s.cursorLine;
    }
    if (s.cursorColumn !== undefined) {
      this.cursor.column = s.cursorColumn;
    }
    if (s.scrollTop !== undefined) {
      this.scrollTop = s.scrollTop;
    }
  }
}

export default SQLEditor;
