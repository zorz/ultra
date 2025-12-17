/**
 * SearchableDialog - Base class for dialogs with fuzzy search
 *
 * Extends BaseDialog with:
 * - Query input and filtering
 * - Item selection (up/down navigation)
 * - Fuzzy search scoring
 * - Result list rendering
 * - Confirm/cancel actions
 *
 * Used by: CommandPalette, FilePicker, and similar searchable dialogs
 */

import type { RenderContext } from '../renderer.ts';
import type { MouseEvent } from '../mouse.ts';
import type { KeyEvent } from '../../terminal/input.ts';
import type { Rect } from '../layout.ts';
import { BaseDialog, type BaseDialogConfig } from './base-dialog.ts';
import { TextInput } from './text-input.ts';
import { RenderUtils } from '../render-utils.ts';

/**
 * Scored item for search results
 */
export interface ScoredItem<T> {
  item: T;
  score: number;
}

/**
 * Configuration for searchable dialogs
 */
export interface SearchableDialogConfig extends BaseDialogConfig {
  /** Placeholder text for empty search */
  placeholder?: string;
  /** Whether to show search input */
  showSearchInput?: boolean;
  /** Maximum visible results */
  maxResults?: number;
}

/**
 * Item display configuration for rendering
 */
export interface ItemDisplayConfig {
  /** Primary text to display */
  text: string;
  /** Secondary text (e.g., path, category) */
  secondary?: string;
  /** Icon character */
  icon?: string;
  /** Whether this is the current/active item */
  isCurrent?: boolean;
}

/**
 * Abstract searchable dialog base class
 *
 * Generic type T represents the item type in the list.
 * Subclasses must implement:
 * - getItemDisplay(): How to render each item
 * - scoreItem(): How to score items against query
 * - onItemSelected(): What happens when an item is confirmed
 */
export abstract class SearchableDialog<T> extends BaseDialog {
  // === Search State ===
  protected _textInput: TextInput;
  protected _items: T[] = [];
  protected _filteredItems: ScoredItem<T>[] = [];
  protected _selectedIndex: number = 0;
  protected _scrollOffset: number = 0;
  protected _maxVisibleResults: number = 15;
  protected _showSearchInput: boolean = true;

  // === Callbacks ===
  protected _selectCallbacks: Set<(item: T) => void> = new Set();
  protected _cancelCallbacks: Set<() => void> = new Set();

  // === Visual State ===
  protected _highlightedId: string = '';  // For marking current/active item

  constructor() {
    super();
    this._debugName = 'SearchableDialog';

    // Initialize text input with callbacks
    this._textInput = new TextInput({
      onChange: () => this.onQueryChange(),
      onSubmit: () => this.confirm(),
      onCancel: () => this.hide()
    });
  }

  // === Lifecycle ===

  /**
   * Show the dialog with items
   */
  protected showWithItems(
    config: SearchableDialogConfig,
    items: T[],
    highlightId?: string
  ): void {
    this.showBase(config);

    this._items = items;
    this._highlightedId = highlightId || '';
    this._selectedIndex = 0;
    this._scrollOffset = 0;
    this._showSearchInput = config.showSearchInput !== false;
    this._maxVisibleResults = config.maxResults || Math.max(5, this._rect.height - 4);

    // Reset text input
    this._textInput.reset();

    // Find highlighted item's index
    if (highlightId) {
      const idx = this.findItemIndex(highlightId);
      if (idx >= 0) {
        this._selectedIndex = idx;
        this.ensureSelectedVisible();
      }
    }

    // Initial filter
    this.filter();

    this.debugLog(`Showing with ${items.length} items`);
  }

  /**
   * Hide and reset
   */
  hide(): void {
    // Trigger cancel callbacks
    for (const callback of this._cancelCallbacks) {
      try {
        callback();
      } catch (e) {
        this.debugLog(`Cancel callback error: ${e}`);
      }
    }
    super.hide();
  }

  // === Query Management ===

  /**
   * Get current search query
   */
  getQuery(): string {
    return this._textInput.value;
  }

  /**
   * Set search query
   */
  setQuery(query: string): void {
    this._textInput.setValue(query);
    // onChange will be triggered automatically
  }

  /**
   * Append character to query
   */
  appendToQuery(char: string): void {
    this._textInput.appendChar(char);
  }

  /**
   * Delete last character from query
   */
  backspaceQuery(): void {
    this._textInput.backspace();
  }

  /**
   * Called when query changes
   */
  protected onQueryChange(): void {
    this._selectedIndex = 0;
    this._scrollOffset = 0;
    this.filter();
  }

  // === Filtering ===

  /**
   * Filter items based on current query
   */
  protected filter(): void {
    const query = this._textInput.value.toLowerCase();

    if (!query) {
      // No query - show all items in original order
      this._filteredItems = this._items.map(item => ({
        item,
        score: 0
      }));
      return;
    }

    // Score and filter items
    const results: ScoredItem<T>[] = [];
    for (const item of this._items) {
      const score = this.scoreItem(item, query);
      if (score > 0) {
        results.push({ item, score });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    this._filteredItems = results;

    this.debugLog(`Filtered to ${results.length} items for query "${query}"`);
  }

  /**
   * Score an item against the query - must be implemented by subclasses
   * @returns Score > 0 for matches, 0 for non-matches
   */
  protected abstract scoreItem(item: T, query: string): number;

  /**
   * Find item index by ID - override in subclasses
   */
  protected findItemIndex(_id: string): number {
    return -1;  // Default: not found
  }

  // === Selection ===

  /**
   * Get currently selected item
   */
  getSelectedItem(): T | null {
    return this._filteredItems[this._selectedIndex]?.item ?? null;
  }

  /**
   * Get selected index
   */
  getSelectedIndex(): number {
    return this._selectedIndex;
  }

  /**
   * Select next item
   */
  selectNext(): void {
    if (this._selectedIndex < this._filteredItems.length - 1) {
      this._selectedIndex++;
      this.ensureSelectedVisible();
    }
  }

  /**
   * Select previous item
   */
  selectPrevious(): void {
    if (this._selectedIndex > 0) {
      this._selectedIndex--;
      this.ensureSelectedVisible();
    }
  }

  /**
   * Select item by index
   */
  selectIndex(index: number): void {
    if (index >= 0 && index < this._filteredItems.length) {
      this._selectedIndex = index;
      this.ensureSelectedVisible();
    }
  }

  /**
   * Ensure selected item is visible in scroll view
   */
  protected ensureSelectedVisible(): void {
    if (this._selectedIndex < this._scrollOffset) {
      this._scrollOffset = this._selectedIndex;
    } else if (this._selectedIndex >= this._scrollOffset + this._maxVisibleResults) {
      this._scrollOffset = this._selectedIndex - this._maxVisibleResults + 1;
    }
  }

  // === Actions ===

  /**
   * Confirm selection
   */
  async confirm(): Promise<void> {
    const item = this.getSelectedItem();
    if (!item) {
      this.debugLog('Confirm called but no item selected');
      return;
    }

    this.debugLog('Confirming selection');

    // Call select callbacks
    for (const callback of this._selectCallbacks) {
      try {
        callback(item);
      } catch (e) {
        this.debugLog(`Select callback error: ${e}`);
      }
    }

    // Call abstract handler
    await this.onItemSelected(item);
  }

  /**
   * Called when an item is selected - subclasses can override
   */
  protected async onItemSelected(_item: T): Promise<void> {
    this.hide();
  }

  // === Callbacks ===

  /**
   * Register selection callback
   */
  onSelect(callback: (item: T) => void): () => void {
    this._selectCallbacks.add(callback);
    return () => {
      this._selectCallbacks.delete(callback);
    };
  }

  /**
   * Register cancel callback
   */
  onCancel(callback: () => void): () => void {
    this._cancelCallbacks.add(callback);
    return () => {
      this._cancelCallbacks.delete(callback);
    };
  }

  // === Keyboard Handling ===

  /**
   * Handle keyboard input
   */
  handleKey(event: KeyEvent): boolean {
    if (!this._isVisible) return false;

    const { key, ctrl } = event;

    // Navigation
    if (key === 'UP' || (ctrl && key === 'P')) {
      this.selectPrevious();
      return true;
    }

    if (key === 'DOWN' || (ctrl && key === 'N')) {
      this.selectNext();
      return true;
    }

    // Page navigation
    if (key === 'PAGEUP') {
      for (let i = 0; i < this._maxVisibleResults; i++) {
        this.selectPrevious();
      }
      return true;
    }

    if (key === 'PAGEDOWN') {
      for (let i = 0; i < this._maxVisibleResults; i++) {
        this.selectNext();
      }
      return true;
    }

    // Home/End for list navigation
    if (ctrl && key === 'HOME') {
      this._selectedIndex = 0;
      this._scrollOffset = 0;
      return true;
    }

    if (ctrl && key === 'END') {
      this._selectedIndex = Math.max(0, this._filteredItems.length - 1);
      this.ensureSelectedVisible();
      return true;
    }

    // Confirm
    if (key === 'ENTER') {
      this.confirm();
      return true;
    }

    // Escape
    if (key === 'ESCAPE') {
      this.hide();
      return true;
    }

    // Tab - could be used for autocomplete in subclasses
    if (key === 'TAB') {
      // Default: do nothing, subclasses can override
      return true;
    }

    // Pass to text input for character handling
    return this._textInput.handleKey(event);
  }

  // === Mouse Handling ===

  /**
   * Handle mouse events
   */
  onMouseEvent(event: MouseEvent): boolean {
    if (!this._isVisible) return false;

    if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED') {
      if (!this.containsPoint(event.x, event.y)) {
        // Click outside - close
        this.hide();
        return true;
      }

      // Calculate which item was clicked
      const { relY } = this.getRelativeCoords(event.x, event.y);
      const listStartY = this._showSearchInput ? 3 : 1;
      const itemIndex = relY - listStartY + this._scrollOffset;

      if (itemIndex >= 0 && itemIndex < this._filteredItems.length) {
        this._selectedIndex = itemIndex;
        this.confirm();
        return true;
      }
    }

    // Scroll wheel
    if (event.name === 'MOUSE_WHEEL_UP') {
      this.selectPrevious();
      return true;
    }

    if (event.name === 'MOUSE_WHEEL_DOWN') {
      this.selectNext();
      return true;
    }

    return this.containsPoint(event.x, event.y);
  }

  // === Rendering ===

  /**
   * Get display configuration for an item - must be implemented by subclasses
   */
  protected abstract getItemDisplay(item: T, isSelected: boolean): ItemDisplayConfig;

  /**
   * Render the dialog
   */
  render(ctx: RenderContext): void {
    if (!this._isVisible) return;

    const colors = this.getColors();

    // Background and border
    this.renderBackground(ctx);

    // Title
    this.renderTitle(ctx);

    // Search input (if shown)
    if (this._showSearchInput) {
      this.renderSearchInput(ctx);
      this.renderSeparator(ctx, 2);
    }

    // Results list
    this.renderResults(ctx);

    // Footer with count
    this.renderFooter(ctx);
  }

  /**
   * Render the search input field
   */
  protected renderSearchInput(ctx: RenderContext): void {
    const colors = this.getColors();
    const inputY = this._rect.y + 1;
    const inputX = this._rect.x + 1;
    const inputWidth = this._rect.width - 2;

    // Input background
    ctx.fill(inputX, inputY, inputWidth, 1, ' ', colors.inputForeground, colors.inputBackground);

    // Prompt character
    ctx.drawStyled(inputX + 1, inputY, '> ', colors.titleForeground, colors.inputBackground);

    // Query text
    const query = this._textInput.value;
    const displayQuery = RenderUtils.truncateText(query, inputWidth - 6);
    ctx.drawStyled(inputX + 3, inputY, displayQuery, colors.inputForeground, colors.inputBackground);

    // Cursor
    const cursorX = inputX + 3 + Math.min(this._textInput.cursorPosition, inputWidth - 6);
    ctx.drawStyled(cursorX, inputY, '│', colors.inputFocusBorder, colors.inputBackground);
  }

  /**
   * Render the results list
   */
  protected renderResults(ctx: RenderContext): void {
    const colors = this.getColors();
    const listStartY = this._rect.y + (this._showSearchInput ? 3 : 1);
    const listHeight = this._rect.height - (this._showSearchInput ? 4 : 2);
    const listWidth = this._rect.width - 2;

    if (this._filteredItems.length === 0) {
      const emptyMessage = this._textInput.value
        ? 'No matching items'
        : 'Type to search...';
      ctx.drawStyled(
        this._rect.x + 3,
        listStartY + 1,
        emptyMessage,
        colors.hintForeground,
        colors.background
      );
      return;
    }

    // Render visible items
    for (let i = 0; i < Math.min(listHeight, this._filteredItems.length - this._scrollOffset); i++) {
      const itemIndex = this._scrollOffset + i;
      const scoredItem = this._filteredItems[itemIndex]!;
      const isSelected = itemIndex === this._selectedIndex;

      const display = this.getItemDisplay(scoredItem.item, isSelected);
      this.renderItem(ctx, listStartY + i, listWidth, display, isSelected);
    }
  }

  /**
   * Render a single item
   */
  protected renderItem(
    ctx: RenderContext,
    y: number,
    width: number,
    display: ItemDisplayConfig,
    isSelected: boolean
  ): void {
    const colors = this.getColors();
    const x = this._rect.x + 1;

    // Background
    const bgColor = isSelected ? colors.selectedBackground : colors.background;
    ctx.fill(x, y, width, 1, ' ', undefined, bgColor);

    // Icon (if any)
    let textX = x + 1;
    if (display.icon) {
      ctx.drawStyled(textX, y, display.icon, colors.hintForeground, bgColor);
      textX += 2;
    }

    // Current marker
    if (display.isCurrent) {
      ctx.drawStyled(textX, y, '✓ ', '#98c379', bgColor);
      textX += 2;
    }

    // Primary text
    const primaryColor = isSelected ? colors.selectedForeground : colors.foreground;
    const maxPrimaryWidth = width - (textX - x) - (display.secondary ? 15 : 2);
    const displayText = RenderUtils.truncateText(display.text, maxPrimaryWidth);
    ctx.drawStyled(textX, y, displayText, primaryColor, bgColor);

    // Secondary text (right-aligned)
    if (display.secondary) {
      const secondaryColor = isSelected ? RenderUtils.lighten(colors.hintForeground, 20) : colors.hintForeground;
      const secondaryX = x + width - display.secondary.length - 2;
      if (secondaryX > textX + displayText.length + 2) {
        ctx.drawStyled(secondaryX, y, display.secondary, secondaryColor, bgColor);
      }
    }
  }

  /**
   * Render footer with item count
   */
  protected renderFooter(ctx: RenderContext): void {
    const colors = this.getColors();
    const footerY = this._rect.y + this._rect.height - 1;
    const count = `${this._filteredItems.length} items`;
    ctx.drawStyled(
      this._rect.x + this._rect.width - count.length - 2,
      footerY,
      count,
      colors.hintForeground,
      colors.background
    );
  }

  // === Fuzzy Scoring Utilities ===

  /**
   * Score text using fuzzy matching
   * Characters must appear in order but not necessarily consecutively
   */
  protected fuzzyScore(query: string, target: string): number {
    const lowerQuery = query.toLowerCase();
    const lowerTarget = target.toLowerCase();

    let score = 0;
    let queryIndex = 0;
    let consecutiveBonus = 0;
    let lastMatchIndex = -1;

    for (let i = 0; i < lowerTarget.length && queryIndex < lowerQuery.length; i++) {
      if (lowerTarget[i] === lowerQuery[queryIndex]) {
        // Bonus for consecutive matches
        if (lastMatchIndex === i - 1) {
          consecutiveBonus += 1;
        } else {
          consecutiveBonus = 0;
        }

        // Bonus for word boundary matches
        const isWordBoundary = i === 0 ||
          lowerTarget[i - 1] === ' ' ||
          lowerTarget[i - 1] === '.' ||
          lowerTarget[i - 1] === '-' ||
          lowerTarget[i - 1] === '_' ||
          lowerTarget[i - 1] === '/';

        const boundaryBonus = isWordBoundary ? 3 : 0;

        score += 1 + consecutiveBonus + boundaryBonus;
        lastMatchIndex = i;
        queryIndex++;
      }
    }

    // Return 0 if not all query chars matched
    if (queryIndex < lowerQuery.length) return 0;

    // Small penalty for longer targets
    score -= lowerTarget.length * 0.01;

    return score;
  }

  /**
   * Score based on word-initial letters
   * "ts" matches "Toggle Sidebar" with high score
   */
  protected scoreWordInitials(text: string, query: string): number {
    const lowerQuery = query.toLowerCase();

    // Extract first letter of each word
    const words = text.split(/[\s\-_.\/]+/);
    const initials = words.map(w => w[0]?.toLowerCase() || '').join('');

    // Also try camelCase boundaries
    const camelWords = text.split(/(?=[A-Z])/);
    const camelInitials = camelWords.map(w => w[0]?.toLowerCase() || '').join('');

    if (initials.startsWith(lowerQuery)) {
      return 20 + (lowerQuery.length * 2);
    }
    if (camelInitials.startsWith(lowerQuery)) {
      return 20 + (lowerQuery.length * 2);
    }
    if (initials.includes(lowerQuery)) {
      return 10 + lowerQuery.length;
    }
    if (camelInitials.includes(lowerQuery)) {
      return 10 + lowerQuery.length;
    }

    return 0;
  }
}

export default SearchableDialog;
