/**
 * Search Widget Component
 * 
 * A floating search/replace widget for in-file search.
 * Similar to VS Code's find widget.
 */

import type { RenderContext } from '../renderer.ts';
import type { KeyEvent } from '../../terminal/input.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import type { Document } from '../../core/document.ts';
import { 
  inFileSearch, 
  createTextSearchQuery, 
  type SearchMatch, 
  type TextSearchOptions,
  type SearchState
} from '../../features/search/in-file-search.ts';
import { themeLoader } from '../themes/theme-loader.ts';

export type SearchMode = 'find' | 'replace';

interface SearchWidgetState {
  searchQuery: string;
  replaceQuery: string;
  options: TextSearchOptions;
  mode: SearchMode;
  focusedField: 'search' | 'replace';
  cursorPosition: number;  // Cursor position in current input field
}

export class SearchWidget implements MouseHandler {
  private isVisible: boolean = false;
  private x: number = 0;
  private y: number = 0;
  private width: number = 50;
  private height: number = 2;  // 2 for find, 3 for replace
  
  private state: SearchWidgetState = {
    searchQuery: '',
    replaceQuery: '',
    options: {
      caseSensitive: false,
      wholeWord: false,
      useRegex: false
    },
    mode: 'find',
    focusedField: 'search',
    cursorPosition: 0
  };

  private document: Document | null = null;
  private searchState: SearchState | null = null;
  
  // Callbacks
  private onCloseCallback?: () => void;
  private onNavigateCallback?: (match: SearchMatch | null) => void;
  private onReplaceCallback?: () => void;

  constructor() {
    // Subscribe to search updates
    inFileSearch.onUpdate((doc, state) => {
      if (doc === this.document) {
        this.searchState = state;
      }
    });
  }

  /**
   * Show the search widget
   */
  show(mode: SearchMode = 'find'): void {
    this.isVisible = true;
    this.state.mode = mode;
    this.state.focusedField = 'search';
    this.height = mode === 'replace' ? 3 : 2;
    
    // If there's selected text, use it as initial search query
    if (this.document) {
      const selectedText = this.document.getSelectedText();
      if (selectedText && !selectedText.includes('\n')) {
        this.state.searchQuery = selectedText;
        this.state.cursorPosition = selectedText.length;
        this.executeSearch();
      }
    }
  }

  /**
   * Hide the search widget
   */
  hide(): void {
    this.isVisible = false;
    if (this.document) {
      inFileSearch.clearSearch(this.document);
    }
    if (this.onCloseCallback) {
      this.onCloseCallback();
    }
  }

  /**
   * Toggle between find and replace mode
   */
  toggleMode(): void {
    this.state.mode = this.state.mode === 'find' ? 'replace' : 'find';
    this.height = this.state.mode === 'replace' ? 3 : 2;
  }

  /**
   * Check if widget is visible
   */
  get visible(): boolean {
    return this.isVisible;
  }

  /**
   * Set position
   */
  setPosition(x: number, y: number, width: number): void {
    this.x = x;
    this.y = y;
    this.width = Math.max(40, Math.min(width, 70));
  }

  /**
   * Set document to search
   */
  setDocument(doc: Document | null): void {
    this.document = doc;
    if (doc) {
      this.searchState = inFileSearch.getState(doc);
    } else {
      this.searchState = null;
    }
  }

  /**
   * Set close callback
   */
  onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  /**
   * Set navigate callback
   */
  onNavigate(callback: (match: SearchMatch | null) => void): void {
    this.onNavigateCallback = callback;
  }

  /**
   * Set replace callback
   */
  onReplace(callback: () => void): void {
    this.onReplaceCallback = callback;
  }

  /**
   * Get current search query
   */
  getSearchQuery(): string {
    return this.state.searchQuery;
  }

  /**
   * Get search options
   */
  getOptions(): TextSearchOptions {
    return { ...this.state.options };
  }

  /**
   * Get matches from current search state
   */
  getMatches(): SearchMatch[] {
    return this.searchState?.matches || [];
  }

  /**
   * Get current match index
   */
  getCurrentMatchIndex(): number {
    return this.searchState?.currentMatchIndex ?? -1;
  }

  /**
   * Handle keyboard input
   */
  handleKey(event: KeyEvent): boolean {
    if (!this.isVisible) return false;

    const { key, ctrl, shift, alt } = event;

    // Escape - close widget
    if (key === 'ESCAPE') {
      this.hide();
      return true;
    }

    // Enter key behavior
    if (key === 'ENTER' || key === 'RETURN') {
      if (ctrl && shift) {
        // Ctrl+Shift+Enter: Replace all
        this.replaceAll();
      } else if (ctrl || (this.state.focusedField === 'replace' && !shift)) {
        // Ctrl+Enter OR Enter in replace field: Replace current and find next
        this.replaceCurrent();
      } else if (shift) {
        // Shift+Enter: Find previous
        this.findPrevious();
      } else {
        // Enter: Find next
        this.findNext();
      }
      return true;
    }

    // Tab - switch between search and replace fields
    if (key === 'TAB' && this.state.mode === 'replace') {
      this.state.focusedField = this.state.focusedField === 'search' ? 'replace' : 'search';
      const field = this.state.focusedField === 'search' ? this.state.searchQuery : this.state.replaceQuery;
      this.state.cursorPosition = field.length;
      return true;
    }

    // Alt+C - toggle case sensitive
    if (alt && key === 'c') {
      this.toggleCaseSensitive();
      return true;
    }

    // Alt+W - toggle whole word
    if (alt && key === 'w') {
      this.toggleWholeWord();
      return true;
    }

    // Alt+R - toggle regex
    if (alt && key === 'R') {
      this.toggleRegex();
      return true;
    }

    // Arrow keys for cursor movement within input
    if (key === 'LEFT') {
      if (this.state.cursorPosition > 0) {
        this.state.cursorPosition--;
      }
      return true;
    }

    if (key === 'RIGHT') {
      const maxLen = this.state.focusedField === 'search' 
        ? this.state.searchQuery.length 
        : this.state.replaceQuery.length;
      if (this.state.cursorPosition < maxLen) {
        this.state.cursorPosition++;
      }
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

    // Home/End
    if (key === 'HOME') {
      this.state.cursorPosition = 0;
      return true;
    }

    if (key === 'END') {
      const field = this.state.focusedField === 'search' ? this.state.searchQuery : this.state.replaceQuery;
      this.state.cursorPosition = field.length;
      return true;
    }

    // Backspace
    if (key === 'BACKSPACE') {
      if (this.state.cursorPosition > 0) {
        if (this.state.focusedField === 'search') {
          this.state.searchQuery = 
            this.state.searchQuery.slice(0, this.state.cursorPosition - 1) +
            this.state.searchQuery.slice(this.state.cursorPosition);
        } else {
          this.state.replaceQuery = 
            this.state.replaceQuery.slice(0, this.state.cursorPosition - 1) +
            this.state.replaceQuery.slice(this.state.cursorPosition);
        }
        this.state.cursorPosition--;
        this.executeSearch();
      }
      return true;
    }

    // Delete
    if (key === 'DELETE') {
      const field = this.state.focusedField === 'search' ? this.state.searchQuery : this.state.replaceQuery;
      if (this.state.cursorPosition < field.length) {
        if (this.state.focusedField === 'search') {
          this.state.searchQuery = 
            this.state.searchQuery.slice(0, this.state.cursorPosition) +
            this.state.searchQuery.slice(this.state.cursorPosition + 1);
        } else {
          this.state.replaceQuery = 
            this.state.replaceQuery.slice(0, this.state.cursorPosition) +
            this.state.replaceQuery.slice(this.state.cursorPosition + 1);
        }
        this.executeSearch();
      }
      return true;
    }

    // Ctrl+A - select all (in input)
    if (ctrl && key === 'a') {
      // For now, just move cursor to end
      const field = this.state.focusedField === 'search' ? this.state.searchQuery : this.state.replaceQuery;
      this.state.cursorPosition = field.length;
      return true;
    }

    // Regular character input - use event.char for actual character (preserves case)
    const char = (event as any).char;
    if (char && char.length === 1 && !ctrl && !alt) {
      if (this.state.focusedField === 'search') {
        this.state.searchQuery = 
          this.state.searchQuery.slice(0, this.state.cursorPosition) +
          char +
          this.state.searchQuery.slice(this.state.cursorPosition);
      } else {
        this.state.replaceQuery = 
          this.state.replaceQuery.slice(0, this.state.cursorPosition) +
          char +
          this.state.replaceQuery.slice(this.state.cursorPosition);
      }
      this.state.cursorPosition++;
      this.executeSearch();
      return true;
    }

    // Consume all other keys to prevent them from affecting the editor
    return true;
  }

  /**
   * Execute search with current query
   */
  private executeSearch(): void {
    if (!this.document) return;

    if (!this.state.searchQuery) {
      inFileSearch.clearSearch(this.document);
      return;
    }

    const query = createTextSearchQuery(this.state.searchQuery, this.state.options);
    inFileSearch.search(this.document, query);
  }

  /**
   * Find next match
   */
  findNext(): void {
    if (!this.document) return;
    const match = inFileSearch.nextMatch(this.document);
    if (this.onNavigateCallback) {
      this.onNavigateCallback(match);
    }
  }

  /**
   * Find previous match
   */
  findPrevious(): void {
    if (!this.document) return;
    const match = inFileSearch.previousMatch(this.document);
    if (this.onNavigateCallback) {
      this.onNavigateCallback(match);
    }
  }

  /**
   * Replace current match
   */
  replaceCurrent(): void {
    if (!this.document) return;
    if (inFileSearch.replaceCurrentMatch(this.document, this.state.replaceQuery)) {
      if (this.onReplaceCallback) {
        this.onReplaceCallback();
      }
      // Auto-advance to next match
      this.findNext();
    }
  }

  /**
   * Replace all matches
   */
  replaceAll(): void {
    if (!this.document) return;
    const count = inFileSearch.replaceAll(this.document, this.state.replaceQuery);
    if (count > 0 && this.onReplaceCallback) {
      this.onReplaceCallback();
    }
  }

  /**
   * Toggle case sensitive option
   */
  toggleCaseSensitive(): void {
    this.state.options.caseSensitive = !this.state.options.caseSensitive;
    this.executeSearch();
  }

  /**
   * Toggle whole word option
   */
  toggleWholeWord(): void {
    this.state.options.wholeWord = !this.state.options.wholeWord;
    this.executeSearch();
  }

  /**
   * Toggle regex option
   */
  toggleRegex(): void {
    this.state.options.useRegex = !this.state.options.useRegex;
    this.executeSearch();
  }

  /**
   * Render the search widget
   */
  render(ctx: RenderContext): void {
    if (!this.isVisible) return;

    const bgColor = themeLoader.getColor('input.background') || '#3c3c3c';
    const fgColor = themeLoader.getColor('input.foreground') || '#cccccc';
    const borderColor = themeLoader.getColor('input.border') || '#3c3c3c';
    const focusBorderColor = themeLoader.getColor('focusBorder') || '#007fd4';
    const inputBg = '#2d2d2d';
    
    // Calculate dimensions
    const totalHeight = this.state.mode === 'replace' ? 2 : 1;
    const inputWidth = Math.max(20, this.width - 28);
    
    // Draw background
    for (let row = 0; row < totalHeight; row++) {
      ctx.fill(this.x, this.y + row, this.width, 1, ' ', fgColor, bgColor);
    }

    // === Search Row ===
    const searchY = this.y;
    let col = this.x + 1;
    
    // Search icon/label
    ctx.drawStyled(col, searchY, '/', '#888888', bgColor);
    col += 2;
    
    // Search input field
    const searchFocused = this.state.focusedField === 'search';
    ctx.fill(col, searchY, inputWidth, 1, ' ', fgColor, inputBg);
    
    // Display search query
    const visibleQuery = this.state.searchQuery.slice(0, inputWidth - 1);
    ctx.drawStyled(col, searchY, visibleQuery, fgColor, inputBg);
    
    // Draw cursor
    if (searchFocused) {
      const cursorPos = Math.min(this.state.cursorPosition, inputWidth - 1);
      ctx.drawStyled(col + cursorPos, searchY, '▏', focusBorderColor, inputBg);
    }
    col += inputWidth + 1;
    
    // Option toggles
    const caseColor = this.state.options.caseSensitive ? '#e5c07b' : '#666666';
    const wordColor = this.state.options.wholeWord ? '#e5c07b' : '#666666';
    const regexColor = this.state.options.useRegex ? '#e5c07b' : '#666666';
    
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
    const matchCount = this.searchState?.matches.length || 0;
    const currentMatch = (this.searchState?.currentMatchIndex ?? -1) + 1;
    const countText = matchCount > 0 
      ? `${currentMatch}/${matchCount}` 
      : (this.state.searchQuery ? '0/0' : '');
    ctx.drawStyled(col, searchY, countText, '#888888', bgColor);
    col += countText.length + 1;
    
    // Close button
    ctx.drawStyled(this.x + this.width - 2, searchY, '×', '#888888', bgColor);

    // === Replace Row (if in replace mode) ===
    if (this.state.mode === 'replace') {
      const replaceY = this.y + 1;
      col = this.x + 1;
      
      // Replace icon
      ctx.drawStyled(col, replaceY, '→', '#888888', bgColor);
      col += 2;
      
      // Replace input field
      const replaceFocused = this.state.focusedField === 'replace';
      ctx.fill(col, replaceY, inputWidth, 1, ' ', fgColor, inputBg);
      
      // Display replace query
      const visibleReplace = this.state.replaceQuery.slice(0, inputWidth - 1);
      ctx.drawStyled(col, replaceY, visibleReplace, fgColor, inputBg);
      
      // Draw cursor
      if (replaceFocused) {
        const cursorPos = Math.min(this.state.cursorPosition, inputWidth - 1);
        ctx.drawStyled(col + cursorPos, replaceY, '▏', focusBorderColor, inputBg);
      }
      col += inputWidth + 1;
      
      // Replace buttons with clearer labels
      ctx.drawStyled(col, replaceY, '[⏎]', '#888888', bgColor);  // Replace current (Enter)
      col += 4;
      ctx.drawStyled(col, replaceY, '[All]', '#888888', bgColor);  // Replace all (Ctrl+Shift+Enter)
    }
  }

  /**
   * Handle mouse events
   */
  onMouseEvent(event: MouseEvent): boolean {
    if (!this.isVisible) return false;

    const totalHeight = this.state.mode === 'replace' ? 2 : 1;
    
    // Check if click is within widget bounds
    if (event.x < this.x || event.x >= this.x + this.width ||
        event.y < this.y || event.y >= this.y + totalHeight) {
      return false;
    }

    if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED') {
      const relX = event.x - this.x;
      const relY = event.y - this.y;

      // Input field layout
      const inputStartX = 3;
      const inputWidth = Math.max(20, this.width - 28);

      // Check search input click
      if (relY === 0 && relX >= inputStartX && relX < inputStartX + inputWidth) {
        this.state.focusedField = 'search';
        this.state.cursorPosition = Math.min(relX - inputStartX, this.state.searchQuery.length);
        return true;
      }

      // Check replace input click (if visible)
      if (this.state.mode === 'replace' && relY === 1 && relX >= inputStartX && relX < inputStartX + inputWidth) {
        this.state.focusedField = 'replace';
        this.state.cursorPosition = Math.min(relX - inputStartX, this.state.replaceQuery.length);
        return true;
      }

      // Option buttons (after input field)
      const optionsX = inputStartX + inputWidth + 1;
      if (relY === 0) {
        // Case sensitive (Aa)
        if (relX >= optionsX && relX < optionsX + 2) {
          this.toggleCaseSensitive();
          return true;
        }
        // Whole word (ab)
        if (relX >= optionsX + 3 && relX < optionsX + 5) {
          this.toggleWholeWord();
          return true;
        }
        // Regex (.*)
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
        if (relX >= this.width - 3) {
          this.hide();
          return true;
        }
      }

      // Replace row buttons
      if (this.state.mode === 'replace' && relY === 1) {
        const replaceButtonX = inputStartX + inputWidth + 1;
        // [⏎] button (4 chars wide)
        if (relX >= replaceButtonX && relX < replaceButtonX + 4) {
          this.replaceCurrent();
          return true;
        }
        // [All] button (5 chars wide)
        if (relX >= replaceButtonX + 4 && relX < replaceButtonX + 9) {
          this.replaceAll();
          return true;
        }
      }

      return true;  // Consume click within widget
    }

    return false;
  }

  /**
   * Check if point is within widget bounds
   */
  containsPoint(x: number, y: number): boolean {
    const totalHeight = this.state.mode === 'replace' ? 2 : 1;
    return this.isVisible &&
           x >= this.x && x < this.x + this.width &&
           y >= this.y && y < this.y + totalHeight;
  }
}

// Singleton instance
export const searchWidget = new SearchWidget();

export default searchWidget;
