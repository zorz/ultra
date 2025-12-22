/**
 * TextInput Component
 *
 * Reusable text input handling with cursor management, selection,
 * and standard keyboard navigation. Used by dialogs and other
 * components that need text input.
 */

import type { KeyEvent } from '../../terminal/input.ts';
import { debugLog } from '../../debug.ts';

/**
 * Selection range in text
 */
export interface TextSelection {
  start: number;
  end: number;
}

/**
 * Event emitted when text changes
 */
export interface TextChangeEvent {
  value: string;
  previousValue: string;
  cursorPosition: number;
}

/**
 * Configuration options for TextInput
 */
export interface TextInputOptions {
  /** Initial value */
  initialValue?: string;
  /** Placeholder text shown when empty */
  placeholder?: string;
  /** Maximum length (0 = unlimited) */
  maxLength?: number;
  /** Whether to allow multi-line input */
  multiline?: boolean;
  /** Callback when value changes */
  onChange?: (event: TextChangeEvent) => void;
  /** Callback when Enter is pressed */
  onSubmit?: (value: string) => void;
  /** Callback when Escape is pressed */
  onCancel?: () => void;
}

/**
 * TextInput - Manages text input state and keyboard handling
 *
 * Supports:
 * - Cursor movement (left, right, home, end)
 * - Text editing (insert, delete, backspace)
 * - Selection (shift+arrows, ctrl+a)
 * - Word navigation (ctrl+left/right)
 * - Clipboard operations (ctrl+c/v/x) - when available
 */
export class TextInput {
  private _value: string = '';
  private _cursorPosition: number = 0;
  private _selection: TextSelection | null = null;
  private _placeholder: string = '';
  private _maxLength: number = 0;
  private _multiline: boolean = false;

  // Callbacks
  private onChangeCallback?: (event: TextChangeEvent) => void;
  private onSubmitCallback?: (value: string) => void;
  private onCancelCallback?: () => void;

  constructor(options: TextInputOptions = {}) {
    this._value = options.initialValue || '';
    this._placeholder = options.placeholder || '';
    this._maxLength = options.maxLength || 0;
    this._multiline = options.multiline || false;
    this._cursorPosition = this._value.length;

    this.onChangeCallback = options.onChange;
    this.onSubmitCallback = options.onSubmit;
    this.onCancelCallback = options.onCancel;
  }

  // === Getters ===

  get value(): string {
    return this._value;
  }

  get cursorPosition(): number {
    return this._cursorPosition;
  }

  get selection(): TextSelection | null {
    return this._selection;
  }

  get placeholder(): string {
    return this._placeholder;
  }

  get hasSelection(): boolean {
    return this._selection !== null && this._selection.start !== this._selection.end;
  }

  get selectedText(): string {
    if (!this._selection) return '';
    const start = Math.min(this._selection.start, this._selection.end);
    const end = Math.max(this._selection.start, this._selection.end);
    return this._value.slice(start, end);
  }

  get displayValue(): string {
    return this._value || this._placeholder;
  }

  get isEmpty(): boolean {
    return this._value.length === 0;
  }

  // === Setters ===

  setValue(value: string): void {
    const previousValue = this._value;
    this._value = this._maxLength > 0 ? value.slice(0, this._maxLength) : value;
    this._cursorPosition = Math.min(this._cursorPosition, this._value.length);
    this.clearSelection();
    this.emitChange(previousValue);
  }

  setPlaceholder(placeholder: string): void {
    this._placeholder = placeholder;
  }

  setCursorPosition(position: number): void {
    this._cursorPosition = Math.max(0, Math.min(position, this._value.length));
    this.clearSelection();
  }

  // === Text Manipulation ===

  /**
   * Insert text at cursor position (or replace selection)
   */
  insert(text: string): void {
    const previousValue = this._value;

    if (this.hasSelection) {
      this.deleteSelection();
    }

    // Check max length
    if (this._maxLength > 0) {
      const availableSpace = this._maxLength - this._value.length;
      text = text.slice(0, availableSpace);
    }

    if (text.length === 0) return;

    this._value =
      this._value.slice(0, this._cursorPosition) +
      text +
      this._value.slice(this._cursorPosition);
    this._cursorPosition += text.length;

    this.emitChange(previousValue);
    this.debugLog(`Inserted "${text}", cursor at ${this._cursorPosition}`);
  }

  /**
   * Append a single character
   */
  appendChar(char: string): void {
    this.insert(char);
  }

  /**
   * Delete character before cursor (backspace)
   */
  backspace(): void {
    if (this.hasSelection) {
      this.deleteSelection();
      return;
    }

    if (this._cursorPosition > 0) {
      const previousValue = this._value;
      this._value =
        this._value.slice(0, this._cursorPosition - 1) +
        this._value.slice(this._cursorPosition);
      this._cursorPosition--;
      this.emitChange(previousValue);
    }
  }

  /**
   * Delete character at cursor (delete key)
   */
  delete(): void {
    if (this.hasSelection) {
      this.deleteSelection();
      return;
    }

    if (this._cursorPosition < this._value.length) {
      const previousValue = this._value;
      this._value =
        this._value.slice(0, this._cursorPosition) +
        this._value.slice(this._cursorPosition + 1);
      this.emitChange(previousValue);
    }
  }

  /**
   * Delete the selected text
   */
  private deleteSelection(): void {
    if (!this._selection) return;

    const start = Math.min(this._selection.start, this._selection.end);
    const end = Math.max(this._selection.start, this._selection.end);
    const previousValue = this._value;

    this._value = this._value.slice(0, start) + this._value.slice(end);
    this._cursorPosition = start;
    this.clearSelection();
    this.emitChange(previousValue);
  }

  /**
   * Delete word before cursor (ctrl+backspace)
   */
  deleteWordBefore(): void {
    if (this.hasSelection) {
      this.deleteSelection();
      return;
    }

    const wordStart = this.findWordBoundary('left');
    if (wordStart < this._cursorPosition) {
      const previousValue = this._value;
      this._value = this._value.slice(0, wordStart) + this._value.slice(this._cursorPosition);
      this._cursorPosition = wordStart;
      this.emitChange(previousValue);
    }
  }

  /**
   * Delete word after cursor (ctrl+delete)
   */
  deleteWordAfter(): void {
    if (this.hasSelection) {
      this.deleteSelection();
      return;
    }

    const wordEnd = this.findWordBoundary('right');
    if (wordEnd > this._cursorPosition) {
      const previousValue = this._value;
      this._value = this._value.slice(0, this._cursorPosition) + this._value.slice(wordEnd);
      this.emitChange(previousValue);
    }
  }

  /**
   * Clear all text
   */
  clear(): void {
    const previousValue = this._value;
    this._value = '';
    this._cursorPosition = 0;
    this.clearSelection();
    this.emitChange(previousValue);
  }

  // === Cursor Movement ===

  /**
   * Move cursor left
   */
  moveLeft(select: boolean = false): void {
    if (select) {
      this.extendSelection('left');
    } else {
      if (this.hasSelection) {
        this._cursorPosition = Math.min(this._selection!.start, this._selection!.end);
        this.clearSelection();
      } else if (this._cursorPosition > 0) {
        this._cursorPosition--;
      }
    }
  }

  /**
   * Move cursor right
   */
  moveRight(select: boolean = false): void {
    if (select) {
      this.extendSelection('right');
    } else {
      if (this.hasSelection) {
        this._cursorPosition = Math.max(this._selection!.start, this._selection!.end);
        this.clearSelection();
      } else if (this._cursorPosition < this._value.length) {
        this._cursorPosition++;
      }
    }
  }

  /**
   * Move cursor to start of line/input
   */
  moveToStart(select: boolean = false): void {
    if (select) {
      this.setSelection(this._cursorPosition, 0);
    } else {
      this.clearSelection();
    }
    this._cursorPosition = 0;
  }

  /**
   * Move cursor to end of line/input
   */
  moveToEnd(select: boolean = false): void {
    if (select) {
      this.setSelection(this._cursorPosition, this._value.length);
    } else {
      this.clearSelection();
    }
    this._cursorPosition = this._value.length;
  }

  /**
   * Move cursor to previous word boundary
   */
  moveWordLeft(select: boolean = false): void {
    const newPosition = this.findWordBoundary('left');
    if (select) {
      this.extendSelectionTo(newPosition);
    } else {
      this.clearSelection();
    }
    this._cursorPosition = newPosition;
  }

  /**
   * Move cursor to next word boundary
   */
  moveWordRight(select: boolean = false): void {
    const newPosition = this.findWordBoundary('right');
    if (select) {
      this.extendSelectionTo(newPosition);
    } else {
      this.clearSelection();
    }
    this._cursorPosition = newPosition;
  }

  // === Selection ===

  /**
   * Select all text
   */
  selectAll(): void {
    this.setSelection(0, this._value.length);
    this._cursorPosition = this._value.length;
  }

  /**
   * Clear selection
   */
  clearSelection(): void {
    this._selection = null;
  }

  /**
   * Set selection range
   */
  setSelection(start: number, end: number): void {
    this._selection = {
      start: Math.max(0, Math.min(start, this._value.length)),
      end: Math.max(0, Math.min(end, this._value.length))
    };
  }

  /**
   * Extend selection in a direction
   */
  private extendSelection(direction: 'left' | 'right'): void {
    if (!this._selection) {
      this._selection = { start: this._cursorPosition, end: this._cursorPosition };
    }

    if (direction === 'left' && this._cursorPosition > 0) {
      this._cursorPosition--;
      this._selection.end = this._cursorPosition;
    } else if (direction === 'right' && this._cursorPosition < this._value.length) {
      this._cursorPosition++;
      this._selection.end = this._cursorPosition;
    }
  }

  /**
   * Extend selection to a specific position
   */
  private extendSelectionTo(position: number): void {
    if (!this._selection) {
      this._selection = { start: this._cursorPosition, end: this._cursorPosition };
    }
    this._selection.end = position;
  }

  // === Word Boundary Detection ===

  /**
   * Find word boundary in given direction
   */
  private findWordBoundary(direction: 'left' | 'right'): number {
    const isWordChar = (c: string) => /\w/.test(c);

    if (direction === 'left') {
      let pos = this._cursorPosition - 1;

      // Skip whitespace
      while (pos > 0 && !isWordChar(this._value[pos]!)) {
        pos--;
      }

      // Skip word characters
      while (pos > 0 && isWordChar(this._value[pos - 1]!)) {
        pos--;
      }

      return Math.max(0, pos);
    } else {
      let pos = this._cursorPosition;

      // Skip word characters
      while (pos < this._value.length && isWordChar(this._value[pos]!)) {
        pos++;
      }

      // Skip whitespace
      while (pos < this._value.length && !isWordChar(this._value[pos]!)) {
        pos++;
      }

      return pos;
    }
  }

  // === Keyboard Handling ===

  /**
   * Handle a key event
   * @returns true if the event was handled
   */
  handleKey(event: KeyEvent): boolean {
    const { key, ctrl, shift, alt } = event;

    // Escape - cancel
    if (key === 'ESCAPE') {
      if (this.onCancelCallback) {
        this.onCancelCallback();
      }
      return true;
    }

    // Enter - submit (if not multiline)
    if (key === 'ENTER' && !this._multiline) {
      if (this.onSubmitCallback) {
        this.onSubmitCallback(this._value);
      }
      return true;
    }

    // Navigation
    if (key === 'LEFT') {
      if (ctrl) {
        this.moveWordLeft(shift);
      } else {
        this.moveLeft(shift);
      }
      return true;
    }

    if (key === 'RIGHT') {
      if (ctrl) {
        this.moveWordRight(shift);
      } else {
        this.moveRight(shift);
      }
      return true;
    }

    if (key === 'HOME') {
      this.moveToStart(shift);
      return true;
    }

    if (key === 'END') {
      this.moveToEnd(shift);
      return true;
    }

    // Deletion
    if (key === 'BACKSPACE') {
      if (ctrl) {
        this.deleteWordBefore();
      } else {
        this.backspace();
      }
      return true;
    }

    if (key === 'DELETE') {
      if (ctrl) {
        this.deleteWordAfter();
      } else {
        this.delete();
      }
      return true;
    }

    // Selection
    if (ctrl && (key === 'A' || key === 'a')) {
      this.selectAll();
      return true;
    }

    // Character input
    const char = event.char;
    if (char && char.length === 1 && !ctrl && !alt && char.charCodeAt(0) >= 32) {
      this.insert(char);
      return true;
    }

    return false;
  }

  // === Callbacks ===

  onChange(callback: (event: TextChangeEvent) => void): () => void {
    this.onChangeCallback = callback;
    return () => { this.onChangeCallback = undefined; };
  }

  onSubmit(callback: (value: string) => void): () => void {
    this.onSubmitCallback = callback;
    return () => { this.onSubmitCallback = undefined; };
  }

  onCancel(callback: () => void): () => void {
    this.onCancelCallback = callback;
    return () => { this.onCancelCallback = undefined; };
  }

  // === Internal ===

  private emitChange(previousValue: string): void {
    if (this.onChangeCallback && this._value !== previousValue) {
      this.onChangeCallback({
        value: this._value,
        previousValue,
        cursorPosition: this._cursorPosition
      });
    }
  }

  private debugLog(msg: string): void {
    debugLog(`[TextInput] ${msg}`);
  }

  // === Reset ===

  /**
   * Reset the input to initial state
   */
  reset(initialValue: string = ''): void {
    this._value = initialValue;
    this._cursorPosition = initialValue.length;
    this._selection = null;
  }
}

export default TextInput;
