/**
 * Document Model
 * 
 * Represents a file in the editor, combining buffer with metadata
 * and cursor state. Handles file I/O operations.
 */

import { Buffer, type Position, type Range } from './buffer.ts';
import { CursorManager, type Cursor, type Selection, clonePosition } from './cursor.ts';
import { UndoManager, type EditOperation } from './undo.ts';
import { 
  calculateNewLineIndent, 
  shouldDedentOnChar, 
  findMatchingBracketIndent,
  getLeadingWhitespace,
  type IndentOptions 
} from './auto-indent.ts';
import { settings } from '../config/settings.ts';

export interface DocumentState {
  filePath: string | null;
  fileName: string;
  language: string;
  isDirty: boolean;
  encoding: string;
  lineEnding: 'lf' | 'crlf';
}

export class Document {
  private _buffer: Buffer;
  private _cursorManager: CursorManager;
  private _undoManager: UndoManager;
  private _filePath: string | null;
  private _fileName: string;
  private _language: string;
  private _isDirty: boolean = false;
  private _encoding: string = 'utf-8';
  private _lineEnding: 'lf' | 'crlf' = 'lf';
  private _savedContent: string = '';

  constructor(content: string = '', filePath: string | null = null) {
    // Normalize line endings
    const normalized = content.replace(/\r\n/g, '\n');
    if (content !== normalized) {
      this._lineEnding = 'crlf';
    }
    
    this._buffer = new Buffer(normalized);
    this._cursorManager = new CursorManager();
    this._undoManager = new UndoManager();
    this._filePath = filePath;
    this._fileName = filePath ? this.extractFileName(filePath) : 'Untitled';
    this._language = filePath ? this.detectLanguage(filePath) : 'plaintext';
    this._savedContent = normalized;
  }

  /**
   * Static method to load a document from a file
   */
  static async fromFile(filePath: string): Promise<Document> {
    try {
      const file = Bun.file(filePath);
      const content = await file.text();
      return new Document(content, filePath);
    } catch (error) {
      throw new Error(`Failed to read file: ${filePath}`);
    }
  }

  /**
   * Save the document to its file path
   */
  async save(): Promise<void> {
    if (!this._filePath) {
      throw new Error('No file path set for document');
    }
    
    let content = this._buffer.getContent();
    
    // Convert line endings if needed
    if (this._lineEnding === 'crlf') {
      content = content.replace(/\n/g, '\r\n');
    }
    
    await Bun.write(this._filePath, content);
    this._savedContent = this._buffer.getContent();
    this._isDirty = false;
  }

  /**
   * Save the document to a new file path
   */
  async saveAs(filePath: string): Promise<void> {
    this._filePath = filePath;
    this._fileName = this.extractFileName(filePath);
    this._language = this.detectLanguage(filePath);
    await this.save();
  }

  // Buffer accessors
  get buffer(): Buffer {
    return this._buffer;
  }

  get content(): string {
    return this._buffer.getContent();
  }

  get lineCount(): number {
    return this._buffer.lineCount;
  }

  get length(): number {
    return this._buffer.length;
  }

  getLine(lineNumber: number): string {
    return this._buffer.getLine(lineNumber);
  }

  getLineLength(lineNumber: number): number {
    return this._buffer.getLineLength(lineNumber);
  }

  // Cursor accessors
  get cursorManager(): CursorManager {
    return this._cursorManager;
  }

  get cursors(): readonly Cursor[] {
    return this._cursorManager.getCursors();
  }

  get primaryCursor(): Cursor {
    return this._cursorManager.getPrimaryCursor();
  }

  // Document state
  get filePath(): string | null {
    return this._filePath;
  }

  get fileName(): string {
    return this._fileName;
  }

  get language(): string {
    return this._language;
  }

  get isDirty(): boolean {
    return this._isDirty;
  }

  get encoding(): string {
    return this._encoding;
  }

  get lineEnding(): 'lf' | 'crlf' {
    return this._lineEnding;
  }

  getState(): DocumentState {
    return {
      filePath: this._filePath,
      fileName: this._fileName,
      language: this._language,
      isDirty: this._isDirty,
      encoding: this._encoding,
      lineEnding: this._lineEnding
    };
  }

  // Editing operations
  
  /**
   * Insert text at all cursor positions
   */
  insert(text: string): void {
    // Capture cursor state BEFORE any modifications
    const cursorsBefore = this._cursorManager.getSnapshot();
    
    const cursors = [...this.cursors].sort((a, b) => {
      // Sort in reverse order so we can insert from bottom to top
      const aOffset = this._buffer.positionToOffset(a.position);
      const bOffset = this._buffer.positionToOffset(b.position);
      return bOffset - aOffset;
    });

    const operations: EditOperation[] = [];

    for (const cursor of cursors) {
      const position = cursor.position;
      
      // If there's a selection, delete it first
      if (cursor.selection) {
        const range = this.getOrderedSelection(cursor.selection);
        const deleted = this._buffer.deleteRange(range.start, range.end);
        operations.push({
          type: 'delete',
          position: clonePosition(range.start),
          text: deleted
        });
        // Update cursor position to start of selection
        cursor.position = clonePosition(range.start);
        cursor.selection = null;
      }

      // Insert the text
      this._buffer.insertAt(cursor.position, text);
      operations.push({
        type: 'insert',
        position: clonePosition(cursor.position),
        text
      });

      // Move cursor after inserted text
      const newPosition = this._buffer.offsetToPosition(
        this._buffer.positionToOffset(cursor.position) + text.length
      );
      cursor.position = newPosition;
      cursor.desiredColumn = newPosition.column;
    }

    this._undoManager.push({
      operations,
      cursorsBefore,
      cursorsAfter: this._cursorManager.getSnapshot()
    });

    this.markDirty();
  }

  /**
   * Delete text (backspace behavior)
   */
  backspace(): void {
    // Capture cursor state BEFORE any modifications
    const cursorsBefore = this._cursorManager.getSnapshot();
    
    const cursors = [...this.cursors].sort((a, b) => {
      const aOffset = this._buffer.positionToOffset(a.position);
      const bOffset = this._buffer.positionToOffset(b.position);
      return bOffset - aOffset;
    });

    const operations: EditOperation[] = [];

    for (const cursor of cursors) {
      if (cursor.selection) {
        // Delete selection
        const range = this.getOrderedSelection(cursor.selection);
        const deleted = this._buffer.deleteRange(range.start, range.end);
        operations.push({
          type: 'delete',
          position: clonePosition(range.start),
          text: deleted
        });
        cursor.position = clonePosition(range.start);
        cursor.selection = null;
      } else {
        // Delete character before cursor
        const offset = this._buffer.positionToOffset(cursor.position);
        if (offset > 0) {
          const startOffset = offset - 1;
          const startPos = this._buffer.offsetToPosition(startOffset);
          const deleted = this._buffer.delete(startOffset, offset);
          operations.push({
            type: 'delete',
            position: clonePosition(startPos),
            text: deleted
          });
          cursor.position = clonePosition(startPos);
        }
      }
      cursor.desiredColumn = cursor.position.column;
    }

    if (operations.length > 0) {
      this._undoManager.push({
        operations,
        cursorsBefore,
        cursorsAfter: this._cursorManager.getSnapshot()
      });
      this.markDirty();
    }
  }

  /**
   * Delete text (delete key behavior)
   */
  delete(): void {
    // Capture cursor state BEFORE any modifications
    const cursorsBefore = this._cursorManager.getSnapshot();
    
    const cursors = [...this.cursors].sort((a, b) => {
      const aOffset = this._buffer.positionToOffset(a.position);
      const bOffset = this._buffer.positionToOffset(b.position);
      return bOffset - aOffset;
    });

    const operations: EditOperation[] = [];

    for (const cursor of cursors) {
      if (cursor.selection) {
        // Delete selection
        const range = this.getOrderedSelection(cursor.selection);
        const deleted = this._buffer.deleteRange(range.start, range.end);
        operations.push({
          type: 'delete',
          position: clonePosition(range.start),
          text: deleted
        });
        cursor.position = clonePosition(range.start);
        cursor.selection = null;
      } else {
        // Delete character after cursor
        const offset = this._buffer.positionToOffset(cursor.position);
        if (offset < this._buffer.length) {
          const deleted = this._buffer.delete(offset, offset + 1);
          operations.push({
            type: 'delete',
            position: clonePosition(cursor.position),
            text: deleted
          });
        }
      }
      cursor.desiredColumn = cursor.position.column;
    }

    if (operations.length > 0) {
      this._undoManager.push({
        operations,
        cursorsBefore,
        cursorsAfter: this._cursorManager.getSnapshot()
      });
      this.markDirty();
    }
  }

  /**
   * Insert a newline with smart indentation
   */
  newline(): void {
    const autoIndent = settings.get('editor.autoIndent');
    const tabSize = settings.get('editor.tabSize');
    const insertSpaces = settings.get('editor.insertSpaces');
    
    // If auto-indent is disabled, just insert newline
    if (autoIndent === 'none') {
      this.insert('\n');
      return;
    }
    
    // Get context for smart indentation
    const cursor = this.primaryCursor;
    const currentLine = cursor.position.line;
    const currentColumn = cursor.position.column;
    const lineContent = this.getLine(currentLine);
    
    // Get character before and after cursor
    const charBefore = currentColumn > 0 ? lineContent[currentColumn - 1] : undefined;
    const charAfter = currentColumn < lineContent.length ? lineContent[currentColumn] : undefined;
    
    // Calculate indentation
    const indentOptions: IndentOptions = { tabSize, insertSpaces, autoIndent };
    const result = calculateNewLineIndent(lineContent, charBefore, charAfter, indentOptions);
    
    if (result.extraLine !== undefined) {
      // Between brackets: insert newline + indent + newline + base indent
      // Cursor ends up on the indented middle line
      this.insert('\n' + result.indent + '\n' + result.extraLine);
      
      // Move cursor back to the middle line
      const newLine = currentLine + 1;
      const newCol = result.indent.length;
      this._cursorManager.setCursor({ line: newLine, column: newCol });
    } else {
      // Normal case: insert newline + indent
      this.insert('\n' + result.indent);
    }
  }

  /**
   * Insert a character with smart dedent for closing brackets
   */
  insertWithAutoDedent(char: string): void {
    const autoIndent = settings.get('editor.autoIndent');
    
    // If not full auto-indent, just insert normally
    if (autoIndent !== 'full') {
      this.insert(char);
      return;
    }
    
    const cursor = this.primaryCursor;
    const currentLine = cursor.position.line;
    const currentColumn = cursor.position.column;
    const lineContent = this.getLine(currentLine);
    const lineBeforeCursor = lineContent.slice(0, currentColumn);
    
    // Check if we should dedent
    if (shouldDedentOnChar(lineBeforeCursor, char)) {
      // Get all lines for bracket matching
      const lines: string[] = [];
      for (let i = 0; i < this.lineCount; i++) {
        lines.push(this.getLine(i));
      }
      
      // Find matching bracket indent
      const matchingIndent = findMatchingBracketIndent(lines, currentLine, char);
      
      if (matchingIndent !== null) {
        // Replace the current line's whitespace with the matching indent + character
        const currentIndent = getLeadingWhitespace(lineContent);
        
        if (currentIndent !== matchingIndent) {
          // Select from start of line to cursor position and replace
          const startOfLine: Position = { line: currentLine, column: 0 };
          
          // Set cursor position and create selection
          cursor.position = { line: currentLine, column: currentColumn };
          cursor.selection = {
            anchor: startOfLine,
            head: { line: currentLine, column: currentColumn }
          };
          
          // Replace selection with matching indent + character
          this.insert(matchingIndent + char);
          return;
        }
      }
    }
    
    // Normal insert
    this.insert(char);
  }

  /**
   * Get selected text from primary cursor
   */
  getSelectedText(): string {
    const cursor = this.primaryCursor;
    if (!cursor.selection) return '';
    
    const range = this.getOrderedSelection(cursor.selection);
    return this._buffer.getRangeByPosition(range.start, range.end);
  }

  /**
   * Get all selected texts
   */
  getAllSelectedTexts(): string[] {
    return this.cursors
      .filter(c => c.selection)
      .map(c => {
        const range = this.getOrderedSelection(c.selection!);
        return this._buffer.getRangeByPosition(range.start, range.end);
      });
  }

  // Undo/Redo

  undo(): void {
    const action = this._undoManager.undo();
    if (!action) return;

    // Apply operations in reverse
    for (let i = action.operations.length - 1; i >= 0; i--) {
      const op = action.operations[i]!;
      if (op.type === 'insert') {
        // Undo insert by deleting
        const startOffset = this._buffer.positionToOffset(op.position);
        this._buffer.delete(startOffset, startOffset + op.text.length);
      } else {
        // Undo delete by inserting
        this._buffer.insertAt(op.position, op.text);
      }
    }

    this._cursorManager.restoreSnapshot(action.cursorsBefore);
    this.updateDirtyState();
  }

  redo(): void {
    const action = this._undoManager.redo();
    if (!action) return;

    // Apply operations forward
    for (const op of action.operations) {
      if (op.type === 'insert') {
        this._buffer.insertAt(op.position, op.text);
      } else {
        const startOffset = this._buffer.positionToOffset(op.position);
        this._buffer.delete(startOffset, startOffset + op.text.length);
      }
    }

    this._cursorManager.restoreSnapshot(action.cursorsAfter);
    this.updateDirtyState();
  }

  // Cursor movement helpers

  /**
   * Move cursor left
   */
  moveLeft(selecting: boolean = false): void {
    this._cursorManager.moveCursors((cursor) => {
      const offset = this._buffer.positionToOffset(cursor.position);
      if (offset > 0) {
        return this._buffer.offsetToPosition(offset - 1);
      }
      return cursor.position;
    }, selecting);
    this._cursorManager.updateDesiredColumn();
  }

  /**
   * Move cursor right
   */
  moveRight(selecting: boolean = false): void {
    this._cursorManager.moveCursors((cursor) => {
      const offset = this._buffer.positionToOffset(cursor.position);
      if (offset < this._buffer.length) {
        return this._buffer.offsetToPosition(offset + 1);
      }
      return cursor.position;
    }, selecting);
    this._cursorManager.updateDesiredColumn();
  }

  /**
   * Move cursor up
   */
  moveUp(selecting: boolean = false): void {
    this._cursorManager.moveCursors((cursor) => {
      if (cursor.position.line > 0) {
        const newLine = cursor.position.line - 1;
        const lineLength = this._buffer.getLineLength(newLine);
        return {
          line: newLine,
          column: Math.min(cursor.desiredColumn, lineLength)
        };
      }
      return cursor.position;
    }, selecting);
  }

  /**
   * Move cursor down
   */
  moveDown(selecting: boolean = false): void {
    this._cursorManager.moveCursors((cursor) => {
      if (cursor.position.line < this._buffer.lineCount - 1) {
        const newLine = cursor.position.line + 1;
        const lineLength = this._buffer.getLineLength(newLine);
        return {
          line: newLine,
          column: Math.min(cursor.desiredColumn, lineLength)
        };
      }
      return cursor.position;
    }, selecting);
  }

  /**
   * Move cursor up by page (multiple lines)
   */
  movePageUp(pageSize: number, selecting: boolean = false): void {
    this._cursorManager.moveCursors((cursor) => {
      const newLine = Math.max(0, cursor.position.line - pageSize);
      const lineLength = this._buffer.getLineLength(newLine);
      return {
        line: newLine,
        column: Math.min(cursor.desiredColumn, lineLength)
      };
    }, selecting);
  }

  /**
   * Move cursor down by page (multiple lines)
   */
  movePageDown(pageSize: number, selecting: boolean = false): void {
    this._cursorManager.moveCursors((cursor) => {
      const newLine = Math.min(this._buffer.lineCount - 1, cursor.position.line + pageSize);
      const lineLength = this._buffer.getLineLength(newLine);
      return {
        line: newLine,
        column: Math.min(cursor.desiredColumn, lineLength)
      };
    }, selecting);
  }

  /**
   * Move cursor to line start
   */
  moveToLineStart(selecting: boolean = false): void {
    this._cursorManager.moveCursors((cursor) => ({
      line: cursor.position.line,
      column: 0
    }), selecting);
    this._cursorManager.updateDesiredColumn();
  }

  /**
   * Move cursor to line end
   */
  moveToLineEnd(selecting: boolean = false): void {
    this._cursorManager.moveCursors((cursor) => ({
      line: cursor.position.line,
      column: this._buffer.getLineLength(cursor.position.line)
    }), selecting);
    this._cursorManager.updateDesiredColumn();
  }

  /**
   * Move cursor to document start
   */
  moveToDocumentStart(selecting: boolean = false): void {
    this._cursorManager.moveCursors(() => ({ line: 0, column: 0 }), selecting);
    this._cursorManager.updateDesiredColumn();
  }

  /**
   * Move cursor to document end
   */
  moveToDocumentEnd(selecting: boolean = false): void {
    this._cursorManager.moveCursors(() => {
      const lastLine = Math.max(0, this._buffer.lineCount - 1);
      return {
        line: lastLine,
        column: this._buffer.getLineLength(lastLine)
      };
    }, selecting);
    this._cursorManager.updateDesiredColumn();
  }

  /**
   * Move cursor to next word
   */
  moveWordRight(selecting: boolean = false): void {
    this._cursorManager.moveCursors((cursor) => {
      const content = this._buffer.getContent();
      let offset = this._buffer.positionToOffset(cursor.position);
      
      // Skip current word characters
      while (offset < content.length && this.isWordChar(content[offset]!)) {
        offset++;
      }
      // Skip whitespace
      while (offset < content.length && !this.isWordChar(content[offset]!)) {
        offset++;
      }
      
      return this._buffer.offsetToPosition(offset);
    }, selecting);
    this._cursorManager.updateDesiredColumn();
  }

  /**
   * Move cursor to previous word
   */
  moveWordLeft(selecting: boolean = false): void {
    this._cursorManager.moveCursors((cursor) => {
      const content = this._buffer.getContent();
      let offset = this._buffer.positionToOffset(cursor.position);
      
      if (offset > 0) offset--;
      
      // Skip whitespace
      while (offset > 0 && !this.isWordChar(content[offset]!)) {
        offset--;
      }
      // Skip word characters
      while (offset > 0 && this.isWordChar(content[offset - 1]!)) {
        offset--;
      }
      
      return this._buffer.offsetToPosition(offset);
    }, selecting);
    this._cursorManager.updateDesiredColumn();
  }

  /**
   * Select all content
   */
  selectAll(): void {
    const lastLine = Math.max(0, this._buffer.lineCount - 1);
    const endPosition = {
      line: lastLine,
      column: this._buffer.getLineLength(lastLine)
    };
    this._cursorManager.selectAll(endPosition);
  }

  /**
   * Select current line
   */
  selectLine(): void {
    const cursor = this.primaryCursor;
    const lineStart: Position = { line: cursor.position.line, column: 0 };
    const lineEnd: Position = {
      line: cursor.position.line,
      column: this._buffer.getLineLength(cursor.position.line)
    };
    
    this._cursorManager.setSelections([{
      anchor: lineStart,
      head: lineEnd
    }]);
  }

  /**
   * Outdent current line or selection
   */
  outdent(): void {
    for (const cursor of this._cursorManager.getMutableCursors()) {
      const line = cursor.position.line;
      const lineContent = this._buffer.getLine(line);
      
      // Find indentation to remove
      let removeCount = 0;
      if (lineContent.startsWith('\t')) {
        removeCount = 1;
      } else {
        // Remove up to tabSize spaces
        const tabSize = 2;  // TODO: get from settings
        for (let i = 0; i < tabSize && i < lineContent.length; i++) {
          if (lineContent[i] === ' ') {
            removeCount++;
          } else {
            break;
          }
        }
      }
      
      if (removeCount > 0) {
        this._buffer.deleteRange(
          { line, column: 0 },
          { line, column: removeCount }
        );
        this.markDirty();
        
        // Adjust cursor
        cursor.position.column = Math.max(0, cursor.position.column - removeCount);
      }
    }
  }

  /**
   * Select next occurrence of selected text (Cmd+D behavior)
   */
  selectNextOccurrence(): void {
    const primaryCursor = this._cursorManager.getPrimaryCursor();
    
    // If no selection, select word at cursor
    if (!primaryCursor.selection || 
        (primaryCursor.selection.anchor.line === primaryCursor.selection.head.line &&
         primaryCursor.selection.anchor.column === primaryCursor.selection.head.column)) {
      this.selectWordAtCursor();
      return;
    }
    
    // Get selected text
    const selectedText = this.getSelectedText();
    if (!selectedText) return;
    
    // Find next occurrence after the last cursor
    const content = this._buffer.getContent();
    const lastCursor = this._cursorManager.getMutableCursors()[this._cursorManager.getMutableCursors().length - 1]!;
    const startOffset = this._buffer.positionToOffset(lastCursor.selection?.head || lastCursor.position);
    
    let nextIndex = content.indexOf(selectedText, startOffset);
    if (nextIndex === -1) {
      // Wrap around to beginning
      nextIndex = content.indexOf(selectedText);
    }
    
    // Skip if we found the current selection
    const firstCursor = this._cursorManager.getMutableCursors()[0]!;
    const firstSelectionStart = this._buffer.positionToOffset(
      firstCursor.selection?.anchor || firstCursor.position
    );
    if (nextIndex === firstSelectionStart && this._cursorManager.getMutableCursors().length === 1) {
      // We only have one cursor and found the same word - search again from after it
      nextIndex = content.indexOf(selectedText, startOffset);
      if (nextIndex === -1 || nextIndex === firstSelectionStart) {
        // No other occurrence found
        return;
      }
    }
    
    if (nextIndex !== -1) {
      const nextStart = this._buffer.offsetToPosition(nextIndex);
      const nextEnd = this._buffer.offsetToPosition(nextIndex + selectedText.length);
      
      // Check if we already have a cursor at this position
      const alreadySelected = this._cursorManager.getMutableCursors().some(c => 
        c.selection &&
        c.selection.anchor.line === nextStart.line &&
        c.selection.anchor.column === nextStart.column
      );
      
      if (!alreadySelected) {
        this._cursorManager.addCursorWithSelection(nextStart, nextEnd);
      }
    }
  }

  /**
   * Select all occurrences of selected text
   */
  selectAllOccurrences(): void {
    const primaryCursor = this._cursorManager.getPrimaryCursor();
    
    // If no selection, select word at cursor first
    if (!primaryCursor.selection || 
        (primaryCursor.selection.anchor.line === primaryCursor.selection.head.line &&
         primaryCursor.selection.anchor.column === primaryCursor.selection.head.column)) {
      this.selectWordAtCursor();
    }
    
    // Get selected text
    const selectedText = this.getSelectedText();
    if (!selectedText) return;
    
    // Find all occurrences
    const content = this._buffer.getContent();
    let index = 0;
    const occurrences: { start: Position; end: Position }[] = [];
    
    while ((index = content.indexOf(selectedText, index)) !== -1) {
      const start = this._buffer.offsetToPosition(index);
      const end = this._buffer.offsetToPosition(index + selectedText.length);
      occurrences.push({ start, end });
      index += selectedText.length;
    }
    
    if (occurrences.length <= 1) return;
    
    // Clear existing cursors and add one for each occurrence
    this._cursorManager.clearSecondary();
    
    // Set the first occurrence as primary cursor
    const first = occurrences[0]!;
    const primary = this._cursorManager.getPrimaryCursor();
    primary.position = { ...first.end };
    primary.selection = {
      anchor: { ...first.start },
      head: { ...first.end }
    };
    
    // Add cursors for remaining occurrences
    for (let i = 1; i < occurrences.length; i++) {
      const occ = occurrences[i]!;
      this._cursorManager.addCursorWithSelection(occ.start, occ.end);
    }
  }

  /**
   * Select word at cursor position
   */
  private selectWordAtCursor(): void {
    const cursor = this._cursorManager.getPrimaryCursor();
    const line = this._buffer.getLine(cursor.position.line);
    let start = cursor.position.column;
    let end = cursor.position.column;
    
    // Expand to word boundaries
    while (start > 0 && this.isWordChar(line[start - 1]!)) {
      start--;
    }
    while (end < line.length && this.isWordChar(line[end]!)) {
      end++;
    }
    
    if (start < end) {
      cursor.selection = {
        anchor: { line: cursor.position.line, column: start },
        head: { line: cursor.position.line, column: end }
      };
      cursor.position = { line: cursor.position.line, column: end };
    }
  }

  /**
   * Add cursor above current position
   */
  addCursorAbove(): void {
    const primaryCursor = this._cursorManager.getPrimaryCursor();
    if (primaryCursor.position.line > 0) {
      const newLine = primaryCursor.position.line - 1;
      const newColumn = Math.min(
        primaryCursor.position.column,
        this._buffer.getLineLength(newLine)
      );
      this._cursorManager.addCursor({ line: newLine, column: newColumn });
    }
  }

  /**
   * Add cursor below current position
   */
  addCursorBelow(): void {
    const primaryCursor = this._cursorManager.getPrimaryCursor();
    if (primaryCursor.position.line < this._buffer.lineCount - 1) {
      const newLine = primaryCursor.position.line + 1;
      const newColumn = Math.min(
        primaryCursor.position.column,
        this._buffer.getLineLength(newLine)
      );
      this._cursorManager.addCursor({ line: newLine, column: newColumn });
    }
  }

  /**
   * Split selection into lines (put cursor on each line)
   */
  splitSelectionIntoLines(): void {
    const primaryCursor = this._cursorManager.getPrimaryCursor();
    if (!primaryCursor.selection) return;
    
    const { anchor, head } = primaryCursor.selection;
    const startLine = Math.min(anchor.line, head.line);
    const endLine = Math.max(anchor.line, head.line);
    
    if (startLine === endLine) return;
    
    // Clear current cursors and create one per line
    const newCursors: { position: Position; selection?: Selection }[] = [];
    
    for (let line = startLine; line <= endLine; line++) {
      const lineLength = this._buffer.getLineLength(line);
      let selStart: number;
      let selEnd: number;
      
      if (line === startLine) {
        selStart = anchor.line < head.line ? anchor.column : head.column;
        selEnd = lineLength;
      } else if (line === endLine) {
        selStart = 0;
        selEnd = anchor.line > head.line ? anchor.column : head.column;
      } else {
        selStart = 0;
        selEnd = lineLength;
      }
      
      newCursors.push({
        position: { line, column: selEnd },
        selection: {
          anchor: { line, column: selStart },
          head: { line, column: selEnd }
        }
      });
    }
    
    // Set the new cursors
    this._cursorManager.clearSecondary();
    if (newCursors.length > 0) {
      const first = newCursors[0]!;
      this._cursorManager.setPosition(first.position);
      if (first.selection) {
        this._cursorManager.getPrimaryCursor().selection = first.selection;
      }
      
      for (let i = 1; i < newCursors.length; i++) {
        const c = newCursors[i]!;
        if (c.selection) {
          this._cursorManager.addCursorWithSelection(c.selection.anchor, c.selection.head);
        } else {
          this._cursorManager.addCursor(c.position);
        }
      }
    }
  }

  // Private helpers

  private getOrderedSelection(selection: Selection): Range {
    const { anchor, head } = selection;
    const anchorOffset = this._buffer.positionToOffset(anchor);
    const headOffset = this._buffer.positionToOffset(head);
    
    if (anchorOffset <= headOffset) {
      return { start: anchor, end: head };
    } else {
      return { start: head, end: anchor };
    }
  }

  private markDirty(): void {
    this._isDirty = true;
  }

  private updateDirtyState(): void {
    this._isDirty = this._buffer.getContent() !== this._savedContent;
  }

  private isWordChar(char: string): boolean {
    return /[\w]/.test(char);
  }

  private extractFileName(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1] || 'Untitled';
  }

  private detectLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    
    const languageMap: Record<string, string> = {
      'ts': 'typescript',
      'tsx': 'typescriptreact',
      'js': 'javascript',
      'jsx': 'javascriptreact',
      'json': 'json',
      'md': 'markdown',
      'py': 'python',
      'rb': 'ruby',
      'rs': 'rust',
      'go': 'go',
      'c': 'c',
      'cpp': 'cpp',
      'h': 'c',
      'hpp': 'cpp',
      'java': 'java',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'yaml': 'yaml',
      'yml': 'yaml',
      'toml': 'toml',
      'sh': 'shellscript',
      'bash': 'shellscript',
      'zsh': 'shellscript'
    };

    return ext ? languageMap[ext] || 'plaintext' : 'plaintext';
  }
}

export default Document;
