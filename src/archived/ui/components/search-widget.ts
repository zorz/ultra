/**
 * Search Widget Component
 *
 * A floating search/replace widget for in-file search.
 * Similar to VS Code's find widget.
 *
 * Now extends BaseDialog for consistent API.
 */

import type { RenderContext } from '../renderer.ts';
import type { KeyEvent } from '../../terminal/input.ts';
import type { MouseEvent } from '../mouse.ts';
import type { Document } from '../../core/document.ts';
import { BaseDialog } from './base-dialog.ts';
import { TextInput } from './text-input.ts';
import {
  inFileSearch,
  createTextSearchQuery,
  type SearchMatch,
  type TextSearchOptions,
  type SearchState
} from '../../features/search/in-file-search.ts';
import { themeLoader } from '../themes/theme-loader.ts';

export type SearchMode = 'find' | 'replace';

/**
 * SearchWidget - Find/Replace widget for in-file search
 *
 * @example
 * ```typescript
 * searchWidget.setDocument(document);
 * searchWidget.setPosition(x, y, width);
 * searchWidget.show('find');
 *
 * searchWidget.onNavigate((match) => {
 *   if (match) scrollToMatch(match);
 * });
 * ```
 */
export class SearchWidget extends BaseDialog {
  // Search state
  private _searchInput: TextInput;
  private _replaceInput: TextInput;
  private _options: TextSearchOptions = {
    caseSensitive: false,
    wholeWord: false,
    useRegex: false
  };
  private _mode: SearchMode = 'find';
  private _focusedField: 'search' | 'replace' = 'search';

  // Document and search state
  private _document: Document | null = null;
  private _searchState: SearchState | null = null;

  // Specialized callbacks
  private _navigateCallbacks: Set<(match: SearchMatch | null) => void> = new Set();
  private _replaceCallbacks: Set<() => void> = new Set();

  constructor() {
    super();
    this._debugName = 'SearchWidget';

    // Initialize text inputs
    this._searchInput = new TextInput({
      onChange: () => this.executeSearch()
    });

    this._replaceInput = new TextInput();

    // Subscribe to search updates
    inFileSearch.onUpdate((doc, state) => {
      if (doc === this._document) {
        this._searchState = state;
      }
    });
  }

  // === Lifecycle ===

  /**
   * Show the search widget
   */
  show(mode: SearchMode = 'find'): void {
    this._isVisible = true;
    this._mode = mode;
    this._focusedField = 'search';
    this._rect.height = mode === 'replace' ? 2 : 1;

    // If there's selected text, use it as initial search query
    if (this._document) {
      const selectedText = this._document.getSelectedText();
      if (selectedText && !selectedText.includes('\n')) {
        this._searchInput.setValue(selectedText);
        this.executeSearch();
      }
    }

    this.debugLog(`Showing in ${mode} mode`);
  }

  /**
   * Hide the search widget
   */
  hide(): void {
    if (this._document) {
      inFileSearch.clearSearch(this._document);
    }
    super.hide();
  }

  /**
   * Check if visible (legacy getter API)
   */
  get visible(): boolean {
    return this._isVisible;
  }

  /**
   * Set position (widget-specific API)
   */
  setPosition(x: number, y: number, width: number): void {
    this._rect.x = x;
    this._rect.y = y;
    this._rect.width = Math.max(40, Math.min(width, 70));
    this._rect.height = this._mode === 'replace' ? 2 : 1;
  }

  /**
   * Toggle between find and replace mode
   */
  toggleMode(): void {
    this._mode = this._mode === 'find' ? 'replace' : 'find';
    this._rect.height = this._mode === 'replace' ? 2 : 1;
  }

  // === Document Management ===

  /**
   * Set document to search
   */
  setDocument(doc: Document | null): void {
    this._document = doc;
    if (doc) {
      this._searchState = inFileSearch.getState(doc);
    } else {
      this._searchState = null;
    }
  }

  // === Search Operations ===

  /**
   * Execute search with current query
   */
  private executeSearch(): void {
    if (!this._document) return;

    if (!this._searchInput.value) {
      inFileSearch.clearSearch(this._document);
      return;
    }

    const query = createTextSearchQuery(this._searchInput.value, this._options);
    inFileSearch.search(this._document, query);
  }

  /**
   * Find next match
   */
  findNext(): void {
    if (!this._document) return;
    const match = inFileSearch.nextMatch(this._document);
    this.emitNavigate(match);
  }

  /**
   * Find previous match
   */
  findPrevious(): void {
    if (!this._document) return;
    const match = inFileSearch.previousMatch(this._document);
    this.emitNavigate(match);
  }

  /**
   * Replace current match
   */
  replaceCurrent(): void {
    if (!this._document) return;
    if (inFileSearch.replaceCurrentMatch(this._document, this._replaceInput.value)) {
      this.emitReplace();
      this.findNext();
    }
  }

  /**
   * Replace all matches
   */
  replaceAll(): void {
    if (!this._document) return;
    const count = inFileSearch.replaceAll(this._document, this._replaceInput.value);
    if (count > 0) {
      this.emitReplace();
    }
  }

  // === Options ===

  toggleCaseSensitive(): void {
    this._options.caseSensitive = !this._options.caseSensitive;
    this.executeSearch();
  }

  toggleWholeWord(): void {
    this._options.wholeWord = !this._options.wholeWord;
    this.executeSearch();
  }

  toggleRegex(): void {
    this._options.useRegex = !this._options.useRegex;
    this.executeSearch();
  }

  // === Getters ===

  getSearchQuery(): string {
    return this._searchInput.value;
  }

  getOptions(): TextSearchOptions {
    return { ...this._options };
  }

  getMatches(): SearchMatch[] {
    return this._searchState?.matches || [];
  }

  getCurrentMatchIndex(): number {
    return this._searchState?.currentMatchIndex ?? -1;
  }

  // === Callbacks ===

  onNavigate(callback: (match: SearchMatch | null) => void): () => void {
    this._navigateCallbacks.add(callback);
    return () => {
      this._navigateCallbacks.delete(callback);
    };
  }

  onReplace(callback: () => void): () => void {
    this._replaceCallbacks.add(callback);
    return () => {
      this._replaceCallbacks.delete(callback);
    };
  }

  private emitNavigate(match: SearchMatch | null): void {
    for (const callback of this._navigateCallbacks) {
      try {
        callback(match);
      } catch (e) {
        this.debugLog(`Navigate callback error: ${e}`);
      }
    }
  }

  private emitReplace(): void {
    for (const callback of this._replaceCallbacks) {
      try {
        callback();
      } catch (e) {
        this.debugLog(`Replace callback error: ${e}`);
      }
    }
  }

  // === Keyboard Handling ===

  handleKey(event: KeyEvent): boolean {
    if (!this._isVisible) return false;

    const { key, ctrl, shift, alt, char } = event;

    // Escape - close widget
    if (key === 'ESCAPE') {
      this.hide();
      return true;
    }

    // Enter key behavior
    if (key === 'ENTER') {
      if (ctrl && shift) {
        this.replaceAll();
      } else if (ctrl || (this._focusedField === 'replace' && !shift)) {
        this.replaceCurrent();
      } else if (shift) {
        this.findPrevious();
      } else {
        this.findNext();
      }
      return true;
    }

    // Tab - switch between search and replace fields
    if (key === 'TAB' && this._mode === 'replace') {
      this._focusedField = this._focusedField === 'search' ? 'replace' : 'search';
      return true;
    }

    // Alt+C - toggle case sensitive
    if (alt && (key === 'C' || key === 'c')) {
      this.toggleCaseSensitive();
      return true;
    }

    // Alt+W - toggle whole word
    if (alt && (key === 'W' || key === 'w')) {
      this.toggleWholeWord();
      return true;
    }

    // Alt+R - toggle regex
    if (alt && (key === 'R' || key === 'r')) {
      this.toggleRegex();
      return true;
    }

    // Up/Down - navigate matches
    if (key === 'UP') {
      this.findPrevious();
      return true;
    }

    if (key === 'DOWN') {
      this.findNext();
      return true;
    }

    // Delegate to focused text input
    const input = this._focusedField === 'search' ? this._searchInput : this._replaceInput;
    if (input.handleKey(event)) {
      if (this._focusedField === 'search') {
        this.executeSearch();
      }
      return true;
    }

    // Consume all other keys to prevent them from affecting the editor
    return true;
  }

  // === Mouse Handling ===

  onMouseEvent(event: MouseEvent): boolean {
    if (!this._isVisible) return false;

    const totalHeight = this._mode === 'replace' ? 2 : 1;

    // Check if click is within widget bounds
    if (event.x < this._rect.x || event.x >= this._rect.x + this._rect.width ||
        event.y < this._rect.y || event.y >= this._rect.y + totalHeight) {
      return false;
    }

    if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED') {
      const relX = event.x - this._rect.x;
      const relY = event.y - this._rect.y;

      const inputStartX = 3;
      const inputWidth = Math.max(20, this._rect.width - 28);

      // Check search input click
      if (relY === 0 && relX >= inputStartX && relX < inputStartX + inputWidth) {
        this._focusedField = 'search';
        this._searchInput.setCursorPosition(Math.min(relX - inputStartX, this._searchInput.value.length));
        return true;
      }

      // Check replace input click (if visible)
      if (this._mode === 'replace' && relY === 1 && relX >= inputStartX && relX < inputStartX + inputWidth) {
        this._focusedField = 'replace';
        this._replaceInput.setCursorPosition(Math.min(relX - inputStartX, this._replaceInput.value.length));
        return true;
      }

      // Option buttons
      const optionsX = inputStartX + inputWidth + 1;
      if (relY === 0) {
        if (relX >= optionsX && relX < optionsX + 2) {
          this.toggleCaseSensitive();
          return true;
        }
        if (relX >= optionsX + 3 && relX < optionsX + 5) {
          this.toggleWholeWord();
          return true;
        }
        if (relX >= optionsX + 6 && relX < optionsX + 8) {
          this.toggleRegex();
          return true;
        }

        // Navigation arrows
        const navX = optionsX + 9;
        if (relX === navX) {
          this.findPrevious();
          return true;
        }
        if (relX === navX + 1) {
          this.findNext();
          return true;
        }

        // Close button
        if (relX >= this._rect.width - 3) {
          this.hide();
          return true;
        }
      }

      // Replace row buttons
      if (this._mode === 'replace' && relY === 1) {
        const replaceButtonX = inputStartX + inputWidth + 1;
        if (relX >= replaceButtonX && relX < replaceButtonX + 4) {
          this.replaceCurrent();
          return true;
        }
        if (relX >= replaceButtonX + 4 && relX < replaceButtonX + 9) {
          this.replaceAll();
          return true;
        }
      }

      return true;
    }

    return false;
  }

  containsPoint(x: number, y: number): boolean {
    const totalHeight = this._mode === 'replace' ? 2 : 1;
    return this._isVisible &&
           x >= this._rect.x && x < this._rect.x + this._rect.width &&
           y >= this._rect.y && y < this._rect.y + totalHeight;
  }

  // === Rendering ===

  render(ctx: RenderContext): void {
    if (!this._isVisible) return;

    const bgColor = themeLoader.getColor('input.background') || '#3c3c3c';
    const fgColor = themeLoader.getColor('input.foreground') || '#cccccc';
    const focusBorderColor = themeLoader.getColor('focusBorder') || '#007fd4';
    const inputBg = '#2d2d2d';

    const totalHeight = this._mode === 'replace' ? 2 : 1;
    const inputWidth = Math.max(20, this._rect.width - 28);

    // Draw background
    for (let row = 0; row < totalHeight; row++) {
      ctx.fill(this._rect.x, this._rect.y + row, this._rect.width, 1, ' ', fgColor, bgColor);
    }

    // === Search Row ===
    const searchY = this._rect.y;
    let col = this._rect.x + 1;

    // Search icon
    ctx.drawStyled(col, searchY, '/', '#888888', bgColor);
    col += 2;

    // Search input
    const searchFocused = this._focusedField === 'search';
    ctx.fill(col, searchY, inputWidth, 1, ' ', fgColor, inputBg);

    const visibleQuery = this._searchInput.value.slice(0, inputWidth - 1);
    ctx.drawStyled(col, searchY, visibleQuery, fgColor, inputBg);

    if (searchFocused) {
      const cursorPos = Math.min(this._searchInput.cursorPosition, inputWidth - 1);
      ctx.drawStyled(col + cursorPos, searchY, '▏', focusBorderColor, inputBg);
    }
    col += inputWidth + 1;

    // Option toggles
    const caseColor = this._options.caseSensitive ? '#e5c07b' : '#666666';
    const wordColor = this._options.wholeWord ? '#e5c07b' : '#666666';
    const regexColor = this._options.useRegex ? '#e5c07b' : '#666666';

    ctx.drawStyled(col, searchY, 'Aa', caseColor, bgColor);
    col += 3;
    ctx.drawStyled(col, searchY, 'ab', wordColor, bgColor);
    col += 3;
    ctx.drawStyled(col, searchY, '.*', regexColor, bgColor);
    col += 3;

    // Navigation arrows
    ctx.drawStyled(col, searchY, '↑', '#888888', bgColor);
    col += 1;
    ctx.drawStyled(col, searchY, '↓', '#888888', bgColor);
    col += 2;

    // Match count
    const matchCount = this._searchState?.matches.length || 0;
    const currentMatch = (this._searchState?.currentMatchIndex ?? -1) + 1;
    const countText = matchCount > 0
      ? `${currentMatch}/${matchCount}`
      : (this._searchInput.value ? '0/0' : '');
    ctx.drawStyled(col, searchY, countText, '#888888', bgColor);
    col += countText.length + 1;

    // Close button
    ctx.drawStyled(this._rect.x + this._rect.width - 2, searchY, '×', '#888888', bgColor);

    // === Replace Row ===
    if (this._mode === 'replace') {
      const replaceY = this._rect.y + 1;
      col = this._rect.x + 1;

      // Replace icon
      ctx.drawStyled(col, replaceY, '→', '#888888', bgColor);
      col += 2;

      // Replace input
      const replaceFocused = this._focusedField === 'replace';
      ctx.fill(col, replaceY, inputWidth, 1, ' ', fgColor, inputBg);

      const visibleReplace = this._replaceInput.value.slice(0, inputWidth - 1);
      ctx.drawStyled(col, replaceY, visibleReplace, fgColor, inputBg);

      if (replaceFocused) {
        const cursorPos = Math.min(this._replaceInput.cursorPosition, inputWidth - 1);
        ctx.drawStyled(col + cursorPos, replaceY, '▏', focusBorderColor, inputBg);
      }
      col += inputWidth + 1;

      // Replace buttons
      ctx.drawStyled(col, replaceY, '[⏎]', '#888888', bgColor);
      col += 4;
      ctx.drawStyled(col, replaceY, '[All]', '#888888', bgColor);
    }
  }
}

// Singleton instance
export const searchWidget = new SearchWidget();
export default searchWidget;
