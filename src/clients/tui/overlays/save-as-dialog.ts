/**
 * Save As Dialog
 *
 * File browser for Save As with directory navigation, filename input,
 * and overwrite confirmation. Uses Promise-based result handling.
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
 * Dialog mode.
 */
type SaveAsMode = 'browse' | 'confirm-overwrite';

/**
 * Configuration for save as dialog.
 */
export interface SaveAsConfig extends DialogConfig {
  /** Starting directory path */
  startPath: string;
  /** Suggested filename */
  suggestedFilename: string;
  /** Whether to show hidden files */
  showHidden?: boolean;
}

// ============================================
// Save As Dialog
// ============================================

/**
 * Promise-based save as dialog.
 * Returns the selected file path via Promise when closed.
 */
export class SaveAsDialog extends PromiseDialog<string> {
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

  /** Current filename */
  private filename: string = '';

  /** Whether filename input is focused */
  private inputFocused: boolean = true;

  /** Dialog mode */
  private mode: SaveAsMode = 'browse';

  /** Path being confirmed for overwrite */
  private confirmPath: string = '';

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
   * Show dialog for saving.
   */
  async showSaveAs(config: SaveAsConfig): Promise<DialogResult<string>> {
    this.showHidden = config.showHidden ?? true;  // Show hidden by default
    this.currentPath = config.startPath;
    this.filename = config.suggestedFilename;
    this.selectedIndex = 0;
    this.scrollOffset = 0;
    this.inputFocused = true;
    this.mode = 'browse';
    this.confirmPath = '';

    await this.loadDirectory();

    return this.showAsync({
      title: config.title ?? 'Save As',
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
  private async enterItem(): Promise<void> {
    const entry = this.entries[this.selectedIndex];
    if (!entry) return;

    if (entry.isDirectory) {
      await this.navigateTo(entry.path);
    } else {
      // Select this file (populate filename)
      this.filename = entry.name;
      this.inputFocused = true;
      this.callbacks.onDirty();
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

  /**
   * Get full save path.
   */
  private getFullPath(): string {
    return path.join(this.currentPath, this.filename);
  }

  /**
   * Check if file exists.
   */
  private async fileExists(): Promise<boolean> {
    if (!this.fileService) return false;

    try {
      // Convert path to URI for the file service
      const uri = this.fileService.pathToUri(this.getFullPath());
      const stats = await this.fileService.stat(uri);
      return stats.exists && stats.isFile;
    } catch {
      return false;
    }
  }

  /**
   * Attempt to save.
   */
  private async save(): Promise<void> {
    if (!this.filename.trim()) return;

    const fullPath = this.getFullPath();

    if (await this.fileExists()) {
      // Show confirmation
      this.mode = 'confirm-overwrite';
      this.confirmPath = fullPath;
      this.callbacks.onDirty();
    } else {
      // Save directly
      this.confirm(fullPath);
    }
  }

  /**
   * Confirm overwrite.
   */
  private confirmOverwrite(): void {
    this.confirm(this.confirmPath);
  }

  /**
   * Cancel overwrite, go back to browse.
   */
  private cancelOverwrite(): void {
    this.mode = 'browse';
    this.confirmPath = '';
    this.callbacks.onDirty();
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
    } else {
      // At top, switch to filename input
      this.inputFocused = true;
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
    // Height minus: border (2) + path (1) + filename (1) + separator (1) + preview (1) + footer (1)
    return this.bounds.height - 8;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  protected override handleKeyInput(event: KeyEvent): boolean {
    // Confirmation mode
    if (this.mode === 'confirm-overwrite') {
      if (event.key === 'y' || event.key === 'Y') {
        this.confirmOverwrite();
        return true;
      }
      if (event.key === 'n' || event.key === 'N' || event.key === 'Escape') {
        this.cancelOverwrite();
        return true;
      }
      return true; // Consume all keys in confirm mode
    }

    // Tab to switch focus
    if (event.key === 'Tab') {
      this.inputFocused = !this.inputFocused;
      this.callbacks.onDirty();
      return true;
    }

    if (this.inputFocused) {
      return this.handleInputKey(event);
    } else {
      return this.handleListKey(event);
    }
  }

  private handleInputKey(event: KeyEvent): boolean {
    if (event.key === 'Enter') {
      this.save();
      return true;
    }

    if (event.key === 'Backspace') {
      if (this.filename.length > 0) {
        this.filename = this.filename.slice(0, -1);
        this.callbacks.onDirty();
      }
      return true;
    }

    if (event.key === 'ArrowDown') {
      // Switch to file list
      this.inputFocused = false;
      this.callbacks.onDirty();
      return true;
    }

    // Character input
    if (event.key.length === 1 && !event.ctrl && !event.alt && !event.meta) {
      this.filename += event.key;
      this.callbacks.onDirty();
      return true;
    }

    return true;
  }

  private handleListKey(event: KeyEvent): boolean {
    if (event.key === 'ArrowDown' || (event.ctrl && event.key === 'n')) {
      this.selectNext();
      return true;
    }

    if (event.key === 'ArrowUp' || (event.ctrl && event.key === 'p')) {
      this.selectPrevious();
      return true;
    }

    if (event.key === 'ArrowLeft') {
      this.goUp();
      return true;
    }

    if (event.key === 'ArrowRight' || event.key === 'Enter') {
      this.enterItem();
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

    // Toggle hidden
    if (event.key === '.' && !event.ctrl) {
      this.toggleHidden();
      return true;
    }

    return true;
  }

  protected override handleMouseInput(event: InputEvent): boolean {
    if (!('type' in event)) return true;
    if (this.mode === 'confirm-overwrite') return true;

    const mouseEvent = event as MouseEvent;
    const content = this.getContentBounds();
    const inputY = content.y + 1;
    const listStartY = content.y + 3;

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

    // Handle click
    if (mouseEvent.type === 'press' && mouseEvent.button === 'left') {
      // Click on filename input
      if (mouseEvent.y === inputY) {
        this.inputFocused = true;
        this.callbacks.onDirty();
        return true;
      }

      // Click on file list
      if (mouseEvent.y >= listStartY && mouseEvent.y < listStartY + this.getVisibleItemCount()) {
        const clickedIndex = this.scrollOffset + (mouseEvent.y - listStartY);
        if (clickedIndex < this.entries.length) {
          this.inputFocused = false;
          if (this.selectedIndex === clickedIndex) {
            this.enterItem();
          } else {
            this.selectedIndex = clickedIndex;
            this.callbacks.onDirty();
          }
        }
        return true;
      }
    }

    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  protected override renderContent(buffer: ScreenBuffer): void {
    if (this.mode === 'confirm-overwrite') {
      this.renderConfirmDialog(buffer);
      return;
    }

    const content = this.getContentBounds();

    // Current path
    this.renderCurrentPath(buffer, content.x, content.y, content.width);

    // Filename input
    this.renderFilenameInput(buffer, content.x, content.y + 1, content.width);

    // Separator
    this.renderSeparator(buffer, content.x, content.y + 2, content.width);

    // File list
    const listY = content.y + 3;
    const listHeight = content.height - 6;
    this.renderFileList(buffer, content.x, listY, content.width, listHeight);

    // Full path preview
    this.renderPathPreview(buffer, content.x, content.y + content.height - 2, content.width);

    // Footer
    this.renderFooter(buffer, content.x, content.y + content.height - 1, content.width);
  }

  private renderCurrentPath(buffer: ScreenBuffer, x: number, y: number, width: number): void {
    const inputBg = this.callbacks.getThemeColor('input.background', '#3c3c3c');
    const pathFg = this.callbacks.getThemeColor('terminal.ansiBrightGreen', '#98c379');

    for (let col = 0; col < width; col++) {
      buffer.set(x + col, y, { char: ' ', fg: pathFg, bg: inputBg });
    }

    const displayPath = this.truncatePath(this.currentPath, width - 4);
    buffer.writeString(x + 1, y, '\u{1F4C1} ' + displayPath, pathFg, inputBg);
  }

  private renderFilenameInput(buffer: ScreenBuffer, x: number, y: number, width: number): void {
    const focusBorder = this.callbacks.getThemeColor('focusBorder', '#007acc');
    const inputBg = this.inputFocused
      ? this.callbacks.getThemeColor('list.activeSelectionBackground', '#094771')
      : this.callbacks.getThemeColor('input.background', '#3c3c3c');
    const inputFg = this.callbacks.getThemeColor('input.foreground', '#cccccc');
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');

    for (let col = 0; col < width; col++) {
      buffer.set(x + col, y, { char: ' ', fg: inputFg, bg: inputBg });
    }

    // Label
    const label = 'Name: ';
    buffer.writeString(x + 1, y, label, dimFg, inputBg);

    // Filename
    const inputWidth = width - 4 - label.length;
    const displayFilename = this.filename.slice(-(inputWidth - 1));
    buffer.writeString(x + 1 + label.length, y, displayFilename, inputFg, inputBg);

    // Cursor
    if (this.inputFocused) {
      const cursorX = x + 1 + label.length + displayFilename.length;
      if (cursorX < x + width - 2) {
        buffer.set(cursorX, y, { char: '\u2588', fg: focusBorder, bg: inputBg });
      }
    }
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
      const isSelected = !this.inputFocused && entryIndex === this.selectedIndex;
      const rowY = y + i;

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

  private renderPathPreview(buffer: ScreenBuffer, x: number, y: number, width: number): void {
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');
    const bg = this.callbacks.getThemeColor('editorWidget.background', '#252526');

    for (let col = 0; col < width; col++) {
      buffer.set(x + col, y, { char: ' ', fg: dimFg, bg });
    }

    const fullPath = this.getFullPath();
    const previewPath = this.truncatePath(fullPath, width - 2);
    buffer.writeString(x + 1, y, previewPath, dimFg, bg);
  }

  private renderFooter(buffer: ScreenBuffer, x: number, y: number, width: number): void {
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');
    const bg = this.callbacks.getThemeColor('editorWidget.background', '#252526');

    const helpText = 'Tab:switch  \u2191\u2193:nav  \u2190:up  Enter:save  Esc:cancel';
    const truncatedHelp = helpText.slice(0, width - 2);
    buffer.writeString(x + 1, y, truncatedHelp, dimFg, bg);
  }

  private renderConfirmDialog(buffer: ScreenBuffer): void {
    const dialogWidth = 50;
    const dialogHeight = 7;
    const dialogX = this.bounds.x + Math.floor((this.bounds.width - dialogWidth) / 2);
    const dialogY = this.bounds.y + Math.floor((this.bounds.height - dialogHeight) / 2);

    const bg = this.callbacks.getThemeColor('editorWidget.background', '#252526');
    const fg = this.callbacks.getThemeColor('editorWidget.foreground', '#cccccc');
    const border = this.callbacks.getThemeColor('terminal.ansiRed', '#e06c75');
    const warnFg = this.callbacks.getThemeColor('terminal.ansiYellow', '#e5c07b');
    const successFg = this.callbacks.getThemeColor('terminal.ansiGreen', '#98c379');

    // Background
    for (let row = dialogY; row < dialogY + dialogHeight; row++) {
      for (let col = dialogX; col < dialogX + dialogWidth; col++) {
        buffer.set(col, row, { char: ' ', fg, bg });
      }
    }

    // Border
    buffer.drawBox({ x: dialogX, y: dialogY, width: dialogWidth, height: dialogHeight }, border, bg, 'rounded');

    // Title
    const title = ' Confirm Overwrite ';
    const titleX = dialogX + Math.floor((dialogWidth - title.length) / 2);
    buffer.writeString(titleX, dialogY, title, border, bg);

    // Message
    const filename = path.basename(this.confirmPath);
    const msg1 = 'File already exists:';
    const msg2 = filename.length > dialogWidth - 6 ? filename.slice(0, dialogWidth - 9) + '...' : filename;
    buffer.writeString(dialogX + 2, dialogY + 2, msg1, fg, bg);
    buffer.writeString(dialogX + 2, dialogY + 3, msg2, warnFg, bg);

    // Options
    const options = 'Overwrite? (Y)es / (N)o';
    const optX = dialogX + Math.floor((dialogWidth - options.length) / 2);
    buffer.writeString(optX, dialogY + 5, options, successFg, bg);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────────────────

  private truncatePath(p: string, maxLen: number): string {
    if (p.length <= maxLen) return p;

    const home = process.env.HOME || '';
    if (home && p.startsWith(home)) {
      p = '~' + p.slice(home.length);
    }

    if (p.length <= maxLen) return p;
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
