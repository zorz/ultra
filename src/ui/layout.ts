/**
 * Layout Management
 * 
 * Manages pane layout, splits, and component positioning.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutNode {
  type: 'leaf' | 'horizontal' | 'vertical';
  rect: Rect;
  children?: LayoutNode[];
  ratio?: number[];  // Split ratios
  id?: string;       // For leaf nodes, identifies the pane
}

export class LayoutManager {
  private root: LayoutNode;
  private _screenWidth: number = 80;
  private _screenHeight: number = 24;
  private activePaneId: string = 'main';
  private paneCounter: number = 0;
  
  // Reserved areas
  private tabBarHeight: number = 1;
  private statusBarHeight: number = 1;
  private sidebarWidth: number = 0;
  private sidebarVisible: boolean = false;
  private sidebarLocation: 'left' | 'right' = 'left';
  private terminalHeight: number = 0;
  private terminalVisible: boolean = false;
  private aiPanelWidth: number = 0;
  private aiPanelVisible: boolean = false;

  constructor() {
    this.root = {
      type: 'leaf',
      rect: { x: 1, y: 2, width: 80, height: 22 },
      id: 'main'
    };
  }

  /**
   * Generate a unique pane ID
   */
  private generatePaneId(): string {
    return `pane_${++this.paneCounter}`;
  }

  /**
   * Get the active pane ID
   */
  getActivePaneId(): string {
    return this.activePaneId;
  }

  /**
   * Set the active pane ID
   */
  setActivePaneId(id: string): void {
    this.activePaneId = id;
  }

  /**
   * Get all pane IDs in the layout
   */
  getAllPaneIds(): string[] {
    const ids: string[] = [];
    this.collectPaneIds(this.root, ids);
    return ids;
  }

  private collectPaneIds(node: LayoutNode, ids: string[]): void {
    if (node.type === 'leaf' && node.id) {
      ids.push(node.id);
    } else if (node.children) {
      for (const child of node.children) {
        this.collectPaneIds(child, ids);
      }
    }
  }

  /**
   * Find a node by pane ID
   */
  private findNode(id: string, node: LayoutNode = this.root): LayoutNode | null {
    if (node.type === 'leaf' && node.id === id) {
      return node;
    }
    if (node.children) {
      for (const child of node.children) {
        const found = this.findNode(id, child);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Find the parent of a node
   */
  private findParent(id: string, node: LayoutNode = this.root, parent: LayoutNode | null = null): { parent: LayoutNode; index: number } | null {
    if (node.type === 'leaf' && node.id === id) {
      return parent ? { parent, index: parent.children?.indexOf(node) ?? -1 } : null;
    }
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]!;
        if (child.type === 'leaf' && child.id === id) {
          return { parent: node, index: i };
        }
        const found = this.findParent(id, child, node);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Split a pane vertically (side by side)
   * Returns the ID of the new pane
   */
  splitVertical(paneId: string = this.activePaneId): string | null {
    return this.splitPane(paneId, 'horizontal'); // horizontal split = side by side (vertical divider)
  }

  /**
   * Split a pane horizontally (stacked)
   * Returns the ID of the new pane
   */
  splitHorizontal(paneId: string = this.activePaneId): string | null {
    return this.splitPane(paneId, 'vertical'); // vertical split = stacked (horizontal divider)
  }

  /**
   * Split a pane in the given direction
   */
  private splitPane(paneId: string, direction: 'horizontal' | 'vertical'): string | null {
    const newPaneId = this.generatePaneId();
    
    // Handle root node special case
    if (this.root.type === 'leaf' && this.root.id === paneId) {
      const oldRect = { ...this.root.rect };
      this.root = {
        type: direction,
        rect: oldRect,
        children: [
          { type: 'leaf', rect: { ...oldRect }, id: paneId },
          { type: 'leaf', rect: { ...oldRect }, id: newPaneId }
        ],
        ratio: [0.5, 0.5]
      };
      this.recalculateLayout();
      return newPaneId;
    }

    // Find the node to split
    const targetNode = this.findNode(paneId);
    if (!targetNode || targetNode.type !== 'leaf') {
      return null;
    }

    // Find the parent
    const parentInfo = this.findParent(paneId);
    
    if (!parentInfo) {
      // This shouldn't happen if the node exists
      return null;
    }

    const { parent, index } = parentInfo;

    if (parent.type === direction) {
      // Same direction - just add a new child
      const newRatio = 1 / (parent.children!.length + 1);
      const scaleFactor = 1 - newRatio;
      parent.ratio = parent.ratio!.map(r => r * scaleFactor);
      parent.ratio!.splice(index + 1, 0, newRatio);
      parent.children!.splice(index + 1, 0, {
        type: 'leaf',
        rect: { ...targetNode.rect },
        id: newPaneId
      });
    } else {
      // Different direction - wrap in new container
      const newContainer: LayoutNode = {
        type: direction,
        rect: { ...targetNode.rect },
        children: [
          { type: 'leaf', rect: { ...targetNode.rect }, id: paneId },
          { type: 'leaf', rect: { ...targetNode.rect }, id: newPaneId }
        ],
        ratio: [0.5, 0.5]
      };
      parent.children![index] = newContainer;
    }

    this.recalculateLayout();
    return newPaneId;
  }

  /**
   * Close a pane and remove it from the layout
   * Returns the ID of the pane that should become active, or null if it was the last pane
   */
  closePane(paneId: string): string | null {
    const allPanes = this.getAllPaneIds();
    if (allPanes.length <= 1) {
      return null; // Can't close the last pane
    }

    // Find the adjacent pane to activate
    const currentIndex = allPanes.indexOf(paneId);
    const nextActiveId = allPanes[currentIndex === 0 ? 1 : currentIndex - 1] || allPanes[0];

    // Handle root being a split
    if (this.root.type !== 'leaf' && this.root.children) {
      this.removeFromNode(this.root, paneId);
      
      // If root now has only one child, promote it
      if (this.root.children.length === 1) {
        const child = this.root.children[0]!;
        child.rect = this.root.rect;
        this.root = child;
      }
    }

    this.recalculateLayout();
    
    if (nextActiveId && this.findNode(nextActiveId)) {
      this.activePaneId = nextActiveId;
      return nextActiveId;
    }
    
    return allPanes.find(id => id !== paneId) || null;
  }

  /**
   * Remove a pane from a node
   */
  private removeFromNode(node: LayoutNode, paneId: string): boolean {
    if (!node.children) return false;

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]!;
      
      if (child.type === 'leaf' && child.id === paneId) {
        // Remove this child
        node.children.splice(i, 1);
        if (node.ratio) {
          const removedRatio = node.ratio[i]!;
          node.ratio.splice(i, 1);
          // Redistribute the ratio
          if (node.ratio.length > 0) {
            const scale = 1 / (1 - removedRatio);
            node.ratio = node.ratio.map(r => r * scale);
          }
        }
        return true;
      }
      
      if (child.type !== 'leaf') {
        if (this.removeFromNode(child, paneId)) {
          // If the child now has only one child, unwrap it
          if (child.children && child.children.length === 1) {
            const grandchild = child.children[0]!;
            grandchild.rect = child.rect;
            node.children[i] = grandchild;
          }
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Get the rect for a specific pane
   */
  getPaneRect(paneId: string): Rect | null {
    const node = this.findNode(paneId);
    return node?.rect || null;
  }

  /**
   * Get all pane rects
   */
  getAllPaneRects(): Map<string, Rect> {
    const rects = new Map<string, Rect>();
    this.collectPaneRects(this.root, rects);
    return rects;
  }

  private collectPaneRects(node: LayoutNode, rects: Map<string, Rect>): void {
    if (node.type === 'leaf' && node.id) {
      rects.set(node.id, node.rect);
    } else if (node.children) {
      for (const child of node.children) {
        this.collectPaneRects(child, rects);
      }
    }
  }

  /**
   * Navigate to the next pane
   */
  focusNextPane(): string | null {
    const panes = this.getAllPaneIds();
    if (panes.length <= 1) return null;
    
    const currentIndex = panes.indexOf(this.activePaneId);
    const nextIndex = (currentIndex + 1) % panes.length;
    this.activePaneId = panes[nextIndex]!;
    return this.activePaneId;
  }

  /**
   * Navigate to the previous pane
   */
  focusPreviousPane(): string | null {
    const panes = this.getAllPaneIds();
    if (panes.length <= 1) return null;
    
    const currentIndex = panes.indexOf(this.activePaneId);
    const prevIndex = currentIndex === 0 ? panes.length - 1 : currentIndex - 1;
    this.activePaneId = panes[prevIndex]!;
    return this.activePaneId;
  }

  /**
   * Check if the layout has multiple panes
   */
  hasSplits(): boolean {
    return this.root.type !== 'leaf';
  }

  /**
   * Get the number of panes
   */
  getPaneCount(): number {
    return this.getAllPaneIds().length;
  }

  /**
   * Update layout dimensions based on screen size
   */
  updateDimensions(width: number, height: number): void {
    this._screenWidth = width;
    this._screenHeight = height;
    this.recalculateLayout();
  }

  /**
   * Get screen dimensions
   */
  get screenWidth(): number {
    return this._screenWidth;
  }

  get screenHeight(): number {
    return this._screenHeight;
  }

  /**
   * Get tab bar rect
   */
  getTabBarRect(): Rect {
    const sidebarOnLeft = this.sidebarLocation === 'left';
    const x = (this.sidebarVisible && sidebarOnLeft) ? this.sidebarWidth + 1 : 1;
    let width = this._screenWidth - x + 1;
    if (this.aiPanelVisible) {
      width -= this.aiPanelWidth;
    }
    if (this.sidebarVisible && !sidebarOnLeft) {
      width -= this.sidebarWidth;
    }
    return {
      x,
      y: 1,
      width,
      height: this.tabBarHeight
    };
  }

  /**
   * Get status bar rect
   */
  getStatusBarRect(): Rect {
    return {
      x: 1,
      y: this._screenHeight,
      width: this._screenWidth,
      height: this.statusBarHeight
    };
  }

  /**
   * Get sidebar rect
   */
  getSidebarRect(): Rect | null {
    if (!this.sidebarVisible) return null;
    const sidebarOnLeft = this.sidebarLocation === 'left';
    return {
      x: sidebarOnLeft ? 1 : this._screenWidth - this.sidebarWidth + 1,
      y: 1,
      width: this.sidebarWidth,
      height: this._screenHeight - this.statusBarHeight
    };
  }

  /**
   * Get terminal rect
   */
  getTerminalRect(): Rect | null {
    if (!this.terminalVisible) return null;
    const sidebarOnLeft = this.sidebarLocation === 'left';
    const x = (this.sidebarVisible && sidebarOnLeft) ? this.sidebarWidth + 1 : 1;
    let width = this._screenWidth - x + 1;
    if (this.aiPanelVisible) {
      width -= this.aiPanelWidth;
    }
    if (this.sidebarVisible && !sidebarOnLeft) {
      width -= this.sidebarWidth;
    }
    return {
      x,
      y: this._screenHeight - this.statusBarHeight - this.terminalHeight + 1,
      width,
      height: this.terminalHeight
    };
  }

  /**
   * Get AI panel rect
   */
  getAIPanelRect(): Rect | null {
    if (!this.aiPanelVisible) return null;
    return {
      x: this._screenWidth - this.aiPanelWidth + 1,
      y: this.tabBarHeight + 1,
      width: this.aiPanelWidth,
      height: this._screenHeight - this.tabBarHeight - this.statusBarHeight
    };
  }

  /**
   * Get main editor area rect
   */
  getEditorAreaRect(): Rect {
    const sidebarOnLeft = this.sidebarLocation === 'left';
    const x = (this.sidebarVisible && sidebarOnLeft) ? this.sidebarWidth + 1 : 1;
    const y = this.tabBarHeight + 1;
    let width = this._screenWidth - x + 1;
    let height = this._screenHeight - this.tabBarHeight - this.statusBarHeight;

    if (this.aiPanelVisible) {
      width -= this.aiPanelWidth;
    }
    
    if (this.sidebarVisible && !sidebarOnLeft) {
      width -= this.sidebarWidth;
    }

    if (this.terminalVisible) {
      height -= this.terminalHeight;
    }

    return { x, y, width, height };
  }

  /**
   * Toggle sidebar
   */
  toggleSidebar(width: number = 30): void {
    if (this.sidebarVisible) {
      this.sidebarVisible = false;
      this.sidebarWidth = 0;
    } else {
      this.sidebarVisible = true;
      this.sidebarWidth = Math.min(width, Math.floor(this._screenWidth * 0.4));
    }
    this.recalculateLayout();
  }

  /**
   * Toggle terminal
   */
  toggleTerminal(height: number = 10): void {
    if (this.terminalVisible) {
      this.terminalVisible = false;
      this.terminalHeight = 0;
    } else {
      this.terminalVisible = true;
      this.terminalHeight = Math.min(height, Math.floor(this._screenHeight * 0.4));
    }
    this.recalculateLayout();
  }

  /**
   * Toggle AI panel
   */
  toggleAIPanel(width: number = 40): void {
    if (this.aiPanelVisible) {
      this.aiPanelVisible = false;
      this.aiPanelWidth = 0;
    } else {
      this.aiPanelVisible = true;
      this.aiPanelWidth = Math.min(width, Math.floor(this._screenWidth * 0.4));
    }
    this.recalculateLayout();
  }

  /**
   * Set sidebar width
   */
  setSidebarWidth(width: number): void {
    if (this.sidebarVisible) {
      this.sidebarWidth = Math.max(10, Math.min(width, Math.floor(this._screenWidth * 0.5)));
      this.recalculateLayout();
    }
  }

  /**
   * Set sidebar location
   */
  setSidebarLocation(location: 'left' | 'right'): void {
    this.sidebarLocation = location;
    this.recalculateLayout();
  }

  /**
   * Get sidebar location
   */
  getSidebarLocation(): 'left' | 'right' {
    return this.sidebarLocation;
  }

  /**
   * Set terminal height
   */
  setTerminalHeight(height: number): void {
    if (this.terminalVisible) {
      this.terminalHeight = Math.max(3, Math.min(height, Math.floor(this._screenHeight * 0.6)));
      this.recalculateLayout();
    }
  }

  /**
   * Set AI panel width
   */
  setAIPanelWidth(width: number): void {
    if (this.aiPanelVisible) {
      this.aiPanelWidth = Math.max(20, Math.min(width, Math.floor(this._screenWidth * 0.5)));
      this.recalculateLayout();
    }
  }

  /**
   * Check if point is on sidebar divider
   */
  isOnSidebarDivider(x: number): boolean {
    if (!this.sidebarVisible) return false;
    if (this.sidebarLocation === 'left') {
      return x === this.sidebarWidth;
    } else {
      return x === this._screenWidth - this.sidebarWidth + 1;
    }
  }

  /**
   * Check if point is on terminal divider
   */
  isOnTerminalDivider(y: number): boolean {
    if (!this.terminalVisible) return false;
    const termRect = this.getTerminalRect();
    return termRect !== null && y === termRect.y - 1;
  }

  /**
   * Check if point is on AI panel divider
   */
  isOnAIPanelDivider(x: number): boolean {
    if (!this.aiPanelVisible) return false;
    const aiRect = this.getAIPanelRect();
    return aiRect !== null && x === aiRect.x - 1;
  }

  /**
   * Recalculate all layout positions
   */
  private recalculateLayout(): void {
    const editorRect = this.getEditorAreaRect();
    this.updateNodeRect(this.root, editorRect);
  }

  /**
   * Update rect for a layout node and its children
   */
  private updateNodeRect(node: LayoutNode, rect: Rect): void {
    node.rect = rect;

    if (node.type === 'leaf' || !node.children) {
      return;
    }

    const ratios = node.ratio || node.children.map(() => 1 / node.children!.length);
    
    if (node.type === 'horizontal') {
      // Split horizontally (side by side)
      let currentX = rect.x;
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]!;
        const width = Math.floor(rect.width * ratios[i]!);
        this.updateNodeRect(child, {
          x: currentX,
          y: rect.y,
          width: i === node.children.length - 1 ? rect.x + rect.width - currentX : width,
          height: rect.height
        });
        currentX += width;
      }
    } else {
      // Split vertically (stacked)
      let currentY = rect.y;
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]!;
        const height = Math.floor(rect.height * ratios[i]!);
        this.updateNodeRect(child, {
          x: rect.x,
          y: currentY,
          width: rect.width,
          height: i === node.children.length - 1 ? rect.y + rect.height - currentY : height
        });
        currentY += height;
      }
    }
  }

  /**
   * Get pane at coordinates
   */
  getPaneAtPoint(x: number, y: number): string | null {
    return this.findPaneAtPoint(this.root, x, y);
  }

  private findPaneAtPoint(node: LayoutNode, x: number, y: number): string | null {
    const { rect } = node;
    
    if (x < rect.x || x >= rect.x + rect.width || y < rect.y || y >= rect.y + rect.height) {
      return null;
    }

    if (node.type === 'leaf') {
      return node.id || null;
    }

    if (node.children) {
      for (const child of node.children) {
        const result = this.findPaneAtPoint(child, x, y);
        if (result) return result;
      }
    }

    return null;
  }

  /**
   * Get visibility states
   */
  isSidebarVisible(): boolean {
    return this.sidebarVisible;
  }

  isTerminalVisible(): boolean {
    return this.terminalVisible;
  }

  isAIPanelVisible(): boolean {
    return this.aiPanelVisible;
  }
}

// Singleton instance
export const layoutManager = new LayoutManager();

export default layoutManager;
