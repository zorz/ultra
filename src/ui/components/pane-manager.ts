/**
 * Pane Manager
 * 
 * Manages multiple editor panes, their documents, and focus state.
 * Acts as an intermediary between the App and individual EditorPane instances.
 */

import { EditorPane } from './editor-pane.ts';
import { TabBar, type Tab } from './tab-bar.ts';
import { Document } from '../../core/document.ts';
import { layoutManager, type Rect } from '../layout.ts';
import type { RenderContext } from '../renderer.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import type { Position } from '../../core/buffer.ts';

interface PaneState {
  pane: EditorPane;
  tabBar: TabBar;
  documentIds: string[];       // List of document IDs open in this pane (tabs)
  activeDocumentId: string | null;  // Currently active document in this pane
}

export class PaneManager implements MouseHandler {
  private panes: Map<string, PaneState> = new Map();
  private documents: Map<string, Document> = new Map();  // documentId -> Document
  
  // Callbacks
  private onPaneClickCallback?: (paneId: string, position: Position, clickCount: number, event: MouseEvent) => void;
  private onPaneDragCallback?: (paneId: string, position: Position, event: MouseEvent) => void;
  private onPaneScrollCallback?: (paneId: string, deltaX: number, deltaY: number) => void;
  private onPaneFocusCallback?: (paneId: string) => void;
  private onTabClickCallback?: (paneId: string, tabId: string) => void;
  private onTabCloseCallback?: (paneId: string, tabId: string) => void;

  constructor() {
    // Create the initial main pane
    this.createPane('main');
  }

  /**
   * Create a new pane
   */
  private createPane(paneId: string): EditorPane {
    const pane = new EditorPane();
    const tabBar = new TabBar();
    
    // Setup pane callbacks that include pane ID
    pane.onClick((position, clickCount, event) => {
      this.setActivePane(paneId);
      if (this.onPaneClickCallback) {
        this.onPaneClickCallback(paneId, position, clickCount, event);
      }
    });
    
    pane.onDrag((position, event) => {
      if (this.onPaneDragCallback) {
        this.onPaneDragCallback(paneId, position, event);
      }
    });
    
    pane.onScroll((deltaX, deltaY) => {
      if (this.onPaneScrollCallback) {
        this.onPaneScrollCallback(paneId, deltaX, deltaY);
      }
    });
    
    // Setup tab bar callbacks that include pane ID
    tabBar.onTabClick((tabId) => {
      this.setActivePane(paneId);
      this.setActivePaneDocument(paneId, tabId);
      if (this.onTabClickCallback) {
        this.onTabClickCallback(paneId, tabId);
      }
    });
    
    tabBar.onTabClose((tabId) => {
      if (this.onTabCloseCallback) {
        this.onTabCloseCallback(paneId, tabId);
      }
    });
    
    this.panes.set(paneId, { pane, tabBar, documentIds: [], activeDocumentId: null });
    return pane;
  }

  /**
   * Get or create a pane by ID
   */
  getPane(paneId: string): EditorPane {
    const state = this.panes.get(paneId);
    if (state) {
      return state.pane;
    }
    return this.createPane(paneId);
  }

  /**
   * Get the active pane
   */
  getActivePane(): EditorPane {
    const activePaneId = layoutManager.getActivePaneId();
    return this.getPane(activePaneId);
  }

  /**
   * Get the active pane ID
   */
  getActivePaneId(): string {
    return layoutManager.getActivePaneId();
  }

  /**
   * Set the active pane
   */
  setActivePane(paneId: string): void {
    const oldActivePaneId = layoutManager.getActivePaneId();
    if (oldActivePaneId !== paneId) {
      // Unfocus old pane
      const oldState = this.panes.get(oldActivePaneId);
      if (oldState) {
        oldState.pane.setFocused(false);
      }
      
      // Focus new pane
      layoutManager.setActivePaneId(paneId);
      const newState = this.panes.get(paneId);
      if (newState) {
        newState.pane.setFocused(true);
      }
      
      if (this.onPaneFocusCallback) {
        this.onPaneFocusCallback(paneId);
      }
    }
  }

  /**
   * Register a document with the manager
   */
  registerDocument(documentId: string, document: Document): void {
    this.documents.set(documentId, document);
  }

  /**
   * Unregister a document from manager (but not from panes)
   */
  unregisterDocument(documentId: string): void {
    this.documents.delete(documentId);
  }

  /**
   * Add a document to a pane's tab list and make it active
   */
  addDocumentToPane(paneId: string, documentId: string): void {
    const state = this.panes.get(paneId);
    if (!state) return;
    
    // Add to tab list if not already there
    if (!state.documentIds.includes(documentId)) {
      state.documentIds.push(documentId);
    }
    
    // Make it the active document
    this.setActivePaneDocument(paneId, documentId);
  }

  /**
   * Remove a document from a pane's tab list
   */
  removeDocumentFromPane(paneId: string, documentId: string): void {
    const state = this.panes.get(paneId);
    if (!state) return;
    
    const index = state.documentIds.indexOf(documentId);
    if (index === -1) return;
    
    state.documentIds.splice(index, 1);
    
    // If this was the active document, switch to another
    if (state.activeDocumentId === documentId) {
      if (state.documentIds.length > 0) {
        const newIndex = Math.min(index, state.documentIds.length - 1);
        this.setActivePaneDocument(paneId, state.documentIds[newIndex]!);
      } else {
        state.activeDocumentId = null;
        state.pane.setDocument(null);
      }
    }
  }

  /**
   * Remove a document from all panes
   */
  removeDocumentFromAllPanes(documentId: string): void {
    for (const [paneId] of this.panes) {
      this.removeDocumentFromPane(paneId, documentId);
    }
    this.unregisterDocument(documentId);
  }

  /**
   * Set the active document for a pane
   */
  setActivePaneDocument(paneId: string, documentId: string | null): void {
    const state = this.panes.get(paneId);
    if (!state) return;
    
    state.activeDocumentId = documentId;
    
    if (documentId) {
      const document = this.documents.get(documentId);
      state.pane.setDocument(document || null);
    } else {
      state.pane.setDocument(null);
    }
  }

  /**
   * Get the active document ID for a pane
   */
  getPaneActiveDocumentId(paneId: string): string | null {
    return this.panes.get(paneId)?.activeDocumentId || null;
  }

  /**
   * Get all document IDs (tabs) for a pane
   */
  getPaneDocumentIds(paneId: string): string[] {
    return this.panes.get(paneId)?.documentIds || [];
  }

  /**
   * Get the document for a pane's active document
   */
  getPaneDocument(paneId: string): Document | null {
    const documentId = this.getPaneActiveDocumentId(paneId);
    if (!documentId) return null;
    return this.documents.get(documentId) || null;
  }

  /**
   * Get a document by ID
   */
  getDocument(documentId: string): Document | null {
    return this.documents.get(documentId) || null;
  }

  /**
   * Get the document for the active pane
   */
  getActiveDocument(): Document | null {
    return this.getPaneDocument(this.getActivePaneId());
  }

  /**
   * Get the document ID for the active pane
   */
  getActiveDocumentId(): string | null {
    return this.getPaneActiveDocumentId(this.getActivePaneId());
  }

  /**
   * Check if a document is open in any pane
   */
  isDocumentOpen(documentId: string): boolean {
    for (const [, state] of this.panes) {
      if (state.documentIds.includes(documentId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Find which pane has a document open (returns first match)
   */
  findPaneWithDocument(documentId: string): string | null {
    for (const [paneId, state] of this.panes) {
      if (state.documentIds.includes(documentId)) {
        return paneId;
      }
    }
    return null;
  }

  /**
   * Set document for a pane (legacy compatibility - use addDocumentToPane instead)
   * @deprecated Use addDocumentToPane instead
   */
  setPaneDocument(paneId: string, documentId: string | null): void {
    if (documentId) {
      this.addDocumentToPane(paneId, documentId);
    }
  }

  /**
   * Split the active pane vertically (side by side)
   * Returns the new pane ID and copies the current document tabs
   */
  splitVertical(): string | null {
    const currentPaneId = this.getActivePaneId();
    const currentState = this.panes.get(currentPaneId);
    
    const newPaneId = layoutManager.splitVertical(currentPaneId);
    if (!newPaneId) return null;
    
    // Create the new pane
    this.createPane(newPaneId);
    
    // Copy document tabs from current pane to new pane
    if (currentState) {
      const newState = this.panes.get(newPaneId);
      if (newState) {
        // Copy all document IDs
        newState.documentIds = [...currentState.documentIds];
        // Set the same active document
        if (currentState.activeDocumentId) {
          this.setActivePaneDocument(newPaneId, currentState.activeDocumentId);
        }
      }
    }
    
    // Focus the new pane
    this.setActivePane(newPaneId);
    
    return newPaneId;
  }

  /**
   * Split the active pane horizontally (stacked)
   * Returns the new pane ID and copies the current document tabs
   */
  splitHorizontal(): string | null {
    const currentPaneId = this.getActivePaneId();
    const currentState = this.panes.get(currentPaneId);
    
    const newPaneId = layoutManager.splitHorizontal(currentPaneId);
    if (!newPaneId) return null;
    
    // Create the new pane
    this.createPane(newPaneId);
    
    // Copy document tabs from current pane to new pane
    if (currentState) {
      const newState = this.panes.get(newPaneId);
      if (newState) {
        // Copy all document IDs
        newState.documentIds = [...currentState.documentIds];
        // Set the same active document
        if (currentState.activeDocumentId) {
          this.setActivePaneDocument(newPaneId, currentState.activeDocumentId);
        }
      }
    }
    
    // Focus the new pane
    this.setActivePane(newPaneId);
    
    return newPaneId;
  }

  /**
   * Close a pane
   */
  closePane(paneId: string): string | null {
    const nextPaneId = layoutManager.closePane(paneId);
    
    if (nextPaneId) {
      // Remove the pane state
      this.panes.delete(paneId);
      
      // Focus the next pane
      this.setActivePane(nextPaneId);
    }
    
    return nextPaneId;
  }

  /**
   * Close the active pane
   */
  closeActivePane(): string | null {
    return this.closePane(this.getActivePaneId());
  }

  /**
   * Focus next pane
   */
  focusNextPane(): void {
    const nextPaneId = layoutManager.focusNextPane();
    if (nextPaneId) {
      this.setActivePane(nextPaneId);
    }
  }

  /**
   * Focus previous pane
   */
  focusPreviousPane(): void {
    const prevPaneId = layoutManager.focusPreviousPane();
    if (prevPaneId) {
      this.setActivePane(prevPaneId);
    }
  }

  /**
   * Get the pane count
   */
  getPaneCount(): number {
    return layoutManager.getPaneCount();
  }

  /**
   * Check if there are multiple panes
   */
  hasSplits(): boolean {
    return layoutManager.hasSplits();
  }

  /**
   * Update pane rects from layout manager
   * Each pane gets a tab bar at the top, reducing editor space by 1 row
   */
  updatePaneRects(): void {
    const rects = layoutManager.getAllPaneRects();
    for (const [paneId, rect] of rects) {
      const state = this.panes.get(paneId);
      if (state) {
        // Tab bar takes the top row of the pane area
        const tabBarRect = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: 1
        };
        
        // Editor pane starts below the tab bar
        const paneRect = {
          x: rect.x,
          y: rect.y + 1,
          width: rect.width,
          height: rect.height - 1
        };
        
        state.tabBar.setRect(tabBarRect);
        state.pane.setRect(paneRect);
      }
    }
  }

  /**
   * Get tabs for a specific pane
   */
  getTabsForPane(paneId: string): Tab[] {
    const state = this.panes.get(paneId);
    if (!state) return [];
    
    return state.documentIds
      .map(docId => {
        const doc = this.documents.get(docId);
        if (!doc) return null;
        return {
          id: docId,
          fileName: doc.fileName,
          filePath: doc.filePath,
          isDirty: doc.isDirty,
          isActive: docId === state.activeDocumentId
        };
      })
      .filter((tab): tab is Tab => tab !== null);
  }

  /**
   * Render all panes
   */
  render(ctx: RenderContext): void {
    // Update rects first
    this.updatePaneRects();
    
    const activePaneId = this.getActivePaneId();
    
    // Render each pane with its tab bar
    for (const [paneId, state] of this.panes) {
      // Set focus state
      const isFocused = paneId === activePaneId;
      state.pane.setFocused(isFocused);
      
      // Update and render tab bar
      state.tabBar.setTabs(this.getTabsForPane(paneId));
      state.tabBar.render(ctx);
      
      // Render editor pane
      state.pane.render(ctx);
    }
    
    // Render split dividers if there are splits
    if (this.hasSplits()) {
      this.renderDividers(ctx);
    }
  }

  /**
   * Render dividers between panes
   */
  private renderDividers(ctx: RenderContext): void {
    const rects = layoutManager.getAllPaneRects();
    const allRects = Array.from(rects.values());
    
    // Find edges that need dividers
    const edges = new Set<string>();
    
    for (let i = 0; i < allRects.length; i++) {
      const rect1 = allRects[i]!;
      for (let j = i + 1; j < allRects.length; j++) {
        const rect2 = allRects[j]!;
        
        // Check for vertical divider (side by side)
        if (rect1.x + rect1.width === rect2.x || rect2.x + rect2.width === rect1.x) {
          const dividerX = rect1.x + rect1.width === rect2.x ? rect1.x + rect1.width : rect2.x + rect2.width;
          const startY = Math.max(rect1.y, rect2.y);
          const endY = Math.min(rect1.y + rect1.height, rect2.y + rect2.height);
          edges.add(`v:${dividerX}:${startY}:${endY}`);
        }
        
        // Check for horizontal divider (stacked)
        if (rect1.y + rect1.height === rect2.y || rect2.y + rect2.height === rect1.y) {
          const dividerY = rect1.y + rect1.height === rect2.y ? rect1.y + rect1.height : rect2.y + rect2.height;
          const startX = Math.max(rect1.x, rect2.x);
          const endX = Math.min(rect1.x + rect1.width, rect2.x + rect2.width);
          edges.add(`h:${dividerY}:${startX}:${endX}`);
        }
      }
    }
    
    // Render dividers - using a subtle color
    const dividerColor = '\x1b[38;2;73;81;98m';  // Dim gray
    const reset = '\x1b[0m';
    
    for (const edge of edges) {
      const parts = edge.split(':');
      const type = parts[0];
      
      if (type === 'v') {
        const x = parseInt(parts[1]!);
        const startY = parseInt(parts[2]!);
        const endY = parseInt(parts[3]!);
        for (let y = startY; y < endY; y++) {
          ctx.buffer(`\x1b[${y};${x}H${dividerColor}│${reset}`);
        }
      } else if (type === 'h') {
        const y = parseInt(parts[1]!);
        const startX = parseInt(parts[2]!);
        const endX = parseInt(parts[3]!);
        ctx.buffer(`\x1b[${y};${startX}H${dividerColor}${'─'.repeat(endX - startX)}${reset}`);
      }
    }
  }

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

  /**
   * Get minimap for active pane (for mouse handling)
   */
  getMinimap(): ReturnType<EditorPane['getMinimap']> {
    return this.getActivePane().getMinimap();
  }

  // Callbacks
  onClick(callback: (paneId: string, position: Position, clickCount: number, event: MouseEvent) => void): void {
    this.onPaneClickCallback = callback;
  }

  onDrag(callback: (paneId: string, position: Position, event: MouseEvent) => void): void {
    this.onPaneDragCallback = callback;
  }

  onScroll(callback: (paneId: string, deltaX: number, deltaY: number) => void): void {
    this.onPaneScrollCallback = callback;
  }

  onFocus(callback: (paneId: string) => void): void {
    this.onPaneFocusCallback = callback;
  }

  onTabClick(callback: (paneId: string, tabId: string) => void): void {
    this.onTabClickCallback = callback;
  }

  onTabClose(callback: (paneId: string, tabId: string) => void): void {
    this.onTabCloseCallback = callback;
  }

  // MouseHandler implementation
  containsPoint(x: number, y: number): boolean {
    for (const [, state] of this.panes) {
      // Check both tab bar and pane
      if (state.tabBar.containsPoint(x, y) || state.pane.containsPoint(x, y)) {
        return true;
      }
    }
    return false;
  }

  onMouseEvent(event: MouseEvent): boolean {
    // First check tab bars
    for (const [paneId, state] of this.panes) {
      if (state.tabBar.containsPoint(event.x, event.y)) {
        // Set this pane as active on click
        if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED') {
          this.setActivePane(paneId);
        }
        return state.tabBar.onMouseEvent(event);
      }
    }
    
    // Then check panes
    for (const [paneId, state] of this.panes) {
      if (state.pane.containsPoint(event.x, event.y)) {
        // Set this pane as active on click
        if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED') {
          this.setActivePane(paneId);
        }
        return state.pane.onMouseEvent(event);
      }
    }
    return false;
  }

  /**
   * Get scroll position for active pane
   */
  getScrollTop(): number {
    return this.getActivePane().getScrollTop();
  }

  getScrollLeft(): number {
    return this.getActivePane().getScrollLeft();
  }

  /**
   * Get visible line count for active pane
   */
  getVisibleLineCount(): number {
    return this.getActivePane().getVisibleLineCount();
  }
}

// Export singleton instance
export const paneManager = new PaneManager();

export default paneManager;
