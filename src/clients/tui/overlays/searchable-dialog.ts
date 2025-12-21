/**
 * Searchable Dialog
 *
 * Generic searchable dialog with fuzzy filtering and keyboard navigation.
 * Subclasses provide scoring and display logic for their item types.
 */

import { PromiseDialog, type DialogConfig, type DialogResult } from './promise-dialog.ts';
import type { OverlayManagerCallbacks } from './overlay-manager.ts';
import type { KeyEvent, MouseEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';

// ============================================
// Types
// ============================================

/**
 * Scored item for search results.
 */
export interface ScoredItem<T> {
  item: T;
  score: number;
}

/**
 * Item display configuration.
 */
export interface ItemDisplay {
  /** Primary text */
  text: string;
  /** Secondary text (right-aligned, e.g., path) */
  secondary?: string;
  /** Icon character */
  icon?: string;
  /** Mark as current/active item */
  isCurrent?: boolean;
}

/**
 * Configuration for searchable dialogs.
 */
export interface SearchableDialogConfig extends DialogConfig {
  /** Placeholder text for search input */
  placeholder?: string;
  /** Whether to show search input */
  showSearchInput?: boolean;
  /** Maximum visible results */
  maxResults?: number;
}

// ============================================
// Searchable Dialog
// ============================================

/**
 * Abstract searchable dialog base class.
 *
 * Generic type T represents the item type in the list.
 * Subclasses must implement:
 * - scoreItem(): How to score items against query
 * - getItemDisplay(): How to render each item
 * - getItemId(): Get unique ID for an item
 */
export abstract class SearchableDialog<T> extends PromiseDialog<T> {
  // Search state
  protected query: string = '';
  protected items: T[] = [];
  protected filteredItems: ScoredItem<T>[] = [];
  protected selectedIndex: number = 0;
  protected scrollOffset: number = 0;

  // Configuration
  protected maxVisibleResults: number = 15;
  protected showSearchInput: boolean = true;
  protected placeholder: string = 'Type to search...';

  // Highlight tracking
  protected highlightedId: string = '';

  constructor(id: string, callbacks: OverlayManagerCallbacks) {
    super(id, callbacks);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Abstract Methods (Subclass Must Implement)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Score an item against the query.
   * @returns Score > 0 for matches, 0 for non-matches
   */
  protected abstract scoreItem(item: T, query: string): number;

  /**
   * Get display configuration for an item.
   */
  protected abstract getItemDisplay(item: T, isSelected: boolean): ItemDisplay;

  /**
   * Get unique ID for an item (for highlight tracking).
   */
  protected abstract getItemId(item: T): string;

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show dialog with items.
   */
  showWithItems(
    config: SearchableDialogConfig,
    items: T[],
    highlightId?: string
  ): Promise<DialogResult<T>> {
    this.items = items;
    this.highlightedId = highlightId ?? '';
    this.query = '';
    this.selectedIndex = 0;
    this.scrollOffset = 0;
    this.showSearchInput = config.showSearchInput !== false;
    this.placeholder = config.placeholder ?? 'Type to search...';
    this.maxVisibleResults = config.maxResults ?? 15;

    // Initial filter (shows all items)
    this.filter();

    // Find highlighted item's index
    if (highlightId) {
      const idx = this.filteredItems.findIndex(
        (scored) => this.getItemId(scored.item) === highlightId
      );
      if (idx >= 0) {
        this.selectedIndex = idx;
        this.ensureSelectedVisible();
      }
    }

    return this.showAsync(config);
  }

  /**
   * Get current query.
   */
  getQuery(): string {
    return this.query;
  }

  /**
   * Set query programmatically.
   */
  setQuery(query: string): void {
    this.query = query;
    this.selectedIndex = 0;
    this.scrollOffset = 0;
    this.filter();
    this.callbacks.onDirty();
  }

  /**
   * Get selected item.
   */
  getSelectedItem(): T | null {
    return this.filteredItems[this.selectedIndex]?.item ?? null;
  }

  /**
   * Update items (e.g., for async loading).
   */
  setItems(items: T[]): void {
    this.items = items;
    this.filter();
    this.callbacks.onDirty();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Filtering
  // ─────────────────────────────────────────────────────────────────────────

  protected filter(): void {
    const queryLower = this.query.toLowerCase().trim();

    if (!queryLower) {
      // No query - show all items with score 0
      this.filteredItems = this.items.map((item) => ({ item, score: 0 }));
      return;
    }

    const results: ScoredItem<T>[] = [];
    for (const item of this.items) {
      const score = this.scoreItem(item, queryLower);
      if (score > 0) {
        results.push({ item, score });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    this.filteredItems = results;

    // Reset selection if out of bounds
    if (this.selectedIndex >= this.filteredItems.length) {
      this.selectedIndex = Math.max(0, this.filteredItems.length - 1);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Navigation
  // ─────────────────────────────────────────────────────────────────────────

  protected selectNext(): void {
    if (this.selectedIndex < this.filteredItems.length - 1) {
      this.selectedIndex++;
      this.ensureSelectedVisible();
      this.callbacks.onDirty();
    }
  }

  protected selectPrevious(): void {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
      this.ensureSelectedVisible();
      this.callbacks.onDirty();
    }
  }

  protected pageDown(): void {
    const pageSize = this.maxVisibleResults;
    this.selectedIndex = Math.min(
      this.filteredItems.length - 1,
      this.selectedIndex + pageSize
    );
    this.ensureSelectedVisible();
    this.callbacks.onDirty();
  }

  protected pageUp(): void {
    const pageSize = this.maxVisibleResults;
    this.selectedIndex = Math.max(0, this.selectedIndex - pageSize);
    this.ensureSelectedVisible();
    this.callbacks.onDirty();
  }

  protected selectFirst(): void {
    this.selectedIndex = 0;
    this.ensureSelectedVisible();
    this.callbacks.onDirty();
  }

  protected selectLast(): void {
    this.selectedIndex = Math.max(0, this.filteredItems.length - 1);
    this.ensureSelectedVisible();
    this.callbacks.onDirty();
  }

  protected ensureSelectedVisible(): void {
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + this.maxVisibleResults) {
      this.scrollOffset = this.selectedIndex - this.maxVisibleResults + 1;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  protected override handleKeyInput(event: KeyEvent): boolean {
    // Navigation
    if (event.key === 'ArrowDown' || (event.ctrl && event.key === 'n')) {
      this.selectNext();
      return true;
    }

    if (event.key === 'ArrowUp' || (event.ctrl && event.key === 'p')) {
      this.selectPrevious();
      return true;
    }

    if (event.key === 'PageDown') {
      this.pageDown();
      return true;
    }

    if (event.key === 'PageUp') {
      this.pageUp();
      return true;
    }

    if (event.ctrl && event.key === 'Home') {
      this.selectFirst();
      return true;
    }

    if (event.ctrl && event.key === 'End') {
      this.selectLast();
      return true;
    }

    // Confirm
    if (event.key === 'Enter') {
      const selected = this.getSelectedItem();
      if (selected) {
        this.confirm(selected);
      } else {
        this.cancel();
      }
      return true;
    }

    // Tab also confirms (common in pickers)
    if (event.key === 'Tab' && !event.shift) {
      const selected = this.getSelectedItem();
      if (selected) {
        this.confirm(selected);
      }
      return true;
    }

    // Backspace
    if (event.key === 'Backspace') {
      if (this.query.length > 0) {
        this.setQuery(this.query.slice(0, -1));
      }
      return true;
    }

    // Clear query
    if (event.ctrl && event.key === 'u') {
      this.setQuery('');
      return true;
    }

    // Delete word backward
    if (event.ctrl && event.key === 'w') {
      const words = this.query.trimEnd().split(/\s+/);
      words.pop();
      this.setQuery(words.join(' '));
      return true;
    }

    // Character input
    if (event.key.length === 1 && !event.ctrl && !event.alt && !event.meta) {
      this.setQuery(this.query + event.key);
      return true;
    }

    return false;
  }

  protected override handleMouseInput(event: import('../types.ts').InputEvent): boolean {
    if (!('type' in event)) return true;

    const mouseEvent = event as MouseEvent;
    const contentBounds = this.getContentBounds();
    const listStartY = contentBounds.y + (this.showSearchInput ? 2 : 0);

    // Handle scroll
    if (mouseEvent.type === 'scroll') {
      const direction = mouseEvent.scrollDirection ?? 1;
      if (direction > 0) {
        this.selectNext();
      } else {
        this.selectPrevious();
      }
      return true;
    }

    // Handle click on list item
    if (mouseEvent.type === 'press' && mouseEvent.button === 'left') {
      const clickY = mouseEvent.y;
      if (clickY >= listStartY && clickY < listStartY + this.maxVisibleResults) {
        const clickedIndex = this.scrollOffset + (clickY - listStartY);
        if (clickedIndex < this.filteredItems.length) {
          this.selectedIndex = clickedIndex;
          this.callbacks.onDirty();

          // Double-click would confirm, but we don't track that here
          // Single click just selects
        }
      }
      return true;
    }

    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  protected override renderContent(buffer: ScreenBuffer): void {
    const content = this.getContentBounds();

    // Search input
    if (this.showSearchInput) {
      this.renderSearchInput(buffer, content.x, content.y, content.width);
    }

    // Results list
    const listY = content.y + (this.showSearchInput ? 2 : 0);
    const listHeight = content.height - (this.showSearchInput ? 3 : 1);
    this.renderResultsList(buffer, content.x, listY, content.width, listHeight);

    // Footer with count
    const footerY = content.y + content.height - 1;
    this.renderFooter(buffer, content.x, footerY, content.width);
  }

  protected renderSearchInput(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number
  ): void {
    const inputBg = this.callbacks.getThemeColor('input.background', '#3c3c3c');
    const inputFg = this.callbacks.getThemeColor('input.foreground', '#cccccc');
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');
    const focusBorder = this.callbacks.getThemeColor('focusBorder', '#007acc');

    // Input background
    for (let col = 0; col < width; col++) {
      buffer.set(x + col, y, { char: ' ', fg: inputFg, bg: inputBg });
    }

    // Prompt
    buffer.writeString(x, y, '> ', focusBorder, inputBg);

    // Query or placeholder
    const displayText = this.query || this.placeholder;
    const displayFg = this.query ? inputFg : dimFg;
    const maxDisplay = width - 4;
    const truncated =
      displayText.length > maxDisplay
        ? displayText.slice(0, maxDisplay - 1) + '…'
        : displayText;
    buffer.writeString(x + 2, y, truncated, displayFg, inputBg);

    // Cursor
    const cursorX = x + 2 + this.query.length;
    if (cursorX < x + width - 1) {
      buffer.set(cursorX, y, { char: '│', fg: focusBorder, bg: inputBg });
    }

    // Separator line
    const sepY = y + 1;
    const border = this.callbacks.getThemeColor('editorWidget.border', '#454545');
    const bg = this.callbacks.getThemeColor('editorWidget.background', '#252526');
    for (let col = 0; col < width; col++) {
      buffer.set(x + col, sepY, { char: '─', fg: border, bg });
    }
  }

  protected renderResultsList(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    const bg = this.callbacks.getThemeColor('editorWidget.background', '#252526');
    const fg = this.callbacks.getThemeColor('editorWidget.foreground', '#cccccc');
    const selectedBg = this.callbacks.getThemeColor(
      'list.activeSelectionBackground',
      '#094771'
    );
    const selectedFg = this.callbacks.getThemeColor(
      'list.activeSelectionForeground',
      '#ffffff'
    );
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');

    // Update max visible based on actual height
    this.maxVisibleResults = Math.max(1, height);

    if (this.filteredItems.length === 0) {
      const msg = this.query ? 'No matching items' : 'No items available';
      buffer.writeString(x + 1, y + 1, msg, dimFg, bg);
      return;
    }

    const visibleCount = Math.min(height, this.filteredItems.length - this.scrollOffset);

    for (let i = 0; i < visibleCount; i++) {
      const itemIndex = this.scrollOffset + i;
      const scoredItem = this.filteredItems[itemIndex]!;
      const isSelected = itemIndex === this.selectedIndex;
      const rowY = y + i;

      const display = this.getItemDisplay(scoredItem.item, isSelected);

      // Row background
      const rowBg = isSelected ? selectedBg : bg;
      const rowFg = isSelected ? selectedFg : fg;

      for (let col = 0; col < width; col++) {
        buffer.set(x + col, rowY, { char: ' ', fg: rowFg, bg: rowBg });
      }

      // Icon
      let textX = x + 1;
      if (display.icon) {
        buffer.writeString(textX, rowY, display.icon + ' ', dimFg, rowBg);
        textX += 2;
      }

      // Current marker
      if (display.isCurrent) {
        buffer.writeString(textX, rowY, '● ', '#4caf50', rowBg);
        textX += 2;
      }

      // Primary text
      const secondaryLen = display.secondary?.length ?? 0;
      const maxPrimary = width - (textX - x) - secondaryLen - 3;
      let displayText = display.text;
      if (displayText.length > maxPrimary) {
        displayText = displayText.slice(0, maxPrimary - 1) + '…';
      }
      buffer.writeString(textX, rowY, displayText, rowFg, rowBg);

      // Secondary text (right-aligned)
      if (display.secondary) {
        const secondaryX = x + width - display.secondary.length - 1;
        if (secondaryX > textX + displayText.length + 1) {
          buffer.writeString(secondaryX, rowY, display.secondary, dimFg, rowBg);
        }
      }
    }
  }

  protected renderFooter(buffer: ScreenBuffer, x: number, y: number, width: number): void {
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');
    const bg = this.callbacks.getThemeColor('editorWidget.background', '#252526');

    // Item count
    const total = this.items.length;
    const filtered = this.filteredItems.length;
    const count = this.query ? `${filtered}/${total}` : `${total} items`;
    buffer.writeString(x + width - count.length - 1, y, count, dimFg, bg);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Fuzzy Scoring Utilities
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fuzzy score: characters must appear in order but not consecutively.
   * Higher scores for consecutive matches and word boundaries.
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
        // Consecutive match bonus
        if (lastMatchIndex === i - 1) {
          consecutiveBonus += 2;
        } else {
          consecutiveBonus = 0;
        }

        // Word boundary bonus
        const isWordBoundary =
          i === 0 || /[\s.\-_/\\]/.test(lowerTarget[i - 1]!);
        const boundaryBonus = isWordBoundary ? 5 : 0;

        // CamelCase bonus
        const isCamelCase =
          i > 0 &&
          target[i] === target[i]!.toUpperCase() &&
          target[i - 1] === target[i - 1]!.toLowerCase();
        const camelBonus = isCamelCase ? 3 : 0;

        score += 1 + consecutiveBonus + boundaryBonus + camelBonus;
        lastMatchIndex = i;
        queryIndex++;
      }
    }

    // Must match all query characters
    if (queryIndex < lowerQuery.length) return 0;

    // Prefer shorter targets (more relevant)
    score -= lowerTarget.length * 0.01;

    // Bonus for exact prefix match
    if (lowerTarget.startsWith(lowerQuery)) {
      score += 10;
    }

    return score;
  }

  /**
   * Score based on word-initial letters (acronym matching).
   */
  protected scoreWordInitials(text: string, query: string): number {
    const lowerQuery = query.toLowerCase();

    // Get initials from words
    const words = text.split(/[\s\-_.\/\\]+/);
    const initials = words.map((w) => w[0]?.toLowerCase() ?? '').join('');

    // Get initials from camelCase
    const camelWords = text.split(/(?=[A-Z])/);
    const camelInitials = camelWords.map((w) => w[0]?.toLowerCase() ?? '').join('');

    // Prefix match on initials
    if (initials.startsWith(lowerQuery)) {
      return 25 + lowerQuery.length * 2;
    }
    if (camelInitials.startsWith(lowerQuery)) {
      return 25 + lowerQuery.length * 2;
    }

    // Contains match on initials
    if (initials.includes(lowerQuery)) {
      return 15 + lowerQuery.length;
    }
    if (camelInitials.includes(lowerQuery)) {
      return 15 + lowerQuery.length;
    }

    return 0;
  }

  /**
   * Combined scoring: fuzzy + word initials.
   * Use this in scoreItem() implementations.
   */
  protected combinedScore(text: string, query: string): number {
    const fuzzy = this.fuzzyScore(query, text);
    const initials = this.scoreWordInitials(text, query);
    return Math.max(fuzzy, initials);
  }
}
