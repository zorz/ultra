/**
 * SQL Editor Element
 *
 * A specialized text editor for writing and executing SQL queries.
 * Features:
 * - Full editor capabilities via embedded DocumentEditor
 * - LSP integration for SQL completions
 * - Connection context (which database to query)
 * - Query execution with Ctrl+Enter
 * - Transaction controls
 */

import { BaseElement, type ElementContext } from './base.ts';
import { DocumentEditor, type DocumentEditorCallbacks, type CursorPosition } from './document-editor.ts';
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
  filePath: string | null;
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
  /** Called when save is requested (Ctrl+S) */
  onSave?: (content: string, filePath: string | null) => Promise<string | null>;
  /** Called when a character is typed (for autocomplete triggers) */
  onCharTyped?: (char: string, position: CursorPosition) => void;
  /** Called when connection changes (for LSP configuration) */
  onConnectionChange?: (connectionId: string | null) => void;
}

// ============================================
// SQL Editor Element
// ============================================

/**
 * SQL Editor for database queries.
 *
 * Wraps a DocumentEditor to provide full editing capabilities with
 * SQL-specific features like query execution and connection management.
 */
export class SQLEditor extends BaseElement {
  // Embedded document editor for text editing
  private documentEditor: DocumentEditor;

  // File
  private filePath: string | null = null;
  private isDirty: boolean = false;

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
  private readonly STATUS_HEIGHT = 1; // Status bar at bottom

  // Unique ID counter for virtual URIs
  private static nextQueryId = 1;
  private queryId: number;

  constructor(id: string, ctx: ElementContext, callbacks: SQLEditorCallbacks = {}) {
    super('SQLEditor', id, 'SQL Query', ctx);
    this.callbacks = callbacks;
    this.queryId = SQLEditor.nextQueryId++;

    // Create embedded DocumentEditor
    const editorCallbacks: DocumentEditorCallbacks = {
      onContentChange: (content: string) => {
        this.markContentDirty();
        this.callbacks.onContentChange?.(content);
      },
      onCharTyped: (char: string, position: CursorPosition) => {
        this.callbacks.onCharTyped?.(char, position);
      },
      onSave: () => {
        this.save();
      },
    };

    this.documentEditor = new DocumentEditor(
      `${id}-editor`,
      'SQL Query',
      ctx,
      editorCallbacks
    );

    // Set up SQL-specific configuration
    this.documentEditor.setUri(this.getVirtualUri());
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the embedded DocumentEditor for LSP integration.
   * This allows the TUI client to access the editor for completions, hover, etc.
   */
  getDocumentEditor(): DocumentEditor {
    return this.documentEditor;
  }

  /**
   * Get the virtual URI for this SQL editor.
   * Uses file:// scheme for LSP compatibility, with a virtual path that won't conflict with real files.
   */
  getVirtualUri(): string {
    if (this.filePath) {
      return `file://${this.filePath}`;
    }
    // Use a virtual file path for LSP compatibility
    // The .ultra-virtual prefix ensures it won't conflict with real files
    return `file:///tmp/.ultra-virtual/query-${this.queryId}.sql`;
  }

  /**
   * Set callbacks after construction.
   * Useful when element is created via factory and callbacks need to be attached later.
   */
  setCallbacks(callbacks: SQLEditorCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };

    // Update document editor callbacks
    this.documentEditor.setCallbacks({
      onContentChange: (content: string) => {
        this.markContentDirty();
        this.callbacks.onContentChange?.(content);
      },
      onCharTyped: (char: string, position: CursorPosition) => {
        this.callbacks.onCharTyped?.(char, position);
      },
      onSave: () => {
        this.save();
      },
    });
  }

  /**
   * Set the content of the editor.
   */
  setContent(content: string): void {
    this.documentEditor.setContent(content);
    this.ctx.markDirty();
  }

  /**
   * Get the content of the editor.
   */
  getContent(): string {
    return this.documentEditor.getContent();
  }

  /**
   * Get selected text from the editor.
   */
  getSelectedText(): string {
    return this.documentEditor.getSelectedText();
  }

  /**
   * Insert text at the current cursor position.
   */
  insertText(text: string): void {
    this.documentEditor.insertText(text);
  }

  /**
   * Delete the character before the cursor, or delete selection if any.
   */
  deleteBackward(): void {
    this.documentEditor.deleteBackward();
  }

  /**
   * Set the connection to use for queries.
   */
  setConnection(connectionId: string | null, connectionName?: string): void {
    this.connectionId = connectionId;
    this.connectionName = connectionName || 'No connection';
    this.updateTitle();
    this.ctx.markDirty();

    // Notify for LSP configuration
    this.callbacks.onConnectionChange?.(connectionId);
  }

  /**
   * Get the current connection ID.
   */
  getConnectionId(): string | null {
    return this.connectionId;
  }

  /**
   * Set the file path for this SQL editor.
   */
  setFilePath(path: string | null): void {
    this.filePath = path;
    this.documentEditor.setUri(this.getVirtualUri());
    this.updateTitle();
  }

  /**
   * Get the file path.
   */
  getFilePath(): string | null {
    return this.filePath;
  }

  /**
   * Check if the document has unsaved changes.
   */
  getIsDirty(): boolean {
    return this.isDirty;
  }

  /**
   * Save the SQL file.
   */
  async save(): Promise<void> {
    if (this.callbacks.onSave) {
      const savedPath = await this.callbacks.onSave(this.getContent(), this.filePath);
      if (savedPath) {
        this.filePath = savedPath;
        this.isDirty = false;
        this.documentEditor.markSaved();
        this.documentEditor.setUri(this.getVirtualUri());
        this.updateTitle();
        this.ctx.markDirty();
      }
    }
  }

  /**
   * Get selected text or all text if no selection.
   */
  getQueryText(): string {
    const selected = this.documentEditor.getSelectedText();
    if (selected) {
      return selected;
    }
    return this.getContent();
  }

  /**
   * Execute the current query.
   */
  async executeQuery(): Promise<void> {
    // Verify connection still exists, clear if stale
    if (this.connectionId && this.callbacks.getConnection) {
      const conn = this.callbacks.getConnection(this.connectionId);
      if (!conn) {
        // Connection no longer exists, clear it
        this.connectionId = null;
        this.connectionName = 'No connection';
        this.updateTitle();
      }
    }

    // If no connection, prompt user to pick one first
    if (!this.connectionId) {
      const picked = await this.pickConnection();
      if (!picked) {
        this.lastError = 'No connection selected';
        this.ctx.markDirty();
        return;
      }
    }

    // Re-check after async operation (TypeScript needs this)
    const connectionId = this.connectionId;
    if (!connectionId) {
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
        this.lastResult = await this.callbacks.onExecuteQuery(sql, connectionId);
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
  // Lifecycle overrides
  // ─────────────────────────────────────────────────────────────────────────

  override onFocus(): void {
    super.onFocus();
    this.documentEditor.onFocus();
  }

  override onBlur(): void {
    super.onBlur();
    this.documentEditor.onBlur();
  }

  override onMount(): void {
    super.onMount();
    this.documentEditor.onMount();
  }

  override onUnmount(): void {
    super.onUnmount();
    this.documentEditor.onUnmount();
  }

  override dispose(): void {
    super.dispose();
    this.documentEditor.dispose();
  }

  override setBounds(bounds: Rect): void {
    super.setBounds(bounds);

    // Set document editor bounds (full width, height minus status bar)
    const editorBounds: Rect = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: Math.max(1, bounds.height - this.STATUS_HEIGHT),
    };
    this.documentEditor.setBounds(editorBounds);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  render(buffer: ScreenBuffer): void {
    const { x, y, width, height } = this.bounds;

    // Render the document editor
    this.documentEditor.render(buffer);

    // Render status bar at bottom
    const statusBg = this.ctx.getThemeColor('statusBar.background', '#007acc');
    const statusFg = this.ctx.getThemeColor('statusBar.foreground', '#ffffff');
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
      buffer.set(x + i, y, { char: connStatus[i] ?? ' ', fg: connColor, bg });
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
      buffer.set(x + statusStart + i, y, { char: statusText[i] ?? ' ', fg: color, bg });
    }

    // Cursor position (right side)
    const cursor = this.documentEditor.getCursor();
    const posText = `Ln ${cursor.line + 1}, Col ${cursor.column + 1}`;
    const posStart = width - posText.length - 1;
    if (posStart > statusStart + statusText.length) {
      for (let i = 0; i < posText.length; i++) {
        buffer.set(x + posStart + i, y, { char: posText[i] ?? ' ', fg, bg });
      }
    }

    // Hint for execute or connection
    const hint = this.connectionId
      ? 'Ctrl+Enter: Run'
      : 'Ctrl+Shift+C: Select Connection';
    const hintStart = Math.floor((width - hint.length) / 2);
    if (hintStart > statusStart + statusText.length && hintStart + hint.length < posStart) {
      for (let i = 0; i < hint.length; i++) {
        buffer.set(x + hintStart + i, y, {
          char: hint[i] ?? ' ',
          fg: this.ctx.getThemeColor('descriptionForeground', '#858585'),
          bg,
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  override handleKey(event: KeyEvent): boolean {
    // SQL-specific keybindings first

    // Execute query: Ctrl+Enter
    if (event.ctrl && event.key === 'Enter') {
      this.executeQuery();
      return true;
    }

    // Pick connection: Ctrl+Shift+C
    if (event.ctrl && event.shift && (event.key === 'c' || event.key === 'C')) {
      this.pickConnection();
      return true;
    }

    // Delegate all other input to the document editor
    return this.documentEditor.handleKey(event);
  }

  override handleMouse(event: MouseEvent): boolean {
    const { x, y, height } = this.bounds;

    if (event.type === 'press') {
      const relY = event.y - y;

      // Click on status bar (last row)
      if (relY === height - 1) {
        const relX = event.x - x;
        // Click on connection status area (left part of status bar)
        const connStatus = this.connectionId ? `[${this.connectionName}]` : '[No Connection]';
        if (relX < connStatus.length) {
          this.pickConnection();
          return true;
        }
        return true; // Consume other status bar clicks
      }
    }

    // Delegate to document editor
    return this.documentEditor.handleMouse(event);
  }

  private async pickConnection(): Promise<boolean> {
    if (this.callbacks.onPickConnection) {
      const conn = await this.callbacks.onPickConnection();
      if (conn) {
        this.setConnection(conn.id, conn.name);
        return true;
      }
    }
    return false;
  }

  private updateTitle(): void {
    const dirtyMarker = this.isDirty ? '* ' : '';
    const fileName = this.filePath
      ? this.filePath.split('/').pop() || 'query.sql'
      : 'New Query';
    const connLabel = this.connectionId ? ` [${this.connectionName}]` : '';
    this.setTitle(`${dirtyMarker}${fileName}${connLabel}`);
  }

  private markContentDirty(): void {
    if (!this.isDirty) {
      this.isDirty = true;
      this.updateTitle();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State Serialization
  // ─────────────────────────────────────────────────────────────────────────

  override getState(): SQLEditorState {
    const cursor = this.documentEditor.getCursor();
    return {
      content: this.getContent(),
      connectionId: this.connectionId,
      filePath: this.filePath,
      cursorLine: cursor.line,
      cursorColumn: cursor.column,
      scrollTop: this.documentEditor.getScrollTop(),
    };
  }

  override setState(state: unknown): void {
    const s = state as SQLEditorState;
    if (s.content !== undefined) {
      this.setContent(s.content);
    }
    if (s.filePath !== undefined) {
      this.filePath = s.filePath;
      this.documentEditor.setUri(this.getVirtualUri());
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
    }
    if (s.cursorLine !== undefined && s.cursorColumn !== undefined) {
      this.documentEditor.setCursor({ line: s.cursorLine, column: s.cursorColumn });
    }
    if (s.scrollTop !== undefined) {
      this.documentEditor.scrollToLine(s.scrollTop);
    }
    // Update title after all state is set
    this.updateTitle();
  }
}

export default SQLEditor;
