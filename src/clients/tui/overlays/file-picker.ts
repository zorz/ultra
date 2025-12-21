/**
 * File Picker Dialog
 *
 * Quick open file picker with fuzzy search.
 * Uses Promise-based result handling.
 */

import { SearchableDialog, type ItemDisplay } from './searchable-dialog.ts';
import type { OverlayManagerCallbacks } from './overlay-manager.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';

// ============================================
// Types
// ============================================

/**
 * A file entry for the file picker.
 */
export interface FileEntry {
  /** File path relative to workspace root */
  path: string;
  /** File name */
  name: string;
  /** Directory path */
  directory?: string;
  /** File extension */
  extension?: string;
  /** Whether file is currently open in editor */
  isOpen?: boolean;
  /** File icon (from extension) */
  icon?: string;
  /** Last modified time */
  mtime?: number;
}

// ============================================
// File Picker Dialog
// ============================================

/**
 * Promise-based file picker with fuzzy search.
 * Returns selected file via Promise when closed.
 */
export class FilePickerDialog extends SearchableDialog<FileEntry> {
  /** Current path for marking */
  private currentPath: string = '';

  /** Callback to load more files asynchronously */
  private loadMoreCallback: (() => Promise<FileEntry[]>) | null = null;

  /** Whether we're currently loading more */
  private isLoading: boolean = false;

  constructor(id: string, callbacks: OverlayManagerCallbacks) {
    super(id, callbacks);
    this.zIndex = 200;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set callback for async file loading.
   */
  setLoadMoreCallback(callback: () => Promise<FileEntry[]>): void {
    this.loadMoreCallback = callback;
  }

  /**
   * Trigger async loading.
   */
  async loadMore(): Promise<void> {
    if (!this.loadMoreCallback || this.isLoading) return;

    this.isLoading = true;
    this.callbacks.onDirty();

    try {
      const moreFiles = await this.loadMoreCallback();
      if (moreFiles.length > 0) {
        this.setItems([...this.items, ...moreFiles]);
      }
    } finally {
      this.isLoading = false;
      this.callbacks.onDirty();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Abstract Implementation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Score a file against the query.
   */
  protected override scoreItem(file: FileEntry, query: string): number {
    // Score against file name (primary)
    const nameScore = this.combinedScore(file.name, query);

    // Score against full path (secondary)
    const pathScore = this.combinedScore(file.path, query) * 0.5;

    // Bonus for currently open files
    const openBonus = file.isOpen ? 5 : 0;

    // Bonus for recent files (based on mtime)
    let recentBonus = 0;
    if (file.mtime) {
      const hoursSinceModified = (Date.now() - file.mtime) / (1000 * 60 * 60);
      if (hoursSinceModified < 1) recentBonus = 3;
      else if (hoursSinceModified < 24) recentBonus = 1;
    }

    return Math.max(nameScore, pathScore) + openBonus + recentBonus;
  }

  /**
   * Get display for a file.
   */
  protected override getItemDisplay(file: FileEntry, _isSelected: boolean): ItemDisplay {
    return {
      text: file.name,
      secondary: file.directory || this.getDirectory(file.path),
      icon: file.icon ?? this.getFileIcon(file.extension),
      isCurrent: file.path === this.currentPath,
    };
  }

  /**
   * Get unique ID for a file.
   */
  protected override getItemId(file: FileEntry): string {
    return file.path;
  }

  /**
   * Override onShow to track current path.
   */
  protected override onShow(): void {
    this.currentPath = this.highlightedId;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────────────────

  private getDirectory(path: string): string {
    const lastSlash = path.lastIndexOf('/');
    return lastSlash > 0 ? path.slice(0, lastSlash) : '';
  }

  private getFileIcon(extension?: string): string {
    if (!extension) return '📄';

    const ext = extension.toLowerCase().replace(/^\./, '');

    const iconMap: Record<string, string> = {
      // Code
      ts: '🟦',
      tsx: '⚛',
      js: '🟨',
      jsx: '⚛',
      py: '🐍',
      rb: '💎',
      go: '🔵',
      rs: '🦀',
      java: '☕',
      cpp: '➕',
      c: '©',
      h: '📎',
      swift: '🐦',
      kt: 'Ⓚ',

      // Web
      html: '🌐',
      css: '🎨',
      scss: '🎨',
      less: '🎨',
      json: '{}',
      xml: '📰',
      yaml: '📋',
      yml: '📋',

      // Docs
      md: '📝',
      txt: '📄',
      pdf: '📕',
      doc: '📘',
      docx: '📘',

      // Data
      sql: '🗃',
      db: '🗄',
      csv: '📊',

      // Config
      toml: '⚙',
      ini: '⚙',
      env: '🔒',
      gitignore: '🙈',
      dockerignore: '🐳',

      // Build
      dockerfile: '🐳',
      makefile: '🔧',

      // Images
      png: '🖼',
      jpg: '🖼',
      jpeg: '🖼',
      gif: '🖼',
      svg: '🎭',
      ico: '🖼',

      // Lock files
      lock: '🔒',
    };

    return iconMap[ext] ?? '📄';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Footer Override (show loading state)
  // ─────────────────────────────────────────────────────────────────────────

  protected override renderFooter(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number
  ): void {
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');
    const bg = this.callbacks.getThemeColor('panel.background', '#252526');

    // Loading indicator
    if (this.isLoading) {
      buffer.writeString(x, y, 'Loading...', dimFg, bg);
    }

    // Item count (right aligned)
    const total = this.items.length;
    const filtered = this.filteredItems.length;
    const count = this.query ? `${filtered}/${total}` : `${total} files`;
    buffer.writeString(x + width - count.length - 1, y, count, dimFg, bg);
  }
}
