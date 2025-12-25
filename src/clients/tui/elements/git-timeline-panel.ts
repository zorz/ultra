/**
 * Git Timeline Panel Element
 *
 * A sidebar panel that displays commit history.
 * Supports two modes:
 * - 'file': Shows commits that modified the currently focused file
 * - 'repo': Shows recent commits across the entire repository
 *
 * Designed to work in multiple contexts:
 * - Sidebar accordion (default)
 * - Tab in any pane
 * - Overlay (future, via wrapper class)
 */

import { BaseElement, type ElementContext } from './base.ts';
import type { KeyEvent, MouseEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import type { GitCommit } from '../../../services/git/types.ts';

// ============================================
// Types
// ============================================

export type TimelineMode = 'file' | 'repo';

/**
 * View node for rendering a commit.
 */
interface TimelineViewNode {
  commit: GitCommit;
  index: number;
}

/**
 * State for session persistence.
 */
export interface GitTimelinePanelState {
  /** Timeline mode */
  mode: TimelineMode;
  /** Currently bound document URI */
  documentUri?: string;
  /** Scroll position */
  scrollTop: number;
  /** Selected commit index */
  selectedIndex: number;
  /** Current search query */
  searchQuery?: string;
}

/**
 * Callbacks for GitTimelinePanel events.
 */
export interface GitTimelinePanelCallbacks {
  /** Called when user wants to view diff for a commit */
  onViewDiff?: (commit: GitCommit, filePath?: string) => void;
  /** Called when user wants to view file at a specific commit */
  onViewFileAtCommit?: (commit: GitCommit, filePath: string) => void;
  /** Called when user wants to copy commit hash to clipboard */
  onCopyHash?: (hash: string) => void;
  /** Called when panel gains/loses focus */
  onFocusChange?: (focused: boolean) => void;
  /** Called when mode changes */
  onModeChange?: (mode: TimelineMode) => void;
}

// ============================================
// GitTimelinePanel Element
// ============================================

export class GitTimelinePanel extends BaseElement {
  // ─────────────────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────────────────

  /** All commits */
  private commits: GitCommit[] = [];

  /** Flattened view for rendering (after filtering) */
  private viewNodes: TimelineViewNode[] = [];

  /** Timeline mode */
  private mode: TimelineMode = 'file';

  /** Currently bound document URI */
  private documentUri: string | null = null;

  /** File path for file mode (relative to repo root) */
  private filePath: string | null = null;

  /** Repository URI */
  private repoUri: string | null = null;

  /** Selected index in view */
  private selectedIndex = 0;

  /** Scroll offset */
  private scrollTop = 0;

  /** Search query for filtering */
  private searchQuery = '';

  /** Search input active */
  private searchInputActive = false;

  /** Search input cursor position */
  private searchCursorPos = 0;

  /** Callbacks */
  private callbacks: GitTimelinePanelCallbacks;

  /** Last click for double-click detection */
  private lastClickTime = 0;
  private lastClickIndex = -1;

  /** Loading state */
  private isLoading = false;

  // ─────────────────────────────────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────────────────────────────────

  constructor(id: string, title: string, ctx: ElementContext, callbacks: GitTimelinePanelCallbacks = {}) {
    super('GitTimelinePanel', id, title, ctx);
    this.callbacks = callbacks;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set callbacks.
   */
  setCallbacks(callbacks: GitTimelinePanelCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Get callbacks.
   */
  getCallbacks(): GitTimelinePanelCallbacks {
    return this.callbacks;
  }

  /**
   * Set timeline mode.
   */
  setMode(mode: TimelineMode): void {
    if (mode !== this.mode) {
      this.mode = mode;
      this.updateTitle();
      this.callbacks.onModeChange?.(mode);
      this.ctx.markDirty();
    }
  }

  /**
   * Get timeline mode.
   */
  getMode(): TimelineMode {
    return this.mode;
  }

  /**
   * Toggle between file and repo modes.
   */
  toggleMode(): void {
    this.setMode(this.mode === 'file' ? 'repo' : 'file');
  }

  /**
   * Set repository URI.
   */
  setRepoUri(uri: string): void {
    this.repoUri = uri;
  }

  /**
   * Get repository URI.
   */
  getRepoUri(): string | null {
    return this.repoUri;
  }

  /**
   * Set commits directly.
   */
  setCommits(commits: GitCommit[], uri?: string, filePath?: string): void {
    this.commits = commits;
    if (uri) {
      this.documentUri = uri;
    }
    if (filePath) {
      this.filePath = filePath;
    }

    this.rebuildView();
    this.selectedIndex = 0;
    this.scrollTop = 0;
    this.isLoading = false;
    this.ctx.markDirty();

    // Update status with commit count
    this.setStatus(`${commits.length} commit${commits.length !== 1 ? 's' : ''}`);
  }

  /**
   * Get bound document URI.
   */
  getDocumentUri(): string | null {
    return this.documentUri;
  }

  /**
   * Get file path.
   */
  getFilePath(): string | null {
    return this.filePath;
  }

  /**
   * Clear commits.
   */
  clearCommits(): void {
    this.commits = [];
    this.documentUri = null;
    this.filePath = null;
    this.viewNodes = [];
    this.selectedIndex = 0;
    this.scrollTop = 0;
    this.setStatus('');
    this.ctx.markDirty();
  }

  /**
   * Set loading state.
   */
  setLoading(loading: boolean): void {
    this.isLoading = loading;
    if (loading) {
      this.setStatus('Loading...');
    }
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
   * Page up.
   */
  pageUp(): void {
    if (this.viewNodes.length === 0) return;
    const pageSize = Math.max(1, this.getListHeight() - 1);
    this.selectedIndex = Math.max(0, this.selectedIndex - pageSize);
    this.ensureVisible();
    this.ctx.markDirty();
  }

  /**
   * Page down.
   */
  pageDown(): void {
    if (this.viewNodes.length === 0) return;
    const pageSize = Math.max(1, this.getListHeight() - 1);
    this.selectedIndex = Math.min(this.viewNodes.length - 1, this.selectedIndex + pageSize);
    this.ensureVisible();
    this.ctx.markDirty();
  }

  /**
   * Go to first commit.
   */
  goToFirst(): void {
    if (this.viewNodes.length === 0) return;
    this.selectedIndex = 0;
    this.ensureVisible();
    this.ctx.markDirty();
  }

  /**
   * Go to last commit.
   */
  goToLast(): void {
    if (this.viewNodes.length === 0) return;
    this.selectedIndex = this.viewNodes.length - 1;
    this.ensureVisible();
    this.ctx.markDirty();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * View diff for selected commit.
   */
  viewDiff(): void {
    const viewNode = this.viewNodes[this.selectedIndex];
    if (!viewNode) return;

    this.callbacks.onViewDiff?.(viewNode.commit, this.filePath ?? undefined);
  }

  /**
   * Open file at selected commit.
   */
  openFileAtCommit(): void {
    const viewNode = this.viewNodes[this.selectedIndex];
    if (!viewNode || !this.filePath) return;

    this.callbacks.onViewFileAtCommit?.(viewNode.commit, this.filePath);
  }

  /**
   * Copy hash of selected commit.
   */
  copyHash(): void {
    const viewNode = this.viewNodes[this.selectedIndex];
    if (!viewNode) return;

    this.callbacks.onCopyHash?.(viewNode.commit.hash);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // View Building
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Rebuild the flattened view from commits with filtering.
   */
  private rebuildView(): void {
    this.viewNodes = [];
    let index = 0;

    for (const commit of this.commits) {
      if (this.matchesSearch(commit)) {
        this.viewNodes.push({
          commit,
          index: index++,
        });
      }
    }

    // Ensure selected index is valid
    if (this.selectedIndex >= this.viewNodes.length) {
      this.selectedIndex = Math.max(0, this.viewNodes.length - 1);
    }
  }

  /**
   * Check if a commit matches the search query.
   */
  private matchesSearch(commit: GitCommit): boolean {
    if (!this.searchQuery) return true;

    const query = this.searchQuery.toLowerCase();
    return (
      commit.message.toLowerCase().includes(query) ||
      commit.author.toLowerCase().includes(query) ||
      commit.shortHash.toLowerCase().includes(query) ||
      commit.hash.toLowerCase().includes(query)
    );
  }

  /**
   * Ensure selected item is visible in scroll view.
   */
  private ensureVisible(): void {
    const listHeight = this.getListHeight();
    if (listHeight <= 0) return;

    if (this.selectedIndex < this.scrollTop) {
      this.scrollTop = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollTop + listHeight) {
      this.scrollTop = this.selectedIndex - listHeight + 1;
    }
  }

  /**
   * Get visible list height (rows for commit list).
   */
  private getListHeight(): number {
    // Mode bar takes 1 row, search box takes 1 row when active
    const headerRows = 1 + (this.searchInputActive ? 1 : 0);
    // Each commit takes 2 rows (line 1: hash + message, line 2: author + date)
    const availableRows = this.bounds.height - headerRows;
    return Math.floor(availableRows / 2);
  }

  /**
   * Update title based on mode.
   */
  private updateTitle(): void {
    const modeLabel = this.mode === 'file' ? 'File' : 'Repo';
    this.setTitle(`Timeline (${modeLabel})`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  render(buffer: ScreenBuffer): void {
    const { x, y, width, height } = this.bounds;
    if (width <= 0 || height <= 0) return;

    // Get theme colors
    const bg = this.ctx.getBackgroundForFocus('sidebar', this.focused);
    const fg = this.ctx.getForegroundForFocus('sidebar', this.focused);
    const selectedBg = this.ctx.getSelectionBackground('sidebar', this.focused);

    // Clear background
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        buffer.set(x + col, y + row, { char: ' ', fg, bg });
      }
    }

    let currentY = y;

    // Render mode toggle bar
    this.renderModeBar(buffer, x, currentY, width, fg, bg);
    currentY++;

    // Render search box if active
    if (this.searchInputActive) {
      this.renderSearchBox(buffer, x, currentY, width, fg, bg);
      currentY++;
    }

    // Render commit list
    const listHeight = height - (currentY - y);
    if (listHeight > 0) {
      this.renderCommitList(buffer, x, currentY, width, listHeight, fg, bg, selectedBg);
    }
  }

  /**
   * Render mode toggle bar.
   */
  private renderModeBar(buffer: ScreenBuffer, x: number, y: number, width: number, fg: string, bg: string): void {
    const fileLabel = this.mode === 'file' ? '[File]' : ' File ';
    const repoLabel = this.mode === 'repo' ? '[Repo]' : ' Repo ';
    const modeText = `${fileLabel} ${repoLabel}`;

    // Highlight active mode
    const fileColor = this.mode === 'file' ? '#a6e3a1' : '#888888';
    const repoColor = this.mode === 'repo' ? '#a6e3a1' : '#888888';

    let col = x;

    // File label
    for (const char of fileLabel) {
      if (col < x + width) {
        buffer.set(col++, y, { char, fg: fileColor, bg });
      }
    }

    // Space
    if (col < x + width) {
      buffer.set(col++, y, { char: ' ', fg, bg });
    }

    // Repo label
    for (const char of repoLabel) {
      if (col < x + width) {
        buffer.set(col++, y, { char, fg: repoColor, bg });
      }
    }

    // Tab hint
    const hint = ' Tab:switch';
    const hintStart = x + width - hint.length;
    if (hintStart > col) {
      for (let i = 0; i < hint.length && hintStart + i < x + width; i++) {
        buffer.set(hintStart + i, y, { char: hint[i]!, fg: '#888888', bg });
      }
    }
  }

  /**
   * Render search box.
   */
  private renderSearchBox(buffer: ScreenBuffer, x: number, y: number, width: number, fg: string, bg: string): void {
    const prefix = '/ ';
    const cursorFg = this.ctx.getThemeColor('terminalCursor.foreground', '#ffffff');

    // Prefix
    for (let i = 0; i < prefix.length && i < width; i++) {
      buffer.set(x + i, y, { char: prefix[i]!, fg: '#888888', bg });
    }

    // Query text
    const queryStart = x + prefix.length;
    const maxQueryWidth = width - prefix.length;

    for (let i = 0; i < this.searchQuery.length && i < maxQueryWidth; i++) {
      const isCursor = i === this.searchCursorPos;
      buffer.set(queryStart + i, y, {
        char: this.searchQuery[i]!,
        fg: isCursor ? bg : fg,
        bg: isCursor ? cursorFg : bg,
      });
    }

    // Cursor at end of text
    if (this.searchCursorPos >= this.searchQuery.length && this.searchCursorPos < maxQueryWidth) {
      buffer.set(queryStart + this.searchCursorPos, y, {
        char: ' ',
        fg: bg,
        bg: cursorFg,
      });
    }
  }

  /**
   * Render commit list.
   */
  private renderCommitList(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number,
    height: number,
    fg: string,
    bg: string,
    selectedBg: string
  ): void {
    // Show message if empty
    if (this.viewNodes.length === 0) {
      const msg = this.isLoading ? 'Loading...' : (this.commits.length === 0 ? 'No commits' : 'No matches');
      for (let i = 0; i < msg.length && i < width; i++) {
        buffer.set(x + i, y, { char: msg[i]!, fg: '#888888', bg });
      }
      return;
    }

    // Calculate visible range (each commit takes 2 rows)
    const commitHeight = 2;
    const visibleCount = Math.floor(height / commitHeight);
    const endIndex = Math.min(this.scrollTop + visibleCount, this.viewNodes.length);

    let currentY = y;
    for (let i = this.scrollTop; i < endIndex; i++) {
      const viewNode = this.viewNodes[i]!;
      const isSelected = i === this.selectedIndex;
      this.renderCommitEntry(buffer, viewNode, x, currentY, width, isSelected, fg, bg, selectedBg);
      currentY += commitHeight;
    }

    // Render scrollbar if needed
    if (this.viewNodes.length > visibleCount) {
      this.renderScrollbar(buffer, x + width - 1, y, height);
    }
  }

  /**
   * Render a single commit entry (2 rows).
   */
  private renderCommitEntry(
    buffer: ScreenBuffer,
    viewNode: TimelineViewNode,
    x: number,
    y: number,
    width: number,
    isSelected: boolean,
    fg: string,
    bg: string,
    selectedBg: string
  ): void {
    const commit = viewNode.commit;
    const rowBg = isSelected ? selectedBg : bg;
    const rowFg = isSelected ? fg : fg;
    const dimFg = isSelected ? fg : '#888888';

    // Row 1: hash + message
    let col = x;

    // Short hash (colored)
    const hashColor = isSelected ? fg : '#fab387'; // Orange for hash
    for (const char of commit.shortHash) {
      if (col < x + width - 1) {
        buffer.set(col++, y, { char, fg: hashColor, bg: rowBg });
      }
    }

    // Space
    if (col < x + width - 1) {
      buffer.set(col++, y, { char: ' ', fg: rowFg, bg: rowBg });
    }

    // Message (truncated)
    const maxMsgLen = width - (col - x) - 1;
    const message = commit.message.length > maxMsgLen
      ? commit.message.substring(0, maxMsgLen - 1) + '…'
      : commit.message;

    for (const char of message) {
      if (col < x + width - 1) {
        buffer.set(col++, y, { char, fg: rowFg, bg: rowBg });
      }
    }

    // Fill rest of row 1
    while (col < x + width) {
      buffer.set(col++, y, { char: ' ', fg: rowFg, bg: rowBg });
    }

    // Row 2: author + date (indented and dimmed)
    col = x + 2; // Indent

    // Author
    const authorText = commit.author;
    for (const char of authorText) {
      if (col < x + width - 12) {
        buffer.set(col++, y + 1, { char, fg: dimFg, bg: rowBg });
      }
    }

    // Space
    if (col < x + width - 10) {
      buffer.set(col++, y + 1, { char: ' ', fg: dimFg, bg: rowBg });
    }

    // Relative date
    const relDate = this.formatRelativeDate(commit.date);
    for (const char of relDate) {
      if (col < x + width - 1) {
        buffer.set(col++, y + 1, { char, fg: dimFg, bg: rowBg });
      }
    }

    // Fill rest of row 2
    while (col < x + width) {
      buffer.set(col++, y + 1, { char: ' ', fg: dimFg, bg: rowBg });
    }
  }

  /**
   * Render scrollbar.
   */
  private renderScrollbar(buffer: ScreenBuffer, x: number, y: number, height: number): void {
    if (height <= 0 || this.viewNodes.length === 0) return;

    const commitHeight = 2;
    const visibleCount = Math.floor(height / commitHeight);
    const totalCommits = this.viewNodes.length;

    if (visibleCount >= totalCommits) return;

    const trackColor = this.ctx.getThemeColor('scrollbar.shadow', '#1a1a1a');
    const thumbColor = this.ctx.getThemeColor('scrollbarSlider.background', '#555555');

    // Calculate thumb size and position
    const thumbHeight = Math.max(1, Math.floor((visibleCount / totalCommits) * height));
    const maxScroll = totalCommits - visibleCount;
    const scrollRatio = maxScroll > 0 ? this.scrollTop / maxScroll : 0;
    const thumbY = Math.floor(scrollRatio * (height - thumbHeight));

    for (let i = 0; i < height; i++) {
      const isThumb = i >= thumbY && i < thumbY + thumbHeight;
      buffer.set(x, y + i, {
        char: '│',
        fg: isThumb ? thumbColor : trackColor,
        bg: this.ctx.getThemeColor('terminal.background', '#1e1e1e'),
      });
    }
  }

  /**
   * Format an ISO date as relative time.
   */
  private formatRelativeDate(isoDate: string): string {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffYears > 0) return `${diffYears}y ago`;
    if (diffMonths > 0) return `${diffMonths}mo ago`;
    if (diffWeeks > 0) return `${diffWeeks}w ago`;
    if (diffDays > 0) return `${diffDays}d ago`;
    if (diffHours > 0) return `${diffHours}h ago`;
    if (diffMinutes > 0) return `${diffMinutes}m ago`;
    return 'just now';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  override handleKey(event: KeyEvent): boolean {
    // Handle search input first
    if (this.searchInputActive) {
      return this.handleSearchInput(event);
    }

    return this.handleNavigationKey(event);
  }

  /**
   * Handle keys when search is active.
   */
  private handleSearchInput(event: KeyEvent): boolean {
    const key = event.key;

    if (key === 'Escape') {
      this.searchInputActive = false;
      this.searchQuery = '';
      this.searchCursorPos = 0;
      this.rebuildView();
      this.ctx.markDirty();
      return true;
    }

    if (key === 'Return' || key === 'Enter') {
      this.searchInputActive = false;
      this.ctx.markDirty();
      return true;
    }

    if (key === 'Backspace') {
      if (this.searchCursorPos > 0) {
        this.searchQuery =
          this.searchQuery.slice(0, this.searchCursorPos - 1) +
          this.searchQuery.slice(this.searchCursorPos);
        this.searchCursorPos--;
        this.rebuildView();
      }
      this.ctx.markDirty();
      return true;
    }

    if (key === 'Delete') {
      if (this.searchCursorPos < this.searchQuery.length) {
        this.searchQuery =
          this.searchQuery.slice(0, this.searchCursorPos) +
          this.searchQuery.slice(this.searchCursorPos + 1);
        this.rebuildView();
      }
      this.ctx.markDirty();
      return true;
    }

    if (key === 'ArrowLeft') {
      this.searchCursorPos = Math.max(0, this.searchCursorPos - 1);
      this.ctx.markDirty();
      return true;
    }

    if (key === 'ArrowRight') {
      this.searchCursorPos = Math.min(this.searchQuery.length, this.searchCursorPos + 1);
      this.ctx.markDirty();
      return true;
    }

    if (key === 'Home') {
      this.searchCursorPos = 0;
      this.ctx.markDirty();
      return true;
    }

    if (key === 'End') {
      this.searchCursorPos = this.searchQuery.length;
      this.ctx.markDirty();
      return true;
    }

    // Navigation while searching
    if (key === 'ArrowUp') {
      this.moveUp();
      return true;
    }

    if (key === 'ArrowDown') {
      this.moveDown();
      return true;
    }

    // Character input
    if (key.length === 1 && !event.ctrl && !event.meta) {
      this.searchQuery =
        this.searchQuery.slice(0, this.searchCursorPos) +
        key +
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
    const key = event.key;

    // Search
    if (key === '/') {
      this.searchInputActive = true;
      this.searchCursorPos = this.searchQuery.length;
      this.ctx.markDirty();
      return true;
    }

    // Clear search with Escape
    if (key === 'Escape') {
      if (this.searchQuery) {
        this.searchQuery = '';
        this.rebuildView();
        this.ctx.markDirty();
        return true;
      }
      return false;
    }

    // Mode toggle
    if (key === 'Tab') {
      this.toggleMode();
      return true;
    }

    // Navigation
    if (key === 'ArrowUp' || key === 'k') {
      this.moveUp();
      return true;
    }

    if (key === 'ArrowDown' || key === 'j') {
      this.moveDown();
      return true;
    }

    if (key === 'PageUp') {
      this.pageUp();
      return true;
    }

    if (key === 'PageDown') {
      this.pageDown();
      return true;
    }

    if (key === 'Home' || key === 'g') {
      this.goToFirst();
      return true;
    }

    if (key === 'End' || key === 'G') {
      this.goToLast();
      return true;
    }

    // Actions
    if (key === 'Return' || key === 'Enter') {
      this.viewDiff();
      return true;
    }

    if (key === 'o') {
      if (this.mode === 'file' && this.filePath) {
        this.openFileAtCommit();
      }
      return true;
    }

    if (key === 'y') {
      this.copyHash();
      return true;
    }

    return false;
  }

  override handleMouse(event: MouseEvent): boolean {
    if (!this.isWithinBounds(event.x, event.y)) return false;

    const { x, y } = this.bounds;
    const relY = event.y - y;

    // Scroll events
    if (event.type === 'scroll') {
      const direction = (event.scrollDirection ?? 1) * 3;
      const maxScroll = Math.max(0, this.viewNodes.length - this.getListHeight());
      this.scrollTop = Math.max(0, Math.min(maxScroll, this.scrollTop + direction));
      this.ctx.markDirty();
      return true;
    }

    // Click on mode bar (row 0)
    if (event.type === 'press' && event.button === 'left' && relY === 0) {
      // Check if click is on File or Repo label
      const relX = event.x - x;
      if (relX < 7) {
        this.setMode('file');
      } else if (relX < 14) {
        this.setMode('repo');
      }
      return true;
    }

    // Click on commit list
    if (event.type === 'press' && event.button === 'left') {
      const headerRows = 1 + (this.searchInputActive ? 1 : 0);
      const listY = relY - headerRows;

      if (listY >= 0) {
        const clickedIndex = this.scrollTop + Math.floor(listY / 2);
        if (clickedIndex < this.viewNodes.length) {
          const now = Date.now();
          const isDoubleClick = clickedIndex === this.lastClickIndex && now - this.lastClickTime < 300;

          if (isDoubleClick) {
            this.viewDiff();
          } else {
            this.selectedIndex = clickedIndex;
            this.ctx.markDirty();
          }

          this.lastClickTime = now;
          this.lastClickIndex = clickedIndex;
        }
      }
      return true;
    }

    return false;
  }

  /**
   * Check if coordinates are within bounds.
   */
  private isWithinBounds(x: number, y: number): boolean {
    return (
      x >= this.bounds.x &&
      x < this.bounds.x + this.bounds.width &&
      y >= this.bounds.y &&
      y < this.bounds.y + this.bounds.height
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

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

  override getState(): GitTimelinePanelState {
    return {
      mode: this.mode,
      documentUri: this.documentUri ?? undefined,
      scrollTop: this.scrollTop,
      selectedIndex: this.selectedIndex,
      searchQuery: this.searchQuery || undefined,
    };
  }

  override setState(state: unknown): void {
    if (!state || typeof state !== 'object') return;

    const s = state as Partial<GitTimelinePanelState>;

    if (s.mode !== undefined) {
      this.mode = s.mode;
    }
    if (s.scrollTop !== undefined) {
      this.scrollTop = s.scrollTop;
    }
    if (s.selectedIndex !== undefined) {
      this.selectedIndex = s.selectedIndex;
    }
    if (s.searchQuery !== undefined) {
      this.searchQuery = s.searchQuery;
    }

    this.rebuildView();
    this.ctx.markDirty();
  }
}

// ============================================
// Factory
// ============================================

export function createGitTimelinePanel(
  id: string,
  title: string,
  ctx: ElementContext,
  callbacks: GitTimelinePanelCallbacks = {}
): GitTimelinePanel {
  return new GitTimelinePanel(id, title, ctx, callbacks);
}
