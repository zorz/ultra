/**
 * Piece Table Buffer Implementation
 *
 * A piece table is an efficient data structure for text editors that stores:
 * - Original content (immutable)
 * - Added content (append-only)
 * - A list of "pieces" that reference spans in either buffer
 *
 * This allows O(1) insert/delete operations on average, with efficient undo/redo.
 *
 * ## Version Tracking (Performance Optimization)
 *
 * The buffer maintains a `_version` counter that increments on every modification.
 * This enables O(1) change detection instead of O(n) content string comparison.
 *
 * **Why this matters:** Components like EditorContent need to detect content changes
 * to invalidate caches (syntax highlighting, fold regions, etc.). Previously this
 * was done by comparing full content strings, which is O(n) where n = file size.
 * For large files (500+ lines), this caused jerky scrolling because every render
 * frame triggered expensive string comparisons.
 *
 * **Usage:** Compare `buffer.version` (or `document.version`) instead of comparing
 * content strings when checking if content has changed since last render/operation.
 *
 * @see EditorContent - uses version for fold/syntax cache invalidation
 */

export interface Position {
  line: number;    // 0-indexed line number
  column: number;  // 0-indexed column (character offset within line)
}

export interface Range {
  start: Position;
  end: Position;
}

interface Piece {
  source: 'original' | 'add';
  start: number;   // Start offset in the source buffer
  length: number;  // Length of this piece
}

interface LineInfo {
  pieceIndex: number;
  offsetInPiece: number;
  lineStartOffset: number;  // Absolute offset from start of document
}

export class Buffer {
  private originalBuffer: string;
  private addBuffer: string;
  private pieces: Piece[];
  private lineCache: LineInfo[] | null = null;
  private _length: number = 0;

  /**
   * Version counter for O(1) change detection.
   * Increments on every buffer modification (insert, delete, restore).
   * Use this instead of comparing content strings to detect changes.
   */
  private _version: number = 0;

  constructor(initialContent: string = '') {
    this.originalBuffer = initialContent;
    this.addBuffer = '';
    
    if (initialContent.length > 0) {
      this.pieces = [{
        source: 'original',
        start: 0,
        length: initialContent.length
      }];
      this._length = initialContent.length;
    } else {
      this.pieces = [];
      this._length = 0;
    }
    
    this.invalidateLineCache();
  }

  /**
   * Get total length of the buffer content
   */
  get length(): number {
    return this._length;
  }

  /**
   * Get the number of lines in the buffer
   */
  get lineCount(): number {
    this.ensureLineCache();
    return this.lineCache!.length;
  }

  /**
   * Get the buffer version number.
   * This increments on every modification and can be used for O(1) change detection.
   * Compare versions instead of content strings to check if buffer has changed.
   */
  get version(): number {
    return this._version;
  }

  /**
   * Get the full content of the buffer
   */
  getContent(): string {
    let result = '';
    for (const piece of this.pieces) {
      const source = piece.source === 'original' ? this.originalBuffer : this.addBuffer;
      result += source.slice(piece.start, piece.start + piece.length);
    }
    return result;
  }

  /**
   * Get content of a specific line (without line ending)
   */
  getLine(lineNumber: number): string {
    this.ensureLineCache();
    
    if (lineNumber < 0 || lineNumber >= this.lineCache!.length) {
      return '';
    }
    
    const lineStart = this.getLineStartOffset(lineNumber);
    const lineEnd = lineNumber + 1 < this.lineCache!.length 
      ? this.getLineStartOffset(lineNumber + 1) - 1  // -1 to exclude newline
      : this._length;
    
    return this.getRange(lineStart, lineEnd);
  }

  /**
   * Get content in a range specified by absolute offsets
   */
  getRange(start: number, end: number): string {
    if (start >= end || start < 0 || end > this._length) {
      if (start >= this._length) return '';
      end = Math.min(end, this._length);
    }

    let result = '';
    let currentOffset = 0;

    for (const piece of this.pieces) {
      const pieceEnd = currentOffset + piece.length;
      
      if (pieceEnd <= start) {
        currentOffset = pieceEnd;
        continue;
      }
      
      if (currentOffset >= end) {
        break;
      }

      const source = piece.source === 'original' ? this.originalBuffer : this.addBuffer;
      const sliceStart = Math.max(0, start - currentOffset);
      const sliceEnd = Math.min(piece.length, end - currentOffset);
      
      result += source.slice(piece.start + sliceStart, piece.start + sliceEnd);
      currentOffset = pieceEnd;
    }

    return result;
  }

  /**
   * Get content in a range specified by Position objects
   */
  getRangeByPosition(start: Position, end: Position): string {
    const startOffset = this.positionToOffset(start);
    const endOffset = this.positionToOffset(end);
    return this.getRange(startOffset, endOffset);
  }

  /**
   * Insert text at a specific offset
   */
  insert(offset: number, text: string): void {
    if (text.length === 0) return;
    if (offset < 0) offset = 0;
    if (offset > this._length) offset = this._length;

    // Add text to add buffer
    const addStart = this.addBuffer.length;
    this.addBuffer += text;

    const newPiece: Piece = {
      source: 'add',
      start: addStart,
      length: text.length
    };

    // Find the piece containing the offset
    let currentOffset = 0;
    let pieceIndex = 0;

    for (; pieceIndex < this.pieces.length; pieceIndex++) {
      const piece = this.pieces[pieceIndex]!;
      if (currentOffset + piece.length >= offset) {
        break;
      }
      currentOffset += piece.length;
    }

    if (pieceIndex >= this.pieces.length) {
      // Insert at end
      this.pieces.push(newPiece);
    } else {
      const piece = this.pieces[pieceIndex]!;
      const offsetInPiece = offset - currentOffset;

      if (offsetInPiece === 0) {
        // Insert before this piece
        this.pieces.splice(pieceIndex, 0, newPiece);
      } else if (offsetInPiece === piece.length) {
        // Insert after this piece
        this.pieces.splice(pieceIndex + 1, 0, newPiece);
      } else {
        // Split the piece
        const beforePiece: Piece = {
          source: piece.source,
          start: piece.start,
          length: offsetInPiece
        };
        const afterPiece: Piece = {
          source: piece.source,
          start: piece.start + offsetInPiece,
          length: piece.length - offsetInPiece
        };
        this.pieces.splice(pieceIndex, 1, beforePiece, newPiece, afterPiece);
      }
    }

    this._length += text.length;
    this.invalidateLineCache();
  }

  /**
   * Insert text at a specific position
   */
  insertAt(position: Position, text: string): void {
    const offset = this.positionToOffset(position);
    this.insert(offset, text);
  }

  /**
   * Delete text in a range specified by offsets
   */
  delete(start: number, end: number): string {
    if (start >= end || start < 0) return '';
    if (end > this._length) end = this._length;
    if (start >= this._length) return '';

    const deletedText = this.getRange(start, end);

    // Find and modify pieces affected by deletion
    let currentOffset = 0;
    let newPieces: Piece[] = [];

    for (const piece of this.pieces) {
      const pieceStart = currentOffset;
      const pieceEnd = currentOffset + piece.length;

      if (pieceEnd <= start || pieceStart >= end) {
        // Piece is entirely outside deletion range
        newPieces.push(piece);
      } else if (pieceStart >= start && pieceEnd <= end) {
        // Piece is entirely inside deletion range - skip it
      } else if (pieceStart < start && pieceEnd > end) {
        // Deletion is entirely inside this piece - split it
        const beforeLength = start - pieceStart;
        const afterStart = end - pieceStart;
        
        newPieces.push({
          source: piece.source,
          start: piece.start,
          length: beforeLength
        });
        newPieces.push({
          source: piece.source,
          start: piece.start + afterStart,
          length: piece.length - afterStart
        });
      } else if (pieceStart < start) {
        // Deletion starts in this piece
        newPieces.push({
          source: piece.source,
          start: piece.start,
          length: start - pieceStart
        });
      } else {
        // Deletion ends in this piece
        const keepStart = end - pieceStart;
        newPieces.push({
          source: piece.source,
          start: piece.start + keepStart,
          length: piece.length - keepStart
        });
      }

      currentOffset = pieceEnd;
    }

    this.pieces = newPieces;
    this._length -= (end - start);
    this.invalidateLineCache();
    
    return deletedText;
  }

  /**
   * Delete text in a range specified by positions
   */
  deleteRange(start: Position, end: Position): string {
    const startOffset = this.positionToOffset(start);
    const endOffset = this.positionToOffset(end);
    return this.delete(startOffset, endOffset);
  }

  /**
   * Replace text in a range
   */
  replace(start: number, end: number, text: string): string {
    const deleted = this.delete(start, end);
    this.insert(start, text);
    return deleted;
  }

  /**
   * Replace text in a range specified by positions
   */
  replaceRange(start: Position, end: Position, text: string): string {
    const startOffset = this.positionToOffset(start);
    const endOffset = this.positionToOffset(end);
    return this.replace(startOffset, endOffset, text);
  }

  /**
   * Convert a Position to an absolute offset
   */
  positionToOffset(position: Position): number {
    this.ensureLineCache();
    
    const { line, column } = position;
    
    if (line < 0) return 0;
    if (line >= this.lineCache!.length) {
      return this._length;
    }

    const lineStartOffset = this.getLineStartOffset(line);
    const lineLength = this.getLineLength(line);
    
    return lineStartOffset + Math.min(column, lineLength);
  }

  /**
   * Convert an absolute offset to a Position
   */
  offsetToPosition(offset: number): Position {
    this.ensureLineCache();
    
    if (offset <= 0) return { line: 0, column: 0 };
    if (offset >= this._length) {
      const lastLine = Math.max(0, this.lineCache!.length - 1);
      return { line: lastLine, column: this.getLineLength(lastLine) };
    }

    // Binary search for the line
    let low = 0;
    let high = this.lineCache!.length - 1;

    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      const lineStart = this.getLineStartOffset(mid);
      
      if (lineStart <= offset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }

    const lineStart = this.getLineStartOffset(low);
    return { line: low, column: offset - lineStart };
  }

  /**
   * Get the length of a specific line (excluding line ending)
   */
  getLineLength(lineNumber: number): number {
    this.ensureLineCache();
    
    if (lineNumber < 0 || lineNumber >= this.lineCache!.length) {
      return 0;
    }

    const lineStart = this.getLineStartOffset(lineNumber);
    const lineEnd = lineNumber + 1 < this.lineCache!.length
      ? this.getLineStartOffset(lineNumber + 1) - 1  // -1 for newline
      : this._length;

    return Math.max(0, lineEnd - lineStart);
  }

  /**
   * Get the start offset of a line
   */
  private getLineStartOffset(lineNumber: number): number {
    this.ensureLineCache();
    
    if (lineNumber <= 0) return 0;
    if (lineNumber >= this.lineCache!.length) return this._length;
    
    return this.lineCache![lineNumber]!.lineStartOffset;
  }

  /**
   * Invalidate the line cache (call after any modification).
   * Also increments the version counter for change detection.
   */
  private invalidateLineCache(): void {
    this.lineCache = null;
    this._version++;
  }

  /**
   * Build the line cache if needed
   */
  private ensureLineCache(): void {
    if (this.lineCache !== null) return;

    this.lineCache = [];
    let currentOffset = 0;
    let lineStartOffset = 0;

    // First line always starts at 0
    this.lineCache.push({
      pieceIndex: 0,
      offsetInPiece: 0,
      lineStartOffset: 0
    });

    for (let pieceIndex = 0; pieceIndex < this.pieces.length; pieceIndex++) {
      const piece = this.pieces[pieceIndex]!;
      const source = piece.source === 'original' ? this.originalBuffer : this.addBuffer;
      
      for (let i = 0; i < piece.length; i++) {
        const char = source[piece.start + i];
        if (char === '\n') {
          lineStartOffset = currentOffset + i + 1;
          this.lineCache.push({
            pieceIndex,
            offsetInPiece: i + 1,
            lineStartOffset
          });
        }
      }
      
      currentOffset += piece.length;
    }
  }

  /**
   * Clone the buffer state (for undo/redo)
   */
  clone(): Buffer {
    const cloned = new Buffer();
    cloned.originalBuffer = this.originalBuffer;
    cloned.addBuffer = this.addBuffer;
    cloned.pieces = this.pieces.map(p => ({ ...p }));
    cloned._length = this._length;
    return cloned;
  }

  /**
   * Get a serializable snapshot of the buffer state
   */
  getSnapshot(): { pieces: Piece[]; addBuffer: string } {
    return {
      pieces: this.pieces.map(p => ({ ...p })),
      addBuffer: this.addBuffer
    };
  }

  /**
   * Restore from a snapshot
   */
  restoreSnapshot(snapshot: { pieces: Piece[]; addBuffer: string }): void {
    this.pieces = snapshot.pieces.map(p => ({ ...p }));
    this.addBuffer = snapshot.addBuffer;
    this._length = this.pieces.reduce((sum, p) => sum + p.length, 0);
    this.invalidateLineCache();
  }
}

export default Buffer;
