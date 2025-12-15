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
    debugLog(`[PaneManager] splitVertical called, activePaneId=${this.activePaneId}`);
    const result = this.splitPane(this.activePaneId, 'horizontal'); // horizontal container = side by side
    debugLog(`[PaneManager] splitVertical result=${result?.id ?? 'null'}`);
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
      // Splitting root node
      this.root = {
        type: direction,
        children: [node, newNode],
        ratio: [0.5, 0.5]
      };
    } else if (parent.type === direction) {
      // Same direction - just add new child
      parent.children!.splice(childIndex + 1, 0, newNode);
      // Recalculate ratios
      const count = parent.children!.length;
      parent.ratio = parent.children!.map(() => 1 / count);
    } else {
      // Different direction - wrap in new container
      const container: LayoutNode = {
        type: direction,
        children: [node, newNode],
        ratio: [0.5, 0.5]
      };
      parent.children![childIndex] = container;
    }
    
    // Focus new pane
    this.setActivePane(newPane.id);
    
    // Recalculate layout
    this.recalculateLayout();
    
    return newPane;
  }

  /**
   * Close a pane
   */
  closePane(paneId: string): boolean {
    if (this.panes.size <= 1) return false; // Can't close last pane
    
    const pane = this.panes.get(paneId);
    if (!pane) return false;
    
    // Find and remove from layout tree
    const removed = this.removePaneFromTree(this.root, paneId, null, -1);
    if (!removed) return false;
    
    // Remove from panes map
    this.panes.delete(paneId);
    
    // If we closed the active pane, focus another
    if (this.activePaneId === paneId) {
      const remainingPaneId = this.panes.keys().next().value;
      if (remainingPaneId) {
        this.setActivePane(remainingPaneId);
      }
    }
    
    // Recalculate layout
    this.recalculateLayout();
    
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
    if (!node.children || node.children.length !== 1) return;
    
    const child = node.children[0]!;
    node.type = child.type;
    node.pane = child.pane;
    node.children = child.children;
    node.ratio = child.ratio;
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
      
      const childRect: Rect = isHorizontal
        ? { x: offset, y: rect.y, width: actualSize, height: rect.height }
        : { x: rect.x, y: offset, width: rect.width, height: actualSize };
      
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
   * Render all panes
   */
  render(ctx: RenderContext): void {
    this.renderNode(ctx, this.root);
    
    // Render split dividers
    if (this.panes.size > 1) {
      this.renderDividers(ctx, this.root);
    }
  }

  private renderNode(ctx: RenderContext, node: LayoutNode): void {
    if (node.type === 'leaf' && node.pane) {
      node.pane.render(ctx);
      return;
    }
    
    if (node.children) {
      for (const child of node.children) {
        this.renderNode(ctx, child);
      }
    }
  }

  private renderDividers(ctx: RenderContext, node: LayoutNode): void {
    if (node.type === 'leaf' || !node.children) return;
    
    const dividerColor = themeLoader.getColor('editorGroup.border') || '#3e4451';
    const rgb = this.hexToRgb(dividerColor);
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

  onActiveDocumentChange(callback: (document: Document | null, pane: Pane) => void): void {
    this.onActiveDocumentChangeCallback = callback;
  }

  onPaneFocus(callback: (pane: Pane) => void): void {
    this.onPaneFocusCallback = callback;
  }

  onDocumentClick(callback: (document: Document, position: Position, clickCount: number, event: MouseEvent) => void): void {
    this.onDocumentClickCallback = callback;
  }

  onDocumentDrag(callback: (document: Document, position: Position, event: MouseEvent) => void): void {
    this.onDocumentDragCallback = callback;
  }

  onDocumentScroll(callback: (document: Document, deltaX: number, deltaY: number) => void): void {
    this.onDocumentScrollCallback = callback;
  }

  onTabCloseRequest(callback: (document: Document, pane: Pane) => void): void {
    this.onTabCloseRequestCallback = callback;
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

  // ==================== Utilities ====================

  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1]!, 16),
      g: parseInt(result[2]!, 16),
      b: parseInt(result[3]!, 16)
    } : null;
  }
}

// Export singleton
export const paneManager = new PaneManager();

export default paneManager;
