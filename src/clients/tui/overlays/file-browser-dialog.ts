/**
 * File Browser Dialog
 *
 * Full directory browser for opening files with navigation.
 * Uses Promise-based result handling and proper theme colors.
 */

import { PromiseDialog, type DialogConfig, type DialogResult } from './promise-dialog.ts';
import type { OverlayManagerCallbacks } from './overlay-manager.ts';
import type { KeyEvent, MouseEvent, InputEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import type { FileService } from '../../../services/file/index.ts';
import * as path from 'path';

// ============================================
// Types
// ============================================

/**
 * A file entry in the browser.
 */
interface BrowserEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isHidden: boolean;
}

/**
 * Configuration for file browser.
 */
export interface FileBrowserConfig extends DialogConfig {
  /** Starting directory path */
  startPath: string;
  /** Whether to show hidden files (default true) */
  showHidden?: boolean;
}

// ============================================
// File Browser Dialog
// ============================================

/**
 * Promise-based file browser dialog.
 * Returns selected file path via Promise when closed.
 */
export class FileBrowserDialog extends PromiseDialog<string> {
  /** File service for directory listing */
  private fileService: FileService | null = null;

  /** Current directory path */
  private currentPath: string = '';

  /** Directory entries */
  private entries: BrowserEntry[] = [];

  /** Selected index */
  private selectedIndex: number = 0;

  /** Scroll offset */
  private scrollOffset: number = 0;

  /** Whether to show hidden files (default true - show dimmed) */
  private showHidden: boolean = true;

  constructor(id: string, callbacks: OverlayManagerCallbacks) {
    super(id, callbacks);
    this.zIndex = 200;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set the file service for directory operations.
   */
  setFileService(service: FileService): void {
    this.fileService = service;
  }

  /**
   * Show dialog starting at a directory.
   */
  async showBrowser(config: FileBrowserConfig): Promise<DialogResult<string>> {
    this.showHidden = config.showHidden ?? true;  // Show hidden by default
    this.currentPath = config.startPath;
    this.selectedIndex = 0;
    this.scrollOffset = 0;

    await this.loadDirectory();

    return this.showAsync({
      title: config.title ?? 'Open File',
      width: config.width ?? 70,
      height: config.height ?? 25,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Directory Operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Load entries from current directory.
   */
  private async loadDirectory(): Promise<void> {
    this.entries = [];

    if (!this.fileService) return;

    try {
      // Convert path to URI for the file service
      const uri = this.fileService.pathToUri(this.currentPath);
      const entries = await this.fileService.readDir(uri);

      const dirs: BrowserEntry[] = [];
      const files: BrowserEntry[] = [];

      for (const entry of entries) {
        // Skip .DS_Store
        if (entry.name === '.DS_Store') continue;

        const isHidden = entry.name.startsWith('.');
        if (!this.showHidden && isHidden) continue;

        const isDirectory = entry.type === 'directory';
        const browserEntry: BrowserEntry = {
          name: entry.name,
          path: path.join(this.currentPath, entry.name),
          isDirectory,
          isHidden,
        };

        if (isDirectory) {
          dirs.push(browserEntry);
        } else {
          files.push(browserEntry);
        }
      }

      // Sort alphabetically (case-insensitive)
      const sortFn = (a: BrowserEntry, b: BrowserEntry) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase());

      dirs.sort(sortFn);
      files.sort(sortFn);

      // Directories first, then files
      this.entries = [...dirs, ...files];
    } catch (error) {
      // Can't read directory - entries stays empty
    }

    this.callbacks.onDirty();
  }

  /**
   * Navigate to a directory.
   */
  private async navigateTo(dirPath: string): Promise<void> {
    const resolved = path.resolve(dirPath);
    this.currentPath = resolved;
    this.selectedIndex = 0;
    this.scrollOffset = 0;
    await this.loadDirectory();
  }

  /**
   * Go to parent directory.
   */
  private async goUp(): Promise<void> {
    const parent = path.dirname(this.currentPath);
    if (parent !== this.currentPath) {
      const oldName = path.basename(this.currentPath);
      await this.navigateTo(parent);
      // Try to select the directory we came from
      const idx = this.entries.findIndex((e) => e.name === oldName);
      if (idx >= 0) {
        this.selectedIndex = idx;
        this.ensureSelectedVisible();
      }
    }
  }

  /**
   * Enter selected directory or select file.
   */
  private async enter(): Promise<void> {
    const entry = this.entries[this.selectedIndex];
    if (!entry) return;

    if (entry.isDirectory) {
      await this.navigateTo(entry.path);
    } else {
      this.confirm(entry.path);
    }
  }

  /**
   * Toggle hidden files visibility.
   */
  private async toggleHidden(): Promise<void> {
    this.showHidden = !this.showHidden;
    await this.loadDirectory();
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.entries.length - 1));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Navigation
  // ─────────────────────────────────────────────────────────────────────────

  private selectNext(): void {
    if (this.selectedIndex < this.entries.length - 1) {
      this.selectedIndex++;
      this.ensureSelectedVisible();
      this.callbacks.onDirty();
    }
  }

  private selectPrevious(): void {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
      this.ensureSelectedVisible();
      this.callbacks.onDirty();
    }
  }

  private pageDown(): void {
    const visibleItems = this.getVisibleItemCount();
    this.selectedIndex = Math.min(this.entries.length - 1, this.selectedIndex + visibleItems);
    this.ensureSelectedVisible();
    this.callbacks.onDirty();
  }

  private pageUp(): void {
    const visibleItems = this.getVisibleItemCount();
    this.selectedIndex = Math.max(0, this.selectedIndex - visibleItems);
    this.ensureSelectedVisible();
    this.callbacks.onDirty();
  }

  private ensureSelectedVisible(): void {
    const visibleItems = this.getVisibleItemCount();
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + visibleItems) {
      this.scrollOffset = this.selectedIndex - visibleItems + 1;
    }
  }

  private getVisibleItemCount(): number {
    // Height minus: border (2) + path (1) + separator (1) + footer (2)
    return this.bounds.height - 6;
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

    if (event.key === 'ArrowLeft' || event.key === 'Backspace') {
      this.goUp();
      return true;
    }

    if (event.key === 'ArrowRight' || event.key === 'Enter') {
      this.enter();
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

    if (event.key === 'Home') {
      this.selectedIndex = 0;
      this.ensureSelectedVisible();
      this.callbacks.onDirty();
      return true;
    }

    if (event.key === 'End') {
      this.selectedIndex = Math.max(0, this.entries.length - 1);
      this.ensureSelectedVisible();
      this.callbacks.onDirty();
      return true;
    }

    // Toggle hidden files
    if (event.key === '.' && !event.ctrl) {
      this.toggleHidden();
      return true;
    }

    return false;
  }

  protected override handleMouseInput(event: InputEvent): boolean {
    if (!('type' in event)) return true;

    const mouseEvent = event as MouseEvent;
    const content = this.getContentBounds();
    const listStartY = content.y + 2; // After path + separator

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
      if (clickY >= listStartY && clickY < listStartY + this.getVisibleItemCount()) {
        const clickedIndex = this.scrollOffset + (clickY - listStartY);
        if (clickedIndex < this.entries.length) {
          if (this.selectedIndex === clickedIndex) {
            // Double-click effect: enter on second click
            this.enter();
          } else {
            this.selectedIndex = clickedIndex;
            this.callbacks.onDirty();
          }
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

    // Current path
    this.renderCurrentPath(buffer, content.x, content.y, content.width);

    // Separator
    this.renderSeparator(buffer, content.x, content.y + 1, content.width);

    // File list
    const listY = content.y + 2;
    const listHeight = content.height - 4; // Leave room for footer
    this.renderFileList(buffer, content.x, listY, content.width, listHeight);

    // Footer
    this.renderFooter(buffer, content.x, content.y + content.height - 1, content.width);
  }

  private renderCurrentPath(buffer: ScreenBuffer, x: number, y: number, width: number): void {
    const inputBg = this.callbacks.getThemeColor('input.background', '#3c3c3c');
    const pathFg = this.callbacks.getThemeColor('terminal.ansiBrightGreen', '#98c379');

    // Background
    for (let col = 0; col < width; col++) {
      buffer.set(x + col, y, { char: ' ', fg: pathFg, bg: inputBg });
    }

    // Path with folder icon
    const displayPath = this.truncatePath(this.currentPath, width - 4);
    buffer.writeString(x + 1, y, '\u{1F4C1} ' + displayPath, pathFg, inputBg);
  }

  private renderSeparator(buffer: ScreenBuffer, x: number, y: number, width: number): void {
    const border = this.callbacks.getThemeColor('editorWidget.border', '#454545');
    const bg = this.callbacks.getThemeColor('editorWidget.background', '#252526');

    for (let col = 0; col < width; col++) {
      buffer.set(x + col, y, { char: '\u2500', fg: border, bg });
    }
  }

  private renderFileList(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    const bg = this.callbacks.getThemeColor('editorWidget.background', '#252526');
    const fg = this.callbacks.getThemeColor('editorWidget.foreground', '#cccccc');
    const selectedBg = this.callbacks.getThemeColor('list.activeSelectionBackground', '#094771');
    const selectedFg = this.callbacks.getThemeColor('list.activeSelectionForeground', '#ffffff');
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');
    const dirFg = this.callbacks.getThemeColor('terminal.ansiBrightBlue', '#61afef');

    if (this.entries.length === 0) {
      buffer.writeString(x + 2, y + 1, 'Empty directory', dimFg, bg);
      return;
    }

    const visibleCount = Math.min(height, this.entries.length - this.scrollOffset);

    for (let i = 0; i < visibleCount; i++) {
      const entryIndex = this.scrollOffset + i;
      const entry = this.entries[entryIndex]!;
      const isSelected = entryIndex === this.selectedIndex;
      const rowY = y + i;

      // Row background
      const rowBg = isSelected ? selectedBg : bg;
      for (let col = 0; col < width; col++) {
        buffer.set(x + col, rowY, { char: ' ', fg, bg: rowBg });
      }

      // Icon
      const icon = entry.isDirectory ? '\u{1F4C1}' : this.getFileIcon(entry.name);
      buffer.writeString(x + 1, rowY, icon, dimFg, rowBg);

      // Name
      let nameFg: string;
      if (isSelected) {
        nameFg = selectedFg;
      } else if (entry.isHidden) {
        nameFg = dimFg;
      } else if (entry.isDirectory) {
        nameFg = dirFg;
      } else {
        nameFg = fg;
      }

      let displayName = entry.name;
      if (entry.isDirectory) displayName += '/';
      const maxNameLen = width - 5;
      if (displayName.length > maxNameLen) {
        displayName = displayName.slice(0, maxNameLen - 1) + '\u2026';
      }
      buffer.writeString(x + 4, rowY, displayName, nameFg, rowBg);
    }

    // Scroll indicators
    if (this.scrollOffset > 0) {
      buffer.writeString(x + width - 2, y, '\u25B2', dimFg, bg);
    }
    if (this.scrollOffset + height < this.entries.length) {
      buffer.writeString(x + width - 2, y + height - 1, '\u25BC', dimFg, bg);
    }
  }

  private renderFooter(buffer: ScreenBuffer, x: number, y: number, width: number): void {
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');
    const bg = this.callbacks.getThemeColor('editorWidget.background', '#252526');

    const helpText = '\u2191\u2193:nav  \u2190:up  \u2192/Enter:open  .:hidden  Esc:close';
    const truncatedHelp = helpText.slice(0, width - 2);
    buffer.writeString(x + 1, y, truncatedHelp, dimFg, bg);

    // Item count (right aligned)
    const count = `${this.entries.length} items`;
    buffer.writeString(x + width - count.length - 1, y, count, dimFg, bg);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────────────────

  private truncatePath(p: string, maxLen: number): string {
    if (p.length <= maxLen) return p;

    // Try to show home directory as ~
    const home = process.env.HOME || '';
    if (home && p.startsWith(home)) {
      p = '~' + p.slice(home.length);
    }

    if (p.length <= maxLen) return p;

    // Truncate from the beginning
    return '\u2026' + p.slice(-(maxLen - 1));
  }

  private getFileIcon(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';

    const icons: Record<string, string> = {
      ts: '\u{1F7E6}',
      tsx: '\u269B',
      js: '\u{1F7E8}',
      jsx: '\u269B',
      json: '{}',
      md: '\u{1F4DD}',
      css: '\u{1F3A8}',
      html: '\u{1F310}',
      py: '\u{1F40D}',
      rs: '\u{1F980}',
      go: '\u{1F535}',
      sh: '\u{1F4C4}',
    };

    return icons[ext] || '\u{1F4C4}';
  }
}
