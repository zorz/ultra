/**
 * Outline Panel Element
 *
 * A VS Code-style code outline for quick navigation.
 * Displays symbols from the current document in a hierarchical tree view.
 *
 * Designed to work in multiple contexts:
 * - Sidebar accordion (default)
 * - Tab in any pane
 * - Editor overlay (future, via wrapper class)
 */

import { BaseElement, type ElementContext } from './base.ts';
import type { KeyEvent, MouseEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import { SymbolKind } from '../../../services/lsp/index.ts';

// ============================================
// Types
// ============================================

/**
 * Normalized symbol representation for outline display.
 */
/**
 * Diff state for symbols when viewing a diff.
 */
export type SymbolDiffState = 'added' | 'modified' | 'deleted' | 'unchanged';

export interface OutlineSymbol {
  /** Unique ID for tracking */
  id: string;
  /** Symbol name */
  name: string;
  /** Symbol kind (LSP SymbolKind) */
  kind: number;
  /** Additional detail (e.g., return type, parameters) */
  detail?: string;
  /** Start line in document (0-indexed) */
  startLine: number;
  /** Start column (0-indexed) */
  startColumn: number;
  /** End line (for range) */
  endLine: number;
  /** Child symbols (for nesting) */
  children?: OutlineSymbol[];
  /** Parent symbol (for tree navigation) */
  parent?: OutlineSymbol;
  /** Diff state when viewing a diff (optional) */
  diffState?: SymbolDiffState;
}

/**
 * Flattened view node for rendering.
 */
interface OutlineViewNode {
  symbol: OutlineSymbol;
  depth: number;
  index: number;
  expanded: boolean;
}

/**
 * State for session persistence.
 */
export interface OutlinePanelState {
  /** Currently bound document URI */
  documentUri?: string;
  /** Scroll position */
  scrollTop: number;
  /** Selected symbol ID */
  selectedSymbolId?: string;
  /** Expanded symbol IDs */
  expandedSymbolIds: string[];
  /** Active symbol filter types (empty = show all) */
  filterTypes: number[];
  /** Current search query */
  searchQuery?: string;
  /** Whether panel should auto-follow cursor */
  autoFollow: boolean;
}

/**
 * Callbacks for OutlinePanel events.
 */
export interface OutlinePanelCallbacks {
  /** Called when user selects a symbol to navigate to */
  onSymbolSelect?: (uri: string, line: number, column: number) => void;
  /** Called when panel gains/loses focus */
  onFocusChange?: (focused: boolean) => void;
}

// ============================================
// Symbol Display Constants
// ============================================

/** ASCII icons for symbol kinds (terminal-friendly) */
const SYMBOL_ICONS: Record<number, string> = {
  [SymbolKind.File]: 'F',
  [SymbolKind.Module]: 'M',
  [SymbolKind.Namespace]: 'N',
  [SymbolKind.Package]: 'P',
  [SymbolKind.Class]: 'C',
  [SymbolKind.Method]: 'm',
  [SymbolKind.Property]: 'p',
  [SymbolKind.Field]: 'f',
  [SymbolKind.Constructor]: 'c',
  [SymbolKind.Enum]: 'E',
  [SymbolKind.Interface]: 'I',
  [SymbolKind.Function]: 'F',
  [SymbolKind.Variable]: 'v',
  [SymbolKind.Constant]: 'K',
  [SymbolKind.String]: 'S',
  [SymbolKind.Number]: '#',
  [SymbolKind.Boolean]: 'B',
  [SymbolKind.Array]: 'A',
  [SymbolKind.Object]: 'O',
  [SymbolKind.Key]: 'k',
  [SymbolKind.Null]: '∅',
  [SymbolKind.EnumMember]: 'e',
  [SymbolKind.Struct]: 'S',
  [SymbolKind.Event]: 'E',
  [SymbolKind.Operator]: '+',
  [SymbolKind.TypeParameter]: 'T',
};

/** Colors for symbol kinds */
const SYMBOL_COLORS: Record<number, string> = {
  [SymbolKind.Class]: '#f9e2af',      // Yellow
  [SymbolKind.Interface]: '#89dceb',  // Cyan
  [SymbolKind.Function]: '#cba6f7',   // Purple
  [SymbolKind.Method]: '#cba6f7',     // Purple
  [SymbolKind.Constructor]: '#cba6f7', // Purple
  [SymbolKind.Variable]: '#89b4fa',   // Blue
  [SymbolKind.Constant]: '#fab387',   // Orange
  [SymbolKind.Property]: '#94e2d5',   // Teal
  [SymbolKind.Field]: '#94e2d5',      // Teal
  [SymbolKind.Enum]: '#f9e2af',       // Yellow
  [SymbolKind.EnumMember]: '#f9e2af', // Yellow
  [SymbolKind.String]: '#a6e3a1',     // Green (for markdown headers)
  [SymbolKind.Module]: '#74c7ec',     // Sky
};

// ============================================
// OutlinePanel Element
// ============================================

export class OutlinePanel extends BaseElement {
  // ─────────────────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────────────────

  /** All symbols (tree structure) */
  private symbols: OutlineSymbol[] = [];

  /** Flattened view for rendering */
  private viewNodes: OutlineViewNode[] = [];

  /** Currently bound document URI */
  private documentUri: string | null = null;

  /** Selected index in view */
  private selectedIndex = 0;

  /** Scroll offset */
  private scrollTop = 0;

  /** Expanded symbol IDs */
  private expandedSymbolIds = new Set<string>();

  /** Symbol type filter (empty = show all) */
  private filterTypes: Set<number> = new Set();

  /** Search query for filtering */
  private searchQuery = '';

  /** Search input active */
  private searchInputActive = false;

  /** Search input cursor position */
  private searchCursorPos = 0;

  /** Auto-follow cursor in editor */
  private autoFollow = true;

  /** Last cursor line for auto-follow */
  private lastCursorLine = -1;

  /** Callbacks */
  private callbacks: OutlinePanelCallbacks;

  /** Last click for double-click detection */
  private lastClickTime = 0;
  private lastClickIndex = -1;

  // ─────────────────────────────────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────────────────────────────────

  constructor(id: string, title: string, ctx: ElementContext, callbacks: OutlinePanelCallbacks = {}) {
    super('OutlinePanel', id, title, ctx);
    this.callbacks = callbacks;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set callbacks.
   */
  setCallbacks(callbacks: OutlinePanelCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Get callbacks.
   */
  getCallbacks(): OutlinePanelCallbacks {
    return this.callbacks;
  }

  /**
   * Set symbols directly.
   */
  setSymbols(symbols: OutlineSymbol[], uri: string): void {
    this.symbols = symbols;
    this.documentUri = uri;

    // Expand top-level symbols by default
    this.expandedSymbolIds.clear();
    for (const symbol of symbols) {
      if (symbol.children && symbol.children.length > 0) {
        this.expandedSymbolIds.add(symbol.id);
      }
    }

    this.rebuildView();
    this.selectedIndex = 0;
    this.scrollTop = 0;
    this.ctx.markDirty();

    // Update status with symbol count
    const count = this.countSymbols(symbols);
    this.setStatus(`${count} symbol${count !== 1 ? 's' : ''}`);
  }

  /**
   * Get bound document URI.
   */
  getDocumentUri(): string | null {
    return this.documentUri;
  }

  /**
   * Clear symbols (when no document is active).
   */
  clearSymbols(): void {
    this.symbols = [];
    this.documentUri = null;
    this.viewNodes = [];
    this.selectedIndex = 0;
    this.scrollTop = 0;
    this.setStatus('');
    this.ctx.markDirty();
  }

  /**
   * Update cursor position for auto-follow.
   */
  updateCursorPosition(line: number, _column: number): void {
    if (!this.autoFollow) return;
    if (line === this.lastCursorLine) return;

    this.lastCursorLine = line;
    this.selectSymbolAtLine(line);
  }

  /**
   * Set auto-follow mode.
   */
  setAutoFollow(enabled: boolean): void {
    this.autoFollow = enabled;
  }

  /**
   * Get auto-follow mode.
   */
  getAutoFollow(): boolean {
    return this.autoFollow;
  }

  /**
   * Filter by symbol types.
   */
  setFilterTypes(types: number[]): void {
    this.filterTypes = new Set(types);
    this.rebuildView();
    this.ctx.markDirty();
  }

  /**
   * Set search query.
   */
  setSearchQuery(query: string): void {
    this.searchQuery = query;
    this.rebuildView();
    this.ctx.markDirty();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Navigation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Move selection up.
   */
  moveUp(): void {
    if (this.viewNodes.length === 0) return;
    this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    this.ensureVisible();
    this.ctx.markDirty();
  }

  /**
   * Move selection down.
   */
  moveDown(): void {
    if (this.viewNodes.length === 0) return;
    this.selectedIndex = Math.min(this.viewNodes.length - 1, this.selectedIndex + 1);
    this.ensureVisible();
    this.ctx.markDirty();
  }

  /**
   * Expand selected symbol.
   */
  expand(): void {
    const viewNode = this.viewNodes[this.selectedIndex];
    if (!viewNode) return;

    const symbol = viewNode.symbol;
    if (symbol.children && symbol.children.length > 0 && !this.expandedSymbolIds.has(symbol.id)) {
      this.expandedSymbolIds.add(symbol.id);
      this.rebuildView();
      this.ctx.markDirty();
    }
  }

  /**
   * Collapse selected symbol or go to parent.
   */
  collapse(): void {
    const viewNode = this.viewNodes[this.selectedIndex];
    if (!viewNode) return;

    const symbol = viewNode.symbol;

    // If expanded, collapse it
    if (this.expandedSymbolIds.has(symbol.id)) {
      this.expandedSymbolIds.delete(symbol.id);
      this.rebuildView();
      this.ctx.markDirty();
      return;
    }

    // Otherwise, go to parent
    if (symbol.parent) {
      const parentIdx = this.viewNodes.findIndex((v) => v.symbol.id === symbol.parent!.id);
      if (parentIdx !== -1) {
        this.selectedIndex = parentIdx;
        this.ensureVisible();
        this.ctx.markDirty();
      }
    }
  }

  /**
   * Toggle expand/collapse.
   */
  toggleExpand(): void {
    const viewNode = this.viewNodes[this.selectedIndex];
    if (!viewNode) return;

    const symbol = viewNode.symbol;
    if (!symbol.children || symbol.children.length === 0) return;

    if (this.expandedSymbolIds.has(symbol.id)) {
      this.expandedSymbolIds.delete(symbol.id);
    } else {
      this.expandedSymbolIds.add(symbol.id);
    }
    this.rebuildView();
    this.ctx.markDirty();
  }

  /**
   * Select the current symbol (navigate to it in editor).
   */
  selectSymbol(): void {
    const viewNode = this.viewNodes[this.selectedIndex];
    if (!viewNode || !this.documentUri) return;

    const symbol = viewNode.symbol;
    this.callbacks.onSymbolSelect?.(this.documentUri, symbol.startLine, symbol.startColumn);
  }

  /**
   * Page up.
   */
  pageUp(): void {
    if (this.viewNodes.length === 0) return;
    const pageSize = Math.max(1, this.bounds.height - 2);
    this.selectedIndex = Math.max(0, this.selectedIndex - pageSize);
    this.ensureVisible();
    this.ctx.markDirty();
  }

  /**
   * Page down.
   */
  pageDown(): void {
    if (this.viewNodes.length === 0) return;
    const pageSize = Math.max(1, this.bounds.height - 2);
    this.selectedIndex = Math.min(this.viewNodes.length - 1, this.selectedIndex + pageSize);
    this.ensureVisible();
    this.ctx.markDirty();
  }

  /**
   * Go to first symbol.
   */
  goToFirst(): void {
    if (this.viewNodes.length === 0) return;
    this.selectedIndex = 0;
    this.ensureVisible();
    this.ctx.markDirty();
  }

  /**
   * Go to last symbol.
   */
  goToLast(): void {
    if (this.viewNodes.length === 0) return;
    this.selectedIndex = this.viewNodes.length - 1;
    this.ensureVisible();
    this.ctx.markDirty();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal - View Building
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Rebuild the flattened view from symbols.
   */
  private rebuildView(): void {
    this.viewNodes = [];
    let index = 0;

    const addSymbols = (symbols: OutlineSymbol[], depth: number): void => {
      for (const symbol of symbols) {
        // Check if symbol matches filters
        const selfMatches = this.matchesFilter(symbol) && this.matchesSearch(symbol);

        // Check if any descendant matches (to show parent nodes)
        const hasMatchingDescendant = this.hasMatchingDescendant(symbol);

        if (selfMatches || hasMatchingDescendant) {
          const isExpanded = this.expandedSymbolIds.has(symbol.id);
          const hasChildren = symbol.children && symbol.children.length > 0;

          this.viewNodes.push({
            symbol,
            depth,
            index: index++,
            expanded: isExpanded && !!hasChildren,
          });

          // Add children if expanded
          if (isExpanded && symbol.children) {
            addSymbols(symbol.children, depth + 1);
          }
        }
      }
    };

    addSymbols(this.symbols, 0);

    // Clamp selection
    if (this.selectedIndex >= this.viewNodes.length) {
      this.selectedIndex = Math.max(0, this.viewNodes.length - 1);
    }
  }

  /**
   * Check if symbol matches type filter.
   */
  private matchesFilter(symbol: OutlineSymbol): boolean {
    if (this.filterTypes.size === 0) return true;
    return this.filterTypes.has(symbol.kind);
  }

  /**
   * Check if symbol matches search query.
   */
  private matchesSearch(symbol: OutlineSymbol): boolean {
    if (!this.searchQuery) return true;
    const query = this.searchQuery.toLowerCase();
    return symbol.name.toLowerCase().includes(query);
  }

  /**
   * Check if symbol has any matching descendants.
   */
  private hasMatchingDescendant(symbol: OutlineSymbol): boolean {
    if (!symbol.children) return false;

    for (const child of symbol.children) {
      if (this.matchesFilter(child) && this.matchesSearch(child)) {
        return true;
      }
      if (this.hasMatchingDescendant(child)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Ensure selected item is visible.
   */
  private ensureVisible(): void {
    const listHeight = this.getListHeight();
    if (this.selectedIndex < this.scrollTop) {
      this.scrollTop = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollTop + listHeight) {
      this.scrollTop = this.selectedIndex - listHeight + 1;
    }
  }

  /**
   * Get available height for symbol list.
   */
  private getListHeight(): number {
    // Reserve 1 row for search box if active
    return Math.max(1, this.bounds.height - (this.searchInputActive ? 1 : 0));
  }

  /**
   * Count total symbols recursively.
   */
  private countSymbols(symbols: OutlineSymbol[]): number {
    let count = 0;
    for (const symbol of symbols) {
      count++;
      if (symbol.children) {
        count += this.countSymbols(symbol.children);
      }
    }
    return count;
  }

  /**
   * Find and select symbol at a given line (for auto-follow).
   */
  private selectSymbolAtLine(line: number): void {
    // Find the deepest symbol containing this line
    let bestMatch: OutlineSymbol | null = null;
    let bestDepth = -1;

    const findSymbol = (symbols: OutlineSymbol[], depth: number): void => {
      for (const symbol of symbols) {
        if (line >= symbol.startLine && line <= symbol.endLine) {
          if (depth > bestDepth) {
            bestMatch = symbol;
            bestDepth = depth;
          }
          if (symbol.children) {
            findSymbol(symbol.children, depth + 1);
          }
        }
      }
    };

    findSymbol(this.symbols, 0);

    if (bestMatch !== null) {
      // TypeScript's control flow analysis can't track assignments in closures,
      // so we need to explicitly cast after the null check
      const matchedSymbol: OutlineSymbol = bestMatch as OutlineSymbol;

      // Expand ancestors to ensure symbol is visible
      let current: OutlineSymbol | undefined = matchedSymbol.parent;
      while (current) {
        this.expandedSymbolIds.add(current.id);
        current = current.parent;
      }

      // Rebuild and find index
      this.rebuildView();

      const idx = this.viewNodes.findIndex((v) => v.symbol.id === matchedSymbol.id);
      if (idx !== -1 && idx !== this.selectedIndex) {
        this.selectedIndex = idx;
        this.ensureVisible();
        this.ctx.markDirty();
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  render(buffer: ScreenBuffer): void {
    const { x, y, width, height } = this.bounds;
    if (width <= 0 || height <= 0) return;

    const bg = this.ctx.getBackgroundForFocus('sidebar', this.focused);
    const fg = this.ctx.getForegroundForFocus('sidebar', this.focused);
    const selectedBg = this.ctx.getSelectionBackground('sidebar', this.focused);

    // Clear background
    for (let row = 0; row < height; row++) {
      buffer.writeString(x, y + row, ' '.repeat(width), fg, bg);
    }

    let currentY = y;

    // Render search box if active
    if (this.searchInputActive) {
      this.renderSearchBox(buffer, x, currentY, width, fg, bg);
      currentY++;
    }

    // Render symbol list
    const listHeight = height - (this.searchInputActive ? 1 : 0);
    this.renderSymbolList(buffer, x, currentY, width, listHeight, fg, bg, selectedBg);

    // Render scrollbar if needed
    if (this.viewNodes.length > listHeight) {
      this.renderScrollbar(buffer, x + width - 1, currentY, listHeight);
    }
  }

  /**
   * Render search input box.
   */
  private renderSearchBox(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number,
    fg: string,
    bg: string
  ): void {
    const inputBg = this.ctx.getThemeColor('input.background', '#3c3c3c');
    const inputFg = this.ctx.getThemeColor('input.foreground', '#cccccc');

    // Draw search icon and input
    const prefix = '/ ';
    const availableWidth = width - prefix.length - 1;
    const displayQuery = this.searchQuery.slice(0, availableWidth);

    buffer.writeString(x, y, prefix, fg, bg);
    buffer.writeString(x + prefix.length, y, displayQuery.padEnd(availableWidth), inputFg, inputBg);

    // Draw cursor if focused
    if (this.focused && this.searchInputActive) {
      const cursorX = x + prefix.length + Math.min(this.searchCursorPos, availableWidth);
      const char = this.searchQuery[this.searchCursorPos] ?? ' ';
      buffer.set(cursorX, y, { char, fg: inputBg, bg: inputFg });
    }
  }

  /**
   * Render the symbol list.
   */
  private renderSymbolList(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number,
    height: number,
    fg: string,
    bg: string,
    selectedBg: string
  ): void {
    if (this.viewNodes.length === 0) {
      // Show empty state
      const msg = this.documentUri ? 'No symbols found' : 'No document open';
      const msgX = x + Math.floor((width - msg.length) / 2);
      const msgY = y + Math.floor(height / 2);
      if (msgY < y + height) {
        buffer.writeString(msgX, msgY, msg, fg, bg);
      }
      return;
    }

    for (let row = 0; row < height; row++) {
      const viewIdx = this.scrollTop + row;
      if (viewIdx >= this.viewNodes.length) break;

      const viewNode = this.viewNodes[viewIdx]!;
      const isSelected = viewIdx === this.selectedIndex;
      const lineBg = isSelected ? selectedBg : bg;

      this.renderSymbolLine(buffer, viewNode, x, y + row, width, isSelected, fg, lineBg);
    }
  }

  /**
   * Render a single symbol line.
   */
  private renderSymbolLine(
    buffer: ScreenBuffer,
    viewNode: OutlineViewNode,
    x: number,
    y: number,
    width: number,
    isSelected: boolean,
    fg: string,
    bg: string
  ): void {
    const { symbol, depth, expanded } = viewNode;
    const hasChildren = symbol.children && symbol.children.length > 0;

    // Build the line
    const indent = '  '.repeat(depth);
    const expander = hasChildren ? (expanded ? '▼' : '▶') : ' ';
    const icon = SYMBOL_ICONS[symbol.kind] ?? '?';
    const iconColor = SYMBOL_COLORS[symbol.kind] ?? fg;

    // Diff state indicator and colors
    let diffIndicator = ' ';
    let diffIndicatorColor = fg;
    let lineBg = bg;
    if (symbol.diffState && symbol.diffState !== 'unchanged') {
      switch (symbol.diffState) {
        case 'added':
          diffIndicator = '+';
          diffIndicatorColor = this.ctx.getThemeColor('gitDecoration.addedResourceForeground', '#81b88b');
          lineBg = this.ctx.getThemeColor('diffEditor.insertedLineBackground', '#1e3a21');
          break;
        case 'modified':
          diffIndicator = '~';
          diffIndicatorColor = this.ctx.getThemeColor('gitDecoration.modifiedResourceForeground', '#e2c08d');
          lineBg = this.ctx.getThemeColor('diffEditor.modifiedLineBackground', '#2d2a1e');
          break;
        case 'deleted':
          diffIndicator = '-';
          diffIndicatorColor = this.ctx.getThemeColor('gitDecoration.deletedResourceForeground', '#c74e39');
          lineBg = this.ctx.getThemeColor('diffEditor.removedLineBackground', '#3a1e1e');
          break;
      }
    }

    // Use lineBg unless selected
    const actualBg = isSelected ? bg : lineBg;

    // Calculate available space for name
    const prefixLen = indent.length + 1 + 2 + 2; // indent + diffIndicator + expander + space + icon + space
    const availableWidth = Math.max(1, width - prefixLen - 1); // -1 for scrollbar
    const name = symbol.name.slice(0, availableWidth);

    // Draw diff indicator at start
    let xPos = x;
    buffer.writeString(xPos, y, diffIndicator, diffIndicatorColor, actualBg);
    xPos += 1;

    // Draw indent and expander
    buffer.writeString(xPos, y, indent, fg, actualBg);
    xPos += indent.length;

    buffer.writeString(xPos, y, expander + ' ', fg, actualBg);
    xPos += 2;

    // Draw icon with color
    buffer.writeString(xPos, y, icon + ' ', iconColor, actualBg);
    xPos += 2;

    // Draw symbol name
    const nameFg = isSelected ? this.ctx.getThemeColor('list.activeSelectionForeground', '#ffffff') : fg;
    buffer.writeString(xPos, y, name, nameFg, actualBg);
    xPos += name.length;

    // Fill rest of line
    const remaining = width - (xPos - x);
    if (remaining > 0) {
      buffer.writeString(xPos, y, ' '.repeat(remaining), fg, actualBg);
    }
  }

  /**
   * Render scrollbar.
   */
  private renderScrollbar(buffer: ScreenBuffer, x: number, y: number, height: number): void {
    const total = this.viewNodes.length;
    if (total <= height) return;

    const trackBg = this.ctx.getThemeColor('scrollbar.shadow', '#1e1e1e');
    const thumbBg = this.ctx.getThemeColor('scrollbarSlider.background', '#5a5a5a');

    // Calculate thumb size and position
    const thumbHeight = Math.max(1, Math.floor((height / total) * height));
    const thumbStart = Math.floor((this.scrollTop / total) * height);

    for (let row = 0; row < height; row++) {
      const isThumb = row >= thumbStart && row < thumbStart + thumbHeight;
      const char = isThumb ? '█' : '░';
      const color = isThumb ? thumbBg : trackBg;
      buffer.set(x, y + row, { char, fg: color, bg: color });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  override handleKey(event: KeyEvent): boolean {
    // Handle search input mode
    if (this.searchInputActive) {
      return this.handleSearchInput(event);
    }

    // Start search with /
    if (event.key === '/') {
      this.searchInputActive = true;
      this.searchCursorPos = this.searchQuery.length;
      this.ctx.markDirty();
      return true;
    }

    // Navigation keys
    return this.handleNavigationKey(event);
  }

  /**
   * Handle search input mode keys.
   */
  private handleSearchInput(event: KeyEvent): boolean {
    // Exit search mode
    if (event.key === 'Escape') {
      this.searchInputActive = false;
      this.ctx.markDirty();
      return true;
    }

    // Confirm search and exit
    if (event.key === 'Enter') {
      this.searchInputActive = false;
      // Select first match if any
      if (this.viewNodes.length > 0) {
        this.selectedIndex = 0;
        this.selectSymbol();
      }
      this.ctx.markDirty();
      return true;
    }

    // Navigate while searching (without exiting)
    if (event.key === 'ArrowDown') {
      this.moveDown();
      return true;
    }
    if (event.key === 'ArrowUp') {
      this.moveUp();
      return true;
    }

    // Text editing
    if (event.key === 'Backspace') {
      if (this.searchCursorPos > 0) {
        this.searchQuery =
          this.searchQuery.slice(0, this.searchCursorPos - 1) +
          this.searchQuery.slice(this.searchCursorPos);
        this.searchCursorPos--;
        this.rebuildView();
        this.ctx.markDirty();
      }
      return true;
    }

    if (event.key === 'Delete') {
      if (this.searchCursorPos < this.searchQuery.length) {
        this.searchQuery =
          this.searchQuery.slice(0, this.searchCursorPos) +
          this.searchQuery.slice(this.searchCursorPos + 1);
        this.rebuildView();
        this.ctx.markDirty();
      }
      return true;
    }

    if (event.key === 'ArrowLeft') {
      if (this.searchCursorPos > 0) {
        this.searchCursorPos--;
        this.ctx.markDirty();
      }
      return true;
    }

    if (event.key === 'ArrowRight') {
      if (this.searchCursorPos < this.searchQuery.length) {
        this.searchCursorPos++;
        this.ctx.markDirty();
      }
      return true;
    }

    if (event.key === 'Home') {
      this.searchCursorPos = 0;
      this.ctx.markDirty();
      return true;
    }

    if (event.key === 'End') {
      this.searchCursorPos = this.searchQuery.length;
      this.ctx.markDirty();
      return true;
    }

    // Character input
    if (event.key.length === 1 && !event.ctrl && !event.alt && !event.meta) {
      this.searchQuery =
        this.searchQuery.slice(0, this.searchCursorPos) +
        event.key +
        this.searchQuery.slice(this.searchCursorPos);
      this.searchCursorPos++;
      this.rebuildView();
      this.ctx.markDirty();
      return true;
    }

    return false;
  }

  /**
   * Handle navigation keys.
   */
  private handleNavigationKey(event: KeyEvent): boolean {
    // Arrow navigation
    if (event.key === 'ArrowUp' || event.key === 'k') {
      this.moveUp();
      return true;
    }

    if (event.key === 'ArrowDown' || event.key === 'j') {
      this.moveDown();
      return true;
    }

    if (event.key === 'ArrowLeft' || event.key === 'h') {
      this.collapse();
      return true;
    }

    if (event.key === 'ArrowRight' || event.key === 'l') {
      this.expand();
      return true;
    }

    // Selection
    if (event.key === 'Enter' || event.key === ' ') {
      const viewNode = this.viewNodes[this.selectedIndex];
      if (viewNode) {
        const hasChildren = viewNode.symbol.children && viewNode.symbol.children.length > 0;
        if (hasChildren && event.key === ' ') {
          // Space toggles expand
          this.toggleExpand();
        } else {
          // Enter navigates
          this.selectSymbol();
        }
      }
      return true;
    }

    // Page navigation
    if (event.key === 'PageUp') {
      this.pageUp();
      return true;
    }

    if (event.key === 'PageDown') {
      this.pageDown();
      return true;
    }

    if (event.key === 'Home') {
      this.goToFirst();
      return true;
    }

    if (event.key === 'End') {
      this.goToLast();
      return true;
    }

    // Clear search with Escape
    if (event.key === 'Escape') {
      if (this.searchQuery) {
        this.searchQuery = '';
        this.rebuildView();
        this.ctx.markDirty();
        return true;
      }
    }

    return false;
  }

  override handleMouse(event: MouseEvent): boolean {
    const { x, y, width, height } = this.bounds;

    // Only handle clicks within bounds
    if (event.x < x || event.x >= x + width || event.y < y || event.y >= y + height) {
      return false;
    }

    // Handle scroll
    if (event.type === 'scroll') {
      const direction = (event.scrollDirection ?? 1) * 3;
      const maxScroll = Math.max(0, this.viewNodes.length - this.getListHeight());
      this.scrollTop = Math.max(0, Math.min(maxScroll, this.scrollTop + direction));
      this.ctx.markDirty();
      return true;
    }

    // Handle click
    if (event.type === 'press' && event.button === 'left') {
      const listStartY = y + (this.searchInputActive ? 1 : 0);
      const relY = event.y - listStartY;

      if (relY < 0) {
        // Click on search box - activate it
        this.searchInputActive = true;
        this.searchCursorPos = this.searchQuery.length;
        this.ctx.markDirty();
        return true;
      }

      const viewIdx = this.scrollTop + relY;
      if (viewIdx >= 0 && viewIdx < this.viewNodes.length) {
        const now = Date.now();
        const isDoubleClick = viewIdx === this.lastClickIndex && now - this.lastClickTime < 300;

        this.selectedIndex = viewIdx;
        this.ctx.markDirty();

        if (isDoubleClick) {
          // Double-click navigates
          this.selectSymbol();
        } else {
          // Check if click is on expander
          const viewNode = this.viewNodes[viewIdx]!;
          const expanderX = x + viewNode.depth * 2;
          if (event.x >= expanderX && event.x < expanderX + 2) {
            this.toggleExpand();
          }
        }

        this.lastClickIndex = viewIdx;
        this.lastClickTime = now;
        return true;
      }
    }

    return false;
  }

  override onFocus(): void {
    super.onFocus();
    this.callbacks.onFocusChange?.(true);
  }

  override onBlur(): void {
    super.onBlur();
    this.searchInputActive = false;
    this.callbacks.onFocusChange?.(false);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State Serialization
  // ─────────────────────────────────────────────────────────────────────────

  override getState(): OutlinePanelState {
    const selectedSymbol = this.viewNodes[this.selectedIndex]?.symbol;
    return {
      documentUri: this.documentUri ?? undefined,
      scrollTop: this.scrollTop,
      selectedSymbolId: selectedSymbol?.id,
      expandedSymbolIds: Array.from(this.expandedSymbolIds),
      filterTypes: Array.from(this.filterTypes),
      searchQuery: this.searchQuery || undefined,
      autoFollow: this.autoFollow,
    };
  }

  override setState(state: unknown): void {
    if (!state || typeof state !== 'object') return;

    const s = state as Partial<OutlinePanelState>;

    if (s.scrollTop !== undefined) {
      this.scrollTop = s.scrollTop;
    }
    if (s.expandedSymbolIds) {
      this.expandedSymbolIds = new Set(s.expandedSymbolIds);
    }
    if (s.filterTypes) {
      this.filterTypes = new Set(s.filterTypes);
    }
    if (s.searchQuery !== undefined) {
      this.searchQuery = s.searchQuery;
    }
    if (s.autoFollow !== undefined) {
      this.autoFollow = s.autoFollow;
    }

    // Note: documentUri and symbols are set externally via setSymbols()
    // selectedSymbolId is restored after symbols are loaded
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create an outline panel element.
 */
export function createOutlinePanel(
  id: string,
  title: string,
  ctx: ElementContext,
  callbacks: OutlinePanelCallbacks = {}
): OutlinePanel {
  return new OutlinePanel(id, title, ctx, callbacks);
}
