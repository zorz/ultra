/**
 * File Browser Component
 *
 * Full directory browser for opening files with navigation.
 * Now extends BaseDialog for consistent theming.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { RenderContext } from '../renderer.ts';
import type { MouseEvent } from '../mouse.ts';
import type { KeyEvent } from '../../terminal/input.ts';
import { BaseDialog, type BaseDialogConfig } from './base-dialog.ts';
import { RenderUtils } from '../render-utils.ts';
import { themeLoader } from '../themes/theme-loader.ts';

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isHidden: boolean;
}

export class FileBrowser extends BaseDialog {
  private currentPath: string = '';
  private entries: FileEntry[] = [];
  private selectedIndex: number = 0;
  private scrollOffset: number = 0;
  private onSelectCallback: ((filePath: string) => void) | null = null;
  private showHidden: boolean = false;

  constructor() {
    super();
    this._debugName = 'FileBrowser';
  }

  /**
   * Show the file browser
   */
  show(startPath: string, screenWidth: number, screenHeight: number, editorX?: number, editorWidth?: number): void {
    const width = Math.min(80, (editorWidth || screenWidth) - 4);
    const height = Math.min(30, screenHeight - 4);

    this.showBase({
      screenWidth,
      screenHeight,
      width,
      height,
      editorX,
      editorWidth,
      title: 'Open File'
    });

    this.selectedIndex = 0;
    this.scrollOffset = 0;
    this.navigateTo(startPath);
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
        // Skip .DS_Store
        if (item.name === '.DS_Store') {
          continue;
        }

        const isHidden = item.name.startsWith('.');
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
    const visibleItems = this._rect.height - 5;
    this.selectedIndex = Math.min(this.entries.length - 1, this.selectedIndex + visibleItems);
    this.ensureVisible();
  }

  /**
   * Page up
   */
  pageUp(): void {
    const visibleItems = this._rect.height - 5;
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
    const visibleItems = this._rect.height - 5;

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
   * Render the file browser
   */
  render(ctx: RenderContext): void {
    if (!this._isVisible) return;

    const colors = this.getColors();

    // Background and border
    this.renderBackground(ctx);

    // Title
    this.renderTitle(ctx);

    // Current path
    const pathY = this._rect.y + 1;
    const displayPath = this.truncatePath(this.currentPath, this._rect.width - 6);
    ctx.fill(this._rect.x + 1, pathY, this._rect.width - 2, 1, ' ', colors.foreground, colors.inputBackground);
    ctx.drawStyled(this._rect.x + 2, pathY, '📁 ' + displayPath, colors.successForeground, colors.inputBackground);

    // Separator
    this.renderSeparator(ctx, 2);

    // File list
    this.renderFileList(ctx);

    // Footer with help
    const footerY = this._rect.y + this._rect.height - 1;
    const helpText = '↑↓:nav  ←:up  →/Enter:open  .:hidden  Esc:close';
    const truncatedHelp = RenderUtils.truncateText(helpText, this._rect.width - 4);
    ctx.drawStyled(this._rect.x + 2, footerY, truncatedHelp, colors.hintForeground, colors.background);
  }

  /**
   * Render file list
   */
  private renderFileList(ctx: RenderContext): void {
    const colors = this.getColors();
    const listStartY = this._rect.y + 3;
    const visibleItems = this._rect.height - 5;

    if (this.entries.length === 0) {
      ctx.drawStyled(this._rect.x + 3, listStartY + 1, 'Empty directory', colors.hintForeground, colors.background);
    } else {
      for (let i = 0; i < visibleItems; i++) {
        const entryIndex = this.scrollOffset + i;
        const entry = this.entries[entryIndex];
        const itemY = listStartY + i;

        if (!entry) {
          ctx.fill(this._rect.x + 1, itemY, this._rect.width - 2, 1, ' ', undefined, colors.background);
          continue;
        }

        const isSelected = entryIndex === this.selectedIndex;
        const bgColor = isSelected ? colors.selectedBackground : colors.background;

        // Background
        ctx.fill(this._rect.x + 1, itemY, this._rect.width - 2, 1, ' ', undefined, bgColor);

        // Icon
        const icon = entry.isDirectory ? '📁' : this.getFileIcon(entry.name);
        const iconColor = entry.isHidden
          ? themeLoader.adjustBrightness(colors.hintForeground, -30)
          : colors.hintForeground;
        ctx.drawStyled(this._rect.x + 2, itemY, icon, iconColor, bgColor);

        // Name
        let nameColor: string;
        if (entry.isHidden) {
          const baseColor = isSelected ? colors.selectedForeground : colors.foreground;
          nameColor = themeLoader.adjustBrightness(baseColor, -20);
        } else {
          nameColor = isSelected ? colors.selectedForeground : colors.foreground;
        }

        const maxNameLen = this._rect.width - 8;
        let displayName = entry.name;
        if (entry.isDirectory) displayName += '/';
        if (displayName.length > maxNameLen) {
          displayName = displayName.slice(0, maxNameLen - 1) + '…';
        }
        ctx.drawStyled(this._rect.x + 5, itemY, displayName, nameColor, bgColor);
      }

      // Scroll indicators
      if (this.scrollOffset > 0) {
        ctx.drawStyled(this._rect.x + this._rect.width - 3, listStartY, '▲', colors.hintForeground, colors.background);
      }
      if (this.scrollOffset + visibleItems < this.entries.length) {
        ctx.drawStyled(this._rect.x + this._rect.width - 3, listStartY + visibleItems - 1, '▼', colors.hintForeground, colors.background);
      }
    }
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
   * Handle mouse events
   */
  onMouseEvent(event: MouseEvent): boolean {
    if (!this._isVisible) return false;

    if (!this.containsPoint(event.x, event.y)) {
      return false;
    }

    if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED') {
      // Calculate which entry was clicked
      const listStartY = this._rect.y + 3;
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

    return true;
  }
}

export const fileBrowser = new FileBrowser();
export default fileBrowser;
