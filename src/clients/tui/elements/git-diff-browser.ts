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
import type { ArtifactNode, ArtifactAction, ContentBrowserCallbacks, SummaryItem } from '../artifacts/types.ts';
import type { GitDiffHunk, DiffLine, GitChangeType } from '../../../services/git/types.ts';
import type { LSPDiagnostic } from '../../../services/lsp/client.ts';
import { TIMEOUTS } from '../../../constants.ts';
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
 * Provider interface for getting LSP diagnostics for files.
 */
export interface DiagnosticsProvider {
  /**
   * Get diagnostics for a file.
   * @param uri File URI (e.g., file:///path/to/file.ts)
   * @returns Array of diagnostics for the file
   */
  getDiagnostics(uri: string): LSPDiagnostic[];
}

/**
 * Diagnostic severity levels (from LSP spec).
 */
export const DiagnosticSeverity = {
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4,
} as const;

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

/**
 * Diff view mode for rendering.
 */
export type DiffViewMode = 'unified' | 'side-by-side';

// ============================================
// Git Diff Browser
// ============================================

export class GitDiffBrowser extends ContentBrowser<GitDiffArtifact> {
  /** Whether showing staged or unstaged diffs */
  private staged = false;

  /** Diff view mode (unified or side-by-side) */
  private diffViewMode: DiffViewMode = 'unified';

  /** Whether auto-refresh is enabled */
  private autoRefresh = true;

  /** Debounce timer for refresh */
  private refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Whether this is a historical diff (commit diff vs working tree) */
  private isHistoricalDiff = false;

  /** Diagnostics provider for LSP integration */
  private diagnosticsProvider: DiagnosticsProvider | null = null;

  /** Whether to show diagnostics on added lines */
  private showDiagnostics = true;

  /** Cached diagnostics per file path */
  private diagnosticsCache = new Map<string, LSPDiagnostic[]>();

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

    // Read settings
    this.autoRefresh = this.ctx.getSetting('tui.diffViewer.autoRefresh', true);
    this.showDiagnostics = this.ctx.getSetting('tui.diffViewer.showDiagnostics', true);
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
   * Set diff view mode.
   */
  setDiffViewMode(mode: DiffViewMode): void {
    if (this.diffViewMode !== mode) {
      this.diffViewMode = mode;
      this.ctx.markDirty();
    }
  }

  /**
   * Get diff view mode.
   */
  getDiffViewMode(): DiffViewMode {
    return this.diffViewMode;
  }

  /**
   * Toggle between unified and side-by-side view.
   */
  toggleDiffViewMode(): void {
    this.setDiffViewMode(this.diffViewMode === 'unified' ? 'side-by-side' : 'unified');
  }

  /**
   * Set git-specific callbacks.
   */
  setGitCallbacks(callbacks: GitDiffBrowserCallbacks): void {
    this.gitCallbacks = { ...this.gitCallbacks, ...callbacks };
    this.setCallbacks(callbacks);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Auto-Refresh
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set whether this is a historical (commit) diff.
   * Historical diffs don't auto-refresh since commits are immutable.
   */
  setHistoricalDiff(isHistorical: boolean): void {
    this.isHistoricalDiff = isHistorical;
  }

  /**
   * Get whether this is a historical diff.
   */
  isHistorical(): boolean {
    return this.isHistoricalDiff;
  }

  /**
   * Set whether auto-refresh is enabled.
   */
  setAutoRefresh(enabled: boolean): void {
    this.autoRefresh = enabled;
  }

  /**
   * Get whether auto-refresh is enabled.
   */
  isAutoRefreshEnabled(): boolean {
    return this.autoRefresh && !this.isHistoricalDiff;
  }

  /**
   * Notify that a git change occurred.
   * If auto-refresh is enabled, schedules a debounced refresh.
   * @param changeType The type of git change that occurred
   */
  notifyGitChange(changeType: GitChangeType): void {
    // Only refresh for status changes on non-historical diffs
    if (!this.isAutoRefreshEnabled()) {
      return;
    }

    // Only respond to status changes (file modifications)
    if (changeType !== 'status') {
      return;
    }

    // Debounce the refresh
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
    }

    this.refreshDebounceTimer = setTimeout(() => {
      this.refreshDebounceTimer = null;
      this.callbacks.onRefresh?.();
    }, TIMEOUTS.FILE_WATCH_DEBOUNCE);
  }

  /**
   * Clean up timers when disposing.
   */
  override dispose(): void {
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
      this.refreshDebounceTimer = null;
    }
    super.dispose();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Diagnostics
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set the diagnostics provider for LSP integration.
   * @param provider The diagnostics provider, or null to disable
   */
  setDiagnosticsProvider(provider: DiagnosticsProvider | null): void {
    this.diagnosticsProvider = provider;
    this.refreshDiagnosticsCache();
    this.ctx.markDirty();
  }

  /**
   * Set whether to show diagnostics on added lines.
   */
  setShowDiagnostics(show: boolean): void {
    if (this.showDiagnostics !== show) {
      this.showDiagnostics = show;
      this.ctx.markDirty();
    }
  }

  /**
   * Get whether diagnostics are shown.
   */
  isShowingDiagnostics(): boolean {
    return this.showDiagnostics && this.diagnosticsProvider !== null;
  }

  /**
   * Refresh the diagnostics cache for all files in the diff.
   */
  refreshDiagnosticsCache(): void {
    this.diagnosticsCache.clear();

    if (!this.diagnosticsProvider || !this.showDiagnostics) {
      return;
    }

    // Get diagnostics for each file in the diff
    const artifacts = this.getArtifacts();
    for (const artifact of artifacts) {
      const uri = `file://${artifact.filePath}`;
      const diagnostics = this.diagnosticsProvider.getDiagnostics(uri);
      if (diagnostics.length > 0) {
        this.diagnosticsCache.set(artifact.filePath, diagnostics);
      }
    }
  }

  /**
   * Get diagnostics for a specific line in a file.
   * Only returns diagnostics for added lines (new code).
   * @param filePath File path
   * @param lineNum Line number in the new file (1-based)
   * @returns Array of diagnostics on this line
   */
  private getDiagnosticsForLine(filePath: string, lineNum: number): LSPDiagnostic[] {
    if (!this.showDiagnostics || !this.diagnosticsProvider) {
      return [];
    }

    const diagnostics = this.diagnosticsCache.get(filePath);
    if (!diagnostics) {
      return [];
    }

    // Filter diagnostics that include this line (LSP lines are 0-based)
    return diagnostics.filter((d) => {
      const startLine = d.range.start.line + 1; // Convert to 1-based
      const endLine = d.range.end.line + 1;
      return lineNum >= startLine && lineNum <= endLine;
    });
  }

  /**
   * Get the highest severity diagnostic for a line.
   * @returns Severity (1=Error, 2=Warning, 3=Info, 4=Hint) or null if none
   */
  private getHighestSeverityForLine(filePath: string, lineNum: number): number | null {
    const diagnostics = this.getDiagnosticsForLine(filePath, lineNum);
    if (diagnostics.length === 0) {
      return null;
    }

    // Lower number = higher severity (Error=1 is highest)
    let highest = Infinity;
    for (const d of diagnostics) {
      const severity = d.severity ?? DiagnosticSeverity.Error;
      if (severity < highest) {
        highest = severity;
      }
    }
    return highest === Infinity ? null : highest;
  }

  /**
   * Get the icon and color for a diagnostic severity.
   */
  private getDiagnosticIconAndColor(severity: number): { icon: string; color: string } {
    switch (severity) {
      case DiagnosticSeverity.Error:
        return {
          icon: '●',
          color: this.ctx.getThemeColor('editorError.foreground', '#f14c4c'),
        };
      case DiagnosticSeverity.Warning:
        return {
          icon: '●',
          color: this.ctx.getThemeColor('editorWarning.foreground', '#cca700'),
        };
      case DiagnosticSeverity.Information:
        return {
          icon: '●',
          color: this.ctx.getThemeColor('editorInfo.foreground', '#3794ff'),
        };
      case DiagnosticSeverity.Hint:
        return {
          icon: '○',
          color: this.ctx.getThemeColor('editorHint.foreground', '#75beff'),
        };
      default:
        return {
          icon: '●',
          color: this.ctx.getThemeColor('editorError.foreground', '#f14c4c'),
        };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Build summary showing file count and total additions/deletions.
   */
  protected override buildSummary(): SummaryItem[] {
    const artifacts = this.getArtifacts();
    if (artifacts.length === 0) {
      return [];
    }

    let totalAdditions = 0;
    let totalDeletions = 0;

    for (const artifact of artifacts) {
      totalAdditions += artifact.additions;
      totalDeletions += artifact.deletions;
    }

    const addedFg = this.ctx.getThemeColor('gitDecoration.addedResourceForeground', '#81b88b');
    const deletedFg = this.ctx.getThemeColor('gitDecoration.deletedResourceForeground', '#c74e39');

    return [
      { label: 'Files', value: artifacts.length },
      { label: '+', value: totalAdditions, color: addedFg },
      { label: '-', value: totalDeletions, color: deletedFg },
    ];
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
    if (this.diffViewMode === 'side-by-side') {
      this.renderLineNodeSideBySide(buffer, node, x, y, width, isSelected, colors);
      return;
    }

    // Unified view rendering
    const line = node.line;
    const prefix = line.type === 'added' ? '+' : line.type === 'deleted' ? '-' : ' ';

    // Check for diagnostics on added lines
    let diagnosticIcon = ' ';
    let diagnosticColor = colors.fg;
    if (line.type === 'added' && line.newLineNum !== undefined) {
      const severity = this.getHighestSeverityForLine(node.artifact.filePath, line.newLineNum);
      if (severity !== null) {
        const { icon, color } = this.getDiagnosticIconAndColor(severity);
        diagnosticIcon = icon;
        diagnosticColor = color;
      }
    }

    // Layout: "D     1234 5678 +content" where D is diagnostic icon
    const indent = '     '; // 5 spaces (1 for diagnostic icon)
    const oldNum = line.oldLineNum?.toString().padStart(4, ' ') ?? '    ';
    const newNum = line.newLineNum?.toString().padStart(4, ' ') ?? '    ';

    // Build line: " D    1234 5678 +content"
    let displayLine = ` ${diagnosticIcon}${indent}${oldNum} ${newNum} ${prefix}${line.content}`;

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

    // Write the line
    buffer.writeString(x, y, displayLine, lineFg, lineBg);

    // Overwrite the diagnostic icon with its specific color
    if (diagnosticIcon !== ' ') {
      buffer.set(x + 1, y, { char: diagnosticIcon, fg: diagnosticColor, bg: lineBg });
    }
  }

  /**
   * Render a line node in side-by-side mode.
   * Layout: │ lineNum │ old content │ lineNum │ new content │
   */
  private renderLineNodeSideBySide(
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
    const line = node.line;
    const indent = '      '; // Match hunk node indent

    // Calculate panel widths (50/50 split after indent)
    const contentWidth = width - indent.length;
    const halfWidth = Math.floor(contentWidth / 2);
    const leftWidth = halfWidth;
    const rightWidth = contentWidth - halfWidth;

    // Line number widths
    const numWidth = 4;
    const leftContentWidth = leftWidth - numWidth - 2; // -2 for separator
    const rightContentWidth = rightWidth - numWidth - 1;

    // Get background colors
    const insertedBg = this.ctx.getThemeColor('diffEditor.insertedLineBackground', '#1e3a21');
    const removedBg = this.ctx.getThemeColor('diffEditor.removedLineBackground', '#3a1e1e');
    const dividerFg = '#555555';

    // Write indent
    buffer.writeString(x, y, indent, colors.fg, colors.rowBg);
    let col = x + indent.length;

    // Determine what to show on each side
    if (line.type === 'context') {
      // Context: show on both sides
      const lineNum = (line.oldLineNum ?? line.newLineNum)?.toString().padStart(numWidth, ' ') ?? '    ';
      const content = line.content;

      // Left side
      const leftContent = content.length > leftContentWidth
        ? content.slice(0, leftContentWidth - 1) + '…'
        : content.padEnd(leftContentWidth, ' ');
      const leftFg = isSelected && this.focused ? colors.selectedFg : colors.fg;
      const leftBg = isSelected ? colors.rowBg : colors.rowBg;

      buffer.writeString(col, y, lineNum, leftFg, leftBg);
      col += numWidth;
      buffer.writeString(col, y, ' ', leftFg, leftBg);
      col++;
      buffer.writeString(col, y, leftContent, leftFg, leftBg);
      col += leftContentWidth;

      // Divider
      buffer.writeString(col, y, '│', dividerFg, colors.rowBg);
      col++;

      // Right side
      const rightContent = content.length > rightContentWidth
        ? content.slice(0, rightContentWidth - 1) + '…'
        : content.padEnd(rightContentWidth, ' ');

      buffer.writeString(col, y, lineNum, leftFg, leftBg);
      col += numWidth;
      buffer.writeString(col, y, ' ', leftFg, leftBg);
      col++;
      buffer.writeString(col, y, rightContent, leftFg, leftBg);

    } else if (line.type === 'deleted') {
      // Deleted: show on left side only, right side empty
      const lineNum = line.oldLineNum?.toString().padStart(numWidth, ' ') ?? '    ';
      const content = line.content;

      // Left side (deleted)
      const leftContent = content.length > leftContentWidth
        ? content.slice(0, leftContentWidth - 1) + '…'
        : content.padEnd(leftContentWidth, ' ');
      const leftFg = isSelected && this.focused ? colors.selectedFg : colors.deletedFg;
      const leftBg = isSelected ? colors.rowBg : removedBg;

      buffer.writeString(col, y, lineNum, leftFg, leftBg);
      col += numWidth;
      buffer.writeString(col, y, '-', leftFg, leftBg);
      col++;
      buffer.writeString(col, y, leftContent, leftFg, leftBg);
      col += leftContentWidth;

      // Divider
      buffer.writeString(col, y, '│', dividerFg, colors.rowBg);
      col++;

      // Right side (empty)
      const emptyRight = ' '.repeat(rightWidth - 1);
      buffer.writeString(col, y, emptyRight, colors.fg, colors.rowBg);

    } else if (line.type === 'added') {
      // Added: show on right side only, left side empty
      const lineNum = line.newLineNum?.toString().padStart(numWidth, ' ') ?? '    ';
      const content = line.content;

      // Check for diagnostics on added lines
      let diagnosticIcon = ' ';
      let diagnosticColor = colors.fg;
      if (line.newLineNum !== undefined) {
        const severity = this.getHighestSeverityForLine(node.artifact.filePath, line.newLineNum);
        if (severity !== null) {
          const { icon, color } = this.getDiagnosticIconAndColor(severity);
          diagnosticIcon = icon;
          diagnosticColor = color;
        }
      }

      // Left side (empty, but reserve 1 char for diagnostic alignment)
      const emptyLeft = ' '.repeat(leftWidth);
      buffer.writeString(col, y, emptyLeft, colors.fg, colors.rowBg);
      col += leftWidth;

      // Divider
      buffer.writeString(col, y, '│', dividerFg, colors.rowBg);
      col++;

      // Right side (added) - show diagnostic icon before line number
      const rightFg = isSelected && this.focused ? colors.selectedFg : colors.addedFg;
      const rightBg = isSelected ? colors.rowBg : insertedBg;

      // Write diagnostic icon
      buffer.set(col, y, { char: diagnosticIcon, fg: diagnosticColor, bg: rightBg });
      col++;

      // Adjust content width for diagnostic icon
      const adjustedRightContentWidth = rightContentWidth - 1;
      const rightContent = content.length > adjustedRightContentWidth
        ? content.slice(0, adjustedRightContentWidth - 1) + '…'
        : content.padEnd(adjustedRightContentWidth, ' ');

      buffer.writeString(col, y, lineNum, rightFg, rightBg);
      col += numWidth;
      buffer.writeString(col, y, '+', rightFg, rightBg);
      col++;
      buffer.writeString(col, y, rightContent, rightFg, rightBg);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Keyboard Hints
  // ─────────────────────────────────────────────────────────────────────────

  protected override getKeyboardHints(): string[] {
    const node = this.getSelectedNode();
    const viewLabel = this.diffViewMode === 'unified' ? 'unified' : 'split';

    if (this.staged) {
      return [
        ` ↑↓:navigate  Enter:toggle  v:${viewLabel}  o:open`,
        ' u:unstage  p:pin  r:refresh',
      ];
    } else {
      if (node && isFileNode(node)) {
        return [
          ` ↑↓:navigate  Enter:toggle  v:${viewLabel}  o:open`,
          ' s:stage  d:discard  p:pin  r:refresh',
        ];
      } else if (node && isHunkNode(node)) {
        return [
          ` ↑↓:navigate  Enter:toggle  v:${viewLabel}  o:open`,
          ' s:stage-hunk  d:discard-hunk  p:pin  r:refresh',
        ];
      }
      return [
        ` ↑↓:navigate  Enter:toggle  v:${viewLabel}  o:open`,
        ' s:stage  d:discard  p:pin  r:refresh',
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

    // Toggle diff view mode (v)
    if (event.key === 'v' && !event.ctrl && !event.alt && !event.shift) {
      this.toggleDiffViewMode();
      return true;
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
