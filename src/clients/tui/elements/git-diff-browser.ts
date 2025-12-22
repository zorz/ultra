/**
 * Git Diff Browser Element
 *
 * A content browser specialized for viewing and managing git diffs.
 * Displays file changes organized by file, with expandable hunks.
 */

import { ContentBrowser } from './content-browser.ts';
import type { ElementContext } from './base.ts';
import type { KeyEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import type { ArtifactNode, ArtifactAction, ContentBrowserCallbacks } from '../artifacts/types.ts';
import type { GitDiffHunk, DiffLine } from '../../../services/git/types.ts';
import {
  type GitDiffArtifact,
  type GitDiffFileNode,
  type GitDiffHunkNode,
  type GitDiffLineNode,
  isFileNode,
  isHunkNode,
  isLineNode,
  getChangeTypeIcon,
  getChangeTypeColorKey,
  formatHunkHeader,
} from '../artifacts/git-diff-artifact.ts';

// ============================================
// Types
// ============================================

/**
 * Callbacks for git diff browser.
 */
export interface GitDiffBrowserCallbacks extends ContentBrowserCallbacks<GitDiffArtifact> {
  /** Stage a file */
  onStageFile?: (filePath: string) => void;
  /** Unstage a file */
  onUnstageFile?: (filePath: string) => void;
  /** Stage a specific hunk */
  onStageHunk?: (filePath: string, hunkIndex: number) => void;
  /** Unstage a specific hunk */
  onUnstageHunk?: (filePath: string, hunkIndex: number) => void;
  /** Discard a file's changes */
  onDiscardFile?: (filePath: string) => void;
  /** Discard a specific hunk */
  onDiscardHunk?: (filePath: string, hunkIndex: number) => void;
}

// ============================================
// Git Diff Browser
// ============================================

export class GitDiffBrowser extends ContentBrowser<GitDiffArtifact> {
  /** Whether showing staged or unstaged diffs */
  private staged = false;

  /** Git-specific callbacks */
  private gitCallbacks: GitDiffBrowserCallbacks;

  constructor(
    id: string,
    title: string,
    ctx: ElementContext,
    callbacks: GitDiffBrowserCallbacks = {}
  ) {
    super(id, title, ctx, callbacks);
    this.gitCallbacks = callbacks;
    this.browserTitle = title;
    this.hintBarHeight = 2;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set whether showing staged diffs.
   */
  setStaged(staged: boolean): void {
    this.staged = staged;
    this.browserSubtitle = staged ? 'Staged Changes' : 'Unstaged Changes';
    this.ctx.markDirty();
  }

  /**
   * Get whether showing staged diffs.
   */
  isStaged(): boolean {
    return this.staged;
  }

  /**
   * Set git-specific callbacks.
   */
  setGitCallbacks(callbacks: GitDiffBrowserCallbacks): void {
    this.gitCallbacks = { ...this.gitCallbacks, ...callbacks };
    this.setCallbacks(callbacks);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Node Building
  // ─────────────────────────────────────────────────────────────────────────

  protected override buildNodes(artifacts: GitDiffArtifact[]): ArtifactNode<GitDiffArtifact>[] {
    return artifacts.map((artifact) => this.buildFileNode(artifact));
  }

  private buildFileNode(artifact: GitDiffArtifact): GitDiffFileNode {
    return {
      artifact,
      nodeType: 'file',
      nodeId: `file:${artifact.filePath}`,
      depth: 0,
      expanded: true,
      children: artifact.hunks.map((hunk, idx) => this.buildHunkNode(artifact, hunk, idx)),
      actions: this.getFileActions(artifact),
      selected: false,
      label: artifact.filePath.split('/').pop() ?? artifact.filePath,
      secondaryLabel: `+${artifact.additions} -${artifact.deletions}`,
      icon: getChangeTypeIcon(artifact.changeType),
      foreground: undefined,
      metadata: {
        fullPath: artifact.filePath,
        changeType: artifact.changeType,
      },
    };
  }

  private buildHunkNode(
    artifact: GitDiffArtifact,
    hunk: GitDiffHunk,
    hunkIndex: number
  ): GitDiffHunkNode {
    return {
      artifact,
      nodeType: 'hunk',
      nodeId: `hunk:${artifact.filePath}:${hunkIndex}`,
      depth: 1,
      expanded: true,
      hunkIndex,
      hunk,
      children: hunk.lines.map((line, idx) => this.buildLineNode(artifact, hunk, hunkIndex, line, idx)),
      actions: this.getHunkActions(artifact, hunkIndex),
      selected: false,
      label: formatHunkHeader(hunk),
      secondaryLabel: `${hunk.lines.length} lines`,
      icon: '@@',
      foreground: '#888888',
      metadata: { hunkIndex },
    };
  }

  private buildLineNode(
    artifact: GitDiffArtifact,
    _hunk: GitDiffHunk,
    hunkIndex: number,
    line: DiffLine,
    lineIndex: number
  ): GitDiffLineNode {
    const prefix = line.type === 'added' ? '+' : line.type === 'deleted' ? '-' : ' ';
    return {
      artifact,
      nodeType: 'line',
      nodeId: `line:${artifact.filePath}:${hunkIndex}:${lineIndex}`,
      depth: 2,
      expanded: false,
      hunkIndex,
      lineIndex,
      line,
      children: [],
      actions: [], // Lines don't have individual actions
      selected: false,
      label: `${prefix}${line.content}`,
      icon: prefix,
      foreground: undefined,
      metadata: {
        lineType: line.type,
        oldLineNum: line.oldLineNum,
        newLineNum: line.newLineNum,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────────────────

  private getFileActions(artifact: GitDiffArtifact): ArtifactAction[] {
    const actions: ArtifactAction[] = [];

    if (this.staged) {
      actions.push({
        id: 'unstage-file',
        label: 'Unstage File',
        shortcut: 'u',
        icon: '-',
        enabled: true,
        execute: () => this.gitCallbacks.onUnstageFile?.(artifact.filePath),
      });
    } else {
      actions.push({
        id: 'stage-file',
        label: 'Stage File',
        shortcut: 's',
        icon: '+',
        enabled: true,
        execute: () => this.gitCallbacks.onStageFile?.(artifact.filePath),
      });
      actions.push({
        id: 'discard-file',
        label: 'Discard Changes',
        shortcut: 'd',
        icon: 'x',
        enabled: true,
        execute: () => this.gitCallbacks.onDiscardFile?.(artifact.filePath),
      });
    }

    actions.push({
      id: 'open-file',
      label: 'Open File',
      shortcut: 'o',
      icon: '→',
      enabled: true,
      execute: () => this.callbacks.onOpenFile?.(artifact.filePath),
    });

    return actions;
  }

  private getHunkActions(artifact: GitDiffArtifact, hunkIndex: number): ArtifactAction[] {
    const actions: ArtifactAction[] = [];

    if (this.staged) {
      actions.push({
        id: 'unstage-hunk',
        label: 'Unstage Hunk',
        shortcut: 'u',
        icon: '-',
        enabled: true,
        execute: () => this.gitCallbacks.onUnstageHunk?.(artifact.filePath, hunkIndex),
      });
    } else {
      actions.push({
        id: 'stage-hunk',
        label: 'Stage Hunk',
        shortcut: 's',
        icon: '+',
        enabled: true,
        execute: () => this.gitCallbacks.onStageHunk?.(artifact.filePath, hunkIndex),
      });
      actions.push({
        id: 'discard-hunk',
        label: 'Discard Hunk',
        shortcut: 'd',
        icon: 'x',
        enabled: true,
        execute: () => this.gitCallbacks.onDiscardHunk?.(artifact.filePath, hunkIndex),
      });
    }

    return actions;
  }

  protected override getNodeActions(node: ArtifactNode<GitDiffArtifact>): ArtifactAction[] {
    return node.actions;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  protected override renderNode(
    buffer: ScreenBuffer,
    node: ArtifactNode<GitDiffArtifact>,
    x: number,
    y: number,
    width: number,
    isSelected: boolean
  ): void {
    // Colors
    const bg = this.ctx.getBackgroundForFocus('sidebar', this.focused);
    const fg = this.ctx.getForegroundForFocus('sidebar', this.focused);
    const selectedBg = this.ctx.getSelectionBackground('sidebar', this.focused);
    const selectedFg = this.ctx.getThemeColor('list.activeSelectionForeground', '#ffffff');
    const addedFg = this.ctx.getThemeColor('gitDecoration.addedResourceForeground', '#81b88b');
    const deletedFg = this.ctx.getThemeColor('gitDecoration.deletedResourceForeground', '#c74e39');
    const modifiedFg = this.ctx.getThemeColor('gitDecoration.modifiedResourceForeground', '#e2c08d');
    const headerFg = this.ctx.getThemeColor('sideBarSectionHeader.foreground', '#cccccc');
    const dimFg = '#888888';

    // Background for this row
    const rowBg = isSelected ? selectedBg : bg;
    buffer.writeString(x, y, ' '.repeat(width), fg, rowBg);

    if (isFileNode(node)) {
      this.renderFileNode(buffer, node, x, y, width, isSelected, {
        selectedFg,
        fg,
        addedFg,
        deletedFg,
        modifiedFg,
        dimFg,
        rowBg,
      });
    } else if (isHunkNode(node)) {
      this.renderHunkNode(buffer, node, x, y, width, isSelected, {
        selectedFg,
        headerFg,
        dimFg,
        rowBg,
      });
    } else if (isLineNode(node)) {
      this.renderLineNode(buffer, node, x, y, width, isSelected, {
        selectedFg,
        fg,
        addedFg,
        deletedFg,
        rowBg,
      });
    }
  }

  private renderFileNode(
    buffer: ScreenBuffer,
    node: GitDiffFileNode,
    x: number,
    y: number,
    width: number,
    isSelected: boolean,
    colors: {
      selectedFg: string;
      fg: string;
      addedFg: string;
      deletedFg: string;
      modifiedFg: string;
      dimFg: string;
      rowBg: string;
    }
  ): void {
    const indent = '  ';
    const collapsed = this.collapsedNodeIds.has(node.nodeId);
    const expander = node.children.length > 0 ? (collapsed ? '▶' : '▼') : ' ';
    const icon = node.icon ?? ' ';

    // Determine file color based on change type
    let fileColor = colors.fg;
    if (!isSelected || !this.focused) {
      const colorKey = getChangeTypeColorKey(node.artifact.changeType);
      fileColor = this.ctx.getThemeColor(colorKey, colors.fg);
    }

    // Build line: "  ▼ M filename.ts  +10 -5"
    let line = `${indent}${expander} ${icon} ${node.label}`;

    // Add stats at end
    const stats = ` +${node.artifact.additions} -${node.artifact.deletions}`;

    if (line.length + stats.length > width) {
      line = line.slice(0, width - stats.length - 1) + '…';
    }

    const padding = width - line.length - stats.length;
    if (padding > 0) {
      line += ' '.repeat(padding);
    }
    line += stats;

    // Write line
    const lineFg = isSelected && this.focused ? colors.selectedFg : fileColor;
    buffer.writeString(x, y, line.slice(0, width), lineFg, colors.rowBg);

    // Write stats in dim color if not selected
    if (!isSelected || !this.focused) {
      const statsX = x + width - stats.length;
      buffer.writeString(statsX, y, stats, colors.dimFg, colors.rowBg);
    }
  }

  private renderHunkNode(
    buffer: ScreenBuffer,
    node: GitDiffHunkNode,
    x: number,
    y: number,
    width: number,
    isSelected: boolean,
    colors: {
      selectedFg: string;
      headerFg: string;
      dimFg: string;
      rowBg: string;
    }
  ): void {
    const indent = '    ';
    const collapsed = this.collapsedNodeIds.has(node.nodeId);
    const expander = node.children.length > 0 ? (collapsed ? '▶' : '▼') : ' ';

    // Build line: "    ▼ @@ -10,5 +12,8 @@"
    let line = `${indent}${expander} ${node.label}`;

    if (line.length > width) {
      line = line.slice(0, width - 1) + '…';
    }
    line = line.padEnd(width, ' ').slice(0, width);

    const lineFg = isSelected && this.focused ? colors.selectedFg : colors.dimFg;
    buffer.writeString(x, y, line, lineFg, colors.rowBg);
  }

  private renderLineNode(
    buffer: ScreenBuffer,
    node: GitDiffLineNode,
    x: number,
    y: number,
    width: number,
    isSelected: boolean,
    colors: {
      selectedFg: string;
      fg: string;
      addedFg: string;
      deletedFg: string;
      rowBg: string;
    }
  ): void {
    const indent = '      ';
    const line = node.line;
    const prefix = line.type === 'added' ? '+' : line.type === 'deleted' ? '-' : ' ';

    // Line number columns
    const oldNum = line.oldLineNum?.toString().padStart(4, ' ') ?? '    ';
    const newNum = line.newLineNum?.toString().padStart(4, ' ') ?? '    ';

    // Build line: "      1234 5678 +content"
    let displayLine = `${indent}${oldNum} ${newNum} ${prefix}${line.content}`;

    if (displayLine.length > width) {
      displayLine = displayLine.slice(0, width - 1) + '…';
    }
    displayLine = displayLine.padEnd(width, ' ').slice(0, width);

    // Determine color
    let lineFg = colors.fg;
    if (isSelected && this.focused) {
      lineFg = colors.selectedFg;
    } else if (line.type === 'added') {
      lineFg = colors.addedFg;
    } else if (line.type === 'deleted') {
      lineFg = colors.deletedFg;
    }

    // Background highlight for diff lines
    let lineBg = colors.rowBg;
    if (!isSelected) {
      if (line.type === 'added') {
        lineBg = this.ctx.getThemeColor('diffEditor.insertedLineBackground', '#1e3a21');
      } else if (line.type === 'deleted') {
        lineBg = this.ctx.getThemeColor('diffEditor.removedLineBackground', '#3a1e1e');
      }
    }

    buffer.writeString(x, y, displayLine, lineFg, lineBg);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Keyboard Hints
  // ─────────────────────────────────────────────────────────────────────────

  protected override getKeyboardHints(): string[] {
    const node = this.getSelectedNode();

    if (this.staged) {
      return [
        ' ↑↓:navigate  Enter:toggle  Tab:view-mode  o:open',
        ' u:unstage  r:refresh',
      ];
    } else {
      if (node && isFileNode(node)) {
        return [
          ' ↑↓:navigate  Enter:toggle  Tab:view-mode  o:open',
          ' s:stage  d:discard  r:refresh',
        ];
      } else if (node && isHunkNode(node)) {
        return [
          ' ↑↓:navigate  Enter:toggle  Tab:view-mode  o:open',
          ' s:stage-hunk  d:discard-hunk  r:refresh',
        ];
      }
      return [
        ' ↑↓:navigate  Enter:toggle  Tab:view-mode  o:open',
        ' s:stage  d:discard  r:refresh',
      ];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Action Key Handling
  // ─────────────────────────────────────────────────────────────────────────

  protected override handleActionKey(event: KeyEvent): boolean {
    const node = this.getSelectedNode();
    if (!node) return false;

    // Stage (s)
    if (event.key === 's' && !event.ctrl && !event.alt && !event.shift) {
      if (!this.staged) {
        if (isFileNode(node)) {
          this.gitCallbacks.onStageFile?.(node.artifact.filePath);
          return true;
        } else if (isHunkNode(node)) {
          this.gitCallbacks.onStageHunk?.(node.artifact.filePath, node.hunkIndex);
          return true;
        }
      }
    }

    // Unstage (u)
    if (event.key === 'u' && !event.ctrl && !event.alt && !event.shift) {
      if (this.staged) {
        if (isFileNode(node)) {
          this.gitCallbacks.onUnstageFile?.(node.artifact.filePath);
          return true;
        } else if (isHunkNode(node)) {
          this.gitCallbacks.onUnstageHunk?.(node.artifact.filePath, node.hunkIndex);
          return true;
        }
      }
    }

    // Discard (d)
    if (event.key === 'd' && !event.ctrl && !event.alt && !event.shift) {
      if (!this.staged) {
        if (isFileNode(node)) {
          this.gitCallbacks.onDiscardFile?.(node.artifact.filePath);
          return true;
        } else if (isHunkNode(node)) {
          this.gitCallbacks.onDiscardHunk?.(node.artifact.filePath, node.hunkIndex);
          return true;
        }
      }
    }

    return false;
  }

  protected override handleNodeActivation(node: ArtifactNode<GitDiffArtifact> | null): void {
    if (!node) return;

    // For line nodes, open file at that line
    if (isLineNode(node)) {
      const lineNum = node.line.newLineNum ?? node.line.oldLineNum ?? 1;
      this.callbacks.onOpenFile?.(node.artifact.filePath, lineNum);
    } else {
      // For file/hunk nodes, open the file
      this.callbacks.onOpenFile?.(node.artifact.filePath);
    }
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a git diff browser element.
 */
export function createGitDiffBrowser(
  id: string,
  title: string,
  ctx: ElementContext,
  callbacks?: GitDiffBrowserCallbacks
): GitDiffBrowser {
  return new GitDiffBrowser(id, title, ctx, callbacks);
}
