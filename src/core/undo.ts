/**
 * Undo/Redo System
 *
 * Operation-based undo system that tracks individual edit operations
 * rather than full document snapshots. Supports serialization for
 * session persistence.
 */

import type { Position } from './buffer.ts';
import type { Cursor } from './cursor.ts';

export interface EditOperation {
  type: 'insert' | 'delete';
  position: Position;
  text: string;
}

export interface UndoAction {
  operations: EditOperation[];
  cursorsBefore: Cursor[];
  cursorsAfter: Cursor[];
  timestamp?: number;
}

/**
 * Serialized undo state for session persistence.
 */
export interface SerializedUndoState {
  undoStack: UndoAction[];
  redoStack: UndoAction[];
}

export class UndoManager {
  private undoStack: UndoAction[] = [];
  private redoStack: UndoAction[] = [];
  private _maxStackSize: number = 1000;
  private groupTimeout: number = 300; // ms to group operations
  private lastActionTime: number = 0;

  constructor(maxStackSize?: number) {
    if (maxStackSize !== undefined && maxStackSize > 0) {
      this._maxStackSize = maxStackSize;
    }
  }

  /**
   * Get the maximum stack size.
   */
  get maxStackSize(): number {
    return this._maxStackSize;
  }

  /**
   * Set the maximum stack size.
   * If the current stacks exceed the new size, they will be trimmed.
   */
  setMaxStackSize(size: number): void {
    if (size > 0) {
      this._maxStackSize = size;
      // Trim stacks if needed
      while (this.undoStack.length > this._maxStackSize) {
        this.undoStack.shift();
      }
      while (this.redoStack.length > this._maxStackSize) {
        this.redoStack.shift();
      }
    }
  }

  /**
   * Push a new action onto the undo stack
   */
  push(action: UndoAction): void {
    const now = Date.now();
    action.timestamp = now;

    // Try to merge with previous action if recent and same type
    if (this.undoStack.length > 0 && now - this.lastActionTime < this.groupTimeout) {
      const lastAction = this.undoStack[this.undoStack.length - 1]!;
      
      if (this.canMerge(lastAction, action)) {
        this.mergeActions(lastAction, action);
        this.lastActionTime = now;
        return;
      }
    }

    this.undoStack.push(action);
    this.lastActionTime = now;

    // Clear redo stack on new action
    this.redoStack = [];

    // Trim stack if too large
    if (this.undoStack.length > this._maxStackSize) {
      this.undoStack.shift();
    }
  }

  /**
   * Undo the last action
   */
  undo(): UndoAction | null {
    const action = this.undoStack.pop();
    if (!action) return null;

    this.redoStack.push(action);
    return action;
  }

  /**
   * Redo the last undone action
   */
  redo(): UndoAction | null {
    const action = this.redoStack.pop();
    if (!action) return null;

    this.undoStack.push(action);
    return action;
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Check if redo is available
   */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * Start a new undo group (prevents merging with previous)
   */
  breakUndoGroup(): void {
    this.lastActionTime = 0;
  }

  /**
   * Check if two actions can be merged
   */
  private canMerge(existing: UndoAction, incoming: UndoAction): boolean {
    // Only merge single-operation actions
    if (existing.operations.length !== 1 || incoming.operations.length !== 1) {
      return false;
    }

    const existingOp = existing.operations[0]!;
    const incomingOp = incoming.operations[0]!;

    // Only merge same type operations
    if (existingOp.type !== incomingOp.type) {
      return false;
    }

    // Don't merge operations with newlines
    if (existingOp.text.includes('\n') || incomingOp.text.includes('\n')) {
      return false;
    }

    if (existingOp.type === 'insert') {
      // Merge consecutive inserts
      const existingEnd = existingOp.position.column + existingOp.text.length;
      return (
        existingOp.position.line === incomingOp.position.line &&
        existingEnd === incomingOp.position.column
      );
    } else {
      // Merge consecutive deletes (backspace)
      return (
        existingOp.position.line === incomingOp.position.line &&
        (existingOp.position.column === incomingOp.position.column + incomingOp.text.length ||
         existingOp.position.column === incomingOp.position.column)
      );
    }
  }

  /**
   * Merge incoming action into existing action
   */
  private mergeActions(existing: UndoAction, incoming: UndoAction): void {
    const existingOp = existing.operations[0]!;
    const incomingOp = incoming.operations[0]!;

    if (existingOp.type === 'insert') {
      // Append text for inserts
      existingOp.text += incomingOp.text;
    } else {
      // For deletes, prepend text and update position
      if (incomingOp.position.column < existingOp.position.column) {
        existingOp.text = incomingOp.text + existingOp.text;
        existingOp.position = { ...incomingOp.position };
      } else {
        existingOp.text += incomingOp.text;
      }
    }

    // Update cursor state
    existing.cursorsAfter = incoming.cursorsAfter;
    existing.timestamp = incoming.timestamp;
  }

  /**
   * Get undo stack size
   */
  get undoCount(): number {
    return this.undoStack.length;
  }

  /**
   * Get redo stack size
   */
  get redoCount(): number {
    return this.redoStack.length;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Serialization
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Serialize undo state for session persistence.
   * Optionally limits the number of actions to save.
   */
  serialize(maxActions?: number): SerializedUndoState {
    const limit = maxActions ?? this._maxStackSize;

    // Take the most recent actions (from the end of the stack)
    const undoStack =
      this.undoStack.length > limit ? this.undoStack.slice(-limit) : [...this.undoStack];
    const redoStack =
      this.redoStack.length > limit ? this.redoStack.slice(-limit) : [...this.redoStack];

    // Deep clone to avoid mutations affecting the saved state
    return {
      undoStack: undoStack.map((action) => this.cloneAction(action)),
      redoStack: redoStack.map((action) => this.cloneAction(action)),
    };
  }

  /**
   * Restore undo state from serialized data.
   */
  deserialize(state: SerializedUndoState): void {
    // Validate and restore with deep cloning
    this.undoStack = (state.undoStack || []).map((action) => this.cloneAction(action));
    this.redoStack = (state.redoStack || []).map((action) => this.cloneAction(action));

    // Trim if exceeds max size
    while (this.undoStack.length > this._maxStackSize) {
      this.undoStack.shift();
    }
    while (this.redoStack.length > this._maxStackSize) {
      this.redoStack.shift();
    }

    // Reset grouping state
    this.lastActionTime = 0;
  }

  /**
   * Deep clone an undo action.
   */
  private cloneAction(action: UndoAction): UndoAction {
    return {
      operations: action.operations.map((op) => ({
        type: op.type,
        position: { line: op.position.line, column: op.position.column },
        text: op.text,
      })),
      cursorsBefore: action.cursorsBefore.map((c) => ({
        position: { line: c.position.line, column: c.position.column },
        selection: c.selection
          ? {
              anchor: { line: c.selection.anchor.line, column: c.selection.anchor.column },
              head: { line: c.selection.head.line, column: c.selection.head.column },
            }
          : null,
        desiredColumn: c.desiredColumn,
      })),
      cursorsAfter: action.cursorsAfter.map((c) => ({
        position: { line: c.position.line, column: c.position.column },
        selection: c.selection
          ? {
              anchor: { line: c.selection.anchor.line, column: c.selection.anchor.column },
              head: { line: c.selection.head.line, column: c.selection.head.column },
            }
          : null,
        desiredColumn: c.desiredColumn,
      })),
      timestamp: action.timestamp,
    };
  }
}

export default UndoManager;
