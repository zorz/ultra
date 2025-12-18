/**
 * Pane Manager
 * 
 * Manages multiple editor panes, split layouts, and focus tracking.
 * Remembers the last focused pane for when files are opened from the sidebar.
 */

import { Pane } from './pane.ts';
import { Document } from '../../core/document.ts';
import type { RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import type { Position } from '../../core/buffer.ts';
import { themeLoader } from '../themes/theme-loader.ts';
import { debugLog } from '../../debug.ts';
import { hexToRgb } from '../colors.ts';

interface LayoutNode {
  type: 'leaf' | 'horizontal' | 'vertical';
  pane?: Pane;           // Only for leaf nodes
  children?: LayoutNode[];
  ratio?: number[];      // Split ratios for children
}

export class PaneManager implements MouseHandler {
  private root: LayoutNode;
  private panes: Map<string, Pane> = new Map();
  private activePaneId: string;
  private lastFocusedPaneId: string;  // For sidebar file opens
  private paneIdCounter: number = 0;
  private rect: Rect = { x: 1, y: 1, width: 80, height: 24 };
  
  // Callbacks
  private onActiveDocumentChangeCallback?: (document: Document | null, pane: Pane) => void;
  private onPaneFocusCallback?: (pane: Pane) => void;
  private onDocumentClickCallback?: (document: Document, position: Position, clickCount: number, event: MouseEvent) => void;
  private onDocumentDragCallback?: (document: Document, position: Position, event: MouseEvent) => void;
  private onDocumentScrollCallback?: (document: Document, deltaX: number, deltaY: number) => void;
  private onTabCloseRequestCallback?: (document: Document, pane: Pane) => void;
  private onGitGutterClickCallback?: (line: number) => void;
  private onInlineDiffStageCallback?: (filePath: string, line: number) => Promise<void>;
  private onInlineDiffRevertCallback?: (filePath: string, line: number) => Promise<void>;

  constructor() {
    // Create initial pane
    const mainPane = this.createPane();
    this.root = { type: 'leaf', pane: mainPane };
    this.activePaneId = mainPane.id;
    this.lastFocusedPaneId = mainPane.id;
  }

  /**
   * Create a new pane with unique ID
   */
  private createPane(): Pane {
    const id = `pane-${++this.paneIdCounter}`;
    const pane = new Pane(id);
    
    // Setup callbacks
    pane.onFocus(() => {
      this.setActivePane(id);
    });
    
    pane.onTabSelect((document) => {
      if (this.onActiveDocumentChangeCallback) {
        this.onActiveDocumentChangeCallback(document, pane);
      }
    });
    
    pane.onTabClose((document, tabId) => {
      if (this.onTabCloseRequestCallback) {
        this.onTabCloseRequestCallback(document, pane);
      }
    });
    
    pane.onClick((position, clickCount, event) => {
      const doc = pane.getActiveDocument();
      if (doc && this.onDocumentClickCallback) {
        this.onDocumentClickCallback(doc, position, clickCount, event);
      }
    });
    
    pane.onDrag((position, event) => {
      const doc = pane.getActiveDocument();
      if (doc && this.onDocumentDragCallback) {
        this.onDocumentDragCallback(doc, position, event);
      }
    });
    
    pane.onScroll((deltaX, deltaY) => {
      const doc = pane.getActiveDocument();
      if (doc && this.onDocumentScrollCallback) {
        this.onDocumentScrollCallback(doc, deltaX, deltaY);
      }
    });

    pane.onGitGutterClick((line) => {
      if (this.onGitGutterClickCallback) {
        this.onGitGutterClickCallback(line);
      }
    });

    pane.onInlineDiffStage(async (filePath, line) => {
      if (this.onInlineDiffStageCallback) {
        await this.onInlineDiffStageCallback(filePath, line);
      }
    });

    pane.onInlineDiffRevert(async (filePath, line) => {
      if (this.onInlineDiffRevertCallback) {
        await this.onInlineDiffRevertCallback(filePath, line);
      }
    });
    
    this.panes.set(id, pane);
    return pane;
  }

  // ==================== Pane Access ====================

  /**
   * Get active pane
   */
  getActivePane(): Pane {
    return this.panes.get(this.activePaneId)!;
  }

  /**
   * Get pane by ID
   */
  getPane(id: string): Pane | undefined {
    return this.panes.get(id);
  }

  /**
   * Get all panes
   */
  getAllPanes(): Pane[] {
    return Array.from(this.panes.values());
  }

  /**
   * Get pane count
   */
  getPaneCount(): number {
    return this.panes.size;
  }

  /**
   * Get the last focused pane (for opening files from sidebar)
   */
  getLastFocusedPane(): Pane {
    return this.panes.get(this.lastFocusedPaneId) || this.getActivePane();
  }

  // ==================== Focus Management ====================

  /**
   * Set active pane
   */
  setActivePane(id: string): void {
    if (!this.panes.has(id)) return;
    
    // Update focus state on all panes
    for (const [paneId, pane] of this.panes) {
      pane.setFocused(paneId === id);
    }
    
    this.activePaneId = id;
    this.lastFocusedPaneId = id;  // Track for sidebar opens
    
    const pane = this.panes.get(id)!;
    if (this.onPaneFocusCallback) {
      this.onPaneFocusCallback(pane);
    }
  }

  /**
   * Focus next pane (cycles through panes)
   */
  focusNextPane(): void {
    const paneIds = Array.from(this.panes.keys());
    const currentIndex = paneIds.indexOf(this.activePaneId);
    const nextIndex = (currentIndex + 1) % paneIds.length;
    this.setActivePane(paneIds[nextIndex]!);
  }

  /**
   * Focus previous pane
   */
  focusPreviousPane(): void {
    const paneIds = Array.from(this.panes.keys());
    const currentIndex = paneIds.indexOf(this.activePaneId);
    const prevIndex = (currentIndex - 1 + paneIds.length) % paneIds.length;
    this.setActivePane(paneIds[prevIndex]!);
  }

  // ==================== Split Operations ====================

  /**
   * Split active pane vertically (side by side)
   */
  splitVertical(): Pane | null {
    debugLog(`[PaneManager] splitVertical called, activePaneId=${this.activePaneId}, panes.size=${this.panes.size}`);
    const result = this.splitPane(this.activePaneId, 'horizontal'); // horizontal container = side by side
    debugLog(`[PaneManager] splitVertical result=${result?.id ?? 'null'}, new panes.size=${this.panes.size}`);
    return result;
  }

  /**
   * Split active pane horizontally (stacked)
   */
  splitHorizontal(): Pane | null {
    return this.splitPane(this.activePaneId, 'vertical'); // vertical container = stacked
  }

  /**
   * Split a specific pane
   */
  private splitPane(paneId: string, direction: 'horizontal' | 'vertical'): Pane | null {
    debugLog(`[PaneManager] splitPane(${paneId}, ${direction})`);
    
    const pane = this.panes.get(paneId);
    if (!pane) {
      debugLog(`[PaneManager] splitPane: pane not found`);
      return null;
    }
    
    // Find the node containing this pane
    const nodeInfo = this.findNodeWithPane(this.root, paneId);
    if (!nodeInfo) {
      debugLog(`[PaneManager] splitPane: node not found`);
      return null;
    }
    
    debugLog(`[PaneManager] splitPane: found node, creating new pane`);
    
    const { node, parent, childIndex } = nodeInfo;
    
    // Create new pane
    const newPane = this.createPane();
    const newNode: LayoutNode = { type: 'leaf', pane: newPane };
    
    if (!parent) {
      // Splitting root node - create a new container
      // IMPORTANT: Create a DEEP copy of the node to avoid any shared references
      // This is critical for proper tree management after close/split cycles
      const nodeCopy: LayoutNode = {
        type: node.type,
        pane: node.pane,
        // Deep copy arrays to prevent any reference sharing issues
        children: node.children ? [...node.children] : undefined,
        ratio: node.ratio ? [...node.ratio] : undefined
      };

      // Clear the old root's references before reassigning
      // This ensures no stale references remain
      const oldRoot = this.root;

      this.root = {
        type: direction,
        children: [nodeCopy, newNode],
        ratio: [0.5, 0.5]
      };

      debugLog(`[PaneManager] splitPane: split root node, oldRoot.type=${oldRoot.type}, newRoot.type=${this.root.type}`);
    } else {
      // Always wrap the selected pane in a new container with the new pane
      // This ensures we split just this pane, not add to a container of siblings
      const container: LayoutNode = {
        type: direction,
        children: [node, newNode],
        ratio: [0.5, 0.5]
      };
      parent.children![childIndex] = container;
      debugLog(`[PaneManager] splitPane: wrapped pane in new ${direction} container`);
    }
    
    // Focus new pane
    this.setActivePane(newPane.id);

    // Recalculate layout
    this.recalculateLayout();

    debugLog(`[PaneManager] splitPane: tree after split:\n${this.dumpTree(this.root)}`);
    debugLog(`[PaneManager] splitPane: panes.size=${this.panes.size}, panes=[${Array.from(this.panes.keys()).join(', ')}]`);

    return newPane;
  }

  /**
   * Close a pane
   */
  closePane(paneId: string): boolean {
    debugLog(`[PaneManager] closePane(${paneId}), current panes.size=${this.panes.size}`);
    if (this.panes.size <= 1) return false; // Can't close last pane

    const pane = this.panes.get(paneId);
    if (!pane) {
      debugLog(`[PaneManager] closePane: pane ${paneId} not found`);
      return false;
    }

    // Find and remove from layout tree
    const removed = this.removePaneFromTree(this.root, paneId, null, -1);
    if (!removed) {
      debugLog(`[PaneManager] closePane: failed to remove from tree`);
      return false;
    }

    // If root is a container with only one child, collapse it
    if (this.root.type !== 'leaf' && this.root.children && this.root.children.length === 1) {
      debugLog(`[PaneManager] closePane: collapsing root node`);
      this.collapseNode(this.root);
    }

    // Remove from panes map
    this.panes.delete(paneId);
    debugLog(`[PaneManager] closePane: removed pane, new panes.size=${this.panes.size}, root.type=${this.root.type}, root.pane=${this.root.pane?.id ?? 'none'}, root.children.length=${this.root.children?.length ?? 0}`);

    // If we closed the active pane, focus another
    if (this.activePaneId === paneId) {
      const remainingPaneId = this.panes.keys().next().value;
      if (remainingPaneId) {
        this.setActivePane(remainingPaneId);
      }
    }

    // Recalculate layout
    this.recalculateLayout();

    debugLog(`[PaneManager] closePane: tree after close:\n${this.dumpTree(this.root)}`);
    debugLog(`[PaneManager] closePane: panes.size=${this.panes.size}, panes=[${Array.from(this.panes.keys()).join(', ')}]`);

    return true;
  }

  /**
   * Close active pane
   */
  closeActivePane(): boolean {
    return this.closePane(this.activePaneId);
  }

  // ==================== Layout Tree Operations ====================

  private findNodeWithPane(
    node: LayoutNode,
    paneId: string,
    parent: LayoutNode | null = null,
    childIndex: number = -1
  ): { node: LayoutNode; parent: LayoutNode | null; childIndex: number } | null {
    if (node.type === 'leaf' && node.pane?.id === paneId) {
      return { node, parent, childIndex };
    }
    
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        const result = this.findNodeWithPane(node.children[i]!, paneId, node, i);
        if (result) return result;
      }
    }
    
    return null;
  }

  private removePaneFromTree(
    node: LayoutNode,
    paneId: string,
    parent: LayoutNode | null,
    childIndex: number
  ): boolean {
    if (node.type === 'leaf' && node.pane?.id === paneId) {
      if (!parent) {
        // This is root - shouldn't happen if we check pane count
        return false;
      }
      
      // Remove from parent
      parent.children!.splice(childIndex, 1);
      parent.ratio!.splice(childIndex, 1);
      
      // Normalize ratios
      const sum = parent.ratio!.reduce((a, b) => a + b, 0);
      parent.ratio = parent.ratio!.map(r => r / sum);
      
      // If parent has only one child, collapse it
      if (parent.children!.length === 1) {
        this.collapseNode(parent);
      }
      
      return true;
    }
    
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        if (this.removePaneFromTree(node.children[i]!, paneId, node, i)) {
          return true;
        }
      }
    }
    
    return false;
  }

  private collapseNode(node: LayoutNode): void {
    if (!node.children || node.children.length !== 1) {
      debugLog(`[PaneManager] collapseNode: skipping, children.length=${node.children?.length ?? 0}`);
      return;
    }

    const child = node.children[0]!;
    debugLog(`[PaneManager] collapseNode: collapsing container(${node.type}) with child(${child.type}, pane=${child.pane?.id ?? 'none'})`);

    // Store child properties before modifying node to avoid any reference issues
    const childType = child.type;
    const childPane = child.pane;
    // Deep copy arrays to prevent shared references
    const childChildren = child.children ? [...child.children] : undefined;
    const childRatio = child.ratio ? [...child.ratio] : undefined;

    // Completely replace node contents with child's properties
    node.type = childType;
    node.pane = childPane;
    node.children = childChildren;
    node.ratio = childRatio;

    // Clean up: leaf nodes shouldn't have children/ratio, containers shouldn't have pane
    if (node.type === 'leaf') {
      delete node.children;
      delete node.ratio;
      debugLog(`[PaneManager] collapseNode: collapsed to leaf with pane=${node.pane?.id}`);
    } else {
      delete node.pane;
      debugLog(`[PaneManager] collapseNode: collapsed to container(${node.type}) with ${node.children?.length ?? 0} children`);
    }
  }

  // ==================== Layout Calculation ====================

  /**
   * Set the available rect for all panes
   */
  setRect(rect: Rect): void {
    debugLog(`[PaneManager] setRect(${JSON.stringify(rect)})`);
    this.rect = rect;
    this.recalculateLayout();
    debugLog(`[PaneManager] setRect complete`);
  }

  /**
   * Recalculate layout for all panes
   */
  private recalculateLayout(): void {
    debugLog(`[PaneManager] recalculateLayout, root.type=${this.root.type}`);
    this.calculateNodeRect(this.root, this.rect);
  }

  private calculateNodeRect(node: LayoutNode, rect: Rect): void {
    debugLog(`[PaneManager] calculateNodeRect type=${node.type}, pane=${node.pane?.id || 'none'}`);
    if (node.type === 'leaf' && node.pane) {
      debugLog(`[PaneManager] setting pane ${node.pane.id} rect to ${JSON.stringify(rect)}`);
      node.pane.setRect(rect);
      return;
    }

    if (!node.children || !node.ratio) return;

    const isHorizontal = node.type === 'horizontal';
    let offset = isHorizontal ? rect.x : rect.y;
    const totalSize = isHorizontal ? rect.width : rect.height;

    for (let i = 0; i < node.children.length; i++) {
      const ratio = node.ratio[i]!;
      const size = Math.floor(totalSize * ratio);

      // Adjust last child to fill remaining space
      const actualSize = i === node.children.length - 1
        ? (isHorizontal ? rect.x + rect.width - offset : rect.y + rect.height - offset)
        : size;

      // Reserve 1 column/row for separator between panes (except for last pane)
      const hasSeparator = i < node.children.length - 1;
      const paneSize = hasSeparator ? actualSize - 1 : actualSize;

      const childRect: Rect = isHorizontal
        ? { x: offset, y: rect.y, width: paneSize, height: rect.height }
        : { x: rect.x, y: offset, width: rect.width, height: paneSize };

      this.calculateNodeRect(node.children[i]!, childRect);
      offset += actualSize;
    }
  }

  // ==================== Document Operations ====================

  /**
   * Open a document in the last focused pane
   */
  openDocument(document: Document, documentId?: string): void {
    const pane = this.getLastFocusedPane();
    pane.openDocument(document, documentId);
    this.setActivePane(pane.id);
  }

  /**
   * Open a document in a specific pane
   */
  openDocumentInPane(document: Document, paneId: string, documentId?: string): void {
    const pane = this.panes.get(paneId);
    if (pane) {
      pane.openDocument(document, documentId);
      this.setActivePane(paneId);
    }
  }

  /**
   * Open a document in the active pane
   */
  openDocumentInActivePane(document: Document, documentId?: string): void {
    this.getActivePane().openDocument(document, documentId);
  }

  /**
   * Get the active document from the active pane
   */
  getActiveDocument(): Document | null {
    return this.getActivePane().getActiveDocument();
  }

  /**
   * Close document in a specific pane
   */
  closeDocumentInPane(document: Document, paneId: string): void {
    const pane = this.panes.get(paneId);
    if (pane) {
      pane.closeDocument(document);
    }
  }

  /**
   * Close document in all panes
   */
  closeDocumentInAllPanes(document: Document): void {
    for (const pane of this.panes.values()) {
      pane.closeDocument(document);
    }
  }

  /**
   * Remove document from all panes by ID (for app.ts integration)
   */
  removeDocumentFromAllPanes(id: string): void {
    for (const pane of this.panes.values()) {
      pane.removeDocument(id);
    }
  }

  /**
   * Find all panes containing a document
   */
  findPanesWithDocument(document: Document): Pane[] {
    return Array.from(this.panes.values()).filter(p => p.hasDocument(document));
  }

  // ==================== Rendering ====================

  /**
   * Validate tree consistency - checks that Map and tree have same panes
   * Returns true if consistent, logs errors and returns false if not
   */
  private validateTreeConsistency(): boolean {
    const panesInTree = this.collectPanesFromTree(this.root);
    const panesInMap = new Set(this.panes.keys());

    // Check sizes match
    if (panesInTree.size !== panesInMap.size) {
      debugLog(`[PaneManager] INCONSISTENCY: Map has ${panesInMap.size} panes, tree has ${panesInTree.size}`);
      debugLog(`[PaneManager] Panes in map: ${Array.from(panesInMap).join(', ')}`);
      debugLog(`[PaneManager] Panes in tree: ${Array.from(panesInTree).join(', ')}`);
      return false;
    }

    // Check each pane in map exists in tree
    for (const paneId of panesInMap) {
      if (!panesInTree.has(paneId)) {
        debugLog(`[PaneManager] INCONSISTENCY: Pane ${paneId} in Map but not in tree`);
        return false;
      }
    }

    // Check each pane in tree exists in map
    for (const paneId of panesInTree) {
      if (!panesInMap.has(paneId)) {
        debugLog(`[PaneManager] INCONSISTENCY: Pane ${paneId} in tree but not in Map`);
        return false;
      }
    }

    return true;
  }

  /**
   * Render all panes
   */
  render(ctx: RenderContext): void {
    // Always verify tree consistency and log any issues
    if (!this.validateTreeConsistency()) {
      debugLog(`[PaneManager] WARNING: Tree inconsistency detected during render!`);
      debugLog(`[PaneManager] Current tree:\n${this.dumpTree(this.root)}`);
    }

    this.renderNode(ctx, this.root);

    // Render split dividers
    if (this.panes.size > 1) {
      this.renderDividers(ctx, this.root);
    }
  }

  /**
   * Collect all pane IDs from the tree (for debugging)
   */
  private collectPanesFromTree(node: LayoutNode): Set<string> {
    const panes = new Set<string>();

    if (node.type === 'leaf' && node.pane) {
      panes.add(node.pane.id);
    }

    if (node.children) {
      for (const child of node.children) {
        const childPanes = this.collectPanesFromTree(child);
        for (const id of childPanes) {
          panes.add(id);
        }
      }
    }

    return panes;
  }

  /**
   * Dump tree structure for debugging
   */
  private dumpTree(node: LayoutNode, indent: string = ''): string {
    if (node.type === 'leaf') {
      return `${indent}leaf(${node.pane?.id ?? 'NO_PANE'})`;
    }
    const childrenStr = node.children?.map((child, i) =>
      this.dumpTree(child, indent + '  ') + ` [ratio=${node.ratio?.[i]?.toFixed(2) ?? '?'}]`
    ).join('\n') ?? '';
    return `${indent}${node.type}(\n${childrenStr}\n${indent})`;
  }

  private renderNode(ctx: RenderContext, node: LayoutNode): void {
    if (node.type === 'leaf') {
      if (node.pane) {
        node.pane.render(ctx);
      } else {
        debugLog(`[PaneManager] WARNING: leaf node without pane!`);
      }
      return;
    }

    // Container node - should have children
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        this.renderNode(ctx, child);
      }
    } else {
      debugLog(`[PaneManager] WARNING: container node without children!`);
    }
  }

  private renderDividers(ctx: RenderContext, node: LayoutNode): void {
    if (node.type === 'leaf' || !node.children) return;
    
    const dividerColor = themeLoader.getColor('editorGroup.border') || '#3e4451';
    const rgb = hexToRgb(dividerColor);
    if (!rgb) return;
    
    const fg = `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m`;
    const reset = '\x1b[0m';
    
    // Draw dividers between children
    for (let i = 0; i < node.children.length - 1; i++) {
      const childRect = this.getNodeRect(node.children[i]!);
      if (!childRect) continue;
      
      if (node.type === 'horizontal') {
        // Vertical divider
        const x = childRect.x + childRect.width;
        for (let y = childRect.y; y < childRect.y + childRect.height; y++) {
          ctx.buffer(`\x1b[${y};${x}H${fg}│${reset}`);
        }
      } else {
        // Horizontal divider
        const y = childRect.y + childRect.height;
        ctx.buffer(`\x1b[${y};${childRect.x}H${fg}${'─'.repeat(childRect.width)}${reset}`);
      }
    }
    
    // Recurse
    for (const child of node.children) {
      this.renderDividers(ctx, child);
    }
  }

  private getNodeRect(node: LayoutNode): Rect | null {
    if (node.type === 'leaf' && node.pane) {
      return node.pane.getRect();
    }
    if (node.children && node.children.length > 0) {
      return this.getNodeRect(node.children[0]!);
    }
    return null;
  }

  // ==================== Mouse Handling ====================

  containsPoint(x: number, y: number): boolean {
    return x >= this.rect.x && x < this.rect.x + this.rect.width &&
           y >= this.rect.y && y < this.rect.y + this.rect.height;
  }

  onMouseEvent(event: MouseEvent): boolean {
    // Find which pane was clicked
    for (const [id, pane] of this.panes) {
      if (pane.containsPoint(event.x, event.y)) {
        // Focus the pane on click
        if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED' ||
            event.name === 'MOUSE_LEFT_BUTTON_PRESSED_DOUBLE' ||
            event.name === 'MOUSE_LEFT_BUTTON_PRESSED_TRIPLE') {
          this.setActivePane(id);
        }
        return pane.onMouseEvent(event);
      }
    }
    return false;
  }

  // ==================== Callbacks ====================

  onActiveDocumentChange(callback: (document: Document | null, pane: Pane) => void): () => void {
    this.onActiveDocumentChangeCallback = callback;
    return () => { this.onActiveDocumentChangeCallback = undefined; };
  }

  onPaneFocus(callback: (pane: Pane) => void): () => void {
    this.onPaneFocusCallback = callback;
    return () => { this.onPaneFocusCallback = undefined; };
  }

  onDocumentClick(callback: (document: Document, position: Position, clickCount: number, event: MouseEvent) => void): () => void {
    this.onDocumentClickCallback = callback;
    return () => { this.onDocumentClickCallback = undefined; };
  }

  onDocumentDrag(callback: (document: Document, position: Position, event: MouseEvent) => void): () => void {
    this.onDocumentDragCallback = callback;
    return () => { this.onDocumentDragCallback = undefined; };
  }

  onDocumentScroll(callback: (document: Document, deltaX: number, deltaY: number) => void): () => void {
    this.onDocumentScrollCallback = callback;
    return () => { this.onDocumentScrollCallback = undefined; };
  }

  onTabCloseRequest(callback: (document: Document, pane: Pane) => void): () => void {
    this.onTabCloseRequestCallback = callback;
    return () => { this.onTabCloseRequestCallback = undefined; };
  }

  onGitGutterClick(callback: (line: number) => void): () => void {
    this.onGitGutterClickCallback = callback;
    return () => { this.onGitGutterClickCallback = undefined; };
  }

  onInlineDiffStage(callback: (filePath: string, line: number) => Promise<void>): () => void {
    this.onInlineDiffStageCallback = callback;
    return () => { this.onInlineDiffStageCallback = undefined; };
  }

  onInlineDiffRevert(callback: (filePath: string, line: number) => Promise<void>): () => void {
    this.onInlineDiffRevertCallback = callback;
    return () => { this.onInlineDiffRevertCallback = undefined; };
  }

  // ==================== Pane Utilities ====================

  /**
   * Ensure cursor is visible in active pane
   */
  ensureCursorVisible(): void {
    this.getActivePane().ensureCursorVisible();
  }

  /**
   * Toggle minimap in active pane
   */
  toggleMinimap(): void {
    this.getActivePane().toggleMinimap();
  }

  // ==================== Folding ====================

  /**
   * Toggle fold at cursor in active pane
   */
  toggleFoldAtCursor(): boolean {
    return this.getActivePane().toggleFoldAtCursor();
  }

  /**
   * Fold all regions in active pane's document
   */
  foldAll(): void {
    this.getActivePane().foldAll();
  }

  /**
   * Unfold all regions in active pane's document
   */
  unfoldAll(): void {
    this.getActivePane().unfoldAll();
  }

  /**
   * Get scroll position from active pane
   */
  getScrollTop(): number {
    return this.getActivePane().getScrollTop();
  }

  getScrollLeft(): number {
    return this.getActivePane().getScrollLeft();
  }

  setScrollTop(value: number): void {
    this.getActivePane().setScrollTop(value);
  }

  setScrollLeft(value: number): void {
    this.getActivePane().setScrollLeft(value);
  }

  getVisibleLineCount(): number {
    return this.getActivePane().getVisibleLineCount();
  }

  // ==================== Session State Serialization ====================

  /**
   * Get the active pane ID
   */
  getActivePaneId(): string {
    return this.activePaneId;
  }

  /**
   * Serialize layout tree for session state
   */
  serializeLayout(): { type: 'leaf' | 'horizontal' | 'vertical'; paneId?: string; children?: any[]; ratios?: number[] } {
    return this.serializeLayoutNode(this.root);
  }

  private serializeLayoutNode(node: LayoutNode): { type: 'leaf' | 'horizontal' | 'vertical'; paneId?: string; children?: any[]; ratios?: number[] } {
    if (node.type === 'leaf') {
      return {
        type: 'leaf',
        paneId: node.pane?.id
      };
    }

    return {
      type: node.type,
      children: node.children?.map(child => this.serializeLayoutNode(child)),
      ratios: node.ratio
    };
  }

  /**
   * Reset pane manager to single pane state (for session restore)
   */
  reset(): void {
    // Clear all panes
    for (const pane of this.panes.values()) {
      // Clear tabs from pane
      for (const docId of pane.getDocumentIds()) {
        pane.removeDocument(docId);
      }
    }
    this.panes.clear();

    // Create new main pane
    this.paneIdCounter = 0;
    const mainPane = this.createPane();
    this.root = { type: 'leaf', pane: mainPane };
    this.activePaneId = mainPane.id;
    this.lastFocusedPaneId = mainPane.id;
  }

  /**
   * Restore layout from session state
   * Returns a map of paneId -> newPaneId for document assignment
   */
  restoreLayout(layout: { type: 'leaf' | 'horizontal' | 'vertical'; paneId?: string; children?: any[]; ratios?: number[] }): Map<string, string> {
    const paneIdMap = new Map<string, string>();

    // Clear existing panes
    this.panes.clear();
    this.paneIdCounter = 0;

    // Rebuild layout tree
    this.root = this.restoreLayoutNode(layout, paneIdMap);

    // Set active pane to first pane
    const firstPaneId = this.panes.keys().next().value;
    if (firstPaneId) {
      this.activePaneId = firstPaneId;
      this.lastFocusedPaneId = firstPaneId;
    }

    return paneIdMap;
  }

  private restoreLayoutNode(
    node: { type: 'leaf' | 'horizontal' | 'vertical'; paneId?: string; children?: any[]; ratios?: number[] },
    paneIdMap: Map<string, string>
  ): LayoutNode {
    if (node.type === 'leaf') {
      const newPane = this.createPane();
      if (node.paneId) {
        paneIdMap.set(node.paneId, newPane.id);
      }
      return { type: 'leaf', pane: newPane };
    }

    return {
      type: node.type,
      children: node.children?.map(child => this.restoreLayoutNode(child, paneIdMap)),
      ratio: node.ratios
    };
  }

  /**
   * Set active pane by ID (for session restore)
   */
  setActivePaneById(paneId: string): void {
    if (this.panes.has(paneId)) {
      this.setActivePane(paneId);
    }
  }

}

// Export singleton
export const paneManager = new PaneManager();

export default paneManager;
