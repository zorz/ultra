/**
 * Local Document Service Implementation
 *
 * Manages documents in-memory, wrapping the existing Document class
 * from src/core/document.ts. This is the default implementation for
 * local editing.
 */

import { Document } from '../../core/document.ts';
import { debugLog } from '../../debug.ts';
import type { DocumentService } from './interface.ts';
import type {
  Position,
  Range,
  Cursor,
  DocumentInfo,
  DocumentOpenOptions,
  DocumentOpenResult,
  DocumentContent,
  DocumentLine,
  InsertOptions,
  DeleteOptions,
  ReplaceOptions,
  EditResult,
  SetCursorsOptions,
  MoveCursorsOptions,
  UndoRedoResult,
  DocumentChangeEvent,
  TextChange,
  CursorChangeEvent,
  DocumentOpenEvent,
  DocumentCloseEvent,
  Unsubscribe,
} from './types.ts';

/**
 * Internal document entry with metadata.
 */
interface DocumentEntry {
  id: string;
  uri: string;
  document: Document;
  languageId: string;
  isReadOnly: boolean;
  lastVersion: number;
}

/**
 * Generate a unique document ID.
 */
function generateDocumentId(): string {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Detect language from file extension.
 */
function detectLanguageFromUri(uri: string): string {
  const ext = uri.split('.').pop()?.toLowerCase() ?? '';
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    json: 'json',
    jsonc: 'jsonc',
    md: 'markdown',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    rb: 'ruby',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    svg: 'xml',
    sql: 'sql',
    graphql: 'graphql',
    gql: 'graphql',
  };
  return languageMap[ext] ?? 'plaintext';
}

/**
 * Extract file path from URI.
 */
function uriToFilePath(uri: string): string | null {
  if (uri.startsWith('file://')) {
    return uri.slice(7);
  }
  return null;
}

/**
 * Local Document Service implementation.
 */
export class LocalDocumentService implements DocumentService {
  private documents = new Map<string, DocumentEntry>();
  private uriToId = new Map<string, string>();

  // Event listeners
  private contentChangeListeners: Array<(event: DocumentChangeEvent) => void> = [];
  private cursorChangeListeners: Array<(event: CursorChangeEvent) => void> = [];
  private openListeners: Array<(event: DocumentOpenEvent) => void> = [];
  private closeListeners: Array<(event: DocumentCloseEvent) => void> = [];

  // Compound edit tracking
  private compoundEditStack = new Map<string, number>();

  constructor() {
    debugLog('[LocalDocumentService] Initialized');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Document Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  async open(options: DocumentOpenOptions): Promise<DocumentOpenResult> {
    const { uri, content, languageId, readOnly } = options;

    // Check if already open
    const existingId = this.uriToId.get(uri);
    if (existingId) {
      const entry = this.documents.get(existingId);
      if (entry) {
        return {
          documentId: existingId,
          info: this.createDocumentInfo(entry),
        };
      }
    }

    // Determine content
    let documentContent = content ?? '';
    const filePath = uriToFilePath(uri);

    if (filePath && content === undefined) {
      // Load from file
      try {
        const file = Bun.file(filePath);
        documentContent = await file.text();
      } catch (error) {
        throw new Error(`Failed to open file: ${filePath}`);
      }
    }

    // Create document
    const document = new Document(documentContent, filePath);
    const id = generateDocumentId();

    // Determine language (provided > URI-based detection > Document detection > plaintext)
    const detectedLanguage = languageId ?? detectLanguageFromUri(uri) ?? document.language;

    const entry: DocumentEntry = {
      id,
      uri,
      document,
      languageId: detectedLanguage,
      isReadOnly: readOnly ?? false,
      lastVersion: document.version,
    };

    this.documents.set(id, entry);
    this.uriToId.set(uri, id);

    // Emit open event
    this.emitOpen({ documentId: id, uri, languageId: detectedLanguage });

    debugLog(`[LocalDocumentService] Opened document: ${id} (${uri})`);

    return {
      documentId: id,
      info: this.createDocumentInfo(entry),
    };
  }

  async close(documentId: string): Promise<boolean> {
    const entry = this.documents.get(documentId);
    if (!entry) {
      return false;
    }

    const uri = entry.uri;
    this.documents.delete(documentId);
    this.uriToId.delete(uri);

    // Emit close event
    this.emitClose({ documentId, uri });

    debugLog(`[LocalDocumentService] Closed document: ${documentId}`);

    return true;
  }

  getInfo(documentId: string): DocumentInfo | null {
    const entry = this.documents.get(documentId);
    if (!entry) return null;
    return this.createDocumentInfo(entry);
  }

  listOpen(): DocumentInfo[] {
    const infos: DocumentInfo[] = [];
    for (const entry of this.documents.values()) {
      infos.push(this.createDocumentInfo(entry));
    }
    return infos;
  }

  isOpen(documentId: string): boolean {
    return this.documents.has(documentId);
  }

  findByUri(uri: string): string | null {
    return this.uriToId.get(uri) ?? null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Content Access
  // ─────────────────────────────────────────────────────────────────────────

  getContent(documentId: string): DocumentContent | null {
    const entry = this.documents.get(documentId);
    if (!entry) return null;

    return {
      content: entry.document.content,
      version: entry.document.version,
      lineCount: entry.document.lineCount,
    };
  }

  getLine(documentId: string, lineNumber: number): DocumentLine | null {
    const entry = this.documents.get(documentId);
    if (!entry) return null;

    if (lineNumber < 0 || lineNumber >= entry.document.lineCount) {
      return null;
    }

    return {
      lineNumber,
      text: entry.document.getLine(lineNumber),
    };
  }

  getLines(documentId: string, startLine: number, endLine: number): DocumentLine[] {
    const entry = this.documents.get(documentId);
    if (!entry) return [];

    const lines: DocumentLine[] = [];
    const maxLine = Math.min(endLine, entry.document.lineCount);

    for (let i = Math.max(0, startLine); i < maxLine; i++) {
      lines.push({
        lineNumber: i,
        text: entry.document.getLine(i),
      });
    }

    return lines;
  }

  getTextInRange(documentId: string, range: Range): string | null {
    const entry = this.documents.get(documentId);
    if (!entry) return null;

    const startOffset = entry.document.buffer.positionToOffset(range.start);
    const endOffset = entry.document.buffer.positionToOffset(range.end);
    const content = entry.document.content;

    return content.slice(startOffset, endOffset);
  }

  getVersion(documentId: string): number | null {
    const entry = this.documents.get(documentId);
    if (!entry) return null;
    return entry.document.version;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Text Editing
  // ─────────────────────────────────────────────────────────────────────────

  insert(options: InsertOptions): EditResult {
    const { documentId, position, text, groupWithPrevious } = options;
    const entry = this.documents.get(documentId);

    if (!entry) {
      return { success: false, version: 0, error: 'Document not found' };
    }

    if (entry.isReadOnly) {
      return { success: false, version: entry.document.version, error: 'Document is read-only' };
    }

    const doc = entry.document;
    const versionBefore = doc.version;

    // Set cursor to position and insert
    doc.cursorManager.setPosition(position);
    doc.insert(text);

    this.notifyContentChange(entry, versionBefore);

    return { success: true, version: doc.version };
  }

  delete(options: DeleteOptions): EditResult {
    const { documentId, range } = options;
    const entry = this.documents.get(documentId);

    if (!entry) {
      return { success: false, version: 0, error: 'Document not found' };
    }

    if (entry.isReadOnly) {
      return { success: false, version: entry.document.version, error: 'Document is read-only' };
    }

    const doc = entry.document;
    const versionBefore = doc.version;

    // Delete text in range directly via buffer
    doc.buffer.deleteRange(range.start, range.end);

    this.notifyContentChange(entry, versionBefore);

    return { success: true, version: doc.version };
  }

  replace(options: ReplaceOptions): EditResult {
    const { documentId, range, text } = options;
    const entry = this.documents.get(documentId);

    if (!entry) {
      return { success: false, version: 0, error: 'Document not found' };
    }

    if (entry.isReadOnly) {
      return { success: false, version: entry.document.version, error: 'Document is read-only' };
    }

    const doc = entry.document;
    const versionBefore = doc.version;

    // Delete the range then insert text at the start position
    doc.buffer.deleteRange(range.start, range.end);
    doc.buffer.insertAt(range.start, text);

    this.notifyContentChange(entry, versionBefore);

    return { success: true, version: doc.version };
  }

  setContent(documentId: string, content: string): EditResult {
    const entry = this.documents.get(documentId);

    if (!entry) {
      return { success: false, version: 0, error: 'Document not found' };
    }

    if (entry.isReadOnly) {
      return { success: false, version: entry.document.version, error: 'Document is read-only' };
    }

    const doc = entry.document;
    const versionBefore = doc.version;

    // Select all and replace
    doc.cursorManager.setPosition({ line: 0, column: 0 });
    doc.selectAll();
    doc.insert(content);

    this.notifyContentChange(entry, versionBefore);

    return { success: true, version: doc.version };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cursor Management
  // ─────────────────────────────────────────────────────────────────────────

  getCursors(documentId: string): Cursor[] | null {
    const entry = this.documents.get(documentId);
    if (!entry) return null;

    return entry.document.cursors.map(c => ({
      position: { ...c.position },
      // The internal Selection uses `head`, but our API uses `active`
      selection: c.selection ? {
        anchor: { ...c.selection.anchor },
        active: { ...c.selection.head },
      } : undefined,
      desiredColumn: c.desiredColumn,
    }));
  }

  setCursors(options: SetCursorsOptions): boolean {
    const { documentId, cursors } = options;
    const entry = this.documents.get(documentId);
    if (!entry) return false;

    const cm = entry.document.cursorManager;

    // Set first cursor
    const firstCursor = cursors[0];
    if (firstCursor) {
      cm.setPosition(firstCursor.position);
      if (firstCursor.selection) {
        cm.setSelections([{ anchor: firstCursor.selection.anchor, head: firstCursor.selection.active }]);
      }

      // Add additional cursors
      for (let i = 1; i < cursors.length; i++) {
        const cursor = cursors[i];
        if (cursor) {
          cm.addCursor(cursor.position);
          // Note: The current CursorManager doesn't support setting selection on non-primary cursor
          // This is a limitation we may need to address
        }
      }
    }

    this.emitCursorChange({ documentId, cursors: this.getCursors(documentId) ?? [] });

    return true;
  }

  setCursor(documentId: string, position: Position, selection?: { anchor: Position; active: Position }): boolean {
    const entry = this.documents.get(documentId);
    if (!entry) return false;

    const cm = entry.document.cursorManager;
    cm.setPosition(position);

    if (selection) {
      cm.setSelections([{ anchor: selection.anchor, head: selection.active }]);
    } else {
      cm.clearSelections();
    }

    this.emitCursorChange({ documentId, cursors: this.getCursors(documentId) ?? [] });

    return true;
  }

  addCursor(documentId: string, position: Position): boolean {
    const entry = this.documents.get(documentId);
    if (!entry) return false;

    entry.document.cursorManager.addCursor(position);
    this.emitCursorChange({ documentId, cursors: this.getCursors(documentId) ?? [] });

    return true;
  }

  moveCursors(options: MoveCursorsOptions): boolean {
    const { documentId, direction, unit, select } = options;
    const entry = this.documents.get(documentId);
    if (!entry) return false;

    const doc = entry.document;

    // Map to document methods (Document uses moveX not moveCursorX naming)
    switch (direction) {
      case 'up':
        if (unit === 'page') {
          // Page up - move multiple lines
          doc.movePageUp(20, select);
        } else if (unit === 'document') {
          doc.moveToDocumentStart(select);
        } else {
          doc.moveUp(select);
        }
        break;

      case 'down':
        if (unit === 'page') {
          doc.movePageDown(20, select);
        } else if (unit === 'document') {
          doc.moveToDocumentEnd(select);
        } else {
          doc.moveDown(select);
        }
        break;

      case 'left':
        if (unit === 'word') {
          doc.moveWordLeft(select);
        } else if (unit === 'line') {
          doc.moveToLineStart(select);
        } else {
          doc.moveLeft(select);
        }
        break;

      case 'right':
        if (unit === 'word') {
          doc.moveWordRight(select);
        } else if (unit === 'line') {
          doc.moveToLineEnd(select);
        } else {
          doc.moveRight(select);
        }
        break;
    }

    this.emitCursorChange({ documentId, cursors: this.getCursors(documentId) ?? [] });

    return true;
  }

  moveCursorsTo(documentId: string, position: Position, select?: boolean): boolean {
    const entry = this.documents.get(documentId);
    if (!entry) return false;

    if (select) {
      const cm = entry.document.cursorManager;
      const current = cm.getPrimaryCursor().position;
      cm.setPosition(position);
      cm.setSelections([{ anchor: current, head: position }]);
    } else {
      entry.document.cursorManager.setPosition(position);
    }

    this.emitCursorChange({ documentId, cursors: this.getCursors(documentId) ?? [] });

    return true;
  }

  selectAll(documentId: string): boolean {
    const entry = this.documents.get(documentId);
    if (!entry) return false;

    entry.document.selectAll();
    this.emitCursorChange({ documentId, cursors: this.getCursors(documentId) ?? [] });

    return true;
  }

  clearSelections(documentId: string): boolean {
    const entry = this.documents.get(documentId);
    if (!entry) return false;

    entry.document.cursorManager.clearSelections();
    this.emitCursorChange({ documentId, cursors: this.getCursors(documentId) ?? [] });

    return true;
  }

  getSelections(documentId: string): string[] | null {
    const entry = this.documents.get(documentId);
    if (!entry) return null;

    // Document.getSelectedText() returns a single string for the primary cursor
    const selectedText = entry.document.getSelectedText();
    return selectedText ? [selectedText] : [''];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Undo/Redo
  // ─────────────────────────────────────────────────────────────────────────

  undo(documentId: string): UndoRedoResult {
    const entry = this.documents.get(documentId);

    if (!entry) {
      return { success: false, version: 0, canUndo: false, canRedo: false };
    }

    const doc = entry.document;
    const versionBefore = doc.version;

    // Document.undo() returns void, so check version change for success
    doc.undo();
    const success = doc.version !== versionBefore;

    if (success) {
      this.notifyContentChange(entry, versionBefore);
    }

    // Access undoManager through the internal reference
    const undoManager = (doc as unknown as { _undoManager: { canUndo(): boolean; canRedo(): boolean } })._undoManager;

    return {
      success,
      version: doc.version,
      canUndo: undoManager?.canUndo() ?? false,
      canRedo: undoManager?.canRedo() ?? false,
    };
  }

  redo(documentId: string): UndoRedoResult {
    const entry = this.documents.get(documentId);

    if (!entry) {
      return { success: false, version: 0, canUndo: false, canRedo: false };
    }

    const doc = entry.document;
    const versionBefore = doc.version;

    // Document.redo() returns void, so check version change for success
    doc.redo();
    const success = doc.version !== versionBefore;

    if (success) {
      this.notifyContentChange(entry, versionBefore);
    }

    // Access undoManager through the internal reference
    const undoManager = (doc as unknown as { _undoManager: { canUndo(): boolean; canRedo(): boolean } })._undoManager;

    return {
      success,
      version: doc.version,
      canUndo: undoManager?.canUndo() ?? false,
      canRedo: undoManager?.canRedo() ?? false,
    };
  }

  canUndo(documentId: string): boolean {
    const entry = this.documents.get(documentId);
    if (!entry) return false;

    const doc = entry.document;
    const undoManager = (doc as unknown as { _undoManager: { canUndo(): boolean } })._undoManager;
    return undoManager?.canUndo() ?? false;
  }

  canRedo(documentId: string): boolean {
    const entry = this.documents.get(documentId);
    if (!entry) return false;

    const doc = entry.document;
    const undoManager = (doc as unknown as { _undoManager: { canRedo(): boolean } })._undoManager;
    return undoManager?.canRedo() ?? false;
  }

  clearUndoHistory(documentId: string): void {
    const entry = this.documents.get(documentId);
    if (entry) {
      const doc = entry.document;
      const undoManager = (doc as unknown as { _undoManager: { clear(): void } })._undoManager;
      undoManager?.clear();
    }
  }

  beginCompoundEdit(documentId: string): void {
    const current = this.compoundEditStack.get(documentId) ?? 0;
    this.compoundEditStack.set(documentId, current + 1);
    // Note: The current UndoManager uses time-based grouping
    // A proper compound edit would require changes to UndoManager
  }

  endCompoundEdit(documentId: string): void {
    const current = this.compoundEditStack.get(documentId) ?? 0;
    if (current > 0) {
      this.compoundEditStack.set(documentId, current - 1);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Dirty State
  // ─────────────────────────────────────────────────────────────────────────

  isDirty(documentId: string): boolean {
    const entry = this.documents.get(documentId);
    return entry?.document.isDirty ?? false;
  }

  markClean(documentId: string): void {
    const entry = this.documents.get(documentId);
    if (entry) {
      // Access private _isDirty and _savedContent to simulate markClean
      const doc = entry.document as unknown as {
        _isDirty: boolean;
        _savedContent: string;
        content: string;
      };
      doc._isDirty = false;
      doc._savedContent = doc.content;
    }
  }

  markDirty(documentId: string): void {
    const entry = this.documents.get(documentId);
    if (entry) {
      // Access private _isDirty to set dirty state
      const doc = entry.document as unknown as { _isDirty: boolean };
      doc._isDirty = true;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Events
  // ─────────────────────────────────────────────────────────────────────────

  onDidChangeContent(callback: (event: DocumentChangeEvent) => void): Unsubscribe {
    this.contentChangeListeners.push(callback);
    return () => {
      const index = this.contentChangeListeners.indexOf(callback);
      if (index >= 0) {
        this.contentChangeListeners.splice(index, 1);
      }
    };
  }

  onDidChangeCursors(callback: (event: CursorChangeEvent) => void): Unsubscribe {
    this.cursorChangeListeners.push(callback);
    return () => {
      const index = this.cursorChangeListeners.indexOf(callback);
      if (index >= 0) {
        this.cursorChangeListeners.splice(index, 1);
      }
    };
  }

  onDidOpenDocument(callback: (event: DocumentOpenEvent) => void): Unsubscribe {
    this.openListeners.push(callback);
    return () => {
      const index = this.openListeners.indexOf(callback);
      if (index >= 0) {
        this.openListeners.splice(index, 1);
      }
    };
  }

  onDidCloseDocument(callback: (event: DocumentCloseEvent) => void): Unsubscribe {
    this.closeListeners.push(callback);
    return () => {
      const index = this.closeListeners.indexOf(callback);
      if (index >= 0) {
        this.closeListeners.splice(index, 1);
      }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Utility
  // ─────────────────────────────────────────────────────────────────────────

  positionToOffset(documentId: string, position: Position): number | null {
    const entry = this.documents.get(documentId);
    if (!entry) return null;
    return entry.document.buffer.positionToOffset(position);
  }

  offsetToPosition(documentId: string, offset: number): Position | null {
    const entry = this.documents.get(documentId);
    if (!entry) return null;
    return entry.document.buffer.offsetToPosition(offset);
  }

  validatePosition(documentId: string, position: Position): Position | null {
    const entry = this.documents.get(documentId);
    if (!entry) return null;

    const doc = entry.document;
    const line = Math.max(0, Math.min(position.line, doc.lineCount - 1));
    const lineLength = doc.getLineLength(line);
    const column = Math.max(0, Math.min(position.column, lineLength));

    return { line, column };
  }

  getWordAtPosition(documentId: string, position: Position): { range: Range; text: string } | null {
    const entry = this.documents.get(documentId);
    if (!entry) return null;

    const doc = entry.document;
    const line = doc.getLine(position.line);
    if (!line) return null;

    // Find word boundaries
    const wordPattern = /\w+/g;
    let match: RegExpExecArray | null;

    while ((match = wordPattern.exec(line)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      if (position.column >= start && position.column < end) {
        return {
          range: {
            start: { line: position.line, column: start },
            end: { line: position.line, column: end },
          },
          text: match[0],
        };
      }
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private createDocumentInfo(entry: DocumentEntry): DocumentInfo {
    const doc = entry.document;
    return {
      documentId: entry.id,
      uri: entry.uri,
      languageId: entry.languageId,
      version: doc.version,
      isDirty: doc.isDirty,
      isReadOnly: entry.isReadOnly,
      lineCount: doc.lineCount,
    };
  }

  private notifyContentChange(entry: DocumentEntry, versionBefore: number): void {
    const doc = entry.document;
    if (doc.version === versionBefore) return;

    // For now, we emit a full content change since we don't track incremental changes
    // TODO: Implement incremental change tracking
    const event: DocumentChangeEvent = {
      documentId: entry.id,
      uri: entry.uri,
      version: doc.version,
      changes: [{
        range: {
          start: { line: 0, column: 0 },
          end: { line: doc.lineCount, column: 0 },
        },
        text: doc.content,
        rangeLength: 0, // Not tracked
      }],
    };

    for (const listener of this.contentChangeListeners) {
      try {
        listener(event);
      } catch (error) {
        debugLog(`[LocalDocumentService] Error in content change listener: ${error}`);
      }
    }

    entry.lastVersion = doc.version;
  }

  private emitCursorChange(event: CursorChangeEvent): void {
    for (const listener of this.cursorChangeListeners) {
      try {
        listener(event);
      } catch (error) {
        debugLog(`[LocalDocumentService] Error in cursor change listener: ${error}`);
      }
    }
  }

  private emitOpen(event: DocumentOpenEvent): void {
    for (const listener of this.openListeners) {
      try {
        listener(event);
      } catch (error) {
        debugLog(`[LocalDocumentService] Error in open listener: ${error}`);
      }
    }
  }

  private emitClose(event: DocumentCloseEvent): void {
    for (const listener of this.closeListeners) {
      try {
        listener(event);
      } catch (error) {
        debugLog(`[LocalDocumentService] Error in close listener: ${error}`);
      }
    }
  }
}

// Singleton instance
export const localDocumentService = new LocalDocumentService();
export default localDocumentService;
