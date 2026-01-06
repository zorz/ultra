/**
 * GitPanel Element
 *
 * A panel for viewing and managing git status, staged/unstaged changes.
 */

import { BaseElement, type ElementContext } from './base.ts';
import type { KeyEvent, MouseEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import { TIMEOUTS } from '../../../constants.ts';

// ============================================
// Types
// ============================================

/**
 * Git file change status.
 */
export type GitFileStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?';

/**
 * A changed file in the git working tree.
 */
export interface GitChange {
  /** File path relative to repo root */
  path: string;
  /** Original path (for renames) */
  originalPath?: string;
  /** Index (staged) status */
  indexStatus: GitFileStatus | ' ';
  /** Working tree status */
  workingStatus: GitFileStatus | ' ';
}

/**
 * Git repository state.
 */
export interface GitState {
  /** Current branch name */
  branch: string;
  /** Remote tracking branch */
  upstream?: string;
  /** Commits ahead of upstream */
  ahead: number;
  /** Commits behind upstream */
  behind: number;
  /** Staged changes */
  staged: GitChange[];
  /** Unstaged changes */
  unstaged: GitChange[];
  /** Untracked files */
  untracked: GitChange[];
  /** Is merge in progress */
  merging: boolean;
  /** Is rebase in progress */
  rebasing: boolean;
}

/**
 * Section in the git panel.
 */
type GitSection = 'staged' | 'unstaged' | 'untracked';

/**
 * View node for rendering.
 */
interface ViewNode {
  type: 'section' | 'file';
  section: GitSection;
  change?: GitChange;
  index: number;
}

/**
 * Callbacks for git panel.
 */
export interface GitPanelCallbacks {
  /** Stage a file */
  onStage?: (path: string) => void;
  /** Stage all files */
  onStageAll?: () => void;
  /** Unstage a file */
  onUnstage?: (path: string) => void;
  /** Discard changes to a file */
  onDiscard?: (path: string) => void;
  /** Open file diff */
  onOpenDiff?: (path: string, staged: boolean) => void;
  /** Commit staged changes */
  onCommit?: () => void;
  /** Refresh status */
  onRefresh?: () => void;
  /** Open file in editor */
  onOpenFile?: (path: string) => void;
}

// ============================================
// GitPanel Element
// ============================================

export class GitPanel extends BaseElement {
  /** Git state */
  private state: GitState = {
    branch: 'main',
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    merging: false,
    rebasing: false,
  };

  /** Flattened view nodes */
  private viewNodes: ViewNode[] = [];

  /** Selected index */
  private selectedIndex = 0;

  /** Scroll offset */
  private scrollTop = 0;

  /** Collapsed sections */
  private collapsedSections = new Set<GitSection>();

  /** Callbacks */
  private callbacks: GitPanelCallbacks;

  constructor(id: string, title: string, ctx: ElementContext, callbacks: GitPanelCallbacks = {}) {
    super('GitPanel', id, title, ctx);
    this.callbacks = callbacks;
    this.rebuildView();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Callback Configuration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set callbacks after construction.
   * Useful when element is created via factory.
   */
  setCallbacks(callbacks: GitPanelCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Get current callbacks.
   */
  getCallbacks(): GitPanelCallbacks {
    return this.callbacks;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Data Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set git state.
   */
  setGitState(state: GitState): void {
    this.state = state;
    this.rebuildView();
    this.updateStatus();
    this.ctx.markDirty();
  }

  /**
   * Get git state.
   */
  getGitState(): GitState {
    return this.state;
  }

  /**
   * Update branch info.
   */
  setBranch(branch: string, upstream?: string, ahead = 0, behind = 0): void {
    this.state.branch = branch;
    this.state.upstream = upstream;
    this.state.ahead = ahead;
    this.state.behind = behind;
    this.updateStatus();
    this.ctx.markDirty();
  }

  /**
   * Set staged changes.
   */
  setStagedChanges(changes: GitChange[]): void {
    this.state.staged = changes;
    this.rebuildView();
    this.ctx.markDirty();
  }

  /**
   * Set unstaged changes.
   */
  setUnstagedChanges(changes: GitChange[]): void {
    this.state.unstaged = changes;
    this.rebuildView();
    this.ctx.markDirty();
  }

  /**
   * Set untracked files.
   */
  setUntrackedFiles(changes: GitChange[]): void {
    this.state.untracked = changes;
    this.rebuildView();
    this.ctx.markDirty();
  }

  /**
   * Update element status text.
   */
  private updateStatus(): void {
    const parts: string[] = [this.state.branch];
    if (this.state.ahead > 0) parts.push(`↑${this.state.ahead}`);
    if (this.state.behind > 0) parts.push(`↓${this.state.behind}`);
    this.setStatus(parts.join(' '));
  }

  /**
   * Rebuild flattened view.
   */
  private rebuildView(): void {
    this.viewNodes = [];
    let index = 0;

    // Staged section
    if (this.state.staged.length > 0) {
      this.viewNodes.push({ type: 'section', section: 'staged', index: index++ });
      if (!this.collapsedSections.has('staged')) {
        for (const change of this.state.staged) {
          this.viewNodes.push({ type: 'file', section: 'staged', change, index: index++ });
        }
      }
    }

    // Unstaged section
    if (this.state.unstaged.length > 0) {
      this.viewNodes.push({ type: 'section', section: 'unstaged', index: index++ });
      if (!this.collapsedSections.has('unstaged')) {
        for (const change of this.state.unstaged) {
          this.viewNodes.push({ type: 'file', section: 'unstaged', change, index: index++ });
        }
      }
    }

    // Untracked section
    if (this.state.untracked.length > 0) {
      this.viewNodes.push({ type: 'section', section: 'untracked', index: index++ });
      if (!this.collapsedSections.has('untracked')) {
        for (const change of this.state.untracked) {
          this.viewNodes.push({ type: 'file', section: 'untracked', change, index: index++ });
        }
      }
    }

    // Clamp selection
    if (this.selectedIndex >= this.viewNodes.length) {
      this.selectedIndex = Math.max(0, this.viewNodes.length - 1);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Selection & Navigation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get selected node.
   */
  getSelectedNode(): ViewNode | null {
    return this.viewNodes[this.selectedIndex] ?? null;
  }

  /**
   * Move selection up.
   */
  moveUp(): void {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
      this.ensureVisible();
      this.ctx.markDirty();
    }
  }

  /**
   * Move selection down.
   */
  moveDown(): void {
    if (this.selectedIndex < this.viewNodes.length - 1) {
      this.selectedIndex++;
      this.ensureVisible();
      this.ctx.markDirty();
    }
  }

  /**
   * Toggle section collapse.
   */
  toggleSection(): void {
    const node = this.viewNodes[this.selectedIndex];
    if (!node || node.type !== 'section') return;

    if (this.collapsedSections.has(node.section)) {
      this.collapsedSections.delete(node.section);
    } else {
      this.collapsedSections.add(node.section);
    }

    this.rebuildView();
    this.ctx.markDirty();
  }

  /**
   * Stage/unstage selected file.
   */
  stageOrUnstage(): void {
    const node = this.viewNodes[this.selectedIndex];
    if (!node || node.type !== 'file' || !node.change) return;

    if (node.section === 'staged') {
      this.callbacks.onUnstage?.(node.change.path);
    } else {
      this.callbacks.onStage?.(node.change.path);
    }
  }

  /**
   * Stage all unstaged and untracked files.
   */
  stageAll(): void {
    this.callbacks.onStageAll?.();
  }

  /**
   * Discard changes to selected file.
   */
  discardChanges(): void {
    const node = this.viewNodes[this.selectedIndex];
    if (!node || node.type !== 'file' || !node.change) return;

    if (node.section !== 'staged') {
      this.callbacks.onDiscard?.(node.change.path);
    }
  }

  /**
   * Open diff for selected file.
   */
  openDiff(): void {
    const node = this.viewNodes[this.selectedIndex];
    if (!node || node.type !== 'file' || !node.change) return;

    this.callbacks.onOpenDiff?.(node.change.path, node.section === 'staged');
  }

  /**
   * Open selected file in editor.
   */
  openFile(): void {
    const node = this.viewNodes[this.selectedIndex];
    if (!node || node.type !== 'file' || !node.change) return;

    this.callbacks.onOpenFile?.(node.change.path);
  }

  /**
   * Ensure selected item is visible.
   */
  private ensureVisible(): void {
    // Account for header (1) and hint bar (2 when focused)
    const hintBarHeight = this.focused ? 2 : 0;
    const viewportHeight = this.bounds.height - 1 - hintBarHeight;

    if (this.selectedIndex < this.scrollTop) {
      this.scrollTop = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollTop + viewportHeight) {
      this.scrollTop = this.selectedIndex - viewportHeight + 1;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  render(buffer: ScreenBuffer): void {
    const { x, y, width, height } = this.bounds;

    // Debug: log bounds and view nodes
    if (height === 0) {
      return; // Nothing to render
    }

    // Use centralized focus colors for consistent focus indication
    const bg = this.ctx.getBackgroundForFocus('sidebar', this.focused);
    const fg = this.ctx.getForegroundForFocus('sidebar', this.focused);
    const headerBg = this.ctx.getThemeColor('sideBarSectionHeader.background', '#383838');
    const headerFg = this.ctx.getThemeColor('sideBarSectionHeader.foreground', '#cccccc');
    const selectedBg = this.ctx.getSelectionBackground('sidebar', this.focused);
    const selectedFg = this.ctx.getThemeColor('list.activeSelectionForeground', '#ffffff');

    // Colors for git status
    const stagedColor = this.ctx.getThemeColor('gitDecoration.addedResourceForeground', '#81b88b');
    const modifiedColor = this.ctx.getThemeColor('gitDecoration.modifiedResourceForeground', '#e2c08d');
    const deletedColor = this.ctx.getThemeColor('gitDecoration.deletedResourceForeground', '#c74e39');
    const untrackedColor = this.ctx.getThemeColor('gitDecoration.untrackedResourceForeground', '#73c991');

    // Clear background
    for (let row = 0; row < height; row++) {
      buffer.writeString(x, y + row, ' '.repeat(width), fg, bg);
    }

    // Render header with branch info
    let headerText = ` ${this.state.branch}`;
    if (this.state.ahead > 0 || this.state.behind > 0) {
      headerText += ` (`;
      if (this.state.ahead > 0) headerText += `↑${this.state.ahead}`;
      if (this.state.behind > 0) headerText += `↓${this.state.behind}`;
      headerText += `)`;
    }
    if (this.state.merging) headerText += ' MERGING';
    if (this.state.rebasing) headerText += ' REBASING';
    buffer.writeString(x, y, headerText.padEnd(width, ' '), headerFg, headerBg);

    // Render view nodes (reserve 2 rows for hint bar at bottom when focused)
    const contentStart = y + 1;
    const hintBarHeight = this.focused ? 2 : 0;
    const contentHeight = Math.max(0, height - 1 - hintBarHeight);

    for (let row = 0; row < contentHeight; row++) {
      const viewIdx = this.scrollTop + row;
      if (viewIdx >= this.viewNodes.length) break;

      const node = this.viewNodes[viewIdx]!;
      const screenY = contentStart + row;
      const isSelected = viewIdx === this.selectedIndex;

      if (node.type === 'section') {
        // Render section header (1-char gutter on left)
        const collapsed = this.collapsedSections.has(node.section);
        const expander = collapsed ? '▶' : '▼';
        const sectionName = this.getSectionName(node.section);
        const count = this.getSectionCount(node.section);
        const line = ` ${expander} ${sectionName} (${count})`.padEnd(width, ' ');

        buffer.writeString(
          x,
          screenY,
          line,
          isSelected ? selectedFg : headerFg,
          isSelected ? selectedBg : headerBg
        );
      } else if (node.change) {
        // Render file entry (1-char gutter + 2-char indent)
        const status = this.getStatusIcon(node.section, node.change);
        const filename = node.change.path.split('/').pop() ?? node.change.path;
        const dirname = node.change.path.includes('/')
          ? node.change.path.slice(0, node.change.path.lastIndexOf('/'))
          : '';

        let line = `   ${status} ${filename}`;
        if (dirname) {
          line += ` ${dirname}`;
        }

        if (line.length > width) {
          line = line.slice(0, width - 1) + '…';
        } else {
          line = line.padEnd(width, ' ');
        }

        // Determine color
        let fileColor = fg;
        if (!isSelected || !this.focused) {
          if (node.section === 'staged') {
            fileColor = stagedColor;
          } else if (node.section === 'untracked') {
            fileColor = untrackedColor;
          } else {
            const status = node.change.workingStatus;
            if (status === 'M') fileColor = modifiedColor;
            else if (status === 'D') fileColor = deletedColor;
            else if (status === 'A') fileColor = stagedColor;
          }
        }

        buffer.writeString(
          x,
          screenY,
          line,
          isSelected ? selectedFg : fileColor,
          isSelected ? selectedBg : bg
        );
      }
    }

    // Empty state message
    if (this.viewNodes.length === 0) {
      const msg = 'No changes';
      const msgX = x + Math.floor((width - msg.length) / 2);
      buffer.writeString(msgX, contentStart + 2, msg, '#888888', bg);
    }

    // Render keyboard hints bar at bottom (only when focused, 2 lines)
    // Hints go immediately after content area, within bounds
    if (this.focused && contentHeight >= 1) {
      const hintBg = this.ctx.getThemeColor('statusBar.background', '#007acc');
      const hintFg = this.ctx.getThemeColor('statusBar.foreground', '#ffffff');

      // Build hints - 2 lines, truncated to fit width
      // Line 1: s:stage, S:stage-all, u:unstage, d:discard
      // Line 2: c:commit, r:refresh, Enter:diff, o:open
      let line1 = ' s:stage S:all u:unstage d:discard';
      let line2 = ' c:commit r:refresh ↵:diff o:open';

      // Truncate and pad to exact width
      if (line1.length > width) line1 = line1.slice(0, width);
      if (line2.length > width) line2 = line2.slice(0, width);
      line1 = line1.padEnd(width, ' ').slice(0, width);
      line2 = line2.padEnd(width, ' ').slice(0, width);

      // Position hints right after content, strictly within bounds
      const hintY1 = contentStart + contentHeight;
      const hintY2 = hintY1 + 1;

      // Only draw if within allocated bounds (y to y+height-1 inclusive)
      if (hintY1 < y + height) {
        buffer.writeString(x, hintY1, line1, hintFg, hintBg);
      }
      if (hintY2 < y + height) {
        buffer.writeString(x, hintY2, line2, hintFg, hintBg);
      }
    }
  }

  /**
   * Get section display name.
   */
  private getSectionName(section: GitSection): string {
    switch (section) {
      case 'staged':
        return 'Staged Changes';
      case 'unstaged':
        return 'Changes';
      case 'untracked':
        return 'Untracked Files';
    }
  }

  /**
   * Get section item count.
   */
  private getSectionCount(section: GitSection): number {
    switch (section) {
      case 'staged':
        return this.state.staged.length;
      case 'unstaged':
        return this.state.unstaged.length;
      case 'untracked':
        return this.state.untracked.length;
    }
  }

  /**
   * Get status icon for file.
   */
  private getStatusIcon(section: GitSection, change: GitChange): string {
    if (section === 'staged') {
      switch (change.indexStatus) {
        case 'M': return 'M';
        case 'A': return '+';
        case 'D': return '-';
        case 'R': return 'R';
        case 'C': return 'C';
        default: return ' ';
      }
    } else if (section === 'untracked') {
      return '?';
    } else {
      switch (change.workingStatus) {
        case 'M': return 'M';
        case 'D': return '-';
        case 'U': return 'U';
        default: return ' ';
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  override handleKey(event: KeyEvent): boolean {
    // Note: Most keys are now handled via the keybinding system (gitPanel.* commands)
    // with "when": "gitPanelFocus" context. See config/default-keybindings.jsonc
    // This handleKey method only handles keys not in keybindings (Home, End, e alias)

    // e: alias for open file (not in keybindings)
    if (event.key === 'e') {
      this.openFile();
      return true;
    }

    // Home: jump to first item
    if (event.key === 'Home') {
      if (this.viewNodes.length > 0) {
        this.selectedIndex = 0;
        this.ensureVisible();
        this.ctx.markDirty();
      }
      return true;
    }

    // End: jump to last item
    if (event.key === 'End') {
      if (this.viewNodes.length > 0) {
        this.selectedIndex = this.viewNodes.length - 1;
        this.ensureVisible();
        this.ctx.markDirty();
      }
      return true;
    }

    return false;
  }

  /** Last click time for double-click detection */
  private lastClickTime = 0;
  /** Last clicked index for double-click detection */
  private lastClickIndex = -1;

  override handleMouse(event: MouseEvent): boolean {
    if (event.type === 'press' && event.button === 'left') {
      // Check if click is within our bounds
      if (event.x >= this.bounds.x && event.x < this.bounds.x + this.bounds.width &&
          event.y >= this.bounds.y && event.y < this.bounds.y + this.bounds.height) {
        // Always request focus when clicked
        this.ctx.requestFocus();

        const relY = event.y - this.bounds.y - 1; // Subtract internal header row
        if (relY >= 0 && this.viewNodes.length > 0) {
          const viewIdx = this.scrollTop + relY;
          if (viewIdx >= 0 && viewIdx < this.viewNodes.length) {
            const now = Date.now();
            const isDoubleClick = viewIdx === this.lastClickIndex && (now - this.lastClickTime) < TIMEOUTS.DOUBLE_CLICK;
            const node = this.viewNodes[viewIdx];

            this.selectedIndex = viewIdx;

            // Click on section header toggles fold
            if (node?.type === 'section') {
              this.toggleSection();
            }
            // Double-click on file opens the diff view
            else if (isDoubleClick && node?.type === 'file' && node.change) {
              const isStaged = node.section === 'staged';
              this.callbacks.onOpenDiff?.(node.change.path, isStaged);
            }

            this.lastClickTime = now;
            this.lastClickIndex = viewIdx;
          }
        }
        this.ctx.markDirty();
        return true;
      }
    }

    if (event.type === 'scroll') {
      // Check if scroll is within our bounds
      if (event.x >= this.bounds.x && event.x < this.bounds.x + this.bounds.width &&
          event.y >= this.bounds.y && event.y < this.bounds.y + this.bounds.height) {
        // Use scrollDirection (1=down, -1=up), multiply by 3 for faster scroll
        const delta = (event.scrollDirection ?? 1) * 3;
        this.scrollTop = Math.max(0, Math.min(this.scrollTop + delta, this.viewNodes.length - (this.bounds.height - 1)));
        this.ctx.markDirty();
        return true;
      }
    }

    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State Serialization
  // ─────────────────────────────────────────────────────────────────────────

  override getState(): unknown {
    return {
      scrollTop: this.scrollTop,
      collapsedSections: Array.from(this.collapsedSections),
    };
  }

  override setState(state: unknown): void {
    const s = state as { scrollTop?: number; collapsedSections?: string[] };
    if (s.scrollTop !== undefined) {
      this.scrollTop = s.scrollTop;
    }
    if (s.collapsedSections) {
      this.collapsedSections = new Set(s.collapsedSections as GitSection[]);
      this.rebuildView();
    }
    this.ctx.markDirty();
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a git panel element.
 */
export function createGitPanel(
  id: string,
  title: string,
  ctx: ElementContext,
  callbacks?: GitPanelCallbacks
): GitPanel {
  return new GitPanel(id, title, ctx, callbacks);
}
