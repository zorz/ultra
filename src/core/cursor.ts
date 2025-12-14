/**
 * Cursor and Selection Management
 * 
 * Supports multi-cursor editing with multiple selections.
 * Each cursor has a position and optionally a selection (anchor + head).
 */

import type { Position, Range } from './buffer.ts';

export interface Selection {
  anchor: Position;  // Where selection started
  head: Position;    // Where cursor currently is (selection end)
}

export interface Cursor {
  position: Position;
  selection: Selection | null;
  desiredColumn: number;  // For vertical movement, remembers intended column
}

/**
 * Compare two positions
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
export function comparePositions(a: Position, b: Position): number {
  if (a.line !== b.line) {
    return a.line < b.line ? -1 : 1;
  }
  if (a.column !== b.column) {
    return a.column < b.column ? -1 : 1;
  }
  return 0;
}

/**
 * Check if two positions are equal
 */
export function positionsEqual(a: Position, b: Position): boolean {
  return a.line === b.line && a.column === b.column;
}

/**
 * Get the minimum position
 */
export function minPosition(a: Position, b: Position): Position {
  return comparePositions(a, b) <= 0 ? a : b;
}

/**
 * Get the maximum position
 */
export function maxPosition(a: Position, b: Position): Position {
  return comparePositions(a, b) >= 0 ? a : b;
}

/**
 * Get the ordered range from a selection (start always <= end)
 */
export function getSelectionRange(selection: Selection): Range {
  const start = minPosition(selection.anchor, selection.head);
  const end = maxPosition(selection.anchor, selection.head);
  return { start, end };
}

/**
 * Check if a selection has actual content (not just a cursor position)
 */
export function hasSelection(selection: Selection | null): boolean {
  if (!selection) return false;
  return !positionsEqual(selection.anchor, selection.head);
}

/**
 * Check if two ranges overlap
 */
export function rangesOverlap(a: Range, b: Range): boolean {
  return comparePositions(a.start, b.end) < 0 && comparePositions(b.start, a.end) < 0;
}

/**
 * Check if a position is within a range
 */
export function positionInRange(pos: Position, range: Range): boolean {
  return comparePositions(pos, range.start) >= 0 && comparePositions(pos, range.end) <= 0;
}

/**
 * Clone a position
 */
export function clonePosition(pos: Position): Position {
  return { line: pos.line, column: pos.column };
}

/**
 * Clone a cursor
 */
export function cloneCursor(cursor: Cursor): Cursor {
  return {
    position: clonePosition(cursor.position),
    selection: cursor.selection ? {
      anchor: clonePosition(cursor.selection.anchor),
      head: clonePosition(cursor.selection.head)
    } : null,
    desiredColumn: cursor.desiredColumn
  };
}

export class CursorManager {
  private _cursors: Cursor[];
  private primaryIndex: number = 0;

  constructor() {
    this._cursors = [{
      position: { line: 0, column: 0 },
      selection: null,
      desiredColumn: 0
    }];
  }

  /**
   * Get all cursors (read-only array, but cursor objects can be mutated)
   */
  getCursors(): readonly Cursor[] {
    return this._cursors;
  }

  /**
   * Get mutable reference to all cursors (for internal operations)
   */
  getMutableCursors(): Cursor[] {
    return this._cursors;
  }

  /**
   * Get the primary cursor
   */
  getPrimaryCursor(): Cursor {
    return this._cursors[this.primaryIndex]!;
  }

  /**
   * Get cursor count
   */
  get count(): number {
    return this._cursors.length;
  }

  /**
   * Set cursors to a single position
   */
  setSingle(position: Position): void {
    this._cursors = [{
      position: clonePosition(position),
      selection: null,
      desiredColumn: position.column
    }];
    this.primaryIndex = 0;
  }

  /**
   * Set cursor position with optional selection
   */
  setPosition(position: Position, selecting: boolean = false): void {
    const cursor = this.getPrimaryCursor();
    
    if (selecting) {
      if (!cursor.selection) {
        cursor.selection = {
          anchor: clonePosition(cursor.position),
          head: clonePosition(position)
        };
      } else {
        cursor.selection.head = clonePosition(position);
      }
    } else {
      cursor.selection = null;
    }
    
    cursor.position = clonePosition(position);
    cursor.desiredColumn = position.column;
  }

  /**
   * Add a new cursor at position
   */
  addCursor(position: Position): void {
    // Check if cursor already exists at this position
    const exists = this._cursors.some(c => positionsEqual(c.position, position));
    if (exists) return;

    this._cursors.push({
      position: clonePosition(position),
      selection: null,
      desiredColumn: position.column
    });
    
    // Sort cursors by position
    this.sortCursors();
  }

  /**
   * Add cursor with selection
   */
  addCursorWithSelection(anchor: Position, head: Position): void {
    this._cursors.push({
      position: clonePosition(head),
      selection: {
        anchor: clonePosition(anchor),
        head: clonePosition(head)
      },
      desiredColumn: head.column
    });
    
    this.sortCursors();
  }

  /**
   * Remove all cursors except primary
   */
  clearSecondary(): void {
    const primary = this.getPrimaryCursor();
    this._cursors = [cloneCursor(primary)];
    this.primaryIndex = 0;
  }

  /**
   * Clear all selections
   */
  clearSelections(): void {
    for (const cursor of this._cursors) {
      cursor.selection = null;
    }
  }

  /**
   * Move all cursors by applying a function
   */
  moveCursors(
    mover: (cursor: Cursor) => Position,
    selecting: boolean = false
  ): void {
    for (const cursor of this._cursors) {
      const newPosition = mover(cursor);
      
      if (selecting) {
        if (!cursor.selection) {
          cursor.selection = {
            anchor: clonePosition(cursor.position),
            head: clonePosition(newPosition)
          };
        } else {
          cursor.selection.head = clonePosition(newPosition);
        }
      } else {
        cursor.selection = null;
      }
      
      cursor.position = newPosition;
    }
    
    this.mergeOverlappingCursors();
  }

  /**
   * Update desired column for all cursors (call after horizontal movement)
   */
  updateDesiredColumn(): void {
    for (const cursor of this._cursors) {
      cursor.desiredColumn = cursor.position.column;
    }
  }

  /**
   * Set selection for all cursors
   */
  setSelections(selections: Selection[]): void {
    // Clear all cursors and create new ones from selections
    this._cursors = selections.map(sel => ({
      position: clonePosition(sel.head),
      selection: {
        anchor: clonePosition(sel.anchor),
        head: clonePosition(sel.head)
      },
      desiredColumn: sel.head.column
    }));
    
    if (this._cursors.length === 0) {
      this._cursors = [{
        position: { line: 0, column: 0 },
        selection: null,
        desiredColumn: 0
      }];
    }
    
    this.primaryIndex = 0;
    this.sortCursors();
  }

  /**
   * Select all with a single cursor
   */
  selectAll(endPosition: Position): void {
    this._cursors = [{
      position: clonePosition(endPosition),
      selection: {
        anchor: { line: 0, column: 0 },
        head: clonePosition(endPosition)
      },
      desiredColumn: endPosition.column
    }];
    this.primaryIndex = 0;
  }

  /**
   * Get all selections (for operations that need ranges)
   */
  getSelections(): Range[] {
    return this._cursors.map(cursor => {
      if (cursor.selection && hasSelection(cursor.selection)) {
        return getSelectionRange(cursor.selection);
      }
      // Return zero-width range at cursor position
      return {
        start: clonePosition(cursor.position),
        end: clonePosition(cursor.position)
      };
    });
  }

  /**
   * Get selected text ranges (non-empty selections only)
   */
  getSelectedRanges(): Range[] {
    return this._cursors
      .filter(c => c.selection && hasSelection(c.selection))
      .map(c => getSelectionRange(c.selection!));
  }

  /**
   * Sort cursors by position (top to bottom, left to right)
   */
  private sortCursors(): void {
    this._cursors.sort((a, b) => comparePositions(a.position, b.position));
    this.primaryIndex = 0;
  }

  /**
   * Merge cursors that have overlapping selections or same position
   */
  private mergeOverlappingCursors(): void {
    if (this._cursors.length <= 1) return;
    
    this.sortCursors();
    
    const merged: Cursor[] = [];
    
    for (const cursor of this._cursors) {
      const last = merged[merged.length - 1];
      
      if (!last) {
        merged.push(cursor);
        continue;
      }
      
      // Check if positions are the same
      if (positionsEqual(last.position, cursor.position)) {
        // Merge selections if both have them
        if (last.selection && cursor.selection) {
          const lastRange = getSelectionRange(last.selection);
          const curRange = getSelectionRange(cursor.selection);
          
          // Create merged selection
          last.selection = {
            anchor: minPosition(lastRange.start, curRange.start),
            head: maxPosition(lastRange.end, curRange.end)
          };
          last.position = clonePosition(last.selection.head);
        }
        continue;
      }
      
      // Check for overlapping selections
      if (last.selection && cursor.selection) {
        const lastRange = getSelectionRange(last.selection);
        const curRange = getSelectionRange(cursor.selection);
        
        if (rangesOverlap(lastRange, curRange)) {
          // Merge the selections
          last.selection = {
            anchor: minPosition(lastRange.start, curRange.start),
            head: maxPosition(lastRange.end, curRange.end)
          };
          last.position = clonePosition(last.selection.head);
          continue;
        }
      }
      
      merged.push(cursor);
    }
    
    this._cursors = merged;
    this.primaryIndex = Math.min(this.primaryIndex, this._cursors.length - 1);
  }

  /**
   * Create a snapshot for undo/redo
   */
  getSnapshot(): Cursor[] {
    return this._cursors.map(cloneCursor);
  }

  /**
   * Restore from snapshot
   */
  restoreSnapshot(snapshot: Cursor[]): void {
    this._cursors = snapshot.map(cloneCursor);
    this.primaryIndex = 0;
  }
}

export default CursorManager;
