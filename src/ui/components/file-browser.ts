/**
 * File Browser Component
 * 
 * Full directory browser for opening files with navigation.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { RenderContext } from '../renderer.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export class FileBrowser implements MouseHandler {
  private isVisible: boolean = false;
  private currentPath: string = '';
  private entries: FileEntry[] = [];
  private selectedIndex: number = 0;
  private scrollOffset: number = 0;
  private x: number = 0;
  private y: number = 0;
  private width: number = 60;
  private height: number = 20;
  private onSelectCallback: ((filePath: string) => void) | null = null;
  private onCloseCallback: (() => void) | null = null;
  private showHidden: boolean = false;

  /**
   * Show the file browser
   */
  show(startPath: string, screenWidth: number, screenHeight: number): void {
    this.isVisible = true;
    this.selectedIndex = 0;
    this.scrollOffset = 0;

    // Center the browser
    this.width = Math.min(80, screenWidth - 4);
    this.height = Math.min(30, screenHeight - 4);
    this.x = Math.floor((screenWidth - this.width) / 2) + 1;
    this.y = 2;

    this.navigateTo(startPath);
  }

  /**
   * Hide the file browser
   */
  hide(): void {
    this.isVisible = false;
    if (this.onCloseCallback) {
      this.onCloseCallback();
    }
  }

  /**
   * Check if browser is open
   */
  isOpen(): boolean {
    return this.isVisible;
  }

  /**
   * Navigate to a directory
   */
  navigateTo(dirPath: string): void {
    try {
      const resolved = path.resolve(dirPath);
      const stat = fs.statSync(resolved);
      
      if (!stat.isDirectory()) {
        // It's a file, select it
        if (this.onSelectCallback) {
          this.onSelectCallback(resolved);
        }
        this.hide();
        return;
      }

      this.currentPath = resolved;
      this.loadDirectory();
      this.selectedIndex = 0;
      this.scrollOffset = 0;
    } catch (error) {
      // Can't access directory, stay where we are
    }
  }

  /**
   * Load entries from current directory
   */
  private loadDirectory(): void {
    this.entries = [];

    try {
      const items = fs.readdirSync(this.currentPath, { withFileTypes: true });
      
      // Separate directories and files
      const dirs: FileEntry[] = [];
      const files: FileEntry[] = [];

      for (const item of items) {
        // Skip hidden files unless showHidden is true
        if (!this.showHidden && item.name.startsWith('.')) {
          continue;
        }

        const entry: FileEntry = {
          name: item.name,
          path: path.join(this.currentPath, item.name),
          isDirectory: item.isDirectory()
        };

        if (item.isDirectory()) {
          dirs.push(entry);
        } else {
          files.push(entry);
        }
      }

      // Sort alphabetically (case-insensitive)
      const sortFn = (a: FileEntry, b: FileEntry) => 
        a.name.toLowerCase().localeCompare(b.name.toLowerCase());

      dirs.sort(sortFn);
      files.sort(sortFn);

      // Directories first, then files
      this.entries = [...dirs, ...files];
    } catch (error) {
      // Can't read directory
    }
  }

  /**
   * Get currently selected entry
   */
  getSelectedEntry(): FileEntry | null {
    return this.entries[this.selectedIndex] || null;
  }

  /**
   * Select next item
   */
  selectNext(): void {
    if (this.selectedIndex < this.entries.length - 1) {
      this.selectedIndex++;
      this.ensureVisible();
    }
  }

  /**
   * Select previous item
   */
  selectPrevious(): void {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
      this.ensureVisible();
    }
  }

  /**
   * Page down
   */
  pageDown(): void {
    const visibleItems = this.height - 5;
    this.selectedIndex = Math.min(this.entries.length - 1, this.selectedIndex + visibleItems);
    this.ensureVisible();
  }

  /**
   * Page up
   */
  pageUp(): void {
    const visibleItems = this.height - 5;
    this.selectedIndex = Math.max(0, this.selectedIndex - visibleItems);
    this.ensureVisible();
  }

  /**
   * Go to parent directory
   */
  goUp(): void {
    const parent = path.dirname(this.currentPath);
    if (parent !== this.currentPath) {
      const oldPath = this.currentPath;
      this.navigateTo(parent);
      // Try to select the directory we came from
      const oldName = path.basename(oldPath);
      const idx = this.entries.findIndex(e => e.name === oldName);
      if (idx >= 0) {
        this.selectedIndex = idx;
        this.ensureVisible();
      }
    }
  }

  /**
   * Enter selected directory or open file
   */
  enter(): void {
    const entry = this.getSelectedEntry();
    if (!entry) return;

    if (entry.isDirectory) {
      this.navigateTo(entry.path);
    } else {
      if (this.onSelectCallback) {
        this.onSelectCallback(entry.path);
      }
      this.hide();
    }
  }

  /**
   * Toggle hidden files
   */
  toggleHidden(): void {
    this.showHidden = !this.showHidden;
    this.loadDirectory();
    this.selectedIndex = Math.min(this.selectedIndex, this.entries.length - 1);
    if (this.selectedIndex < 0) this.selectedIndex = 0;
  }

  /**
   * Ensure selected item is visible
   */
  private ensureVisible(): void {
    const visibleItems = this.height - 5;
    
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + visibleItems) {
      this.scrollOffset = this.selectedIndex - visibleItems + 1;
    }
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
   * Render the file browser
   */
  render(ctx: RenderContext): void {
    if (!this.isVisible) return;

    // Background with border
    ctx.fill(this.x, this.y, this.width, this.height, ' ', undefined, '#2d2d2d');

    // Draw border
    this.drawBorder(ctx);

    // Title
    const title = ' Open File ';
    const titleX = this.x + Math.floor((this.width - title.length) / 2);
    ctx.drawStyled(titleX, this.y, title, '#61afef', '#2d2d2d');

    // Current path
    const pathY = this.y + 1;
    const displayPath = this.truncatePath(this.currentPath, this.width - 6);
    ctx.fill(this.x + 1, pathY, this.width - 2, 1, ' ', '#d0d0d0', '#3e3e3e');
    ctx.drawStyled(this.x + 2, pathY, '📁 ' + displayPath, '#98c379', '#3e3e3e');

    // Separator
    const sepY = this.y + 2;
    ctx.drawStyled(this.x + 1, sepY, '─'.repeat(this.width - 2), '#444444', '#2d2d2d');

    // File list
    const listStartY = this.y + 3;
    const visibleItems = this.height - 5;

    if (this.entries.length === 0) {
      ctx.drawStyled(this.x + 3, listStartY + 1, 'Empty directory', '#888888', '#2d2d2d');
    } else {
      for (let i = 0; i < visibleItems; i++) {
        const entryIndex = this.scrollOffset + i;
        const entry = this.entries[entryIndex];
        const itemY = listStartY + i;

        if (!entry) {
          ctx.fill(this.x + 1, itemY, this.width - 2, 1, ' ', undefined, '#2d2d2d');
          continue;
        }

        const isSelected = entryIndex === this.selectedIndex;
        const bgColor = isSelected ? '#3e5f8a' : '#2d2d2d';

        // Background
        ctx.fill(this.x + 1, itemY, this.width - 2, 1, ' ', undefined, bgColor);

        // Icon
        const icon = entry.isDirectory ? '📁' : this.getFileIcon(entry.name);
        ctx.drawStyled(this.x + 2, itemY, icon, '#888888', bgColor);

        // Name
        const nameColor = isSelected ? '#ffffff' : (entry.isDirectory ? '#61afef' : '#d4d4d4');
        const maxNameLen = this.width - 8;
        let displayName = entry.name;
        if (entry.isDirectory) displayName += '/';
        if (displayName.length > maxNameLen) {
          displayName = displayName.slice(0, maxNameLen - 1) + '…';
        }
        ctx.drawStyled(this.x + 5, itemY, displayName, nameColor, bgColor);
      }

      // Scroll indicators
      if (this.scrollOffset > 0) {
        ctx.drawStyled(this.x + this.width - 3, listStartY, '▲', '#888888', '#2d2d2d');
      }
      if (this.scrollOffset + visibleItems < this.entries.length) {
        ctx.drawStyled(this.x + this.width - 3, listStartY + visibleItems - 1, '▼', '#888888', '#2d2d2d');
      }
    }

    // Footer with help
    const footerY = this.y + this.height - 1;
    const helpText = '↑↓:nav  ←:up  →/Enter:open  .:hidden  Esc:close';
    const truncatedHelp = helpText.slice(0, this.width - 4);
    ctx.drawStyled(this.x + 2, footerY, truncatedHelp, '#666666', '#2d2d2d');
  }

  /**
   * Draw border around browser
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
   * Truncate path for display
   */
  private truncatePath(p: string, maxLen: number): string {
    if (p.length <= maxLen) return p;
    
    // Try to show home directory as ~
    const home = process.env.HOME || '';
    if (home && p.startsWith(home)) {
      p = '~' + p.slice(home.length);
    }
    
    if (p.length <= maxLen) return p;
    
    // Truncate from the beginning
    return '…' + p.slice(-(maxLen - 1));
  }

  /**
   * Get icon for file type
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
      'py': '',
      'rs': '',
      'go': '',
      'sh': '',
      'yml': '',
      'yaml': '',
      'toml': '',
      'lock': '',
      'gitignore': '',
    };

    return icons[ext] || '';
  }

  /**
   * Check if point is inside browser
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
      // Calculate which entry was clicked
      const listStartY = this.y + 3;
      const clickedIndex = event.y - listStartY + this.scrollOffset;
      
      if (clickedIndex >= 0 && clickedIndex < this.entries.length) {
        if (this.selectedIndex === clickedIndex) {
          // Double-click effect: enter on second click
          this.enter();
        } else {
          this.selectedIndex = clickedIndex;
        }
        return true;
      }
    }

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
}

export const fileBrowser = new FileBrowser();

export default fileBrowser;
