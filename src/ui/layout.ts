/**
 * Layout Management
 *
 * Manages pane layout, splits, and component positioning.
 */

import { settings } from '../config/settings.ts';

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
  
  // Reserved areas
  private tabBarHeight: number = 0;  // Each pane has its own tab bar now
  private statusBarHeight: number = 1;
  private sidebarWidth: number = 0;
  private sidebarVisible: boolean = false;
  private sidebarLocation: 'left' | 'right' = 'left';
  private terminalSize: number = 0;  // Height or width depending on position
  private terminalVisible: boolean = false;
  private terminalPosition: 'bottom' | 'top' | 'left' | 'right' = 'bottom';
  private aiPanelWidth: number = 0;
  private aiPanelVisible: boolean = false;

  constructor() {
    this.root = {
      type: 'leaf',
      rect: { x: 1, y: 1, width: 80, height: 23 },
      id: 'main'
    };
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
    const sidebarOffset = this.sidebarVisible ? this.sidebarWidth : 0;
    const aiOffset = this.aiPanelVisible ? this.aiPanelWidth : 0;
    
    switch (this.terminalPosition) {
      case 'bottom': {
        const x = sidebarOnLeft ? sidebarOffset + 1 : 1;
        let width = this._screenWidth - x + 1;
        if (this.aiPanelVisible) width -= aiOffset;
        if (this.sidebarVisible && !sidebarOnLeft) width -= sidebarOffset;
        
        return {
          x,
          y: this._screenHeight - this.statusBarHeight - this.terminalSize + 1,
          width,
          height: this.terminalSize
        };
      }
      
      case 'top': {
        const x = sidebarOnLeft ? sidebarOffset + 1 : 1;
        let width = this._screenWidth - x + 1;
        if (this.aiPanelVisible) width -= aiOffset;
        if (this.sidebarVisible && !sidebarOnLeft) width -= sidebarOffset;
        
        return {
          x,
          y: 1,
          width,
          height: this.terminalSize
        };
      }
      
      case 'left': {
        const x = sidebarOnLeft ? sidebarOffset + 1 : 1;
        return {
          x,
          y: 1,
          width: this.terminalSize,
          height: this._screenHeight - this.statusBarHeight
        };
      }
      
      case 'right': {
        let x = this._screenWidth - this.terminalSize + 1;
        if (this.aiPanelVisible) x -= aiOffset;
        if (this.sidebarVisible && !sidebarOnLeft) x -= sidebarOffset;
        
        return {
          x,
          y: 1,
          width: this.terminalSize,
          height: this._screenHeight - this.statusBarHeight
        };
      }
    }
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
   * Get main editor area rect (where panes live)
   */
  getEditorAreaRect(): Rect {
    const sidebarOnLeft = this.sidebarLocation === 'left';
    let x = (this.sidebarVisible && sidebarOnLeft) ? this.sidebarWidth + 1 : 1;
    let y = 1;  // Start at top since panes have their own tab bars
    let width = this._screenWidth - x + 1;
    let height = this._screenHeight - this.statusBarHeight;

    if (this.aiPanelVisible) {
      width -= this.aiPanelWidth;
    }
    
    if (this.sidebarVisible && !sidebarOnLeft) {
      width -= this.sidebarWidth;
    }

    // Adjust for terminal position
    if (this.terminalVisible) {
      switch (this.terminalPosition) {
        case 'bottom':
          height -= this.terminalSize;
          break;
        case 'top':
          y += this.terminalSize;
          height -= this.terminalSize;
          break;
        case 'left':
          x += this.terminalSize;
          width -= this.terminalSize;
          break;
        case 'right':
          width -= this.terminalSize;
          break;
      }
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
  toggleTerminal(size?: number): void {
    if (this.terminalVisible) {
      this.terminalVisible = false;
      this.terminalSize = 0;
    } else {
      this.terminalVisible = true;
      const isVertical = this.terminalPosition === 'left' || this.terminalPosition === 'right';
      const defaultSize = isVertical ? 40 : 12;
      const maxSize = isVertical ? this._screenWidth * 0.4 : this._screenHeight * 0.4;
      this.terminalSize = Math.min(size || defaultSize, Math.floor(maxSize));
    }
    this.recalculateLayout();
  }

  /**
   * Set terminal position
   */
  setTerminalPosition(position: 'bottom' | 'top' | 'left' | 'right'): void {
    this.terminalPosition = position;
    // Re-calculate appropriate size for new position
    if (this.terminalVisible) {
      const isVertical = position === 'left' || position === 'right';
      const defaultSize = isVertical ? 40 : 12;
      const maxSize = isVertical ? this._screenWidth * 0.4 : this._screenHeight * 0.4;
      this.terminalSize = Math.min(defaultSize, Math.floor(maxSize));
    }
    this.recalculateLayout();
  }

  /**
   * Get terminal position
   */
  getTerminalPosition(): 'bottom' | 'top' | 'left' | 'right' {
    return this.terminalPosition;
  }

  /**
   * Toggle AI panel
   */
  toggleAIPanel(width?: number): void {
    if (this.aiPanelVisible) {
      this.aiPanelVisible = false;
      this.aiPanelWidth = 0;
    } else {
      this.aiPanelVisible = true;
      const defaultWidth = width ?? settings.get('ai.panel.defaultWidth') ?? 80;
      const maxPercent = settings.get('ai.panel.maxWidthPercent') ?? 50;
      this.aiPanelWidth = Math.min(defaultWidth, Math.floor(this._screenWidth * (maxPercent / 100)));
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
   * Set terminal size (height for top/bottom, width for left/right)
   */
  setTerminalSize(size: number): void {
    if (this.terminalVisible) {
      const isVertical = this.terminalPosition === 'left' || this.terminalPosition === 'right';
      const maxSize = isVertical ? this._screenWidth * 0.6 : this._screenHeight * 0.6;
      const minSize = isVertical ? 20 : 3;
      this.terminalSize = Math.max(minSize, Math.min(size, Math.floor(maxSize)));
      this.recalculateLayout();
    }
  }

  /**
   * Set AI panel width
   */
  setAIPanelWidth(width: number): void {
    if (this.aiPanelVisible) {
      const maxPercent = settings.get('ai.panel.maxWidthPercent') ?? 50;
      this.aiPanelWidth = Math.max(20, Math.min(width, Math.floor(this._screenWidth * (maxPercent / 100))));
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
  isOnTerminalDivider(x: number, y: number): boolean {
    if (!this.terminalVisible) return false;
    const termRect = this.getTerminalRect();
    if (!termRect) return false;
    
    switch (this.terminalPosition) {
      case 'bottom':
        return y === termRect.y - 1 && x >= termRect.x && x < termRect.x + termRect.width;
      case 'top':
        return y === termRect.y + termRect.height && x >= termRect.x && x < termRect.x + termRect.width;
      case 'left':
        return x === termRect.x + termRect.width && y >= termRect.y && y < termRect.y + termRect.height;
      case 'right':
        return x === termRect.x - 1 && y >= termRect.y && y < termRect.y + termRect.height;
    }
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
