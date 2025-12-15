/**
 * Pane Manager
 * 
 * Manages multiple editor panes, their documents, and focus state.
 * Acts as an intermediary between the App and individual EditorPane instances.
 */

import { EditorPane } from './editor-pane.ts';
import { Document } from '../../core/document.ts';
import { layoutManager, type Rect } from '../layout.ts';
import type { RenderContext } from '../renderer.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import type { Position } from '../../core/buffer.ts';

interface PaneState {
  pane: EditorPane;
  documentId: string | null;  // References the document in App's document list
}

export class PaneManager implements MouseHandler {
  private panes: Map<string, PaneState> = new Map();
  private documents: Map<string, Document> = new Map();  // documentId -> Document
  
  // Callbacks
  private onPaneClickCallback?: (paneId: string, position: Position, clickCount: number, event: MouseEvent) => void;
  private onPaneDragCallback?: (paneId: string, position: Position, event: MouseEvent) => void;
  private onPaneScrollCallback?: (paneId: string, deltaX: number, deltaY: number) => void;
  private onPaneFocusCallback?: (paneId: string) => void;

  constructor() {
    // Create the initial main pane
    this.createPane('main');
  }

  /**
   * Create a new pane
   */
  private createPane(paneId: string): EditorPane {
    const pane = new EditorPane();
    
    // Setup callbacks that include pane ID
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
    
    this.panes.set(paneId, { pane, documentId: null });
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
   * Unregister a document
   */
  unregisterDocument(documentId: string): void {
    this.documents.delete(documentId);
    
    // Clear from any panes that have this document
    for (const [paneId, state] of this.panes) {
      if (state.documentId === documentId) {
        state.pane.setDocument(null);
        state.documentId = null;
      }
    }
  }

  /**
   * Set document for a pane
   */
  setPaneDocument(paneId: string, documentId: string | null): void {
    const state = this.panes.get(paneId);
    if (!state) return;
    
    state.documentId = documentId;
    
    if (documentId) {
      const document = this.documents.get(documentId);
      state.pane.setDocument(document || null);
    } else {
      state.pane.setDocument(null);
    }
  }

  /**
   * Get the document ID for a pane
   */
  getPaneDocumentId(paneId: string): string | null {
    return this.panes.get(paneId)?.documentId || null;
  }

  /**
   * Get the document for a pane
   */
  getPaneDocument(paneId: string): Document | null {
    const documentId = this.getPaneDocumentId(paneId);
    if (!documentId) return null;
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
    return this.getPaneDocumentId(this.getActivePaneId());
  }

  /**
   * Split the active pane vertically (side by side)
   * Returns the new pane ID and copies the current document
   */
  splitVertical(): string | null {
    const currentPaneId = this.getActivePaneId();
    const currentDocId = this.getPaneDocumentId(currentPaneId);
    
    const newPaneId = layoutManager.splitVertical(currentPaneId);
    if (!newPaneId) return null;
    
    // Create the new pane
    this.createPane(newPaneId);
    
    // Clone the document view to the new pane
    if (currentDocId) {
      this.setPaneDocument(newPaneId, currentDocId);
    }
    
    // Focus the new pane
    this.setActivePane(newPaneId);
    
    return newPaneId;
  }

  /**
   * Split the active pane horizontally (stacked)
   * Returns the new pane ID and copies the current document
   */
  splitHorizontal(): string | null {
    const currentPaneId = this.getActivePaneId();
    const currentDocId = this.getPaneDocumentId(currentPaneId);
    
    const newPaneId = layoutManager.splitHorizontal(currentPaneId);
    if (!newPaneId) return null;
    
    // Create the new pane
    this.createPane(newPaneId);
    
    // Clone the document view to the new pane
    if (currentDocId) {
      this.setPaneDocument(newPaneId, currentDocId);
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
   */
  updatePaneRects(): void {
    const rects = layoutManager.getAllPaneRects();
    for (const [paneId, rect] of rects) {
      const state = this.panes.get(paneId);
      if (state) {
        state.pane.setRect(rect);
      }
    }
  }

  /**
   * Render all panes
   */
  render(ctx: RenderContext): void {
    // Update rects first
    this.updatePaneRects();
    
    const activePaneId = this.getActivePaneId();
    
    // Render each pane
    for (const [paneId, state] of this.panes) {
      // Set focus state
      state.pane.setFocused(paneId === activePaneId);
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

  // MouseHandler implementation
  containsPoint(x: number, y: number): boolean {
    for (const [, state] of this.panes) {
      if (state.pane.containsPoint(x, y)) {
        return true;
      }
    }
    return false;
  }

  onMouseEvent(event: MouseEvent): boolean {
    // Find which pane was clicked
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
