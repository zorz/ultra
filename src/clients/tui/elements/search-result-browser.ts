/**
 * Search Result Browser Element
 *
 * A content browser specialized for viewing and managing search results
 * with inline editing for find/replace operations.
 */

import { ContentBrowser } from './content-browser.ts';
import type { ElementContext } from './base.ts';
import type { KeyEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import type { ArtifactNode, ArtifactAction, ContentBrowserCallbacks } from '../artifacts/types.ts';
import {
  type SearchResultArtifact,
  type SearchResultFileNode,
  type SearchResultMatchNode,
  type SearchMatch,
  isSearchFileNode,
  isSearchMatchNode,
  getHighlightedSegments,
} from '../artifacts/search-result-artifact.ts';

// ============================================
// Types
// ============================================

/**
 * Callbacks for search result browser.
 */
export interface SearchResultBrowserCallbacks extends ContentBrowserCallbacks<SearchResultArtifact> {
  /** Replace a single match */
  onReplace?: (filePath: string, match: SearchMatch, replacement: string) => void;
  /** Replace all matches in a file */
  onReplaceInFile?: (filePath: string, replacement: string) => void;
  /** Replace all matches across all files */
  onReplaceAll?: (replacement: string) => void;
  /** Replacement text changed */
  onReplacementChange?: (replacement: string) => void;
}

// ============================================
// Search Result Browser
// ============================================

export class SearchResultBrowser extends ContentBrowser<SearchResultArtifact> {
  /** The search query */
  private query = '';

  /** Whether query is regex */
  private isRegex = false;

  /** Whether search is case-sensitive */
  private caseSensitive = false;

  /** Global replacement text */
  private replacementText = '';

  /** Search-specific callbacks */
  private searchCallbacks: SearchResultBrowserCallbacks;

  // Inline editing state
  private editingNodeId: string | null = null;
  private editText = '';
  private editCursor = 0;

  constructor(
    id: string,
    title: string,
    ctx: ElementContext,
    callbacks: SearchResultBrowserCallbacks = {}
  ) {
    super(id, title, ctx, callbacks);
    this.searchCallbacks = callbacks;
    this.browserTitle = 'Search Results';
    this.hintBarHeight = 2;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set search query info for display.
   */
  setQuery(query: string, isRegex = false, caseSensitive = false): void {
    this.query = query;
    this.isRegex = isRegex;
    this.caseSensitive = caseSensitive;
    this.updateBrowserSubtitle();
    this.ctx.markDirty();
  }

  /**
   * Get the search query.
   */
  getQuery(): string {
    return this.query;
  }

  /**
   * Set the global replacement text.
   */
  setReplacementText(text: string): void {
    this.replacementText = text;
    this.ctx.markDirty();
  }

  /**
   * Get the replacement text.
   */
  getReplacementText(): string {
    return this.replacementText;
  }

  /**
   * Set search-specific callbacks.
   */
  setSearchCallbacks(callbacks: SearchResultBrowserCallbacks): void {
    this.searchCallbacks = { ...this.searchCallbacks, ...callbacks };
    this.setCallbacks(callbacks);
  }

  /**
   * Update browser subtitle with query info.
   */
  private updateBrowserSubtitle(): void {
    let subtitle = `"${this.query}"`;
    const flags: string[] = [];
    if (this.isRegex) flags.push('regex');
    if (this.caseSensitive) flags.push('case-sensitive');
    if (flags.length > 0) {
      subtitle += ` (${flags.join(', ')})`;
    }
    this.setBrowserSubtitle(subtitle);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Inline Editing
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check if currently in edit mode.
   */
  isEditing(): boolean {
    return this.editingNodeId !== null;
  }

  /**
   * Start inline editing for the selected match.
   */
  startEditing(): void {
    const node = this.getSelectedNode();
    if (!node || !isSearchMatchNode(node)) return;

    this.editingNodeId = node.nodeId;
    this.editText = node.editedReplacement ?? this.replacementText;
    this.editCursor = this.editText.length;
    node.isEditing = true;
    this.ctx.markDirty();
  }

  /**
   * Stop inline editing.
   */
  stopEditing(confirm: boolean): void {
    if (!this.editingNodeId) return;

    // Find the editing node
    const node = this.flatNodes.find((n) => n.nodeId === this.editingNodeId);
    if (node && isSearchMatchNode(node)) {
      node.isEditing = false;
      if (confirm) {
        node.editedReplacement = this.editText;
        this.searchCallbacks.onReplacementChange?.(this.editText);
      }
    }

    this.editingNodeId = null;
    this.ctx.markDirty();
  }

  /**
   * Handle key input during editing.
   */
  private handleEditKey(event: KeyEvent): boolean {
    if (event.key === 'Escape') {
      this.stopEditing(false);
      return true;
    }

    if (event.key === 'Enter') {
      this.stopEditing(true);
      // Execute replace
      const node = this.getSelectedNode();
      if (node && isSearchMatchNode(node)) {
        this.searchCallbacks.onReplace?.(
          node.artifact.filePath,
          node.match,
          node.editedReplacement ?? this.replacementText
        );
      }
      return true;
    }

    if (event.key === 'Backspace') {
      if (this.editCursor > 0) {
        this.editText =
          this.editText.slice(0, this.editCursor - 1) + this.editText.slice(this.editCursor);
        this.editCursor--;
        this.ctx.markDirty();
      }
      return true;
    }

    if (event.key === 'Delete') {
      if (this.editCursor < this.editText.length) {
        this.editText =
          this.editText.slice(0, this.editCursor) + this.editText.slice(this.editCursor + 1);
        this.ctx.markDirty();
      }
      return true;
    }

    if (event.key === 'ArrowLeft') {
      if (this.editCursor > 0) {
        this.editCursor--;
        this.ctx.markDirty();
      }
      return true;
    }

    if (event.key === 'ArrowRight') {
      if (this.editCursor < this.editText.length) {
        this.editCursor++;
        this.ctx.markDirty();
      }
      return true;
    }

    if (event.key === 'Home') {
      this.editCursor = 0;
      this.ctx.markDirty();
      return true;
    }

    if (event.key === 'End') {
      this.editCursor = this.editText.length;
      this.ctx.markDirty();
      return true;
    }

    // Clear all (Ctrl+U)
    if (event.key === 'u' && event.ctrl) {
      this.editText = '';
      this.editCursor = 0;
      this.ctx.markDirty();
      return true;
    }

    // Insert printable character
    if (event.key.length === 1 && !event.ctrl && !event.alt && !event.meta) {
      this.editText =
        this.editText.slice(0, this.editCursor) + event.key + this.editText.slice(this.editCursor);
      this.editCursor++;
      this.ctx.markDirty();
      return true;
    }

    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Node Building
  // ─────────────────────────────────────────────────────────────────────────

  protected override buildNodes(
    artifacts: SearchResultArtifact[]
  ): ArtifactNode<SearchResultArtifact>[] {
    return artifacts.map((artifact) => this.buildFileNode(artifact));
  }

  private buildFileNode(artifact: SearchResultArtifact): SearchResultFileNode {
    return {
      artifact,
      nodeType: 'file',
      nodeId: `file:${artifact.filePath}`,
      depth: 0,
      expanded: true,
      children: artifact.matches.map((match, idx) => this.buildMatchNode(artifact, match, idx)),
      actions: this.getFileActions(artifact),
      selected: false,
      label: artifact.filePath.split('/').pop() ?? artifact.filePath,
      secondaryLabel: `${artifact.matches.length} matches`,
      icon: '📄',
      matchCount: artifact.matches.length,
      metadata: {
        fullPath: artifact.filePath,
      },
    };
  }

  private buildMatchNode(
    artifact: SearchResultArtifact,
    match: SearchMatch,
    matchIndex: number
  ): SearchResultMatchNode {
    return {
      artifact,
      nodeType: 'match',
      nodeId: `match:${artifact.filePath}:${match.line}:${match.column}`,
      depth: 1,
      expanded: false,
      children: [],
      match,
      matchIndex,
      isEditing: false,
      actions: this.getMatchActions(artifact, match),
      selected: false,
      label: match.lineText.trim(),
      secondaryLabel: `${match.line}:${match.column + 1}`,
      icon: '→',
      metadata: {
        line: match.line,
        column: match.column,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────────────────

  private getFileActions(artifact: SearchResultArtifact): ArtifactAction[] {
    return [
      {
        id: 'replace-in-file',
        label: 'Replace All in File',
        shortcut: 'R',
        icon: '↻',
        enabled: this.replacementText.length > 0,
        execute: () => this.searchCallbacks.onReplaceInFile?.(artifact.filePath, this.replacementText),
      },
      {
        id: 'open-file',
        label: 'Open File',
        shortcut: 'o',
        icon: '→',
        enabled: true,
        execute: () => this.callbacks.onOpenFile?.(artifact.filePath),
      },
    ];
  }

  private getMatchActions(artifact: SearchResultArtifact, match: SearchMatch): ArtifactAction[] {
    return [
      {
        id: 'replace',
        label: 'Replace',
        shortcut: 'r',
        icon: '↻',
        enabled: true,
        execute: () => this.searchCallbacks.onReplace?.(artifact.filePath, match, this.replacementText),
      },
      {
        id: 'edit-replacement',
        label: 'Edit Replacement',
        shortcut: 'e',
        icon: '✎',
        enabled: true,
        execute: () => this.startEditing(),
      },
      {
        id: 'open-at-line',
        label: 'Open at Line',
        shortcut: 'o',
        icon: '→',
        enabled: true,
        execute: () => this.callbacks.onOpenFile?.(artifact.filePath, match.line, match.column),
      },
    ];
  }

  protected override getNodeActions(node: ArtifactNode<SearchResultArtifact>): ArtifactAction[] {
    return node.actions;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  protected override renderNode(
    buffer: ScreenBuffer,
    node: ArtifactNode<SearchResultArtifact>,
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
    const matchHighlight = this.ctx.getThemeColor('editor.findMatchHighlightBackground', '#ea5c0055');
    const matchFg = this.ctx.getThemeColor('editor.findMatchForeground', '#ffcc00');
    const dimFg = '#888888';

    // Background for this row
    const rowBg = isSelected ? selectedBg : bg;
    buffer.writeString(x, y, ' '.repeat(width), fg, rowBg);

    if (isSearchFileNode(node)) {
      this.renderFileNode(buffer, node, x, y, width, isSelected, {
        selectedFg,
        fg,
        dimFg,
        rowBg,
      });
    } else if (isSearchMatchNode(node)) {
      this.renderMatchNode(buffer, node, x, y, width, isSelected, {
        selectedFg,
        fg,
        dimFg,
        matchHighlight,
        matchFg,
        rowBg,
      });
    }
  }

  private renderFileNode(
    buffer: ScreenBuffer,
    node: SearchResultFileNode,
    x: number,
    y: number,
    width: number,
    isSelected: boolean,
    colors: {
      selectedFg: string;
      fg: string;
      dimFg: string;
      rowBg: string;
    }
  ): void {
    const indent = '  ';
    const collapsed = this.collapsedNodeIds.has(node.nodeId);
    const expander = node.children.length > 0 ? (collapsed ? '▶' : '▼') : ' ';

    // Build line: "  ▼ 📄 filename.ts  5 matches"
    let line = `${indent}${expander} ${node.label}`;
    const stats = ` ${node.matchCount} matches`;

    if (line.length + stats.length > width) {
      line = line.slice(0, width - stats.length - 1) + '…';
    }

    const padding = width - line.length - stats.length;
    if (padding > 0) {
      line += ' '.repeat(padding);
    }
    line += stats;

    const lineFg = isSelected && this.focused ? colors.selectedFg : colors.fg;
    buffer.writeString(x, y, line.slice(0, width), lineFg, colors.rowBg);

    // Stats in dim color if not selected
    if (!isSelected || !this.focused) {
      const statsX = x + width - stats.length;
      buffer.writeString(statsX, y, stats, colors.dimFg, colors.rowBg);
    }
  }

  private renderMatchNode(
    buffer: ScreenBuffer,
    node: SearchResultMatchNode,
    x: number,
    y: number,
    width: number,
    isSelected: boolean,
    colors: {
      selectedFg: string;
      fg: string;
      dimFg: string;
      matchHighlight: string;
      matchFg: string;
      rowBg: string;
    }
  ): void {
    const indent = '    ';
    const match = node.match;

    // Check if this node is being edited
    if (node.isEditing) {
      this.renderEditingNode(buffer, node, x, y, width, colors);
      return;
    }

    // Line number prefix
    const lineNum = `${match.line}:`.padStart(6, ' ');

    // Get highlighted segments
    const segments = getHighlightedSegments(match);

    // Build line with highlighting info
    let line = `${indent}${lineNum} `;
    const contentStart = indent.length + lineNum.length + 1;
    const availableWidth = width - contentStart;

    // Trim line text if needed
    let displayText = match.lineText.trim();
    if (displayText.length > availableWidth) {
      displayText = displayText.slice(0, availableWidth - 1) + '…';
    }

    line += displayText;
    line = line.padEnd(width, ' ').slice(0, width);

    // Write base line
    const lineFg = isSelected && this.focused ? colors.selectedFg : colors.fg;
    buffer.writeString(x, y, line, lineFg, colors.rowBg);

    // Highlight match text (only if not selected to avoid color clash)
    if (!isSelected || !this.focused) {
      // Calculate where match appears in trimmed text
      const trimOffset = match.lineText.length - match.lineText.trimStart().length;
      const highlightStart = x + contentStart + match.column - trimOffset;
      const highlightEnd = Math.min(highlightStart + match.length, x + width);

      if (highlightStart >= x + contentStart && highlightStart < x + width) {
        for (let col = highlightStart; col < highlightEnd; col++) {
          const cell = buffer.get(col, y);
          if (cell) {
            buffer.set(col, y, {
              ...cell,
              fg: colors.matchFg,
              bold: true,
            });
          }
        }
      }
    }
  }

  private renderEditingNode(
    buffer: ScreenBuffer,
    node: SearchResultMatchNode,
    x: number,
    y: number,
    width: number,
    colors: {
      selectedFg: string;
      fg: string;
      dimFg: string;
      matchHighlight: string;
      matchFg: string;
      rowBg: string;
    }
  ): void {
    const editBg = this.ctx.getThemeColor('input.background', '#3c3c3c');
    const editFg = this.ctx.getThemeColor('input.foreground', '#cccccc');
    const editBorder = this.ctx.getThemeColor('input.border', '#007acc');

    // Draw edit box
    const indent = '    ';
    const label = 'Replace: ';
    const labelWidth = indent.length + label.length;
    const inputWidth = width - labelWidth - 2; // -2 for borders

    // Label
    buffer.writeString(x, y, `${indent}${label}`, colors.fg, colors.rowBg);

    // Input field background
    const inputX = x + labelWidth;
    buffer.writeString(inputX, y, ' '.repeat(inputWidth + 2), editFg, editBg);

    // Input text (with cursor)
    let displayText = this.editText;
    let cursorOffset = this.editCursor;

    // Scroll if text is too long
    if (displayText.length > inputWidth - 1) {
      const scrollOffset = Math.max(0, this.editCursor - inputWidth + 2);
      displayText = displayText.slice(scrollOffset);
      cursorOffset = this.editCursor - scrollOffset;
    }

    buffer.writeString(inputX + 1, y, displayText.slice(0, inputWidth - 1), editFg, editBg);

    // Draw cursor
    if (cursorOffset <= inputWidth - 1) {
      const cursorX = inputX + 1 + cursorOffset;
      const cursorChar = cursorOffset < displayText.length ? displayText[cursorOffset] : ' ';
      buffer.writeString(cursorX, y, cursorChar ?? ' ', editBg, editFg);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Keyboard Hints
  // ─────────────────────────────────────────────────────────────────────────

  protected override getKeyboardHints(): string[] {
    if (this.isEditing()) {
      return [
        ' Enter:confirm  Esc:cancel  ←→:move cursor',
        ' Ctrl+U:clear  Backspace:delete',
      ];
    }

    const node = this.getSelectedNode();

    if (node && isSearchMatchNode(node)) {
      return [
        ' ↑↓:navigate  Enter:open  Tab:view-mode  o:open',
        ' r:replace  e:edit  R:replace-in-file  A:replace-all',
      ];
    }

    return [
      ' ↑↓:navigate  Enter:toggle  Tab:view-mode  o:open',
      ' R:replace-in-file  A:replace-all  r:refresh',
    ];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  override handleKey(event: KeyEvent): boolean {
    // Handle editing mode first
    if (this.isEditing()) {
      return this.handleEditKey(event);
    }

    // Regular key handling
    return super.handleKey(event);
  }

  protected override handleActionKey(event: KeyEvent): boolean {
    const node = this.getSelectedNode();
    if (!node) return false;

    // Replace single match (r)
    if (event.key === 'r' && !event.ctrl && !event.alt && !event.shift) {
      if (isSearchMatchNode(node)) {
        this.searchCallbacks.onReplace?.(
          node.artifact.filePath,
          node.match,
          node.editedReplacement ?? this.replacementText
        );
        return true;
      }
    }

    // Replace all in file (R)
    if (event.key === 'R' || (event.key === 'r' && event.shift)) {
      if (isSearchFileNode(node)) {
        this.searchCallbacks.onReplaceInFile?.(node.artifact.filePath, this.replacementText);
        return true;
      } else if (isSearchMatchNode(node)) {
        this.searchCallbacks.onReplaceInFile?.(node.artifact.filePath, this.replacementText);
        return true;
      }
    }

    // Replace all (A)
    if (event.key === 'A' || (event.key === 'a' && event.shift)) {
      this.searchCallbacks.onReplaceAll?.(this.replacementText);
      return true;
    }

    // Edit replacement (e)
    if (event.key === 'e' && !event.ctrl && !event.alt && !event.shift) {
      if (isSearchMatchNode(node)) {
        this.startEditing();
        return true;
      }
    }

    return false;
  }

  protected override handleNodeActivation(node: ArtifactNode<SearchResultArtifact> | null): void {
    if (!node) return;

    // For match nodes, open file at that line
    if (isSearchMatchNode(node)) {
      this.callbacks.onOpenFile?.(node.artifact.filePath, node.match.line, node.match.column);
    } else {
      // For file nodes, open the file
      this.callbacks.onOpenFile?.(node.artifact.filePath);
    }
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a search result browser element.
 */
export function createSearchResultBrowser(
  id: string,
  title: string,
  ctx: ElementContext,
  callbacks?: SearchResultBrowserCallbacks
): SearchResultBrowser {
  return new SearchResultBrowser(id, title, ctx, callbacks);
}
