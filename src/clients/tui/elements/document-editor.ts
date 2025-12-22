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
 * Text selection using anchor/head model.
 * Anchor is where selection started, head is where cursor currently is.
 */
export interface Selection {
  anchor: CursorPosition;
  head: CursorPosition;
}

/**
 * A cursor with optional selection.
 */
export interface Cursor {
  position: CursorPosition;
  selection: Selection | null;
  /** Desired column for vertical movement */
  desiredColumn: number;
}

/**
 * Diagnostic severity levels.
 */
export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

/**
 * Diagnostic information for a range of text.
 */
export interface DiagnosticInfo {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  message: string;
  severity: DiagnosticSeverity;
  source?: string;
}

/**
 * Document state for serialization.
 */
export interface DocumentEditorState {
  uri?: string;
  scrollTop: number;
  cursors: Cursor[];
  foldedRegions?: number[];
}

/**
 * Callbacks for document editor.
 */
export interface DocumentEditorCallbacks {
  /** Called when content changes */
  onContentChange?: (content: string) => void;
  /** Called when cursor moves */
  onCursorChange?: (cursors: readonly Cursor[]) => void;
  /** Called when document is saved */
  onSave?: () => void;
  /** Called when fold state changes */
  onFoldChange?: () => void;
  /** Called when a character is typed (for autocomplete triggers) */
  onCharTyped?: (char: string, position: CursorPosition) => void;
  /** Called when editor receives focus (for checking external file changes) */
  onFocus?: () => void;
}

// ============================================
// DocumentEditor Element
// ============================================

export class DocumentEditor extends BaseElement {
  /** Document lines */
  private lines: DocumentLine[] = [{ text: '' }];

  /** All cursors (multi-cursor support) */
  private cursors: Cursor[] = [{ position: { line: 0, column: 0 }, selection: null, desiredColumn: 0 }];

  /** Primary cursor index */
  private primaryCursorIndex = 0;

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

  /** Whether text selection dragging is active */
  private selectionDragging = false;

  /** Click state for double/triple click detection */
  private clickState = {
    lastClickTime: 0,
    lastClickX: 0,
    lastClickY: 0,
    clickCount: 0,
  };

  /** Double/triple click timeout (ms) */
  private static readonly CLICK_TIMEOUT = 300;

  /** Click distance threshold (characters) */
  private static readonly CLICK_DISTANCE = 2;

  /** Fold manager for code folding */
  private foldManager: FoldManager = new FoldManager();

  /** Whether folding is enabled */
  private foldingEnabled = true;

  /** Version of content when fold regions were last computed */
  private lastFoldVersion = -1;

  /** Current content version (increments on change) */
  private contentVersion = 0;

  /** Whether word wrap is enabled */
  private wordWrapEnabled = true;

  /** Cached wrapped line mappings: visual row -> { bufferLine, wrapOffset } */
  private wrappedLineMap: Array<{ bufferLine: number; wrapOffset: number }> = [];

  /** Last width used for wrapping calculation */
  private lastWrapWidth = 0;

  /** Diagnostics for this document (errors, warnings, etc.) */
  private diagnostics: DiagnosticInfo[] = [];

  /** Git line changes for gutter indicators */
  private gitLineChanges: Map<number, 'added' | 'modified' | 'deleted'> = new Map();

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
  // Lifecycle Overrides
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Called when editor receives focus.
   * Notifies callback for external file change detection.
   */
  override onFocus(): void {
    super.onFocus();
    this.callbacks.onFocus?.();
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
   * Enable or disable word wrap.
   */
  setWordWrapEnabled(enabled: boolean): void {
    this.wordWrapEnabled = enabled;
    this.lastWrapWidth = 0; // Force recalculation
    this.ctx.markDirty();
  }

  /**
   * Check if word wrap is enabled.
   */
  isWordWrapEnabled(): boolean {
    return this.wordWrapEnabled;
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

    const cursor = this.getPrimaryCursor();

    // First check if cursor line starts a fold
    if (this.foldManager.canFold(cursor.position.line) || this.foldManager.isFolded(cursor.position.line)) {
      const result = this.foldManager.toggleFold(cursor.position.line);
      if (result) {
        this.callbacks.onFoldChange?.();
        this.ctx.markDirty();
      }
      return result;
    }

    // Otherwise, try to fold the containing region
    const region = this.foldManager.findRegionContaining(cursor.position.line);
    if (region) {
      const result = this.foldManager.toggleFold(region.startLine);
      if (result) {
        // Move cursor to fold start line if it would be hidden
        if (this.foldManager.isHidden(cursor.position.line)) {
          cursor.position.line = region.startLine;
          this.ensureCursorColumnInBounds(cursor);
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
      const cursor = this.getPrimaryCursor();
      if (this.foldManager.isHidden(cursor.position.line)) {
        cursor.position.line = line;
        this.ensureCursorColumnInBounds(cursor);
      }
      this.callbacks.onFoldChange?.();
      this.ctx.markDirty();
    }
    return result;
  }

  /**
   * Fold at a specific line.
   */
  foldLine(line: number): boolean {
    if (!this.foldingEnabled) return false;

    if (this.foldManager.canFold(line)) {
      const result = this.foldManager.fold(line);
      if (result) {
        this.callbacks.onFoldChange?.();
        this.ctx.markDirty();
      }
      return result;
    }

    return false;
  }

  /**
   * Fold at the current cursor line.
   */
  foldAtCursor(): boolean {
    if (!this.foldingEnabled) return false;

    const cursor = this.getPrimaryCursor();

    // First check if cursor line starts a fold
    if (this.foldManager.canFold(cursor.position.line)) {
      const result = this.foldManager.fold(cursor.position.line);
      if (result) {
        this.callbacks.onFoldChange?.();
        this.ctx.markDirty();
      }
      return result;
    }

    // Otherwise, fold the containing region
    const result = this.foldManager.foldContaining(cursor.position.line);
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

    const cursor = this.getPrimaryCursor();

    // First check if cursor line starts a fold
    if (this.foldManager.isFolded(cursor.position.line)) {
      const result = this.foldManager.unfold(cursor.position.line);
      if (result) {
        this.callbacks.onFoldChange?.();
        this.ctx.markDirty();
      }
      return result;
    }

    // Find containing folded region
    const region = this.foldManager.findRegionContaining(cursor.position.line);
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
    const cursor = this.getPrimaryCursor();
    if (this.foldManager.isHidden(cursor.position.line)) {
      // Find nearest visible line before cursor
      for (let i = cursor.position.line; i >= 0; i--) {
        if (!this.foldManager.isHidden(i)) {
          cursor.position.line = i;
          break;
        }
      }
      this.ensureCursorColumnInBounds(cursor);
    }

    this.callbacks.onFoldChange?.();
    this.ctx.markDirty();
  }

  /**
   * Ensure a cursor's column is within the line bounds.
   */
  private ensureCursorColumnInBounds(cursor: Cursor): void {
    const lineLen = this.lines[cursor.position.line]!.text.length;
    cursor.position.column = Math.max(0, Math.min(cursor.position.column, lineLen));
    cursor.desiredColumn = cursor.position.column;
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
    this.ensureCursorsInBounds();
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
   * Get lines (read-only access for external use).
   */
  getLines(): readonly DocumentLine[] {
    return this.lines;
  }

  /**
   * Set diagnostics for this document.
   */
  setDiagnostics(diagnostics: DiagnosticInfo[]): void {
    this.diagnostics = diagnostics;
    this.ctx.markDirty();
  }

  /**
   * Get diagnostics for this document.
   */
  getDiagnostics(): readonly DiagnosticInfo[] {
    return this.diagnostics;
  }

  /**
   * Get diagnostics for a specific line (for gutter rendering).
   */
  private getDiagnosticsForLine(line: number): DiagnosticInfo[] {
    return this.diagnostics.filter(
      (d) => line >= d.startLine && line <= d.endLine
    );
  }

  /**
   * Get the highest severity diagnostic for a line (for gutter icon).
   */
  private getHighestSeverityForLine(line: number): DiagnosticSeverity | null {
    const lineDiagnostics = this.getDiagnosticsForLine(line);
    if (lineDiagnostics.length === 0) return null;

    // Lower number = higher severity (1=Error, 4=Hint)
    return lineDiagnostics.reduce<DiagnosticSeverity>(
      (min, d) => (d.severity < min ? d.severity : min),
      DiagnosticSeverity.Hint
    );
  }

  /**
   * Get the gutter icon and color for a diagnostic severity.
   */
  private getDiagnosticIconAndColor(severity: DiagnosticSeverity): { icon: string; color: string } {
    switch (severity) {
      case DiagnosticSeverity.Error:
        return {
          icon: '●',
          color: this.ctx.getThemeColor('editorError.foreground', '#f14c4c'),
        };
      case DiagnosticSeverity.Warning:
        return {
          icon: '●',
          color: this.ctx.getThemeColor('editorWarning.foreground', '#cca700'),
        };
      case DiagnosticSeverity.Information:
        return {
          icon: '●',
          color: this.ctx.getThemeColor('editorInfo.foreground', '#3794ff'),
        };
      case DiagnosticSeverity.Hint:
        return {
          icon: '○',
          color: this.ctx.getThemeColor('editorHint.foreground', '#75beff'),
        };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Git Line Changes
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set git line changes for gutter indicators.
   * @param changes Map of line number (1-based) to change type
   */
  setGitLineChanges(changes: Map<number, 'added' | 'modified' | 'deleted'>): void {
    this.gitLineChanges = changes;
    this.ctx.markDirty();
  }

  /**
   * Clear git line changes.
   */
  clearGitLineChanges(): void {
    this.gitLineChanges.clear();
    this.ctx.markDirty();
  }

  /**
   * Get the color for a git line change type.
   */
  private getGitLineColor(type: 'added' | 'modified' | 'deleted'): string {
    switch (type) {
      case 'added':
        return this.ctx.getThemeColor('editorGutter.addedBackground', '#a6e3a1');
      case 'modified':
        return this.ctx.getThemeColor('editorGutter.modifiedBackground', '#f9e2af');
      case 'deleted':
        return this.ctx.getThemeColor('editorGutter.deletedBackground', '#f38ba8');
    }
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
  // Position Utilities
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Compare two positions. Returns -1 if a < b, 0 if equal, 1 if a > b.
   */
  private comparePositions(a: CursorPosition, b: CursorPosition): number {
    if (a.line !== b.line) return a.line < b.line ? -1 : 1;
    if (a.column !== b.column) return a.column < b.column ? -1 : 1;
    return 0;
  }

  /**
   * Check if two positions are equal.
   */
  private positionsEqual(a: CursorPosition, b: CursorPosition): boolean {
    return a.line === b.line && a.column === b.column;
  }

  /**
   * Get the minimum of two positions.
   */
  private minPosition(a: CursorPosition, b: CursorPosition): CursorPosition {
    return this.comparePositions(a, b) <= 0 ? a : b;
  }

  /**
   * Get the maximum of two positions.
   */
  private maxPosition(a: CursorPosition, b: CursorPosition): CursorPosition {
    return this.comparePositions(a, b) >= 0 ? a : b;
  }

  /**
   * Clone a position.
   */
  private clonePosition(pos: CursorPosition): CursorPosition {
    return { line: pos.line, column: pos.column };
  }

  /**
   * Clone a cursor.
   */
  private cloneCursor(cursor: Cursor): Cursor {
    return {
      position: this.clonePosition(cursor.position),
      selection: cursor.selection
        ? { anchor: this.clonePosition(cursor.selection.anchor), head: this.clonePosition(cursor.selection.head) }
        : null,
      desiredColumn: cursor.desiredColumn,
    };
  }

  /**
   * Check if a selection has content (anchor != head).
   */
  private hasSelectionContent(selection: Selection | null): boolean {
    if (!selection) return false;
    return !this.positionsEqual(selection.anchor, selection.head);
  }

  /**
   * Get ordered range from selection (start <= end).
   */
  private getSelectionRange(selection: Selection): { start: CursorPosition; end: CursorPosition } {
    const start = this.minPosition(selection.anchor, selection.head);
    const end = this.maxPosition(selection.anchor, selection.head);
    return { start, end };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cursor & Selection
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get primary cursor.
   */
  getPrimaryCursor(): Cursor {
    return this.cursors[this.primaryCursorIndex]!;
  }

  /**
   * Get all cursors.
   */
  getCursors(): readonly Cursor[] {
    return this.cursors;
  }

  /**
   * Get primary cursor position (for backward compatibility).
   */
  getCursor(): CursorPosition {
    return this.clonePosition(this.getPrimaryCursor().position);
  }

  /**
   * Get primary selection (for backward compatibility).
   */
  getSelection(): Selection | null {
    const cursor = this.getPrimaryCursor();
    return cursor.selection ? { ...cursor.selection } : null;
  }

  /**
   * Set single cursor at position, clearing all others.
   */
  setCursor(pos: CursorPosition): void {
    this.cursors = [{
      position: this.clonePosition(pos),
      selection: null,
      desiredColumn: pos.column,
    }];
    this.primaryCursorIndex = 0;
    this.ensureCursorsInBounds();
    this.ensurePrimaryCursorVisible();
    this.callbacks.onCursorChange?.(this.cursors);
    this.ctx.markDirty();
  }

  /**
   * Set cursor position with optional selection extension.
   */
  setCursorPosition(pos: CursorPosition, extending: boolean = false): void {
    const cursor = this.getPrimaryCursor();

    if (extending) {
      if (!cursor.selection) {
        cursor.selection = {
          anchor: this.clonePosition(cursor.position),
          head: this.clonePosition(pos),
        };
      } else {
        cursor.selection.head = this.clonePosition(pos);
      }
    } else {
      cursor.selection = null;
    }

    cursor.position = this.clonePosition(pos);
    cursor.desiredColumn = pos.column;

    this.ensureCursorsInBounds();
    this.ensurePrimaryCursorVisible();
    this.callbacks.onCursorChange?.(this.cursors);
    this.ctx.markDirty();
  }

  /**
   * Add a new cursor at position.
   */
  addCursor(pos: CursorPosition): void {
    // Check if cursor already exists at this position
    const exists = this.cursors.some((c) => this.positionsEqual(c.position, pos));
    if (exists) return;

    this.cursors.push({
      position: this.clonePosition(pos),
      selection: null,
      desiredColumn: pos.column,
    });

    this.sortCursors();
    this.ctx.markDirty();
  }

  /**
   * Add a cursor with selection.
   */
  addCursorWithSelection(anchor: CursorPosition, head: CursorPosition): void {
    this.cursors.push({
      position: this.clonePosition(head),
      selection: {
        anchor: this.clonePosition(anchor),
        head: this.clonePosition(head),
      },
      desiredColumn: head.column,
    });

    this.sortCursors();
    this.mergeOverlappingCursors();
    this.ctx.markDirty();
  }

  /**
   * Clear all secondary cursors, keeping only primary.
   */
  clearSecondaryCursors(): void {
    const primary = this.cloneCursor(this.getPrimaryCursor());
    this.cursors = [primary];
    this.primaryCursorIndex = 0;
    this.ctx.markDirty();
  }

  /**
   * Clear all selections on all cursors.
   */
  clearSelections(): void {
    for (const cursor of this.cursors) {
      cursor.selection = null;
    }
    this.ctx.markDirty();
  }

  /**
   * Sort cursors by position (top to bottom, left to right).
   */
  private sortCursors(): void {
    this.cursors.sort((a, b) => this.comparePositions(a.position, b.position));
    this.primaryCursorIndex = 0;
  }

  /**
   * Merge cursors that have overlapping selections or same position.
   */
  private mergeOverlappingCursors(): void {
    if (this.cursors.length <= 1) return;

    this.sortCursors();
    const merged: Cursor[] = [];

    for (const cursor of this.cursors) {
      const last = merged[merged.length - 1];

      if (!last) {
        merged.push(cursor);
        continue;
      }

      // Check if positions are the same
      if (this.positionsEqual(last.position, cursor.position)) {
        // Merge selections if both have them
        if (last.selection && cursor.selection) {
          const lastRange = this.getSelectionRange(last.selection);
          const curRange = this.getSelectionRange(cursor.selection);
          last.selection = {
            anchor: this.minPosition(lastRange.start, curRange.start),
            head: this.maxPosition(lastRange.end, curRange.end),
          };
          last.position = this.clonePosition(last.selection.head);
        }
        continue;
      }

      // Check for overlapping selections
      if (last.selection && cursor.selection) {
        const lastRange = this.getSelectionRange(last.selection);
        const curRange = this.getSelectionRange(cursor.selection);

        // Check if ranges overlap
        if (
          this.comparePositions(lastRange.start, curRange.end) < 0 &&
          this.comparePositions(curRange.start, lastRange.end) < 0
        ) {
          // Merge the selections
          last.selection = {
            anchor: this.minPosition(lastRange.start, curRange.start),
            head: this.maxPosition(lastRange.end, curRange.end),
          };
          last.position = this.clonePosition(last.selection.head);
          continue;
        }
      }

      merged.push(cursor);
    }

    this.cursors = merged;
    this.primaryCursorIndex = Math.min(this.primaryCursorIndex, this.cursors.length - 1);
  }

  /**
   * Move all cursors in a direction.
   */
  moveCursor(direction: 'up' | 'down' | 'left' | 'right', extend = false): void {
    for (const cursor of this.cursors) {
      const oldPos = this.clonePosition(cursor.position);

      switch (direction) {
        case 'up':
          if (cursor.position.line > 0) {
            cursor.position.line--;
            cursor.position.column = Math.min(cursor.desiredColumn, this.lines[cursor.position.line]!.text.length);
          }
          break;
        case 'down':
          if (cursor.position.line < this.lines.length - 1) {
            cursor.position.line++;
            cursor.position.column = Math.min(cursor.desiredColumn, this.lines[cursor.position.line]!.text.length);
          }
          break;
        case 'left':
          if (cursor.position.column > 0) {
            cursor.position.column--;
            cursor.desiredColumn = cursor.position.column;
          } else if (cursor.position.line > 0) {
            cursor.position.line--;
            cursor.position.column = this.lines[cursor.position.line]!.text.length;
            cursor.desiredColumn = cursor.position.column;
          }
          break;
        case 'right':
          if (cursor.position.column < this.lines[cursor.position.line]!.text.length) {
            cursor.position.column++;
            cursor.desiredColumn = cursor.position.column;
          } else if (cursor.position.line < this.lines.length - 1) {
            cursor.position.line++;
            cursor.position.column = 0;
            cursor.desiredColumn = 0;
          }
          break;
      }

      if (extend) {
        if (!cursor.selection) {
          cursor.selection = { anchor: oldPos, head: this.clonePosition(cursor.position) };
        } else {
          cursor.selection.head = this.clonePosition(cursor.position);
        }
      } else {
        cursor.selection = null;
      }
    }

    this.mergeOverlappingCursors();
    this.ensurePrimaryCursorVisible();
    this.callbacks.onCursorChange?.(this.cursors);
    this.ctx.markDirty();
  }

  /**
   * Move all cursors to start of line.
   */
  moveCursorToLineStart(extend = false): void {
    for (const cursor of this.cursors) {
      const oldPos = this.clonePosition(cursor.position);
      cursor.position.column = 0;
      cursor.desiredColumn = 0;

      if (extend) {
        if (!cursor.selection) {
          cursor.selection = { anchor: oldPos, head: this.clonePosition(cursor.position) };
        } else {
          cursor.selection.head = this.clonePosition(cursor.position);
        }
      } else {
        cursor.selection = null;
      }
    }

    this.mergeOverlappingCursors();
    this.ensurePrimaryCursorVisible();
    this.callbacks.onCursorChange?.(this.cursors);
    this.ctx.markDirty();
  }

  /**
   * Move all cursors to end of line.
   */
  moveCursorToLineEnd(extend = false): void {
    for (const cursor of this.cursors) {
      const oldPos = this.clonePosition(cursor.position);
      cursor.position.column = this.lines[cursor.position.line]!.text.length;
      cursor.desiredColumn = cursor.position.column;

      if (extend) {
        if (!cursor.selection) {
          cursor.selection = { anchor: oldPos, head: this.clonePosition(cursor.position) };
        } else {
          cursor.selection.head = this.clonePosition(cursor.position);
        }
      } else {
        cursor.selection = null;
      }
    }

    this.mergeOverlappingCursors();
    this.ensurePrimaryCursorVisible();
    this.callbacks.onCursorChange?.(this.cursors);
    this.ctx.markDirty();
  }

  /**
   * Move cursor to document start (clears secondary cursors).
   */
  moveCursorToDocStart(extend = false): void {
    const cursor = this.getPrimaryCursor();
    const oldPos = this.clonePosition(cursor.position);

    // Clear secondary cursors for document navigation
    this.clearSecondaryCursors();

    this.cursors[0]!.position = { line: 0, column: 0 };
    this.cursors[0]!.desiredColumn = 0;

    if (extend) {
      if (!this.cursors[0]!.selection) {
        this.cursors[0]!.selection = { anchor: oldPos, head: { line: 0, column: 0 } };
      } else {
        this.cursors[0]!.selection.head = { line: 0, column: 0 };
      }
    } else {
      this.cursors[0]!.selection = null;
    }

    this.ensurePrimaryCursorVisible();
    this.callbacks.onCursorChange?.(this.cursors);
    this.ctx.markDirty();
  }

  /**
   * Move cursor to document end (clears secondary cursors).
   */
  moveCursorToDocEnd(extend = false): void {
    const cursor = this.getPrimaryCursor();
    const oldPos = this.clonePosition(cursor.position);

    // Clear secondary cursors for document navigation
    this.clearSecondaryCursors();

    const lastLine = this.lines.length - 1;
    const lastCol = this.lines[lastLine]!.text.length;
    this.cursors[0]!.position = { line: lastLine, column: lastCol };
    this.cursors[0]!.desiredColumn = lastCol;

    if (extend) {
      if (!this.cursors[0]!.selection) {
        this.cursors[0]!.selection = { anchor: oldPos, head: { line: lastLine, column: lastCol } };
      } else {
        this.cursors[0]!.selection.head = { line: lastLine, column: lastCol };
      }
    } else {
      this.cursors[0]!.selection = null;
    }

    this.ensurePrimaryCursorVisible();
    this.callbacks.onCursorChange?.(this.cursors);
    this.ctx.markDirty();
  }

  /**
   * Select all text in document.
   */
  selectAll(): void {
    const lastLine = this.lines.length - 1;
    const lastCol = this.lines[lastLine]!.text.length;

    this.cursors = [{
      position: { line: lastLine, column: lastCol },
      selection: {
        anchor: { line: 0, column: 0 },
        head: { line: lastLine, column: lastCol },
      },
      desiredColumn: lastCol,
    }];
    this.primaryCursorIndex = 0;

    this.callbacks.onCursorChange?.(this.cursors);
    this.ctx.markDirty();
  }

  /**
   * Ensure all cursors are within document bounds.
   */
  private ensureCursorsInBounds(): void {
    for (const cursor of this.cursors) {
      cursor.position.line = Math.max(0, Math.min(cursor.position.line, this.lines.length - 1));
      const lineLen = this.lines[cursor.position.line]!.text.length;
      cursor.position.column = Math.max(0, Math.min(cursor.position.column, lineLen));
    }
  }

  /**
   * Ensure primary cursor is visible in viewport.
   */
  private ensurePrimaryCursorVisible(): void {
    const cursor = this.getPrimaryCursor();
    const viewportHeight = this.bounds.height;
    const rightMargin = this.getRightMarginWidth();
    const viewportWidth = this.bounds.width - this.gutterWidth - rightMargin;

    // Vertical scrolling
    if (cursor.position.line < this.scrollTop) {
      this.scrollTop = cursor.position.line;
    } else if (cursor.position.line >= this.scrollTop + viewportHeight) {
      this.scrollTop = cursor.position.line - viewportHeight + 1;
    }

    // Horizontal scrolling
    if (cursor.position.column < this.scrollLeft) {
      this.scrollLeft = cursor.position.column;
    } else if (cursor.position.column >= this.scrollLeft + viewportWidth) {
      this.scrollLeft = cursor.position.column - viewportWidth + 1;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Editing
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Insert text at all cursor positions.
   * For multi-cursor, processes from bottom to top to avoid index shifting.
   */
  insertText(text: string): void {
    // Delete selections first
    this.deleteAllSelections();

    // Process cursors from bottom to top
    const sortedCursors = [...this.cursors].sort((a, b) => this.comparePositions(b.position, a.position));

    for (const cursor of sortedCursors) {
      this.insertTextAtPosition(cursor, text);
    }

    this.modified = true;
    this.contentVersion++;
    this.updateGutterWidth();
    this.updateFoldRegions();
    this.ensurePrimaryCursorVisible();
    this.callbacks.onContentChange?.(this.getContent());
    this.ctx.markDirty();
  }

  /**
   * Insert text at a specific cursor position.
   */
  private insertTextAtPosition(cursor: Cursor, text: string): void {
    const line = this.lines[cursor.position.line]!;
    const before = line.text.slice(0, cursor.position.column);
    const after = line.text.slice(cursor.position.column);

    const insertLines = text.split('\n');
    if (insertLines.length === 1) {
      line.text = before + text + after;
      cursor.position.column += text.length;
      cursor.desiredColumn = cursor.position.column;
    } else {
      // Multi-line insert
      line.text = before + insertLines[0]!;
      const newLines: DocumentLine[] = [];
      for (let i = 1; i < insertLines.length - 1; i++) {
        newLines.push({ text: insertLines[i]! });
      }
      newLines.push({ text: insertLines[insertLines.length - 1]! + after });
      this.lines.splice(cursor.position.line + 1, 0, ...newLines);
      cursor.position.line += insertLines.length - 1;
      cursor.position.column = insertLines[insertLines.length - 1]!.length;
      cursor.desiredColumn = cursor.position.column;
    }
  }

  /**
   * Delete character before all cursors (backspace).
   */
  deleteBackward(): void {
    // If any cursor has a selection, delete selections instead
    if (this.cursors.some((c) => this.hasSelectionContent(c.selection))) {
      this.deleteAllSelections();
      this.modified = true;
      this.contentVersion++;
      this.updateFoldRegions();
      this.ensurePrimaryCursorVisible();
      this.callbacks.onContentChange?.(this.getContent());
      this.ctx.markDirty();
      return;
    }

    // Process cursors from bottom to top
    const sortedCursors = [...this.cursors].sort((a, b) => this.comparePositions(b.position, a.position));

    for (const cursor of sortedCursors) {
      if (cursor.position.column > 0) {
        const line = this.lines[cursor.position.line]!;
        line.text = line.text.slice(0, cursor.position.column - 1) + line.text.slice(cursor.position.column);
        cursor.position.column--;
        cursor.desiredColumn = cursor.position.column;
      } else if (cursor.position.line > 0) {
        // Join with previous line
        const prevLine = this.lines[cursor.position.line - 1]!;
        const currLine = this.lines[cursor.position.line]!;
        const newColumn = prevLine.text.length;
        prevLine.text += currLine.text;
        this.lines.splice(cursor.position.line, 1);
        cursor.position.line--;
        cursor.position.column = newColumn;
        cursor.desiredColumn = newColumn;

        // Adjust other cursors that were on lines below
        for (const other of this.cursors) {
          if (other !== cursor && other.position.line > cursor.position.line) {
            other.position.line--;
          }
        }
      }
    }

    this.mergeOverlappingCursors();
    this.updateGutterWidth();
    this.modified = true;
    this.contentVersion++;
    this.updateFoldRegions();
    this.ensurePrimaryCursorVisible();
    this.callbacks.onContentChange?.(this.getContent());
    this.ctx.markDirty();
  }

  /**
   * Delete character at all cursors (delete key).
   */
  deleteForward(): void {
    // If any cursor has a selection, delete selections instead
    if (this.cursors.some((c) => this.hasSelectionContent(c.selection))) {
      this.deleteAllSelections();
      this.modified = true;
      this.contentVersion++;
      this.updateFoldRegions();
      this.ensurePrimaryCursorVisible();
      this.callbacks.onContentChange?.(this.getContent());
      this.ctx.markDirty();
      return;
    }

    // Process cursors from bottom to top
    const sortedCursors = [...this.cursors].sort((a, b) => this.comparePositions(b.position, a.position));

    for (const cursor of sortedCursors) {
      const line = this.lines[cursor.position.line]!;
      if (cursor.position.column < line.text.length) {
        line.text = line.text.slice(0, cursor.position.column) + line.text.slice(cursor.position.column + 1);
      } else if (cursor.position.line < this.lines.length - 1) {
        // Join with next line
        const nextLine = this.lines[cursor.position.line + 1]!;
        line.text += nextLine.text;
        this.lines.splice(cursor.position.line + 1, 1);

        // Adjust other cursors that were on lines below
        for (const other of this.cursors) {
          if (other !== cursor && other.position.line > cursor.position.line) {
            other.position.line--;
          }
        }
      }
    }

    this.mergeOverlappingCursors();
    this.updateGutterWidth();
    this.modified = true;
    this.contentVersion++;
    this.updateFoldRegions();
    this.callbacks.onContentChange?.(this.getContent());
    this.ctx.markDirty();
  }

  /**
   * Delete all selections on all cursors.
   */
  private deleteAllSelections(): void {
    // Process cursors with selections from bottom to top
    const cursorsWithSelections = this.cursors
      .filter((c) => this.hasSelectionContent(c.selection))
      .sort((a, b) => {
        const aRange = this.getSelectionRange(a.selection!);
        const bRange = this.getSelectionRange(b.selection!);
        return this.comparePositions(bRange.start, aRange.start);
      });

    for (const cursor of cursorsWithSelections) {
      if (!cursor.selection) continue;

      const { start, end } = this.getSelectionRange(cursor.selection);

      if (start.line === end.line) {
        // Single line deletion
        const line = this.lines[start.line]!;
        line.text = line.text.slice(0, start.column) + line.text.slice(end.column);
      } else {
        // Multi-line deletion
        const startLine = this.lines[start.line]!;
        const endLine = this.lines[end.line]!;
        startLine.text = startLine.text.slice(0, start.column) + endLine.text.slice(end.column);
        const linesRemoved = end.line - start.line;
        this.lines.splice(start.line + 1, linesRemoved);

        // Adjust other cursors that were on lines below
        for (const other of this.cursors) {
          if (other !== cursor && other.position.line > start.line) {
            other.position.line -= linesRemoved;
          }
        }
      }

      cursor.position = this.clonePosition(start);
      cursor.desiredColumn = start.column;
      cursor.selection = null;
    }

    this.mergeOverlappingCursors();
    this.updateGutterWidth();
  }

  /**
   * Get selected text from primary cursor.
   */
  getSelectedText(): string {
    const cursor = this.getPrimaryCursor();
    if (!cursor.selection || !this.hasSelectionContent(cursor.selection)) {
      return '';
    }

    const { start, end } = this.getSelectionRange(cursor.selection);

    if (start.line === end.line) {
      return this.lines[start.line]!.text.slice(start.column, end.column);
    }

    const lines: string[] = [];
    lines.push(this.lines[start.line]!.text.slice(start.column));
    for (let i = start.line + 1; i < end.line; i++) {
      lines.push(this.lines[i]!.text);
    }
    lines.push(this.lines[end.line]!.text.slice(0, end.column));
    return lines.join('\n');
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

  /**
   * Get horizontal scroll position.
   */
  getScrollLeft(): number {
    return this.scrollLeft;
  }

  /**
   * Get gutter width in characters.
   */
  getGutterWidth(): number {
    return this.gutterWidth;
  }

  /**
   * Go to a specific line number (1-indexed).
   */
  goToLine(lineNumber: number): void {
    const targetLine = Math.max(0, Math.min(lineNumber - 1, this.lines.length - 1));
    const primaryCursor = this.getPrimaryCursor();
    primaryCursor.position.line = targetLine;
    primaryCursor.position.column = 0;
    primaryCursor.selection = null;
    this.ensurePrimaryCursorVisible();
    this.ctx.markDirty();
  }

  /**
   * Go to a specific column on the current line (0-indexed).
   */
  goToColumn(column: number): void {
    const primaryCursor = this.getPrimaryCursor();
    const line = this.lines[primaryCursor.position.line];
    if (line) {
      primaryCursor.position.column = Math.max(0, Math.min(column, line.text.length));
      primaryCursor.selection = null;
      this.ensurePrimaryCursorVisible();
      this.ctx.markDirty();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Word Wrap Support
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Calculate wrap break positions for a line (word-aware wrapping).
   * Returns an array of character positions where each wrapped row starts.
   * E.g., [0, 45, 92] means row 0 starts at char 0, row 1 at char 45, row 2 at char 92.
   */
  private getLineWrapBreaks(lineText: string, wrapWidth: number): number[] {
    if (!this.wordWrapEnabled || wrapWidth <= 0 || lineText.length === 0) {
      return [0];
    }

    const breaks: number[] = [0];
    let pos = 0;

    while (pos < lineText.length) {
      const remaining = lineText.length - pos;
      if (remaining <= wrapWidth) {
        // Rest fits on this row
        break;
      }

      // Find the last space/break point within wrapWidth
      let breakPos = pos + wrapWidth;
      let foundBreak = false;

      // Look backwards for a word boundary
      for (let i = breakPos; i > pos; i--) {
        const char = lineText[i];
        // Break after spaces, tabs, or before certain punctuation
        if (char === ' ' || char === '\t') {
          breakPos = i + 1; // Break after the space
          foundBreak = true;
          break;
        }
        // Also allow breaking before certain punctuation if we're close to the edge
        if (i > pos + wrapWidth * 0.5 && (char === '-' || char === '/' || char === '\\' || char === '.' || char === ',')) {
          breakPos = i;
          foundBreak = true;
          break;
        }
      }

      // If no word boundary found, hard break at wrapWidth
      if (!foundBreak) {
        breakPos = pos + wrapWidth;
      }

      // Skip leading spaces on the new line (optional, for cleaner look)
      while (breakPos < lineText.length && lineText[breakPos] === ' ') {
        breakPos++;
      }

      if (breakPos >= lineText.length) {
        break;
      }

      breaks.push(breakPos);
      pos = breakPos;
    }

    return breaks;
  }

  /**
   * Calculate the number of visual rows a line takes when wrapped.
   */
  private getWrappedRowCount(lineText: string, wrapWidth: number): number {
    if (!this.wordWrapEnabled || wrapWidth <= 0 || lineText.length === 0) {
      return 1;
    }
    return this.getLineWrapBreaks(lineText, wrapWidth).length;
  }

  /**
   * Get the text for a specific wrapped row of a line.
   */
  private getWrappedRowText(lineText: string, wrapOffset: number, wrapWidth: number): string {
    const breaks = this.getLineWrapBreaks(lineText, wrapWidth);
    if (wrapOffset >= breaks.length) {
      return '';
    }
    const start = breaks[wrapOffset]!;
    const end = wrapOffset + 1 < breaks.length ? breaks[wrapOffset + 1]! : lineText.length;
    return lineText.slice(start, end);
  }

  /**
   * Get the starting character position for a wrapped row.
   */
  private getWrapRowStart(lineText: string, wrapOffset: number, wrapWidth: number): number {
    const breaks = this.getLineWrapBreaks(lineText, wrapWidth);
    if (wrapOffset >= breaks.length) {
      return lineText.length;
    }
    return breaks[wrapOffset]!;
  }

  /**
   * Find which wrapped row a column falls into.
   */
  private getWrapRowForColumn(lineText: string, column: number, wrapWidth: number): number {
    const breaks = this.getLineWrapBreaks(lineText, wrapWidth);
    for (let i = breaks.length - 1; i >= 0; i--) {
      if (column >= breaks[i]!) {
        return i;
      }
    }
    return 0;
  }

  /**
   * Convert a buffer position to visual row (accounting for word wrap).
   */
  private bufferPosToVisualRow(bufferLine: number, column: number, wrapWidth: number): number {
    if (!this.wordWrapEnabled || wrapWidth <= 0) {
      return bufferLine;
    }

    let visualRow = 0;
    for (let i = 0; i < bufferLine && i < this.lines.length; i++) {
      if (!this.foldManager.isHidden(i)) {
        visualRow += this.getWrappedRowCount(this.lines[i]!.text, wrapWidth);
      }
    }
    // Add offset within the current line based on word wrap
    if (bufferLine < this.lines.length) {
      visualRow += this.getWrapRowForColumn(this.lines[bufferLine]!.text, column, wrapWidth);
    }
    return visualRow;
  }

  /**
   * Convert visual row to buffer line and wrap offset.
   */
  private visualRowToBufferPos(visualRow: number, wrapWidth: number): { bufferLine: number; wrapOffset: number } {
    if (!this.wordWrapEnabled || wrapWidth <= 0) {
      return { bufferLine: visualRow, wrapOffset: 0 };
    }

    let currentVisualRow = 0;
    for (let bufferLine = 0; bufferLine < this.lines.length; bufferLine++) {
      if (this.foldManager.isHidden(bufferLine)) {
        continue;
      }
      const rowCount = this.getWrappedRowCount(this.lines[bufferLine]!.text, wrapWidth);
      if (currentVisualRow + rowCount > visualRow) {
        return { bufferLine, wrapOffset: visualRow - currentVisualRow };
      }
      currentVisualRow += rowCount;
    }
    return { bufferLine: this.lines.length - 1, wrapOffset: 0 };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  render(buffer: ScreenBuffer): void {
    const { x, y, width, height } = this.bounds;
    // Use centralized focus colors for consistent focus indication
    const bg = this.ctx.getBackgroundForFocus('editor', this.focused);
    const fg = this.ctx.getForegroundForFocus('editor', this.focused);
    const gutterBg = this.focused
      ? this.ctx.getThemeColor('editorGutter.background', '#1e1e1e')
      : bg; // Match editor background when unfocused
    const gutterFg = this.ctx.getThemeColor('editorLineNumber.foreground', '#858585');
    const cursorBg = this.ctx.getThemeColor('editorCursor.foreground', '#aeafad');
    const selectionBg = this.ctx.getSelectionBackground('editor', this.focused);
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

    // Determine starting position based on scroll
    // For word wrap, scrollTop is still a buffer line number
    let bufferLine = this.scrollTop;
    let wrapOffset = 0; // Which wrapped row of the current buffer line we're on
    let row = 0;

    while (row < height && bufferLine < this.lines.length) {
      const screenY = y + row;

      // Skip hidden lines (inside folded regions)
      if (this.foldManager.isHidden(bufferLine)) {
        bufferLine++;
        wrapOffset = 0;
        continue;
      }

      const line = this.lines[bufferLine]!;
      const wrappedRowCount = this.wordWrapEnabled
        ? this.getWrappedRowCount(line.text, contentWidth)
        : 1;

      // Determine line background - highlight if any cursor is on this line
      const isCurrentLine = this.cursors.some((c) => c.position.line === bufferLine);
      const lineBg = isCurrentLine && this.focused ? lineHighlight : bg;
      const currentGutterBg = isCurrentLine && this.focused ? lineHighlight : gutterBg;

      // Render gutter: [diagnostic icon][line number][fold indicator][space]
      // Only show line number on first wrapped row
      if (wrapOffset === 0) {
        const lineNumStr = String(bufferLine + 1).padStart(lineNumWidth, ' ');
        const foldIndicator = this.foldingEnabled ? this.getFoldIndicator(bufferLine) : '';
        const gutterStr = lineNumStr + foldIndicator + ' ';

        // Use git status color for line number if available (1-based line)
        const gitStatus = this.gitLineChanges.get(bufferLine + 1);
        const lineNumFg = gitStatus ? this.getGitLineColor(gitStatus) : gutterFg;
        buffer.writeString(x, screenY, gutterStr, lineNumFg, currentGutterBg);

        // Overlay diagnostic icon in first column if there's a diagnostic
        const severity = this.getHighestSeverityForLine(bufferLine);
        if (severity !== null) {
          const { icon, color } = this.getDiagnosticIconAndColor(severity);
          buffer.set(x, screenY, { char: icon, fg: color, bg: currentGutterBg });
        }
      } else {
        // Wrapped continuation - show continuation marker or empty gutter
        const gutterStr = ' '.repeat(lineNumWidth) + (this.foldingEnabled ? ' ' : '') + ' ';
        buffer.writeString(x, screenY, gutterStr, gutterFg, currentGutterBg);
      }

      // Fill background
      buffer.writeString(contentX, screenY, ' '.repeat(contentWidth), fg, lineBg);

      // Render line content (with wrapping)
      if (this.wordWrapEnabled) {
        const wrappedText = this.getWrappedRowText(line.text, wrapOffset, contentWidth);
        const textOffset = this.getWrapRowStart(line.text, wrapOffset, contentWidth);

        if (line.tokens && line.tokens.length > 0) {
          // Render with tokens, adjusting for wrap offset
          this.renderLineWithTokensWrapped(buffer, contentX, screenY, line, contentWidth, lineBg, textOffset, wrappedText.length);
        } else {
          buffer.writeString(contentX, screenY, wrappedText, fg, lineBg);
        }
      } else {
        // No wrapping - use horizontal scroll
        const visibleText = line.text.slice(this.scrollLeft, this.scrollLeft + contentWidth);
        if (line.tokens && line.tokens.length > 0) {
          this.renderLineWithTokens(buffer, contentX, screenY, line, contentWidth, lineBg);
        } else {
          buffer.writeString(contentX, screenY, visibleText, fg, lineBg);
        }
      }

      // If this line is folded (only on first wrapped row), show ellipsis
      if (wrapOffset === 0 && this.foldManager.isFolded(bufferLine)) {
        const foldedCount = this.foldManager.getFoldedLineCount(bufferLine);
        const ellipsis = ` ... ${foldedCount} lines`;
        const textLen = Math.min(line.text.length, contentWidth) - this.scrollLeft;
        const ellipsisX = contentX + Math.max(0, textLen);
        if (ellipsisX < x + width - rightMargin - ellipsis.length) {
          buffer.writeString(ellipsisX, screenY, ellipsis, foldEllipsisFg, lineBg);
        }
      }

      // Render selection highlights for all cursors
      for (const cursor of this.cursors) {
        if (cursor.selection && this.hasSelectionContent(cursor.selection)) {
          this.renderCursorSelectionOnLineWrapped(buffer, contentX, screenY, bufferLine, wrapOffset, contentWidth, selectionBg, cursor);
        }
      }

      // Render diagnostic underlines
      if (wrapOffset === 0) {
        // Only render underlines on first wrapped row (simplification)
        this.renderDiagnosticUnderlines(buffer, contentX, screenY, bufferLine, contentWidth, lineBg);
      }

      // Render all cursors on this line
      if (this.focused) {
        for (const cursor of this.cursors) {
          if (cursor.position.line === bufferLine) {
            // Calculate which wrapped row the cursor is on
            const cursorWrapRow = this.wordWrapEnabled
              ? this.getWrapRowForColumn(line.text, cursor.position.column, contentWidth)
              : 0;
            if (cursorWrapRow === wrapOffset) {
              const wrapStart = this.wordWrapEnabled
                ? this.getWrapRowStart(line.text, wrapOffset, contentWidth)
                : 0;
              const cursorCol = this.wordWrapEnabled
                ? cursor.position.column - wrapStart
                : cursor.position.column - this.scrollLeft;
              if (cursorCol >= 0 && cursorCol < contentWidth) {
                const cursorX = contentX + cursorCol;
                const cursorChar = buffer.get(cursorX, screenY)?.char ?? ' ';
                buffer.set(cursorX, screenY, { char: cursorChar, fg: bg, bg: cursorBg });
              }
            }
          }
        }
      }

      // Move to next wrapped row or next buffer line
      wrapOffset++;
      if (wrapOffset >= wrappedRowCount) {
        bufferLine++;
        wrapOffset = 0;
      }
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
   * Render diagnostic underlines for a line.
   * Adds a colored underline character under the diagnostic range.
   */
  private renderDiagnosticUnderlines(
    buffer: ScreenBuffer,
    contentX: number,
    screenY: number,
    bufferLine: number,
    contentWidth: number,
    bg: string
  ): void {
    const lineDiagnostics = this.getDiagnosticsForLine(bufferLine);
    if (lineDiagnostics.length === 0) return;

    for (const diag of lineDiagnostics) {
      // Determine the color based on severity
      const underlineColor = this.getDiagnosticUnderlineColor(diag.severity);

      // Calculate the visible range on this line
      let startCol: number;
      let endCol: number;

      if (diag.startLine === bufferLine) {
        startCol = diag.startColumn;
      } else {
        startCol = 0; // Diagnostic starts on a previous line
      }

      if (diag.endLine === bufferLine) {
        endCol = diag.endColumn;
      } else {
        // Diagnostic continues to next line
        const line = this.lines[bufferLine];
        endCol = line ? line.text.length : 0;
      }

      // Adjust for horizontal scroll
      const visibleStart = Math.max(0, startCol - this.scrollLeft);
      const visibleEnd = Math.min(contentWidth, endCol - this.scrollLeft);

      // Draw underline characters
      for (let col = visibleStart; col < visibleEnd; col++) {
        const cellX = contentX + col;
        const cell = buffer.get(cellX, screenY);
        if (cell) {
          // Keep the original character but change the foreground to show underline
          // Since terminal can't do true underlines easily, we use the underline color as fg
          // and rely on a styled character or attribute
          buffer.set(cellX, screenY, {
            char: cell.char,
            fg: cell.fg,
            bg: cell.bg,
            underline: true,
            underlineColor,
          });
        }
      }
    }
  }

  /**
   * Get the underline color for a diagnostic severity.
   */
  private getDiagnosticUnderlineColor(severity: DiagnosticSeverity): string {
    switch (severity) {
      case DiagnosticSeverity.Error:
        return this.ctx.getThemeColor('editorError.foreground', '#f14c4c');
      case DiagnosticSeverity.Warning:
        return this.ctx.getThemeColor('editorWarning.foreground', '#cca700');
      case DiagnosticSeverity.Information:
        return this.ctx.getThemeColor('editorInfo.foreground', '#3794ff');
      case DiagnosticSeverity.Hint:
        return this.ctx.getThemeColor('editorHint.foreground', '#75beff');
    }
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
   * Render selection highlight on a line for a specific cursor.
   */
  private renderCursorSelectionOnLine(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    lineNum: number,
    width: number,
    selectionBg: string,
    cursor: Cursor
  ): void {
    if (!cursor.selection) return;

    const { start, end } = this.getSelectionRange(cursor.selection);
    const line = this.lines[lineNum]!;

    // Check if line is in selection
    if (lineNum < start.line || lineNum > end.line) return;

    let startCol = 0;
    let endCol = line.text.length;

    if (lineNum === start.line) {
      startCol = start.column;
    }
    if (lineNum === end.line) {
      endCol = end.column;
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
   * Render a line with syntax tokens, adjusted for word wrap offset.
   */
  private renderLineWithTokensWrapped(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    line: DocumentLine,
    width: number,
    bg: string,
    textOffset: number,
    rowLength: number
  ): void {
    const fg = this.ctx.getThemeColor('editor.foreground', '#cccccc');
    const text = line.text;
    const tokens = line.tokens ?? [];

    // Sort tokens by start position
    const sortedTokens = [...tokens].sort((a, b) => a.start - b.start);

    let col = 0;
    let tokenIdx = 0;

    // Use rowLength to limit how many characters we render (word-wrapped row length)
    const maxCol = Math.min(width, rowLength);

    while (col < maxCol && textOffset + col < text.length) {
      const charIdx = textOffset + col;

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
   * Render selection highlight on a wrapped line row for a specific cursor.
   */
  private renderCursorSelectionOnLineWrapped(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    lineNum: number,
    wrapOffset: number,
    width: number,
    selectionBg: string,
    cursor: Cursor
  ): void {
    if (!cursor.selection) return;

    const { start, end } = this.getSelectionRange(cursor.selection);
    const line = this.lines[lineNum]!;

    // Check if line is in selection
    if (lineNum < start.line || lineNum > end.line) return;

    let startCol = 0;
    let endCol = line.text.length;

    if (lineNum === start.line) {
      startCol = start.column;
    }
    if (lineNum === end.line) {
      endCol = end.column;
    }

    // Get word-boundary wrap positions
    const wrapStart = this.getWrapRowStart(line.text, wrapOffset, width);
    const wrapEnd = wrapOffset + 1 < this.getLineWrapBreaks(line.text, width).length
      ? this.getWrapRowStart(line.text, wrapOffset + 1, width)
      : line.text.length;
    const rowLength = wrapEnd - wrapStart;

    // Clamp selection to this wrapped row
    const selStartInRow = Math.max(startCol - wrapStart, 0);
    const selEndInRow = Math.min(endCol - wrapStart, rowLength);

    if (selStartInRow >= selEndInRow) return;

    // Highlight selection
    for (let col = selStartInRow; col < selEndInRow; col++) {
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

    // Regular character input
    if (event.key.length === 1 && !event.ctrl && !event.alt && !event.meta) {
      this.insertText(event.key);
      // Notify of character typed for autocomplete trigger
      const position = this.getPrimaryCursor().position;
      this.callbacks.onCharTyped?.(event.key, { line: position.line, column: position.column });
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
    const contentWidth = width - this.gutterWidth - rightMargin;

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

    // Handle selection drag release
    if (event.type === 'release' && this.selectionDragging) {
      this.selectionDragging = false;
      return true;
    }

    // Handle selection drag
    if (event.type === 'drag' && this.selectionDragging) {
      const relX = event.x - this.bounds.x - this.gutterWidth;
      const relY = event.y - this.bounds.y;
      const result = this.screenRowToBufferLine(relY);

      if (result !== null) {
        const { bufferLine, wrapOffset } = result;
        const lineText = this.lines[bufferLine]!.text;
        const wrapColumnOffset = this.wordWrapEnabled
          ? this.getWrapRowStart(lineText, wrapOffset, contentWidth)
          : 0;
        const baseColumn = this.wordWrapEnabled ? relX : this.scrollLeft + relX;
        const column = Math.max(0, Math.min(wrapColumnOffset + baseColumn, lineText.length));
        this.setCursorPosition({ line: bufferLine, column }, true);
      }
      return true;
    }

    if (event.type === 'press' && event.button === 'left') {
      // Calculate clicked position
      const relX = event.x - this.bounds.x;
      const relY = event.y - this.bounds.y;

      // Convert screen row to buffer line (accounting for hidden lines and word wrap)
      const result = this.screenRowToBufferLine(relY);

      // Check if click is in gutter area
      if (relX >= 0 && relX < this.gutterWidth && result !== null) {
        const { bufferLine } = result;
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

        // Click in gutter - select entire line
        this.selectLine(bufferLine);
        this.ctx.requestFocus();
        return true;
      }

      // Click in content area
      const contentRelX = relX - this.gutterWidth;
      if (contentRelX >= 0 && contentRelX < contentWidth && result !== null) {
        const { bufferLine, wrapOffset } = result;
        const lineText = this.lines[bufferLine];
        if (lineText) {
          const wrapColumnOffset = this.wordWrapEnabled
            ? this.getWrapRowStart(lineText.text, wrapOffset, contentWidth)
            : 0;
          const baseColumn = this.wordWrapEnabled ? contentRelX : this.scrollLeft + contentRelX;
          const column = Math.min(wrapColumnOffset + baseColumn, lineText.text.length);
          const clickPos = { line: bufferLine, column };

          // Update click count for double/triple click detection
          const clickCount = this.updateClickCount(event.x, event.y);

          if (clickCount === 3) {
            // Triple click - select line
            this.selectLine(bufferLine);
          } else if (clickCount === 2) {
            // Double click - select word
            this.selectWordAt(clickPos);
          } else if (event.ctrl) {
            // Ctrl+click - add cursor
            this.addCursor(clickPos);
          } else if (event.shift) {
            // Shift+click - extend selection
            this.setCursorPosition(clickPos, true);
          } else {
            // Normal click - set cursor and start drag selection
            this.setCursor(clickPos);
            this.selectionDragging = true;
          }

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
   * Update click count for double/triple click detection.
   */
  private updateClickCount(x: number, y: number): number {
    const now = Date.now();
    const timeDiff = now - this.clickState.lastClickTime;
    const distX = Math.abs(x - this.clickState.lastClickX);
    const distY = Math.abs(y - this.clickState.lastClickY);

    if (
      timeDiff < DocumentEditor.CLICK_TIMEOUT &&
      distX <= DocumentEditor.CLICK_DISTANCE &&
      distY <= DocumentEditor.CLICK_DISTANCE
    ) {
      this.clickState.clickCount = (this.clickState.clickCount % 3) + 1;
    } else {
      this.clickState.clickCount = 1;
    }

    this.clickState.lastClickTime = now;
    this.clickState.lastClickX = x;
    this.clickState.lastClickY = y;

    return this.clickState.clickCount;
  }

  /**
   * Select a word at the given position.
   */
  selectWordAt(pos: CursorPosition): void {
    const line = this.lines[pos.line]!.text;
    let start = pos.column;
    let end = pos.column;

    // Expand backwards to word boundary
    while (start > 0 && /\w/.test(line[start - 1]!)) {
      start--;
    }

    // Expand forwards to word boundary
    while (end < line.length && /\w/.test(line[end]!)) {
      end++;
    }

    // Set cursor with selection
    this.cursors = [{
      position: { line: pos.line, column: end },
      selection: {
        anchor: { line: pos.line, column: start },
        head: { line: pos.line, column: end },
      },
      desiredColumn: end,
    }];
    this.primaryCursorIndex = 0;
    this.callbacks.onCursorChange?.(this.cursors);
    this.ctx.markDirty();
  }

  /**
   * Select an entire line.
   */
  selectLine(lineNum: number): void {
    const lineLen = this.lines[lineNum]!.text.length;

    this.cursors = [{
      position: { line: lineNum, column: lineLen },
      selection: {
        anchor: { line: lineNum, column: 0 },
        head: { line: lineNum, column: lineLen },
      },
      desiredColumn: lineLen,
    }];
    this.primaryCursorIndex = 0;
    this.callbacks.onCursorChange?.(this.cursors);
    this.ctx.markDirty();
  }

  /**
   * Select the next occurrence of the currently selected text.
   * If nothing is selected, selects the word under the cursor first.
   */
  selectNextOccurrence(): void {
    const primaryCursor = this.getPrimaryCursor();

    // If no selection, select word under cursor first
    if (!primaryCursor.selection || !this.hasSelectionContent(primaryCursor.selection)) {
      this.selectWordAt(primaryCursor.position);
      return;
    }

    // Get the selected text
    const selectedText = this.getSelectedText();
    if (!selectedText) return;

    // Find the last cursor's position to search from
    const lastCursor = this.cursors[this.cursors.length - 1]!;
    const searchStart = lastCursor.selection
      ? this.getSelectionRange(lastCursor.selection).end
      : lastCursor.position;

    // Search for next occurrence
    const occurrence = this.findTextOccurrence(selectedText, searchStart, true);

    if (occurrence) {
      this.addCursorWithSelection(occurrence.start, occurrence.end);
      this.ensurePrimaryCursorVisible();
      this.callbacks.onCursorChange?.(this.cursors);
    }
  }

  /**
   * Select all occurrences of the currently selected text.
   * If nothing is selected, selects the word under the cursor first.
   */
  selectAllOccurrences(): void {
    const primaryCursor = this.getPrimaryCursor();

    // If no selection, select word under cursor first
    if (!primaryCursor.selection || !this.hasSelectionContent(primaryCursor.selection)) {
      this.selectWordAt(primaryCursor.position);
    }

    // Get the selected text
    const selectedText = this.getSelectedText();
    if (!selectedText) return;

    // Find all occurrences
    const occurrences = this.findAllTextOccurrences(selectedText);

    if (occurrences.length === 0) return;

    // Create cursors for all occurrences
    this.cursors = occurrences.map((occ) => ({
      position: this.clonePosition(occ.end),
      selection: {
        anchor: this.clonePosition(occ.start),
        head: this.clonePosition(occ.end),
      },
      desiredColumn: occ.end.column,
    }));

    this.primaryCursorIndex = 0;
    this.callbacks.onCursorChange?.(this.cursors);
    this.ctx.markDirty();
  }

  /**
   * Find the next occurrence of text starting from a position.
   * Wraps around to the beginning of the document.
   */
  private findTextOccurrence(
    text: string,
    start: CursorPosition,
    wrap: boolean
  ): { start: CursorPosition; end: CursorPosition } | null {
    const searchLines = text.split('\n');
    const isSingleLine = searchLines.length === 1;

    if (isSingleLine) {
      // Single-line search
      for (let line = start.line; line < this.lines.length; line++) {
        const lineText = this.lines[line]!.text;
        const startCol = line === start.line ? start.column : 0;
        const idx = lineText.indexOf(text, startCol);

        if (idx !== -1) {
          // Check if this position is already selected
          const isAlreadySelected = this.cursors.some((c) => {
            if (!c.selection) return false;
            const range = this.getSelectionRange(c.selection);
            return range.start.line === line && range.start.column === idx;
          });

          if (!isAlreadySelected) {
            return {
              start: { line, column: idx },
              end: { line, column: idx + text.length },
            };
          }
        }
      }

      // Wrap around to beginning
      if (wrap) {
        for (let line = 0; line <= start.line; line++) {
          const lineText = this.lines[line]!.text;
          const endCol = line === start.line ? start.column : lineText.length;
          const idx = lineText.indexOf(text);

          if (idx !== -1 && idx < endCol) {
            // Check if this position is already selected
            const isAlreadySelected = this.cursors.some((c) => {
              if (!c.selection) return false;
              const range = this.getSelectionRange(c.selection);
              return range.start.line === line && range.start.column === idx;
            });

            if (!isAlreadySelected) {
              return {
                start: { line, column: idx },
                end: { line, column: idx + text.length },
              };
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Find all occurrences of text in the document.
   */
  private findAllTextOccurrences(text: string): { start: CursorPosition; end: CursorPosition }[] {
    const occurrences: { start: CursorPosition; end: CursorPosition }[] = [];
    const searchLines = text.split('\n');
    const isSingleLine = searchLines.length === 1;

    if (isSingleLine) {
      for (let line = 0; line < this.lines.length; line++) {
        const lineText = this.lines[line]!.text;
        let startIdx = 0;

        while (startIdx < lineText.length) {
          const idx = lineText.indexOf(text, startIdx);
          if (idx === -1) break;

          occurrences.push({
            start: { line, column: idx },
            end: { line, column: idx + text.length },
          });

          startIdx = idx + 1;
        }
      }
    }

    return occurrences;
  }

  /**
   * Add cursors above all current cursors.
   */
  addCursorAbove(): void {
    const newCursors: Cursor[] = [];

    for (const cursor of this.cursors) {
      if (cursor.position.line > 0) {
        const newLine = cursor.position.line - 1;
        const newColumn = Math.min(cursor.desiredColumn, this.lines[newLine]!.text.length);

        // Check if cursor already exists at this position
        const exists = this.cursors.some(
          (c) => c.position.line === newLine && c.position.column === newColumn
        ) || newCursors.some(
          (c) => c.position.line === newLine && c.position.column === newColumn
        );

        if (!exists) {
          newCursors.push({
            position: { line: newLine, column: newColumn },
            selection: null,
            desiredColumn: cursor.desiredColumn,
          });
        }
      }
    }

    if (newCursors.length > 0) {
      this.cursors.push(...newCursors);
      this.sortCursors();
      this.ensurePrimaryCursorVisible();
      this.callbacks.onCursorChange?.(this.cursors);
      this.ctx.markDirty();
    }
  }

  /**
   * Add cursors below all current cursors.
   */
  addCursorBelow(): void {
    const newCursors: Cursor[] = [];

    for (const cursor of this.cursors) {
      if (cursor.position.line < this.lines.length - 1) {
        const newLine = cursor.position.line + 1;
        const newColumn = Math.min(cursor.desiredColumn, this.lines[newLine]!.text.length);

        // Check if cursor already exists at this position
        const exists = this.cursors.some(
          (c) => c.position.line === newLine && c.position.column === newColumn
        ) || newCursors.some(
          (c) => c.position.line === newLine && c.position.column === newColumn
        );

        if (!exists) {
          newCursors.push({
            position: { line: newLine, column: newColumn },
            selection: null,
            desiredColumn: cursor.desiredColumn,
          });
        }
      }
    }

    if (newCursors.length > 0) {
      this.cursors.push(...newCursors);
      this.sortCursors();
      this.ensurePrimaryCursorVisible();
      this.callbacks.onCursorChange?.(this.cursors);
      this.ctx.markDirty();
    }
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
   * Convert a screen row to a buffer line number and wrap offset.
   * Accounts for hidden (folded) lines and word wrapping.
   */
  private screenRowToBufferLine(screenRow: number): { bufferLine: number; wrapOffset: number } | null {
    const { width } = this.bounds;
    const rightMargin = this.getRightMarginWidth();
    const contentWidth = width - this.gutterWidth - rightMargin;

    let bufferLine = this.scrollTop;
    let row = 0;

    while (bufferLine < this.lines.length) {
      // Skip hidden lines
      if (this.foldManager.isHidden(bufferLine)) {
        bufferLine++;
        continue;
      }

      const line = this.lines[bufferLine]!;
      const wrappedRowCount = this.wordWrapEnabled
        ? this.getWrappedRowCount(line.text, contentWidth)
        : 1;

      // Check if target row is within this buffer line's wrapped rows
      if (screenRow >= row && screenRow < row + wrappedRowCount) {
        const wrapOffset = screenRow - row;
        return { bufferLine, wrapOffset };
      }

      row += wrappedRowCount;
      bufferLine++;
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
      cursors: this.cursors.map((c) => this.cloneCursor(c)),
      foldedRegions: this.foldManager.getFoldedLines(),
    };
  }

  override setState(state: unknown): void {
    const s = state as DocumentEditorState;
    if (s.scrollTop !== undefined) {
      this.scrollTop = s.scrollTop;
    }
    if (s.cursors && s.cursors.length > 0) {
      this.cursors = s.cursors.map((c) => this.cloneCursor(c));
      this.primaryCursorIndex = 0;
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
