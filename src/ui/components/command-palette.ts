/**
 * Command Palette Component
 * 
 * Fuzzy search command palette for executing commands.
 * Supports:
 *   - Fuzzy matching (characters in order)
 *   - Word-initial matching ("ts" matches "toggleSidebar")
 *   - Substring matching
 */

import type { RenderContext } from '../renderer.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import type { Command } from '../../input/commands.ts';

interface ScoredCommand {
  command: Command;
  score: number;
}

export interface PaletteItem {
  id: string;
  title: string;
  category?: string;
  handler: () => void | Promise<void>;
}

interface ScoredItem {
  item: PaletteItem;
  score: number;
}

export class CommandPalette implements MouseHandler {
  private isVisible: boolean = false;
  private query: string = '';
  private commands: Command[] = [];
  private filteredCommands: ScoredCommand[] = [];
  private selectedIndex: number = 0;
  private x: number = 0;
  private y: number = 0;
  private width: number = 60;
  private height: number = 20;
  private onSelectCallback: ((command: Command) => void) | null = null;
  private onCloseCallback: (() => void) | null = null;
  
  // Custom items mode
  private customItems: PaletteItem[] = [];
  private filteredItems: ScoredItem[] = [];
  private customTitle: string = 'Command Palette';
  private isCustomMode: boolean = false;
  private highlightedId: string = '';

  show(commands: Command[], screenWidth: number, screenHeight: number): void {
    this.isVisible = true;
    this.isCustomMode = false;
    this.commands = commands;
    this.query = '';
    this.selectedIndex = 0;
    this.customTitle = 'Command Palette';
    
    // Center the palette
    this.width = Math.min(70, screenWidth - 4);
    this.height = Math.min(20, screenHeight - 4);
    this.x = Math.floor((screenWidth - this.width) / 2) + 1;
    this.y = 2;
    
    this.filter();
  }

  /**
   * Show palette with custom items
   */
  showWithItems(
    items: PaletteItem[], 
    title: string = 'Select Item',
    highlightId: string = ''
  ): void {
    this.isVisible = true;
    this.isCustomMode = true;
    this.customItems = items;
    this.customTitle = title;
    this.highlightedId = highlightId;
    this.query = '';
    this.selectedIndex = 0;
    
    // Find the highlighted item's index
    if (highlightId) {
      const idx = items.findIndex(item => item.id === highlightId);
      if (idx >= 0) {
        this.selectedIndex = idx;
      }
    }
    
    // Center the palette
    const screenWidth = process.stdout.columns || 80;
    const screenHeight = process.stdout.rows || 24;
    this.width = Math.min(70, screenWidth - 4);
    this.height = Math.min(20, screenHeight - 4);
    this.x = Math.floor((screenWidth - this.width) / 2) + 1;
    this.y = 2;
    
    this.filterCustomItems();
  }

  hide(): void {
    this.isVisible = false;
    if (this.onCloseCallback) {
      this.onCloseCallback();
    }
  }

  isOpen(): boolean {
    return this.isVisible;
  }

  getQuery(): string {
    return this.query;
  }

  appendToQuery(char: string): void {
    this.query += char;
    this.selectedIndex = 0;
    if (this.isCustomMode) {
      this.filterCustomItems();
    } else {
      this.filter();
    }
  }

  backspaceQuery(): void {
    if (this.query.length > 0) {
      this.query = this.query.slice(0, -1);
      this.selectedIndex = 0;
      if (this.isCustomMode) {
        this.filterCustomItems();
      } else {
        this.filter();
      }
    }
  }

  getSelectedCommand(): Command | null {
    if (this.isCustomMode) return null;
    return this.filteredCommands[this.selectedIndex]?.command || null;
  }

  getSelectedItem(): PaletteItem | null {
    if (!this.isCustomMode) return null;
    return this.filteredItems[this.selectedIndex]?.item || null;
  }

  selectNext(): void {
    const maxIndex = this.isCustomMode 
      ? this.filteredItems.length - 1 
      : this.filteredCommands.length - 1;
    if (this.selectedIndex < maxIndex) {
      this.selectedIndex++;
    }
  }

  selectPrevious(): void {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
    }
  }

  async confirm(): Promise<void> {
    if (this.isCustomMode) {
      const item = this.getSelectedItem();
      if (item) {
        await item.handler();
      }
    } else {
      const command = this.getSelectedCommand();
      if (command && this.onSelectCallback) {
        await this.onSelectCallback(command);
      }
    }
    this.hide();
  }

  onSelect(callback: (command: Command) => void): void {
    this.onSelectCallback = callback;
  }

  onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  /**
   * Filter and score commands based on query
   */
  private filter(): void {
    if (!this.query) {
      // No query - show all commands sorted alphabetically
      this.filteredCommands = this.commands.map(cmd => ({
        command: cmd,
        score: 0
      }));
      return;
    }

    const results: ScoredCommand[] = [];
    const lowerQuery = this.query.toLowerCase();

    for (const cmd of this.commands) {
      const score = this.scoreCommand(cmd, lowerQuery);
      if (score > 0) {
        results.push({ command: cmd, score });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    this.filteredCommands = results;
  }

  /**
   * Filter and score custom items based on query
   */
  private filterCustomItems(): void {
    if (!this.query) {
      // No query - show all items in original order
      this.filteredItems = this.customItems.map(item => ({
        item,
        score: 0
      }));
      return;
    }

    const results: ScoredItem[] = [];
    const lowerQuery = this.query.toLowerCase();

    for (const item of this.customItems) {
      const score = this.scoreItem(item, lowerQuery);
      if (score > 0) {
        results.push({ item, score });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    this.filteredItems = results;
  }

  /**
   * Score a custom item against the query
   */
  private scoreItem(item: PaletteItem, lowerQuery: string): number {
    const title = item.title;
    const lowerTitle = title.toLowerCase();

    let bestScore = 0;

    // Exact substring match
    if (lowerTitle.includes(lowerQuery)) {
      bestScore = Math.max(bestScore, 100 + (50 - lowerQuery.length));
    }

    // Fuzzy match
    const fuzzyScore = this.fuzzyScore(lowerQuery, lowerTitle);
    if (fuzzyScore > 0) {
      bestScore = Math.max(bestScore, 40 + fuzzyScore);
    }

    return bestScore;
  }

  /**
   * Score a command against the query
   * Returns 0 if no match, higher score = better match
   */
  private scoreCommand(cmd: Command, lowerQuery: string): number {
    const title = cmd.title;
    const lowerTitle = title.toLowerCase();
    const id = cmd.id;
    const lowerId = id.toLowerCase();

    let bestScore = 0;

    // 1. Exact substring match in title (highest priority)
    if (lowerTitle.includes(lowerQuery)) {
      bestScore = Math.max(bestScore, 100 + (50 - lowerQuery.length));
    }

    // 2. Word-initial letter match (e.g., "ts" matches "Toggle Sidebar")
    const wordInitialScore = this.scoreWordInitials(title, lowerQuery);
    if (wordInitialScore > 0) {
      bestScore = Math.max(bestScore, 80 + wordInitialScore);
    }

    // 3. Fuzzy match in title
    const fuzzyTitleScore = this.fuzzyScore(lowerQuery, lowerTitle);
    if (fuzzyTitleScore > 0) {
      bestScore = Math.max(bestScore, 40 + fuzzyTitleScore);
    }

    // 4. Match in command ID (lower priority)
    if (lowerId.includes(lowerQuery)) {
      bestScore = Math.max(bestScore, 30);
    }

    // 5. Fuzzy match in command ID
    const fuzzyIdScore = this.fuzzyScore(lowerQuery, lowerId);
    if (fuzzyIdScore > 0) {
      bestScore = Math.max(bestScore, 20 + fuzzyIdScore);
    }

    return bestScore;
  }

  /**
   * Score based on matching first letters of words
   * "ts" matches "Toggle Sidebar" -> high score
   * "nf" matches "New File" -> high score
   */
  private scoreWordInitials(text: string, query: string): number {
    // Extract first letter of each word
    const words = text.split(/[\s\-_.]+/);
    const initials = words.map(w => w[0]?.toLowerCase() || '').join('');
    
    // Also try camelCase word boundaries
    const camelWords = text.split(/(?=[A-Z])/);
    const camelInitials = camelWords.map(w => w[0]?.toLowerCase() || '').join('');

    // Check if query matches initials
    if (initials.startsWith(query)) {
      return 20 + (query.length * 2);
    }
    if (camelInitials.startsWith(query)) {
      return 20 + (query.length * 2);
    }
    if (initials.includes(query)) {
      return 10 + query.length;
    }
    if (camelInitials.includes(query)) {
      return 10 + query.length;
    }

    return 0;
  }

  /**
   * Fuzzy match scoring - characters must appear in order
   */
  private fuzzyScore(query: string, target: string): number {
    let score = 0;
    let queryIndex = 0;
    let consecutiveBonus = 0;
    let lastMatchIndex = -1;

    for (let i = 0; i < target.length && queryIndex < query.length; i++) {
      if (target[i] === query[queryIndex]) {
        // Bonus for consecutive matches
        if (lastMatchIndex === i - 1) {
          consecutiveBonus += 1;
        } else {
          consecutiveBonus = 0;
        }

        // Bonus for matching at word boundaries
        const isWordBoundary = i === 0 || 
          target[i - 1] === ' ' || 
          target[i - 1] === '.' ||
          target[i - 1] === '-' ||
          target[i - 1] === '_' ||
          (target[i - 1]?.toLowerCase() === target[i - 1] && target[i]?.toUpperCase() === target[i]);
        
        const boundaryBonus = isWordBoundary ? 3 : 0;

        score += 1 + consecutiveBonus + boundaryBonus;
        lastMatchIndex = i;
        queryIndex++;
      }
    }

    // Return 0 if not all query chars matched
    if (queryIndex < query.length) return 0;

    // Small penalty for longer targets
    score -= target.length * 0.01;

    return score;
  }

  render(ctx: RenderContext): void {
    if (!this.isVisible) return;

    // Background with border
    ctx.fill(this.x, this.y, this.width, this.height, ' ', undefined, '#2d2d2d');

    // Draw border
    this.drawBorder(ctx);

    // Title
    const title = ` ${this.customTitle} `;
    const titleX = this.x + Math.floor((this.width - title.length) / 2);
    ctx.drawStyled(titleX, this.y, title, '#c678dd', '#2d2d2d');

    // Input field
    const inputY = this.y + 1;
    const inputPrefix = ' > ';
    const cursorChar = '│';
    
    // Draw input background
    ctx.fill(this.x + 1, inputY, this.width - 2, 1, ' ', '#d0d0d0', '#3e3e3e');
    
    // Draw input content
    ctx.drawStyled(this.x + 2, inputY, inputPrefix, '#c678dd', '#3e3e3e');
    const displayQuery = this.query.slice(0, this.width - 10);
    ctx.drawStyled(this.x + 5, inputY, displayQuery + cursorChar, '#ffffff', '#3e3e3e');

    // Separator
    const sepY = this.y + 2;
    ctx.drawStyled(this.x + 1, sepY, '─'.repeat(this.width - 2), '#444444', '#2d2d2d');

    // Results - render differently based on mode
    if (this.isCustomMode) {
      this.renderCustomItems(ctx);
    } else {
      this.renderCommands(ctx);
    }
  }

  /**
   * Render command list
   */
  private renderCommands(ctx: RenderContext): void {
    if (this.filteredCommands.length === 0) {
      const noResults = this.query ? 'No matching commands' : 'Type to search commands';
      ctx.drawStyled(this.x + 3, this.y + 4, noResults, '#888888', '#2d2d2d');
    } else {
      const maxResults = this.height - 4;
      for (let i = 0; i < maxResults; i++) {
        const item = this.filteredCommands[i];
        if (!item) break;

        const resultY = this.y + 3 + i;
        const isSelected = i === this.selectedIndex;
        const cmd = item.command;

        // Background
        const bgColor = isSelected ? '#3e5f8a' : '#2d2d2d';
        ctx.fill(this.x + 1, resultY, this.width - 2, 1, ' ', undefined, bgColor);

        // Category icon
        const icon = this.getCategoryIcon(cmd.category);
        ctx.drawStyled(this.x + 2, resultY, icon, '#888888', bgColor);

        // Command title
        const titleColor = isSelected ? '#ffffff' : '#d4d4d4';
        const maxTitleLen = this.width - 20;
        const displayTitle = cmd.title.length > maxTitleLen 
          ? cmd.title.slice(0, maxTitleLen - 1) + '…'
          : cmd.title;
        ctx.drawStyled(this.x + 5, resultY, displayTitle, titleColor, bgColor);

        // Category label (right-aligned, dimmed)
        if (cmd.category) {
          const categoryColor = isSelected ? '#a0a0a0' : '#666666';
          const categoryText = cmd.category;
          const categoryX = this.x + this.width - categoryText.length - 3;
          if (categoryX > this.x + 5 + displayTitle.length + 2) {
            ctx.drawStyled(categoryX, resultY, categoryText, categoryColor, bgColor);
          }
        }
      }
    }

    // Footer with count
    const footerY = this.y + this.height - 1;
    const count = `${this.filteredCommands.length} commands`;
    ctx.drawStyled(this.x + this.width - count.length - 2, footerY, count, '#666666', '#2d2d2d');
  }

  /**
   * Render custom items list
   */
  private renderCustomItems(ctx: RenderContext): void {
    if (this.filteredItems.length === 0) {
      const noResults = this.query ? 'No matching items' : 'Type to search';
      ctx.drawStyled(this.x + 3, this.y + 4, noResults, '#888888', '#2d2d2d');
    } else {
      const maxResults = this.height - 4;
      for (let i = 0; i < maxResults; i++) {
        const scoredItem = this.filteredItems[i];
        if (!scoredItem) break;

        const resultY = this.y + 3 + i;
        const isSelected = i === this.selectedIndex;
        const item = scoredItem.item;
        const isCurrent = item.id === this.highlightedId;

        // Background
        const bgColor = isSelected ? '#3e5f8a' : '#2d2d2d';
        ctx.fill(this.x + 1, resultY, this.width - 2, 1, ' ', undefined, bgColor);

        // Checkmark for current item
        const checkmark = isCurrent ? '✓ ' : '  ';
        const checkColor = isSelected ? '#98c379' : '#98c379';
        ctx.drawStyled(this.x + 2, resultY, checkmark, checkColor, bgColor);

        // Item title
        const titleColor = isSelected ? '#ffffff' : '#d4d4d4';
        const maxTitleLen = this.width - 20;
        const displayTitle = item.title.length > maxTitleLen 
          ? item.title.slice(0, maxTitleLen - 1) + '…'
          : item.title;
        ctx.drawStyled(this.x + 4, resultY, displayTitle, titleColor, bgColor);

        // Category label (right-aligned, dimmed)
        if (item.category) {
          const categoryColor = isSelected ? '#a0a0a0' : '#666666';
          const categoryText = item.category;
          const categoryX = this.x + this.width - categoryText.length - 3;
          if (categoryX > this.x + 4 + displayTitle.length + 2) {
            ctx.drawStyled(categoryX, resultY, categoryText, categoryColor, bgColor);
          }
        }
      }
    }

    // Footer with count
    const footerY = this.y + this.height - 1;
    const count = `${this.filteredItems.length} items`;
    ctx.drawStyled(this.x + this.width - count.length - 2, footerY, count, '#666666', '#2d2d2d');
  }

  /**
   * Draw border around palette
   */
  private drawBorder(ctx: RenderContext): void {
    const borderColor = '#444444';
    const bgColor = '#2d2d2d';

    // Top border
    ctx.drawStyled(this.x, this.y, '╭' + '─'.repeat(this.width - 2) + '╮', borderColor, bgColor);

    // Side borders
    for (let y = this.y + 1; y < this.y + this.height - 1; y++) {
      ctx.drawStyled(this.x, y, '│', borderColor, bgColor);
      ctx.drawStyled(this.x + this.width - 1, y, '│', borderColor, bgColor);
    }

    // Bottom border
    ctx.drawStyled(this.x, this.y + this.height - 1, '╰' + '─'.repeat(this.width - 2) + '╯', borderColor, bgColor);
  }

  /**
   * Get icon for command category
   */
  private getCategoryIcon(category?: string): string {
    const icons: Record<string, string> = {
      'File': '󰈔',
      'Edit': '',
      'Selection': '󰒅',
      'View': '',
      'Navigation': '',
      'Search': '',
      'Tabs': '󰓩',
    };
    return icons[category || ''] || '';
  }

  containsPoint(x: number, y: number): boolean {
    if (!this.isVisible) return false;
    return (
      x >= this.x &&
      x < this.x + this.width &&
      y >= this.y &&
      y < this.y + this.height
    );
  }

  onMouseEvent(event: MouseEvent): boolean {
    if (!this.isVisible) return false;
    
    if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED') {
      // Calculate which item was clicked
      const itemY = event.y - this.y - 3;
      const itemCount = this.isCustomMode ? this.filteredItems.length : this.filteredCommands.length;
      if (itemY >= 0 && itemY < itemCount) {
        this.selectedIndex = itemY;
        this.confirm();
        return true;
      }
    }
    
    return this.containsPoint(event.x, event.y);
  }
}

export const commandPalette = new CommandPalette();

export default commandPalette;
