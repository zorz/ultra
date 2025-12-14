/**
 * File Picker Component
 * 
 * Fuzzy file finder dialog for quick file opening.
 */

import type { RenderContext } from '../renderer.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import { fileSearch, type FileSearchResult } from '../../features/search/file-search.ts';

export class FilePicker implements MouseHandler {
  private isVisible: boolean = false;
  private query: string = '';
  private results: FileSearchResult[] = [];
  private selectedIndex: number = 0;
  private x: number = 0;
  private y: number = 0;
  private width: number = 80;
  private height: number = 20;
  private onSelectCallback: ((filePath: string) => void) | null = null;
  private onCloseCallback: (() => void) | null = null;
  private isIndexing: boolean = false;

  /**
   * Show the file picker
   */
  async show(workspaceRoot: string, screenWidth: number, screenHeight: number): Promise<void> {
    this.isVisible = true;
    this.query = '';
    this.selectedIndex = 0;

    // Center the picker
    this.width = Math.min(80, screenWidth - 4);
    this.height = Math.min(24, screenHeight - 4);
    this.x = Math.floor((screenWidth - this.width) / 2) + 1;
    this.y = 2;

    // Index files if needed
    if (fileSearch.getFileCount() === 0) {
      this.isIndexing = true;
      fileSearch.setWorkspaceRoot(workspaceRoot);
      await fileSearch.indexFiles();
      this.isIndexing = false;
    }

    this.updateResults();
  }

  /**
   * Hide the file picker
   */
  hide(): void {
    this.isVisible = false;
    if (this.onCloseCallback) {
      this.onCloseCallback();
    }
  }

  /**
   * Check if picker is open
   */
  isOpen(): boolean {
    return this.isVisible;
  }

  /**
   * Set the search query
   */
  setQuery(query: string): void {
    this.query = query;
    this.selectedIndex = 0;
    this.updateResults();
  }

  /**
   * Get the current query
   */
  getQuery(): string {
    return this.query;
  }

  /**
   * Append to query
   */
  appendToQuery(char: string): void {
    this.query += char;
    this.selectedIndex = 0;
    this.updateResults();
  }

  /**
   * Backspace in query
   */
  backspaceQuery(): void {
    if (this.query.length > 0) {
      this.query = this.query.slice(0, -1);
      this.selectedIndex = 0;
      this.updateResults();
    }
  }

  /**
   * Update search results
   */
  private updateResults(): void {
    this.results = fileSearch.search(this.query, this.height - 3);
  }

  /**
   * Get selected file path
   */
  getSelectedPath(): string | null {
    const result = this.results[this.selectedIndex];
    return result?.path || null;
  }

  /**
   * Select next item
   */
  selectNext(): void {
    if (this.selectedIndex < this.results.length - 1) {
      this.selectedIndex++;
    }
  }

  /**
   * Select previous item
   */
  selectPrevious(): void {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
    }
  }

  /**
   * Confirm selection
   */
  confirm(): void {
    const path = this.getSelectedPath();
    if (path && this.onSelectCallback) {
      this.onSelectCallback(path);
    }
    this.hide();
  }

  /**
   * Register callback for file selection
   */
  onSelect(callback: (filePath: string) => void): void {
    this.onSelectCallback = callback;
  }

  /**
   * Register callback for close
   */
  onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  /**
   * Render the file picker
   */
  render(ctx: RenderContext): void {
    if (!this.isVisible) return;

    // Background with border
    ctx.fill(this.x, this.y, this.width, this.height, ' ', undefined, '#2d2d2d');

    // Draw border
    this.drawBorder(ctx);

    // Title
    const title = ' Quick Open ';
    const titleX = this.x + Math.floor((this.width - title.length) / 2);
    ctx.drawStyled(titleX, this.y, title, '#61afef', '#2d2d2d');

    // Input field with icon
    const inputY = this.y + 1;
    const inputPrefix = ' 🔍 ';
    const inputText = this.query;
    const cursorChar = '│';
    
    // Draw input background
    ctx.fill(this.x + 1, inputY, this.width - 2, 1, ' ', '#d0d0d0', '#3e3e3e');
    
    // Draw input content
    ctx.drawStyled(this.x + 2, inputY, inputPrefix, '#888888', '#3e3e3e');
    const displayQuery = inputText.slice(0, this.width - 10);
    ctx.drawStyled(this.x + 6, inputY, displayQuery + cursorChar, '#ffffff', '#3e3e3e');

    // Separator
    const sepY = this.y + 2;
    ctx.drawStyled(this.x + 1, sepY, '─'.repeat(this.width - 2), '#444444', '#2d2d2d');

    // Results
    if (this.isIndexing) {
      ctx.drawStyled(this.x + 3, this.y + 4, 'Indexing files...', '#888888', '#2d2d2d');
    } else if (this.results.length === 0) {
      const noResults = this.query ? 'No matching files' : 'Type to search files';
      ctx.drawStyled(this.x + 3, this.y + 4, noResults, '#888888', '#2d2d2d');
    } else {
      const maxResults = this.height - 4;
      for (let i = 0; i < maxResults; i++) {
        const result = this.results[i];
        if (!result) break;

        const resultY = this.y + 3 + i;
        const isSelected = i === this.selectedIndex;

        // Background
        const bgColor = isSelected ? '#3e5f8a' : '#2d2d2d';
        ctx.fill(this.x + 1, resultY, this.width - 2, 1, ' ', undefined, bgColor);

        // File icon based on extension
        const icon = this.getFileIcon(result.name);
        ctx.drawStyled(this.x + 2, resultY, icon, '#888888', bgColor);

        // Filename (highlighted)
        const nameColor = isSelected ? '#ffffff' : '#d4d4d4';
        const maxNameLen = Math.min(30, this.width - 10);
        const displayName = result.name.length > maxNameLen 
          ? result.name.slice(0, maxNameLen - 1) + '…'
          : result.name;
        ctx.drawStyled(this.x + 5, resultY, displayName, nameColor, bgColor);

        // Path (dimmed)
        const pathColor = isSelected ? '#a0a0a0' : '#666666';
        const pathStart = this.x + 6 + displayName.length;
        const pathMaxLen = this.width - (pathStart - this.x) - 2;
        if (pathMaxLen > 5) {
          const dir = result.relativePath.slice(0, result.relativePath.length - result.name.length - 1);
          const displayPath = dir.length > pathMaxLen 
            ? '…' + dir.slice(-(pathMaxLen - 1))
            : dir;
          if (displayPath) {
            ctx.drawStyled(pathStart, resultY, displayPath, pathColor, bgColor);
          }
        }
      }
    }

    // Footer with file count
    const footerY = this.y + this.height - 1;
    const fileCount = `${fileSearch.getFileCount()} files`;
    ctx.drawStyled(this.x + this.width - fileCount.length - 2, footerY, fileCount, '#666666', '#2d2d2d');
  }

  /**
   * Draw border around picker
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
   * Get file icon based on extension
   */
  private getFileIcon(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    
    const icons: Record<string, string> = {
      'ts': '󰛦',
      'tsx': '󰜈',
      'js': '󰌞',
      'jsx': '󰜈',
      'json': '',
      'md': '',
      'css': '',
      'scss': '',
      'html': '',
      'vue': '󰡄',
      'svelte': '',
      'py': '',
      'rs': '',
      'go': '',
      'rb': '',
      'sh': '',
      'bash': '',
      'zsh': '',
      'yaml': '',
      'yml': '',
      'toml': '',
      'xml': '󰗀',
      'svg': '󰜡',
      'png': '',
      'jpg': '',
      'jpeg': '',
      'gif': '',
      'sql': '',
      'graphql': '',
      'dockerfile': '',
      'gitignore': '',
    };

    return icons[ext] || '';
  }

  /**
   * Check if point is inside picker
   */
  containsPoint(x: number, y: number): boolean {
    if (!this.isVisible) return false;
    return (
      x >= this.x &&
      x < this.x + this.width &&
      y >= this.y &&
      y < this.y + this.height
    );
  }

  /**
   * Handle mouse events
   */
  onMouseEvent(event: MouseEvent): boolean {
    if (!this.isVisible) return false;

    if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED') {
      // Calculate which result was clicked
      const resultY = event.y - this.y - 3;
      if (resultY >= 0 && resultY < this.results.length) {
        this.selectedIndex = resultY;
        this.confirm();
        return true;
      }
    }

    return this.containsPoint(event.x, event.y);
  }
}

export const filePicker = new FilePicker();

export default filePicker;
