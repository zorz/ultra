/**
 * File Picker Dialog
 *
 * A searchable file picker overlay (Quick Open).
 */

import { BaseDialog, type OverlayManagerCallbacks } from './overlay-manager.ts';
import type { InputEvent, KeyEvent, Rect } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';

// ============================================
// Types
// ============================================

/**
 * A file entry that can be selected.
 */
export interface FileEntry {
  /** File path relative to workspace */
  path: string;
  /** File name */
  name: string;
  /** Optional icon */
  icon?: string;
  /** Optional directory indicator */
  isDirectory?: boolean;
  /** Optional git status */
  gitStatus?: 'M' | 'A' | 'D' | 'U' | '?' | '';
}

/**
 * Callbacks for file picker.
 */
export interface FilePickerCallbacks extends OverlayManagerCallbacks {
  /** Called when a file is selected */
  onSelect?: (file: FileEntry) => void;
  /** Called when picker is dismissed */
  onDismiss?: () => void;
  /** Called to load more files matching query */
  onQueryChange?: (query: string) => void;
}

// ============================================
// File Picker
// ============================================

export class FilePicker extends BaseDialog {
  /** All available files */
  private files: FileEntry[] = [];

  /** Filtered files based on search */
  private filtered: FileEntry[] = [];

  /** Current search query */
  private query = '';

  /** Selected index in filtered list */
  private selectedIndex = 0;

  /** Scroll offset */
  private scrollTop = 0;

  /** Max visible items */
  private maxVisible = 10;

  /** Whether loading is in progress */
  private isLoading = false;

  /** Callbacks */
  private pickerCallbacks: FilePickerCallbacks;

  constructor(callbacks: FilePickerCallbacks) {
    super('file-picker', callbacks);
    this.pickerCallbacks = callbacks;
    this.zIndex = 200;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // File Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set available files.
   */
  setFiles(files: FileEntry[]): void {
    this.files = files;
    this.updateFilter();
  }

  /**
   * Add files (for incremental loading).
   */
  addFiles(files: FileEntry[]): void {
    this.files.push(...files);
    this.updateFilter();
  }

  /**
   * Clear all files.
   */
  clearFiles(): void {
    this.files = [];
    this.filtered = [];
    this.callbacks.onDirty();
  }

  /**
   * Set loading state.
   */
  setLoading(loading: boolean): void {
    this.isLoading = loading;
    this.callbacks.onDirty();
  }

  /**
   * Get loading state.
   */
  isLoadingFiles(): boolean {
    return this.isLoading;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Show/Hide
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the file picker.
   */
  override show(): void {
    this.query = '';
    this.selectedIndex = 0;
    this.scrollTop = 0;
    this.updateFilter();
    super.show();
  }

  /**
   * Hide the file picker.
   */
  override hide(): void {
    super.hide();
    this.pickerCallbacks.onDismiss?.();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Search & Filter
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set search query.
   */
  setQuery(query: string): void {
    this.query = query;
    this.selectedIndex = 0;
    this.scrollTop = 0;
    this.updateFilter();
    this.pickerCallbacks.onQueryChange?.(query);
    this.callbacks.onDirty();
  }

  /**
   * Get current query.
   */
  getQuery(): string {
    return this.query;
  }

  /**
   * Update filtered files based on query.
   */
  private updateFilter(): void {
    if (!this.query) {
      this.filtered = [...this.files];
      return;
    }

    const queryLower = this.query.toLowerCase();
    const queryParts = queryLower.split(/[/\\]/).filter(Boolean);

    this.filtered = this.files.filter((file) => {
      const pathLower = file.path.toLowerCase();

      // Check if all query parts match somewhere in the path
      let lastIndex = -1;
      for (const part of queryParts) {
        const index = pathLower.indexOf(part, lastIndex + 1);
        if (index === -1) return false;
        lastIndex = index;
      }
      return true;
    });

    // Sort by relevance
    this.filtered.sort((a, b) => {
      const aPath = a.path.toLowerCase();
      const bPath = b.path.toLowerCase();

      // Exact name match first
      if (a.name.toLowerCase() === queryLower && b.name.toLowerCase() !== queryLower) {
        return -1;
      }
      if (b.name.toLowerCase() === queryLower && a.name.toLowerCase() !== queryLower) {
        return 1;
      }

      // Name starts with query
      if (a.name.toLowerCase().startsWith(queryLower) && !b.name.toLowerCase().startsWith(queryLower)) {
        return -1;
      }
      if (b.name.toLowerCase().startsWith(queryLower) && !a.name.toLowerCase().startsWith(queryLower)) {
        return 1;
      }

      // Shorter paths first
      const aDepth = aPath.split('/').length;
      const bDepth = bPath.split('/').length;
      if (aDepth !== bDepth) return aDepth - bDepth;

      // Alphabetical
      return aPath.localeCompare(bPath);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Navigation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Select next item.
   */
  selectNext(): void {
    if (this.filtered.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.filtered.length;
    this.ensureVisible();
    this.callbacks.onDirty();
  }

  /**
   * Select previous item.
   */
  selectPrevious(): void {
    if (this.filtered.length === 0) return;
    this.selectedIndex = this.selectedIndex === 0 ? this.filtered.length - 1 : this.selectedIndex - 1;
    this.ensureVisible();
    this.callbacks.onDirty();
  }

  /**
   * Select the current file.
   */
  selectCurrent(): void {
    const file = this.filtered[this.selectedIndex];
    if (!file) return;

    this.hide();
    this.pickerCallbacks.onSelect?.(file);
  }

  /**
   * Ensure selected item is visible.
   */
  private ensureVisible(): void {
    if (this.selectedIndex < this.scrollTop) {
      this.scrollTop = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollTop + this.maxVisible) {
      this.scrollTop = this.selectedIndex - this.maxVisible + 1;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  render(buffer: ScreenBuffer): void {
    const { x, y, width, height } = this.bounds;

    // Colors
    const bg = this.callbacks.getThemeColor('panel.background', '#252526');
    const fg = this.callbacks.getThemeColor('panel.foreground', '#cccccc');
    const inputBg = this.callbacks.getThemeColor('input.background', '#3c3c3c');
    const inputFg = this.callbacks.getThemeColor('input.foreground', '#cccccc');
    const selectedBg = this.callbacks.getThemeColor('list.activeSelectionBackground', '#094771');
    const selectedFg = this.callbacks.getThemeColor('list.activeSelectionForeground', '#ffffff');
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');
    const border = this.callbacks.getThemeColor('panel.border', '#404040');

    // Git status colors
    const modifiedColor = this.callbacks.getThemeColor('gitDecoration.modifiedResourceForeground', '#e2c08d');
    const addedColor = this.callbacks.getThemeColor('gitDecoration.addedResourceForeground', '#81b88b');
    const deletedColor = this.callbacks.getThemeColor('gitDecoration.deletedResourceForeground', '#c74e39');
    const untrackedColor = this.callbacks.getThemeColor('gitDecoration.untrackedResourceForeground', '#73c991');

    // Draw dialog box
    this.drawDialogBox(buffer, 'Quick Open');

    // Input field (row 1)
    const inputY = y + 1;
    const inputWidth = width - 4;
    const inputX = x + 2;

    // Input background
    for (let col = 0; col < inputWidth; col++) {
      buffer.set(inputX + col, inputY, { char: ' ', fg: inputFg, bg: inputBg });
    }

    // Search icon and query
    const prefix = '> ';
    buffer.writeString(inputX, inputY, prefix, dimFg, inputBg);
    buffer.writeString(inputX + prefix.length, inputY, this.query, inputFg, inputBg);

    // Cursor
    const cursorX = inputX + prefix.length + this.query.length;
    if (cursorX < inputX + inputWidth) {
      buffer.set(cursorX, inputY, { char: '▏', fg: inputFg, bg: inputBg });
    }

    // Loading indicator
    if (this.isLoading) {
      const loadingText = 'Loading...';
      const loadX = x + width - 2 - loadingText.length;
      buffer.writeString(loadX, inputY, loadingText, dimFg, inputBg);
    }

    // Separator
    const sepY = y + 2;
    for (let col = 1; col < width - 1; col++) {
      buffer.set(x + col, sepY, { char: '─', fg: border, bg });
    }

    // File list
    const listY = y + 3;
    const listHeight = height - 4;
    this.maxVisible = listHeight;

    if (this.filtered.length === 0) {
      const msg = this.query ? 'No matching files' : 'No files found';
      buffer.writeString(x + 2, listY + 1, msg, dimFg, bg);
    } else {
      for (let i = 0; i < listHeight; i++) {
        const fileIndex = this.scrollTop + i;
        if (fileIndex >= this.filtered.length) break;

        const file = this.filtered[fileIndex]!;
        const isSelected = fileIndex === this.selectedIndex;
        const rowY = listY + i;

        // Row background
        const rowBg = isSelected ? selectedBg : bg;
        const rowFg = isSelected ? selectedFg : fg;

        for (let col = 1; col < width - 1; col++) {
          buffer.set(x + col, rowY, { char: ' ', fg: rowFg, bg: rowBg });
        }

        // Icon
        let labelX = x + 2;
        if (file.icon) {
          buffer.writeString(labelX, rowY, file.icon + ' ', rowFg, rowBg);
          labelX += 2;
        } else {
          const icon = file.isDirectory ? '📁' : '📄';
          buffer.writeString(labelX, rowY, icon + ' ', rowFg, rowBg);
          labelX += 3; // Emoji width
        }

        // File name
        const maxNameWidth = Math.floor((width - 6) * 0.4);
        let name = file.name;
        if (name.length > maxNameWidth) {
          name = name.slice(0, maxNameWidth - 1) + '…';
        }
        buffer.writeString(labelX, rowY, name, rowFg, rowBg);
        labelX += maxNameWidth + 1;

        // Path (dimmed)
        const pathMaxWidth = width - labelX - x - 4;
        let pathDisplay = file.path;
        if (pathDisplay.length > pathMaxWidth) {
          pathDisplay = '…' + pathDisplay.slice(-pathMaxWidth + 1);
        }
        buffer.writeString(labelX, rowY, pathDisplay, isSelected ? selectedFg : dimFg, rowBg);

        // Git status indicator
        if (file.gitStatus) {
          let statusColor = dimFg;
          switch (file.gitStatus) {
            case 'M':
              statusColor = modifiedColor;
              break;
            case 'A':
              statusColor = addedColor;
              break;
            case 'D':
              statusColor = deletedColor;
              break;
            case '?':
              statusColor = untrackedColor;
              break;
          }
          const statusX = x + width - 3;
          buffer.writeString(statusX, rowY, file.gitStatus, isSelected ? selectedFg : statusColor, rowBg);
        }
      }
    }

    // Scrollbar
    if (this.filtered.length > listHeight) {
      const scrollX = x + width - 2;
      const thumbHeight = Math.max(1, Math.floor((listHeight / this.filtered.length) * listHeight));
      const thumbStart = Math.floor((this.scrollTop / this.filtered.length) * listHeight);

      for (let i = 0; i < listHeight; i++) {
        const isThumb = i >= thumbStart && i < thumbStart + thumbHeight;
        buffer.set(scrollX, listY + i, {
          char: ' ',
          fg: '#ffffff',
          bg: isThumb ? '#5a5a5a' : bg,
        });
      }
    }

    // Footer with count
    const footerY = y + height - 1;
    const countText = ` ${this.filtered.length} / ${this.files.length} files `;
    buffer.writeString(x + 2, footerY, countText, dimFg, bg);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  handleInput(event: InputEvent): boolean {
    if (!('key' in event)) return false;

    const keyEvent = event as KeyEvent;

    // Navigation
    if (keyEvent.key === 'ArrowDown' || (keyEvent.ctrl && keyEvent.key === 'n')) {
      this.selectNext();
      return true;
    }

    if (keyEvent.key === 'ArrowUp' || (keyEvent.ctrl && keyEvent.key === 'p')) {
      this.selectPrevious();
      return true;
    }

    // Select
    if (keyEvent.key === 'Enter') {
      this.selectCurrent();
      return true;
    }

    // Dismiss
    if (keyEvent.key === 'Escape') {
      this.hide();
      return true;
    }

    // Backspace
    if (keyEvent.key === 'Backspace') {
      if (this.query.length > 0) {
        this.setQuery(this.query.slice(0, -1));
      }
      return true;
    }

    // Clear
    if (keyEvent.ctrl && keyEvent.key === 'u') {
      this.setQuery('');
      return true;
    }

    // Character input
    if (keyEvent.key.length === 1 && !keyEvent.ctrl && !keyEvent.alt && !keyEvent.meta) {
      this.setQuery(this.query + keyEvent.key);
      return true;
    }

    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Layout
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Calculate bounds for centered dialog.
   */
  calculateBounds(screenWidth: number, screenHeight: number): Rect {
    const width = Math.min(70, screenWidth - 4);
    const height = Math.min(18, screenHeight - 4);
    const dialogX = Math.floor((screenWidth - width) / 2);
    const dialogY = Math.max(2, Math.floor(screenHeight / 6));

    return { x: dialogX, y: dialogY, width, height };
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a file picker.
 */
export function createFilePicker(callbacks: FilePickerCallbacks): FilePicker {
  return new FilePicker(callbacks);
}
