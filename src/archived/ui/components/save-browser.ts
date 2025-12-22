/**
 * Save Browser Component
 * 
 * File browser for Save As with directory navigation and filename input.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { RenderContext } from '../renderer.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import { themeLoader } from '../themes/theme-loader.ts';

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isHidden: boolean;
}

type SaveBrowserMode = 'browse' | 'confirm-overwrite';

export class SaveBrowser implements MouseHandler {
  private isVisible: boolean = false;
  private currentPath: string = '';
  private entries: FileEntry[] = [];
  private selectedIndex: number = 0;
  private scrollOffset: number = 0;
  private x: number = 0;
  private y: number = 0;
  private width: number = 60;
  private height: number = 20;
  private onSaveCallback: ((filePath: string) => void) | null = null;
  private onCancelCallback: (() => void) | null = null;
  private showHidden: boolean = false;
  
  // Filename input
  private filename: string = '';
  private inputFocused: boolean = true;  // Start with filename input focused
  
  // Confirmation mode
  private mode: SaveBrowserMode = 'browse';
  private confirmPath: string = '';

  /**
   * Show the save browser
   */
  show(options: {
    startPath: string;
    suggestedFilename: string;
    screenWidth: number;
    screenHeight: number;
    editorX?: number;
    editorWidth?: number;
    onSave: (filePath: string) => void;
    onCancel?: () => void;
  }): void {
    this.isVisible = true;
    this.selectedIndex = 0;
    this.scrollOffset = 0;
    this.filename = options.suggestedFilename;
    this.onSaveCallback = options.onSave;
    this.onCancelCallback = options.onCancel || null;
    this.inputFocused = true;
    this.mode = 'browse';
    this.confirmPath = '';

    // Center the browser over editor area if provided, otherwise over full screen
    const centerX = options.editorX !== undefined && options.editorWidth !== undefined
      ? options.editorX + Math.floor(options.editorWidth / 2)
      : Math.floor(options.screenWidth / 2);

    this.width = Math.min(80, (options.editorWidth || options.screenWidth) - 4);
    this.height = Math.min(30, options.screenHeight - 4);
    this.x = centerX - Math.floor(this.width / 2) + 1;
    this.y = 2;

    this.navigateTo(options.startPath);
  }

  /**
   * Hide the browser
   */
  hide(): void {
    this.isVisible = false;
    if (this.onCancelCallback) {
      this.onCancelCallback();
    }
  }

  /**
   * Check if browser is open
   */
  isOpen(): boolean {
    return this.isVisible;
  }

  /**
   * Get current mode
   */
  getMode(): SaveBrowserMode {
    return this.mode;
  }

  /**
   * Navigate to a directory
   */
  navigateTo(dirPath: string): void {
    try {
      const resolved = path.resolve(dirPath);
      const stat = fs.statSync(resolved);
      
      if (!stat.isDirectory()) {
        // It's a file - set filename and go to parent
        this.filename = path.basename(resolved);
        this.navigateTo(path.dirname(resolved));
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
        if (item.name === '.DS_Store') continue;

        const isHidden = item.name.startsWith('.');
        if (!this.showHidden && isHidden) continue;

        const entry: FileEntry = {
          name: item.name,
          path: path.join(this.currentPath, item.name),
          isDirectory: item.isDirectory(),
          isHidden
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

      this.entries = [...dirs, ...files];
    } catch (error) {
      // Can't read directory
    }
  }

  /**
   * Get full save path
   */
  getFullPath(): string {
    return path.join(this.currentPath, this.filename);
  }

  /**
   * Check if file exists
   */
  fileExists(): boolean {
    try {
      fs.accessSync(this.getFullPath());
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Attempt to save
   */
  save(): void {
    if (!this.filename.trim()) return;

    const fullPath = this.getFullPath();
    
    if (this.fileExists()) {
      // Show confirmation
      this.mode = 'confirm-overwrite';
      this.confirmPath = fullPath;
    } else {
      // Save directly
      if (this.onSaveCallback) {
        this.onSaveCallback(fullPath);
      }
      this.isVisible = false;
    }
  }

  /**
   * Confirm overwrite
   */
  confirmOverwrite(): void {
    if (this.onSaveCallback) {
      this.onSaveCallback(this.confirmPath);
    }
    this.isVisible = false;
  }

  /**
   * Cancel overwrite, go back to browse
   */
  cancelOverwrite(): void {
    this.mode = 'browse';
    this.confirmPath = '';
  }

  /**
   * Handle key input
   */
  handleKey(key: string, char?: string, ctrl?: boolean, shift?: boolean): boolean {
    if (this.mode === 'confirm-overwrite') {
      if (key === 'Y' || key === 'y') {
        this.confirmOverwrite();
        return true;
      }
      if (key === 'N' || key === 'n' || key === 'ESCAPE') {
        this.cancelOverwrite();
        return true;
      }
      return true; // Consume all keys in confirm mode
    }

    // Browse mode
    if (key === 'ESCAPE') {
      this.hide();
      return true;
    }

    if (key === 'TAB') {
      this.inputFocused = !this.inputFocused;
      return true;
    }

    if (this.inputFocused) {
      // Filename input handling
      if (key === 'ENTER') {
        this.save();
        return true;
      }
      if (key === 'BACKSPACE') {
        if (this.filename.length > 0) {
          this.filename = this.filename.slice(0, -1);
        }
        return true;
      }
      if (key === 'DOWN') {
        // Switch to file list (below the input)
        this.inputFocused = false;
        return true;
      }
      // Type character
      if (char && char.length === 1 && !ctrl) {
        this.filename += char;
        return true;
      }
      if (key.length === 1 && !ctrl) {
        this.filename += key.toLowerCase();
        return true;
      }
      return true;
    } else {
      // File list navigation
      if (key === 'DOWN') {
        this.selectNext();
        return true;
      }
      if (key === 'UP') {
        this.selectPrevious();
        return true;
      }
      if (key === 'LEFT') {
        this.goUp();
        return true;
      }
      if (key === 'RIGHT' || key === 'ENTER') {
        this.enter();
        return true;
      }
      if (key === 'PAGEDOWN') {
        this.pageDown();
        return true;
      }
      if (key === 'PAGEUP') {
        this.pageUp();
        return true;
      }
      if (key === '.' && !ctrl) {
        this.toggleHidden();
        return true;
      }
      return true;
    }
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
    } else {
      // At top, switch to filename input
      this.inputFocused = true;
    }
  }

  /**
   * Page down
   */
  pageDown(): void {
    const visibleItems = this.height - 8;
    this.selectedIndex = Math.min(this.entries.length - 1, this.selectedIndex + visibleItems);
    this.ensureVisible();
  }

  /**
   * Page up
   */
  pageUp(): void {
    const visibleItems = this.height - 8;
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
      const oldName = path.basename(oldPath);
      const idx = this.entries.findIndex(e => e.name === oldName);
      if (idx >= 0) {
        this.selectedIndex = idx;
        this.ensureVisible();
      }
    }
  }

  /**
   * Enter selected directory or select file
   */
  enter(): void {
    const entry = this.entries[this.selectedIndex];
    if (!entry) return;

    if (entry.isDirectory) {
      this.navigateTo(entry.path);
    } else {
      // Select this file (populate filename)
      this.filename = entry.name;
      this.inputFocused = true;
    }
  }

  /**
   * Toggle hidden files
   */
  toggleHidden(): void {
    this.showHidden = !this.showHidden;
    this.loadDirectory();
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.entries.length - 1));
  }

  /**
   * Ensure selected item is visible
   */
  private ensureVisible(): void {
    const visibleItems = this.height - 8;
    
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + visibleItems) {
      this.scrollOffset = this.selectedIndex - visibleItems + 1;
    }
  }

  /**
   * Render the save browser
   */
  render(ctx: RenderContext): void {
    if (!this.isVisible) return;

    if (this.mode === 'confirm-overwrite') {
      this.renderConfirmDialog(ctx);
      return;
    }

    const bgColor = '#2d2d2d';
    const borderColor = '#444444';

    // Background
    ctx.fill(this.x, this.y, this.width, this.height, ' ', undefined, bgColor);

    // Border
    this.drawBorder(ctx);

    // Title
    const title = ' Save As ';
    const titleX = this.x + Math.floor((this.width - title.length) / 2);
    ctx.drawStyled(titleX, this.y, title, '#61afef', bgColor);

    // Current path
    const pathY = this.y + 1;
    const displayPath = this.truncatePath(this.currentPath, this.width - 6);
    ctx.fill(this.x + 1, pathY, this.width - 2, 1, ' ', '#d0d0d0', '#3e3e3e');
    ctx.drawStyled(this.x + 2, pathY, '📁 ' + displayPath, '#98c379', '#3e3e3e');

    // Filename input
    const inputY = this.y + 2;
    const inputBg = this.inputFocused ? '#3e5f8a' : '#3e3e3e';
    const inputLabel = 'Name: ';
    ctx.fill(this.x + 1, inputY, this.width - 2, 1, ' ', '#d0d0d0', inputBg);
    ctx.drawStyled(this.x + 2, inputY, inputLabel, '#888888', inputBg);
    
    const inputWidth = this.width - 4 - inputLabel.length;
    const displayFilename = this.filename.slice(-(inputWidth - 1));
    ctx.drawStyled(this.x + 2 + inputLabel.length, inputY, displayFilename, '#ffffff', inputBg);
    
    // Cursor in input
    if (this.inputFocused) {
      const cursorX = this.x + 2 + inputLabel.length + displayFilename.length;
      if (cursorX < this.x + this.width - 2) {
        ctx.drawStyled(cursorX, inputY, '█', '#ffffff', inputBg);
      }
    }

    // Separator
    const sepY = this.y + 3;
    ctx.drawStyled(this.x + 1, sepY, '─'.repeat(this.width - 2), borderColor, bgColor);

    // File list
    const listStartY = this.y + 4;
    const visibleItems = this.height - 8;

    if (this.entries.length === 0) {
      ctx.drawStyled(this.x + 3, listStartY + 1, 'Empty directory', '#888888', bgColor);
    } else {
      for (let i = 0; i < visibleItems; i++) {
        const entryIndex = this.scrollOffset + i;
        const entry = this.entries[entryIndex];
        const itemY = listStartY + i;

        if (!entry) {
          ctx.fill(this.x + 1, itemY, this.width - 2, 1, ' ', undefined, bgColor);
          continue;
        }

        const isSelected = !this.inputFocused && entryIndex === this.selectedIndex;
        const itemBg = isSelected ? '#3e5f8a' : bgColor;

        // Background
        ctx.fill(this.x + 1, itemY, this.width - 2, 1, ' ', undefined, itemBg);

        // Icon
        const icon = entry.isDirectory ? '📁' : this.getFileIcon(entry.name);
        ctx.drawStyled(this.x + 2, itemY, icon, '#888888', itemBg);

        // Name
        let nameColor = isSelected ? '#ffffff' : (entry.isDirectory ? '#61afef' : '#d4d4d4');
        if (entry.isHidden) {
          nameColor = isSelected ? '#a0a0a0' : '#707070';
        }
        
        const maxNameLen = this.width - 8;
        let displayName = entry.name;
        if (entry.isDirectory) displayName += '/';
        if (displayName.length > maxNameLen) {
          displayName = displayName.slice(0, maxNameLen - 1) + '…';
        }
        ctx.drawStyled(this.x + 5, itemY, displayName, nameColor, itemBg);
      }

      // Scroll indicators
      if (this.scrollOffset > 0) {
        ctx.drawStyled(this.x + this.width - 3, listStartY, '▲', '#888888', bgColor);
      }
      if (this.scrollOffset + visibleItems < this.entries.length) {
        ctx.drawStyled(this.x + this.width - 3, listStartY + visibleItems - 1, '▼', '#888888', bgColor);
      }
    }

    // Footer separator
    const footerSepY = this.y + this.height - 3;
    ctx.drawStyled(this.x + 1, footerSepY, '─'.repeat(this.width - 2), borderColor, bgColor);

    // Full path preview
    const previewY = this.y + this.height - 2;
    const fullPath = this.getFullPath();
    const previewPath = this.truncatePath(fullPath, this.width - 4);
    ctx.fill(this.x + 1, previewY, this.width - 2, 1, ' ', undefined, bgColor);
    ctx.drawStyled(this.x + 2, previewY, previewPath, '#888888', bgColor);

    // Footer with help
    const footerY = this.y + this.height - 1;
    const helpText = 'Tab:switch  ↑↓:nav  ←:up  →:enter  Enter:save  Esc:cancel';
    const truncatedHelp = helpText.slice(0, this.width - 4);
    ctx.drawStyled(this.x + 2, footerY, truncatedHelp, '#666666', bgColor);
  }

  /**
   * Render overwrite confirmation dialog
   */
  private renderConfirmDialog(ctx: RenderContext): void {
    const dialogWidth = 50;
    const dialogHeight = 7;
    const dialogX = this.x + Math.floor((this.width - dialogWidth) / 2);
    const dialogY = this.y + Math.floor((this.height - dialogHeight) / 2);

    const bgColor = '#2d2d2d';
    const borderColor = '#e06c75';

    // Background
    ctx.fill(dialogX, dialogY, dialogWidth, dialogHeight, ' ', undefined, bgColor);

    // Border
    ctx.drawStyled(dialogX, dialogY, '╭' + '─'.repeat(dialogWidth - 2) + '╮', borderColor, bgColor);
    for (let y = dialogY + 1; y < dialogY + dialogHeight - 1; y++) {
      ctx.drawStyled(dialogX, y, '│', borderColor, bgColor);
      ctx.drawStyled(dialogX + dialogWidth - 1, y, '│', borderColor, bgColor);
    }
    ctx.drawStyled(dialogX, dialogY + dialogHeight - 1, '╰' + '─'.repeat(dialogWidth - 2) + '╯', borderColor, bgColor);

    // Title
    const title = ' Confirm Overwrite ';
    const titleX = dialogX + Math.floor((dialogWidth - title.length) / 2);
    ctx.drawStyled(titleX, dialogY, title, '#e06c75', bgColor);

    // Message
    const filename = path.basename(this.confirmPath);
    const msg1 = 'File already exists:';
    const msg2 = filename.length > dialogWidth - 6 ? filename.slice(0, dialogWidth - 9) + '...' : filename;
    ctx.drawStyled(dialogX + 2, dialogY + 2, msg1, '#d4d4d4', bgColor);
    ctx.drawStyled(dialogX + 2, dialogY + 3, msg2, '#e5c07b', bgColor);

    // Options
    const options = 'Overwrite? (Y)es / (N)o';
    const optX = dialogX + Math.floor((dialogWidth - options.length) / 2);
    ctx.drawStyled(optX, dialogY + 5, options, '#98c379', bgColor);
  }

  /**
   * Draw border
   */
  private drawBorder(ctx: RenderContext): void {
    const borderColor = '#444444';
    const bgColor = '#2d2d2d';

    ctx.drawStyled(this.x, this.y, '╭' + '─'.repeat(this.width - 2) + '╮', borderColor, bgColor);
    for (let y = this.y + 1; y < this.y + this.height - 1; y++) {
      ctx.drawStyled(this.x, y, '│', borderColor, bgColor);
      ctx.drawStyled(this.x + this.width - 1, y, '│', borderColor, bgColor);
    }
    ctx.drawStyled(this.x, this.y + this.height - 1, '╰' + '─'.repeat(this.width - 2) + '╯', borderColor, bgColor);
  }

  /**
   * Truncate path for display
   */
  private truncatePath(p: string, maxLen: number): string {
    if (p.length <= maxLen) return p;
    
    const home = process.env.HOME || '';
    if (home && p.startsWith(home)) {
      p = '~' + p.slice(home.length);
    }
    
    if (p.length <= maxLen) return p;
    return '…' + p.slice(-(maxLen - 1));
  }

  /**
   * Get icon for file type
   */
  private getFileIcon(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const icons: Record<string, string> = {
      'ts': '󰛦', 'tsx': '󰜈', 'js': '󰌞', 'jsx': '󰜈',
      'json': '', 'md': '', 'css': '', 'html': '',
      'py': '', 'rs': '', 'go': '', 'sh': '',
    };
    return icons[ext] || '';
  }

  /**
   * Check if point is inside browser
   */
  containsPoint(x: number, y: number): boolean {
    if (!this.isVisible) return false;
    return x >= this.x && x < this.x + this.width && y >= this.y && y < this.y + this.height;
  }

  /**
   * Handle mouse events
   */
  onMouseEvent(event: MouseEvent): boolean {
    if (!this.isVisible) return false;

    if (this.mode === 'confirm-overwrite') {
      return this.containsPoint(event.x, event.y);
    }

    if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED') {
      // Check if clicked on filename input
      const inputY = this.y + 2;
      if (event.y === inputY) {
        this.inputFocused = true;
        return true;
      }

      // Check if clicked on file list
      const listStartY = this.y + 4;
      const clickedIndex = event.y - listStartY + this.scrollOffset;
      
      if (clickedIndex >= 0 && clickedIndex < this.entries.length) {
        this.inputFocused = false;
        if (this.selectedIndex === clickedIndex) {
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

export const saveBrowser = new SaveBrowser();
export default saveBrowser;
