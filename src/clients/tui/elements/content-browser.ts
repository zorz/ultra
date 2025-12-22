/**
 * Content Browser Element
 *
 * Abstract base class for browsing structured content like git diffs,
 * search results, diagnostics, etc. Supports tree and flat view modes,
 * keyboard navigation, and per-node actions.
 */

import { BaseElement, type ElementContext } from './base.ts';
import type { KeyEvent, MouseEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import type {
  Artifact,
  ArtifactNode,
  ArtifactAction,
  ViewMode,
  ContentBrowserCallbacks,
  ContentBrowserState,
} from '../artifacts/types.ts';

// ============================================
// Content Browser Base Class
// ============================================

/**
 * Abstract base class for content browsers.
 *
 * Provides:
 * - Tree/flat view modes with expand/collapse
 * - Keyboard and mouse navigation
 * - Scrollbar rendering
 * - Keyboard hints bar
 * - State serialization
 *
 * Subclasses implement:
 * - buildNodes() - convert artifacts to tree structure
 * - renderNode() - render individual nodes
 * - getNodeActions() - get available actions per node
 */
export abstract class ContentBrowser<T extends Artifact = Artifact> extends BaseElement {
  // ─────────────────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────────────────

  /** Root nodes (tree structure) */
  protected rootNodes: ArtifactNode<T>[] = [];

  /** Flattened nodes for display (respects collapsed state) */
  protected flatNodes: ArtifactNode<T>[] = [];

  /** Currently selected index in flatNodes */
  protected selectedIndex = 0;

  /** Scroll offset */
  protected scrollTop = 0;

  /** View mode */
  protected viewMode: ViewMode = 'tree';

  /** IDs of collapsed nodes */
  protected collapsedNodeIds = new Set<string>();

  /** Callbacks */
  protected callbacks: ContentBrowserCallbacks<T>;

  /** Title shown in tab */
  protected browserTitle = '';

  /** Subtitle/status shown in header */
  protected browserSubtitle = '';

  /** Whether to show the header row */
  protected showHeader = true;

  /** Height of the hints bar when focused (0 to disable) */
  protected hintBarHeight = 2;

  // Mouse state
  private lastClickTime = 0;
  private lastClickIndex = -1;
  private scrollbarDragging = false;

  // ─────────────────────────────────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────────────────────────────────

  constructor(
    id: string,
    title: string,
    ctx: ElementContext,
    callbacks: ContentBrowserCallbacks<T> = {}
  ) {
    super('ContentBrowser', id, title, ctx);
    this.callbacks = callbacks;
    this.browserTitle = title;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Abstract Methods (implemented by subclasses)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Build tree structure from artifacts.
   * Called when setArtifacts() is invoked.
   */
  protected abstract buildNodes(artifacts: T[]): ArtifactNode<T>[];

  /**
   * Render a single node to the buffer.
   *
   * @param buffer Screen buffer to render to
   * @param node The node to render
   * @param x Left edge x coordinate
   * @param y Y coordinate (row)
   * @param width Available width
   * @param isSelected Whether this node is selected
   */
  protected abstract renderNode(
    buffer: ScreenBuffer,
    node: ArtifactNode<T>,
    x: number,
    y: number,
    width: number,
    isSelected: boolean
  ): void;

  /**
   * Get actions available for a node.
   * Used for keyboard hints and action execution.
   */
  protected abstract getNodeActions(node: ArtifactNode<T>): ArtifactAction[];

  /**
   * Get keyboard hints to display.
   * Returns array of lines to render in the hints bar.
   */
  protected getKeyboardHints(): string[] {
    return [' ↑↓:navigate  Enter:toggle/action  Tab:view-mode'];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set artifacts to display.
   */
  setArtifacts(artifacts: T[]): void {
    this.rootNodes = this.buildNodes(artifacts);
    this.rebuildFlatView();
    this.ctx.markDirty();
  }

  /**
   * Get currently displayed artifacts (from root nodes).
   */
  getArtifacts(): T[] {
    const seen = new Set<string>();
    const artifacts: T[] = [];

    const collect = (nodes: ArtifactNode<T>[]) => {
      for (const node of nodes) {
        if (!seen.has(node.artifact.id)) {
          seen.add(node.artifact.id);
          artifacts.push(node.artifact);
        }
        collect(node.children);
      }
    };

    collect(this.rootNodes);
    return artifacts;
  }

  /**
   * Set callbacks after construction.
   */
  setCallbacks(callbacks: ContentBrowserCallbacks<T>): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Get current callbacks.
   */
  getCallbacks(): ContentBrowserCallbacks<T> {
    return this.callbacks;
  }

  /**
   * Set view mode.
   */
  setViewMode(mode: ViewMode): void {
    if (this.viewMode !== mode) {
      this.viewMode = mode;
      this.rebuildFlatView();
      this.ctx.markDirty();
    }
  }

  /**
   * Get current view mode.
   */
  getViewMode(): ViewMode {
    return this.viewMode;
  }

  /**
   * Toggle view mode between tree and flat.
   */
  toggleViewMode(): void {
    this.setViewMode(this.viewMode === 'tree' ? 'flat' : 'tree');
  }

  /**
   * Set browser title (shown in header).
   */
  setBrowserTitle(title: string): void {
    this.browserTitle = title;
    this.ctx.markDirty();
  }

  /**
   * Set browser subtitle (shown in header).
   */
  setBrowserSubtitle(subtitle: string): void {
    this.browserSubtitle = subtitle;
    this.ctx.markDirty();
  }

  /**
   * Get the currently selected node.
   */
  getSelectedNode(): ArtifactNode<T> | null {
    return this.flatNodes[this.selectedIndex] ?? null;
  }

  /**
   * Get the total number of visible nodes.
   */
  getNodeCount(): number {
    return this.flatNodes.length;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // View Building
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Rebuild flattened view based on collapsed state.
   */
  protected rebuildFlatView(): void {
    this.flatNodes = [];

    if (this.viewMode === 'tree') {
      this.flattenTree(this.rootNodes, 0);
    } else {
      // Flat mode: show only leaf nodes
      this.collectLeaves(this.rootNodes);
    }

    // Clamp selection
    if (this.selectedIndex >= this.flatNodes.length) {
      this.selectedIndex = Math.max(0, this.flatNodes.length - 1);
    }

    // Notify selection change
    this.callbacks.onSelectionChange?.(this.getSelectedNode());
  }

  /**
   * Flatten tree structure respecting collapsed nodes.
   */
  private flattenTree(nodes: ArtifactNode<T>[], depth: number): void {
    for (const node of nodes) {
      node.depth = depth;
      this.flatNodes.push(node);

      // Recurse into children if not collapsed
      if (!this.collapsedNodeIds.has(node.nodeId) && node.children.length > 0) {
        this.flattenTree(node.children, depth + 1);
      }
    }
  }

  /**
   * Collect leaf nodes (nodes without children).
   */
  private collectLeaves(nodes: ArtifactNode<T>[]): void {
    for (const node of nodes) {
      if (node.children.length === 0) {
        node.depth = 0; // Reset depth for flat view
        this.flatNodes.push(node);
      } else {
        this.collectLeaves(node.children);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Navigation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Move selection up.
   */
  moveUp(count = 1): void {
    const newIndex = Math.max(0, this.selectedIndex - count);
    if (newIndex !== this.selectedIndex) {
      this.selectedIndex = newIndex;
      this.ensureVisible();
      this.callbacks.onSelectionChange?.(this.getSelectedNode());
      this.ctx.markDirty();
    }
  }

  /**
   * Move selection down.
   */
  moveDown(count = 1): void {
    const newIndex = Math.min(this.flatNodes.length - 1, this.selectedIndex + count);
    if (newIndex !== this.selectedIndex) {
      this.selectedIndex = newIndex;
      this.ensureVisible();
      this.callbacks.onSelectionChange?.(this.getSelectedNode());
      this.ctx.markDirty();
    }
  }

  /**
   * Move to first item.
   */
  moveToFirst(): void {
    if (this.flatNodes.length > 0 && this.selectedIndex !== 0) {
      this.selectedIndex = 0;
      this.ensureVisible();
      this.callbacks.onSelectionChange?.(this.getSelectedNode());
      this.ctx.markDirty();
    }
  }

  /**
   * Move to last item.
   */
  moveToLast(): void {
    const lastIndex = this.flatNodes.length - 1;
    if (lastIndex >= 0 && this.selectedIndex !== lastIndex) {
      this.selectedIndex = lastIndex;
      this.ensureVisible();
      this.callbacks.onSelectionChange?.(this.getSelectedNode());
      this.ctx.markDirty();
    }
  }

  /**
   * Page up.
   */
  pageUp(): void {
    const pageSize = this.getContentHeight();
    this.moveUp(pageSize);
  }

  /**
   * Page down.
   */
  pageDown(): void {
    const pageSize = this.getContentHeight();
    this.moveDown(pageSize);
  }

  /**
   * Toggle expand/collapse for current node.
   */
  toggleExpand(): void {
    const node = this.getSelectedNode();
    if (!node || node.children.length === 0) return;

    if (this.collapsedNodeIds.has(node.nodeId)) {
      this.collapsedNodeIds.delete(node.nodeId);
    } else {
      this.collapsedNodeIds.add(node.nodeId);
    }

    this.rebuildFlatView();
    this.ctx.markDirty();
  }

  /**
   * Expand all nodes.
   */
  expandAll(): void {
    this.collapsedNodeIds.clear();
    this.rebuildFlatView();
    this.ctx.markDirty();
  }

  /**
   * Collapse all nodes.
   */
  collapseAll(): void {
    const collectIds = (nodes: ArtifactNode<T>[]) => {
      for (const node of nodes) {
        if (node.children.length > 0) {
          this.collapsedNodeIds.add(node.nodeId);
        }
        collectIds(node.children);
      }
    };
    collectIds(this.rootNodes);
    this.rebuildFlatView();
    this.ctx.markDirty();
  }

  /**
   * Execute an action by ID on the selected node.
   */
  executeAction(actionId: string): boolean {
    const node = this.getSelectedNode();
    if (!node) return false;

    const actions = this.getNodeActions(node);
    const action = actions.find((a) => a.id === actionId);

    if (action?.enabled) {
      action.execute();
      this.callbacks.onAction?.(node.artifact, action, node);
      return true;
    }

    return false;
  }

  /**
   * Ensure selected item is visible.
   */
  protected ensureVisible(): void {
    const contentHeight = this.getContentHeight();
    if (contentHeight <= 0) return;

    if (this.selectedIndex < this.scrollTop) {
      this.scrollTop = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollTop + contentHeight) {
      this.scrollTop = this.selectedIndex - contentHeight + 1;
    }
  }

  /**
   * Get content height (excluding header and hints bar).
   */
  protected getContentHeight(): number {
    const headerHeight = this.showHeader ? 1 : 0;
    const hintsHeight = this.focused ? this.hintBarHeight : 0;
    return Math.max(0, this.bounds.height - headerHeight - hintsHeight);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  override render(buffer: ScreenBuffer): void {
    const { x, y, width, height } = this.bounds;
    if (height === 0 || width === 0) return;

    // Colors
    const bg = this.ctx.getBackgroundForFocus('sidebar', this.focused);
    const fg = this.ctx.getForegroundForFocus('sidebar', this.focused);
    const headerBg = this.ctx.getThemeColor('sideBarSectionHeader.background', '#383838');
    const headerFg = this.ctx.getThemeColor('sideBarSectionHeader.foreground', '#cccccc');

    // Clear background
    for (let row = 0; row < height; row++) {
      buffer.writeString(x, y + row, ' '.repeat(width), fg, bg);
    }

    let currentY = y;

    // Render header
    if (this.showHeader) {
      let headerText = ` ${this.browserTitle}`;
      if (this.browserSubtitle) {
        headerText += ` - ${this.browserSubtitle}`;
      }
      // Add view mode indicator
      headerText += ` [${this.viewMode}]`;

      if (headerText.length > width) {
        headerText = headerText.slice(0, width - 1) + '…';
      }
      buffer.writeString(x, currentY, headerText.padEnd(width, ' '), headerFg, headerBg);
      currentY++;
    }

    // Calculate content area
    const contentHeight = this.getContentHeight();
    const contentStartY = currentY;

    // Render nodes
    const scrollbarWidth = this.needsScrollbar() ? 1 : 0;
    const nodeWidth = width - scrollbarWidth;

    for (let row = 0; row < contentHeight; row++) {
      const viewIdx = this.scrollTop + row;
      if (viewIdx >= this.flatNodes.length) break;

      const node = this.flatNodes[viewIdx]!;
      const screenY = contentStartY + row;
      const isSelected = viewIdx === this.selectedIndex;

      this.renderNode(buffer, node, x, screenY, nodeWidth, isSelected);
    }

    // Empty state
    if (this.flatNodes.length === 0) {
      const msg = 'No items';
      const msgX = x + Math.floor((width - msg.length) / 2);
      buffer.writeString(msgX, contentStartY + 2, msg, '#888888', bg);
    }

    // Render scrollbar
    if (this.needsScrollbar()) {
      this.renderScrollbar(buffer, x + width - 1, contentStartY, contentHeight);
    }

    // Render hints bar
    if (this.focused && this.hintBarHeight > 0) {
      this.renderHintsBar(buffer, x, contentStartY + contentHeight, width);
    }
  }

  /**
   * Check if scrollbar is needed.
   */
  protected needsScrollbar(): boolean {
    return this.flatNodes.length > this.getContentHeight();
  }

  /**
   * Render scrollbar.
   */
  protected renderScrollbar(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    height: number
  ): void {
    const totalNodes = this.flatNodes.length;
    if (totalNodes <= height || height <= 0) return;

    const trackBg = this.ctx.getThemeColor('scrollbar.shadow', '#333333');
    const thumbBg = this.ctx.getThemeColor('scrollbarSlider.background', '#79797966');
    const thumbHoverBg = this.ctx.getThemeColor('scrollbarSlider.hoverBackground', '#797979b3');

    // Draw track
    for (let row = 0; row < height; row++) {
      buffer.writeString(x, y + row, ' ', trackBg, trackBg);
    }

    // Calculate thumb size and position
    const thumbHeight = Math.max(1, Math.floor((height * height) / totalNodes));
    const scrollRange = totalNodes - height;
    const thumbRange = height - thumbHeight;
    const thumbTop = Math.floor((this.scrollTop / scrollRange) * thumbRange);

    // Draw thumb
    const thumbColor = this.scrollbarDragging ? thumbHoverBg : thumbBg;
    for (let row = 0; row < thumbHeight; row++) {
      buffer.writeString(x, y + thumbTop + row, '▐', thumbColor, trackBg);
    }
  }

  /**
   * Render keyboard hints bar.
   */
  protected renderHintsBar(buffer: ScreenBuffer, x: number, y: number, width: number): void {
    const hintBg = this.ctx.getThemeColor('statusBar.background', '#007acc');
    const hintFg = this.ctx.getThemeColor('statusBar.foreground', '#ffffff');

    const hints = this.getKeyboardHints();

    for (let i = 0; i < this.hintBarHeight && i < hints.length; i++) {
      let line = hints[i] ?? '';
      if (line.length > width) {
        line = line.slice(0, width);
      }
      line = line.padEnd(width, ' ').slice(0, width);
      buffer.writeString(x, y + i, line, hintFg, hintBg);
    }

    // Fill remaining hint bar rows if needed
    for (let i = hints.length; i < this.hintBarHeight; i++) {
      buffer.writeString(x, y + i, ' '.repeat(width), hintFg, hintBg);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  override handleKey(event: KeyEvent): boolean {
    // Navigation
    if (event.key === 'ArrowUp' || event.key === 'k') {
      this.moveUp();
      return true;
    }
    if (event.key === 'ArrowDown' || event.key === 'j') {
      this.moveDown();
      return true;
    }
    if (event.key === 'PageUp') {
      this.pageUp();
      return true;
    }
    if (event.key === 'PageDown') {
      this.pageDown();
      return true;
    }
    if (event.key === 'Home') {
      this.moveToFirst();
      return true;
    }
    if (event.key === 'End') {
      this.moveToLast();
      return true;
    }

    // Expand/collapse
    if (event.key === 'Enter' || event.key === ' ') {
      const node = this.getSelectedNode();
      if (node?.children.length) {
        this.toggleExpand();
      } else {
        // Trigger primary action or open file
        this.handleNodeActivation(node);
      }
      return true;
    }
    if (event.key === 'ArrowRight' || event.key === 'l') {
      const node = this.getSelectedNode();
      if (node?.children.length && this.collapsedNodeIds.has(node.nodeId)) {
        this.toggleExpand();
        return true;
      }
      // Move into children if expanded
      if (node?.children.length && !this.collapsedNodeIds.has(node.nodeId)) {
        this.moveDown();
        return true;
      }
    }
    if (event.key === 'ArrowLeft' || event.key === 'h') {
      const node = this.getSelectedNode();
      // Collapse if expanded
      if (node?.children.length && !this.collapsedNodeIds.has(node.nodeId)) {
        this.toggleExpand();
        return true;
      }
      // Move to parent
      if (node && node.depth > 0) {
        // Find parent node
        for (let i = this.selectedIndex - 1; i >= 0; i--) {
          if (this.flatNodes[i]!.depth < node.depth) {
            this.selectedIndex = i;
            this.ensureVisible();
            this.callbacks.onSelectionChange?.(this.getSelectedNode());
            this.ctx.markDirty();
            return true;
          }
        }
      }
    }

    // View mode toggle
    if (event.key === 'Tab' && !event.ctrl && !event.alt) {
      this.toggleViewMode();
      return true;
    }

    // Expand/collapse all
    if (event.key === 'e' && event.ctrl) {
      this.expandAll();
      return true;
    }
    if (event.key === 'c' && event.ctrl) {
      this.collapseAll();
      return true;
    }

    // Refresh
    if (event.key === 'r' && !event.ctrl) {
      this.callbacks.onRefresh?.();
      return true;
    }

    // Open file
    if (event.key === 'o' && !event.ctrl) {
      const node = this.getSelectedNode();
      if (node?.artifact.description) {
        this.callbacks.onOpenFile?.(node.artifact.description);
        return true;
      }
    }

    // Let subclasses handle action shortcuts
    return this.handleActionKey(event);
  }

  /**
   * Handle action keyboard shortcuts.
   * Override in subclasses to handle specific action keys.
   */
  protected handleActionKey(_event: KeyEvent): boolean {
    return false;
  }

  /**
   * Handle node activation (Enter on leaf node).
   * Override in subclasses for custom behavior.
   */
  protected handleNodeActivation(node: ArtifactNode<T> | null): void {
    if (!node) return;

    // Default: open file if node has a file path
    if (node.artifact.description) {
      this.callbacks.onOpenFile?.(node.artifact.description);
    }
  }

  override handleMouse(event: MouseEvent): boolean {
    const { x, y, width, height } = this.bounds;

    // Check if within bounds
    if (event.x < x || event.x >= x + width || event.y < y || event.y >= y + height) {
      return false;
    }

    // Always request focus on click
    if (event.type === 'press' && event.button === 'left') {
      this.ctx.requestFocus();
    }

    const headerHeight = this.showHeader ? 1 : 0;
    const contentHeight = this.getContentHeight();
    const contentStartY = y + headerHeight;

    // Scrollbar handling
    const scrollbarX = x + width - 1;
    if (this.needsScrollbar() && event.x === scrollbarX) {
      if (event.type === 'press' && event.button === 'left') {
        this.scrollbarDragging = true;
        this.handleScrollbarClick(event.y - contentStartY, contentHeight);
        return true;
      }
      if (event.type === 'drag' && this.scrollbarDragging) {
        this.handleScrollbarClick(event.y - contentStartY, contentHeight);
        return true;
      }
    }

    if (event.type === 'release') {
      this.scrollbarDragging = false;
    }

    // Content area clicks
    if (event.type === 'press' && event.button === 'left') {
      const relY = event.y - contentStartY;
      if (relY >= 0 && relY < contentHeight) {
        const viewIdx = this.scrollTop + relY;
        if (viewIdx >= 0 && viewIdx < this.flatNodes.length) {
          const now = Date.now();
          const isDoubleClick = viewIdx === this.lastClickIndex && now - this.lastClickTime < 300;
          const node = this.flatNodes[viewIdx]!;

          this.selectedIndex = viewIdx;
          this.callbacks.onSelectionChange?.(node);

          if (isDoubleClick) {
            if (node.children.length > 0) {
              this.toggleExpand();
            } else {
              this.handleNodeActivation(node);
            }
          }

          this.lastClickTime = now;
          this.lastClickIndex = viewIdx;
          this.ctx.markDirty();
          return true;
        }
      }
    }

    // Scrolling
    if (event.type === 'scroll') {
      const delta = (event.scrollDirection ?? 1) * 3;
      const maxScroll = Math.max(0, this.flatNodes.length - contentHeight);
      this.scrollTop = Math.max(0, Math.min(this.scrollTop + delta, maxScroll));
      this.ctx.markDirty();
      return true;
    }

    return false;
  }

  /**
   * Handle scrollbar click.
   */
  private handleScrollbarClick(relY: number, trackHeight: number): void {
    if (trackHeight <= 0) return;

    const totalNodes = this.flatNodes.length;
    const contentHeight = this.getContentHeight();
    const maxScroll = Math.max(0, totalNodes - contentHeight);

    // Calculate scroll position from click position
    const ratio = Math.max(0, Math.min(1, relY / trackHeight));
    this.scrollTop = Math.round(ratio * maxScroll);
    this.ctx.markDirty();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State Serialization
  // ─────────────────────────────────────────────────────────────────────────

  override getState(): ContentBrowserState {
    return {
      scrollTop: this.scrollTop,
      selectedIndex: this.selectedIndex,
      expandedNodeIds: Array.from(this.collapsedNodeIds),
      viewMode: this.viewMode,
    };
  }

  override setState(state: unknown): void {
    const s = state as ContentBrowserState;
    if (s.scrollTop !== undefined) {
      this.scrollTop = s.scrollTop;
    }
    if (s.selectedIndex !== undefined) {
      this.selectedIndex = s.selectedIndex;
    }
    if (s.expandedNodeIds) {
      this.collapsedNodeIds = new Set(s.expandedNodeIds);
    }
    if (s.viewMode) {
      this.viewMode = s.viewMode;
    }
    this.ctx.markDirty();
  }
}
