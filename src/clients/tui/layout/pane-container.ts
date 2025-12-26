/**
 * Pane Container
 *
 * Manages split pane layouts with support for horizontal and vertical splits.
 * Implements a tree structure where leaves are Panes and nodes are splits.
 */

import { debugLog } from '../../../debug.ts';
import type {
  Rect,
  SplitDirection,
  PaneConfig,
  SplitConfig,
  ElementType,
  isSplitConfig,
} from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import type { FocusManager, FocusResolver } from '../input/focus-manager.ts';
import { Pane, type PaneCallbacks } from './pane.ts';
import { BaseElement } from '../elements/base.ts';

// ============================================
// Types
// ============================================

/**
 * Split node in the layout tree.
 */
interface SplitNode {
  type: 'split';
  id: string;
  direction: SplitDirection;
  children: LayoutNode[];
  ratios: number[];
  bounds: Rect;
}

/**
 * A node in the layout tree - either a Pane or a SplitNode.
 */
type LayoutNode = Pane | SplitNode;

/**
 * Element type for focus color lookups.
 */
export type FocusableElementType = 'editor' | 'sidebar' | 'panel' | 'terminal';

/**
 * Tab info for dropdown menu.
 */
export interface TabDropdownInfo {
  id: string;
  title: string;
  isActive: boolean;
}

/**
 * Callbacks for pane container events.
 */
export interface PaneContainerCallbacks {
  /** Called when any content is dirty */
  onDirty: () => void;
  /** Get a theme color */
  getThemeColor: (key: string, fallback?: string) => string;
  /** Get a setting value */
  getSetting: <T>(key: string, defaultValue: T) => T;
  /** Called when an element close is requested via tab X. Return true to proceed, false to cancel. */
  onElementCloseRequest?: (elementId: string, element: BaseElement) => Promise<boolean>;
  /** Get background color for focus state */
  getBackgroundForFocus: (elementType: FocusableElementType, isFocused: boolean) => string;
  /** Get foreground color for focus state */
  getForegroundForFocus: (elementType: FocusableElementType, isFocused: boolean) => string;
  /** Get selection background for focus state */
  getSelectionBackground: (elementType: FocusableElementType, isFocused: boolean) => string;
  /** Called when tab dropdown is requested */
  onShowTabDropdown?: (paneId: string, tabs: TabDropdownInfo[], x: number, y: number) => void;
}

// ============================================
// Pane Container Class
// ============================================

export class PaneContainer implements FocusResolver {
  /** Root of the layout tree */
  private root: LayoutNode | null = null;

  /** Map of pane ID to Pane */
  private panes: Map<string, Pane> = new Map();

  /** Container bounds */
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 };

  /** Callbacks */
  private callbacks: PaneContainerCallbacks;

  /** Focus manager */
  private focusManager: FocusManager | null = null;

  /** ID counters */
  private nextPaneId = 1;
  private nextSplitId = 1;

  /** Divider size in characters */
  private static readonly DIVIDER_SIZE = 1;

  /** Reserved height at the bottom for terminal panel (only affects non-accordion panes) */
  private bottomReservedHeight = 0;

  constructor(callbacks: PaneContainerCallbacks) {
    this.callbacks = callbacks;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Focus Manager Integration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set the focus manager and register as resolver.
   */
  setFocusManager(focusManager: FocusManager): void {
    this.focusManager = focusManager;
    focusManager.setResolver(this);
  }

  // FocusResolver implementation
  getPaneIds(): string[] {
    return Array.from(this.panes.keys());
  }

  getElement(elementId: string): BaseElement | null {
    for (const pane of this.panes.values()) {
      const element = pane.getElement(elementId);
      if (element) return element;
    }
    return null;
  }

  findPaneForElement(elementId: string): string | null {
    for (const pane of this.panes.values()) {
      if (pane.hasElement(elementId)) {
        return pane.id;
      }
    }
    return null;
  }

  getActiveElementInPane(paneId: string): BaseElement | null {
    const pane = this.panes.get(paneId);
    if (!pane) return null;

    if (pane.getMode() === 'tabs') {
      return pane.getActiveElement();
    }
    // For accordion, return first visible element
    const elements = pane.getElements();
    return elements.find((e) => e.isVisible()) ?? elements[0] ?? null;
  }

  getElementsInPane(paneId: string): BaseElement[] {
    const pane = this.panes.get(paneId);
    return pane?.getElements() ?? [];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Initialization
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Ensure a root pane exists.
   */
  ensureRoot(): Pane {
    if (!this.root) {
      const pane = this.createPane();
      this.root = pane;
      // Layout the new pane
      this.layoutNode(pane, this.bounds);
    }

    if (this.root instanceof Pane) {
      return this.root;
    }

    return this.findFirstPane(this.root);
  }

  /**
   * Create a new pane.
   */
  private createPane(): Pane {
    const id = `pane-${this.nextPaneId++}`;
    const callbacks = this.createPaneCallbacks(id);
    const pane = new Pane(id, callbacks);
    this.panes.set(id, pane);
    this.setupPaneTabDropdown(pane);
    return pane;
  }

  private createPaneCallbacks(paneId: string): PaneCallbacks {
    const paneCallbacks: PaneCallbacks = {
      onDirty: () => this.callbacks.onDirty(),
      onFocusRequest: (elementId) => {
        debugLog(`[PaneContainer] Focus request for element: ${elementId} in pane: ${paneId}`);
        const result = this.focusManager?.focusElement(elementId);
        debugLog(`[PaneContainer] Focus result: ${result}`);
      },
      getThemeColor: (key, fallback) => this.callbacks.getThemeColor(key, fallback),
      getSetting: (key, defaultValue) => this.callbacks.getSetting(key, defaultValue),
      onElementCloseRequest: this.callbacks.onElementCloseRequest
        ? (elementId, element) => this.callbacks.onElementCloseRequest!(elementId, element)
        : undefined,
      isPaneFocused: () => this.focusManager?.isPaneFocused(paneId) ?? false,
      getBackgroundForFocus: (type, focused) => this.callbacks.getBackgroundForFocus(type, focused),
      getForegroundForFocus: (type, focused) => this.callbacks.getForegroundForFocus(type, focused),
      getSelectionBackground: (type, focused) => this.callbacks.getSelectionBackground(type, focused),
    };

    return paneCallbacks;
  }

  /**
   * Wire up the tab dropdown callback for a pane.
   * Called after pane creation to set up the dropdown.
   */
  private setupPaneTabDropdown(pane: Pane): void {
    if (this.callbacks.onShowTabDropdown) {
      pane.setTabDropdownCallback((tabs, x, y) => {
        this.callbacks.onShowTabDropdown!(pane.id, tabs, x, y);
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Layout
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set container bounds and re-layout.
   */
  setBounds(bounds: Rect): void {
    this.bounds = { ...bounds };
    if (this.root) {
      this.layoutNode(this.root, bounds);
    }
  }

  /**
   * Get container bounds.
   */
  getBounds(): Rect {
    return { ...this.bounds };
  }

  /**
   * Set reserved height at the bottom (for terminal panel).
   * This height is subtracted only from non-accordion panes (editor area).
   */
  setBottomReservedHeight(height: number): void {
    if (this.bottomReservedHeight === height) return;
    this.bottomReservedHeight = height;
    if (this.root) {
      this.layoutNode(this.root, this.bounds);
    }
  }

  /**
   * Get the bottom reserved height.
   */
  getBottomReservedHeight(): number {
    return this.bottomReservedHeight;
  }

  private layoutNode(node: LayoutNode, bounds: Rect): void {
    if (node instanceof Pane) {
      // For accordion panes (sidebar), use full height
      // For other panes (editor), reduce height by bottom reserved space
      let adjustedBounds = bounds;
      if (node.getMode() !== 'accordion' && this.bottomReservedHeight > 0) {
        adjustedBounds = {
          ...bounds,
          height: Math.max(1, bounds.height - this.bottomReservedHeight),
        };
      }
      node.setBounds(adjustedBounds);
      return;
    }

    // Split node
    node.bounds = { ...bounds };
    const { direction, children, ratios } = node;

    const isHorizontal = direction === 'horizontal';
    const totalSize = isHorizontal ? bounds.height : bounds.width;
    const dividerSpace = (children.length - 1) * PaneContainer.DIVIDER_SIZE;
    const availableSize = totalSize - dividerSpace;

    let offset = isHorizontal ? bounds.y : bounds.x;

    children.forEach((child, i) => {
      const size = Math.floor(availableSize * ratios[i]!);

      const childBounds: Rect = isHorizontal
        ? { x: bounds.x, y: offset, width: bounds.width, height: size }
        : { x: offset, y: bounds.y, width: size, height: bounds.height };

      this.layoutNode(child, childBounds);

      offset += size + (i < children.length - 1 ? PaneContainer.DIVIDER_SIZE : 0);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Splitting
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Split a pane.
   * @returns New pane ID
   */
  split(direction: SplitDirection, paneId?: string): string {
    const targetPaneId = paneId ?? this.focusManager?.getFocusedPaneId() ?? '';
    const targetPane = this.panes.get(targetPaneId);

    if (!targetPane) {
      // If no target, ensure root and split it
      const root = this.ensureRoot();
      return this.splitPane(root, direction);
    }

    return this.splitPane(targetPane, direction);
  }

  private splitPane(targetPane: Pane, direction: SplitDirection): string {
    const newPane = this.createPane();
    const parent = this.findParent(this.root!, targetPane);

    const splitNode: SplitNode = {
      type: 'split',
      id: `split-${this.nextSplitId++}`,
      direction,
      children: [targetPane, newPane],
      ratios: [0.5, 0.5],
      bounds: targetPane.getBounds(),
    };

    if (!parent) {
      // Target is root
      this.root = splitNode;
    } else if ('children' in parent) {
      // Replace in parent split
      const idx = parent.children.indexOf(targetPane);
      parent.children[idx] = splitNode;
    }

    // Re-layout
    this.layoutNode(this.root!, this.bounds);
    this.callbacks.onDirty();

    return newPane.id;
  }

  /**
   * Close a pane.
   */
  close(paneId: string): boolean {
    const pane = this.panes.get(paneId);
    if (!pane) return false;

    // Unmount all elements
    pane.unmountAll();
    this.panes.delete(paneId);

    const parent = this.findParent(this.root!, pane);

    if (!parent) {
      // Closing root pane - create new empty one
      this.root = this.createPane();
    } else if ('children' in parent) {
      const idx = parent.children.indexOf(pane);
      parent.children.splice(idx, 1);
      parent.ratios.splice(idx, 1);

      // Redistribute ratios
      const total = parent.ratios.reduce((a, b) => a + b, 0);
      if (total > 0) {
        parent.ratios = parent.ratios.map((r) => r / total);
      }

      // If only one child left, collapse the split
      if (parent.children.length === 1) {
        const child = parent.children[0]!;
        const grandparent = this.findParent(this.root!, parent);

        if (!grandparent) {
          this.root = child;
        } else if ('children' in grandparent) {
          const idx = grandparent.children.indexOf(parent);
          grandparent.children[idx]! = child;
        }
      }
    }

    // Move focus to sibling
    if (this.focusManager?.getFocusedPaneId() === paneId) {
      const firstPane = this.findFirstPane(this.root!);
      this.focusManager.focusPane(firstPane.id);
    }

    this.layoutNode(this.root!, this.bounds);
    this.callbacks.onDirty();
    return true;
  }

  /**
   * Adjust split ratios.
   */
  adjustRatios(splitId: string, ratios: number[]): boolean {
    const split = this.findSplit(this.root, splitId);
    if (!split) return false;

    if (ratios.length !== split.children.length) return false;

    // Normalize ratios
    const total = ratios.reduce((a, b) => a + b, 0);
    split.ratios = ratios.map((r) => r / total);

    this.layoutNode(this.root!, this.bounds);
    this.callbacks.onDirty();
    return true;
  }

  /**
   * Swap the order of children in a split (e.g., to move sidebar from left to right).
   * Swaps both children and ratios so each pane keeps its size.
   */
  swapSplitChildren(splitId: string): boolean {
    const split = this.findSplit(this.root, splitId);
    if (!split) return false;

    // Reverse both children and ratios - each pane keeps its size
    split.children.reverse();
    split.ratios.reverse();

    // Re-layout to apply changes
    this.layoutNode(this.root!, this.bounds);
    this.callbacks.onDirty();
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Element Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Add an element to a pane.
   */
  addElement(paneId: string, elementType: ElementType, title?: string): string {
    const pane = this.panes.get(paneId);
    if (!pane) {
      throw new Error(`Pane not found: ${paneId}`);
    }
    return pane.addElement(elementType, title);
  }

  /**
   * Remove an element.
   */
  removeElement(elementId: string): boolean {
    for (const pane of this.panes.values()) {
      if (pane.hasElement(elementId)) {
        return pane.removeElement(elementId);
      }
    }
    return false;
  }

  /**
   * Move an element between panes.
   */
  moveElement(elementId: string, targetPaneId: string): boolean {
    const targetPane = this.panes.get(targetPaneId);
    if (!targetPane) return false;

    // Find source pane
    let sourcePane: Pane | null = null;
    for (const pane of this.panes.values()) {
      if (pane.hasElement(elementId)) {
        sourcePane = pane;
        break;
      }
    }

    if (!sourcePane || sourcePane.id === targetPaneId) return false;

    const element = sourcePane.detachElement(elementId);
    if (!element) return false;

    targetPane.attachElement(element);
    this.callbacks.onDirty();
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Render the pane container.
   */
  render(buffer: ScreenBuffer): void {
    if (this.root) {
      this.renderNode(this.root, buffer);
    }
  }

  private renderNode(node: LayoutNode, buffer: ScreenBuffer): void {
    if (node instanceof Pane) {
      node.render(buffer);
      return;
    }

    // Render children
    for (const child of node.children) {
      this.renderNode(child, buffer);
    }

    // Render dividers
    this.renderDividers(node, buffer);
  }

  private renderDividers(split: SplitNode, buffer: ScreenBuffer): void {
    const { direction, bounds, children, ratios } = split;
    const isHorizontal = direction === 'horizontal';

    const dividerFg = this.callbacks.getThemeColor('panel.border', '#404040');
    const dividerBg = this.callbacks.getThemeColor('editor.background', '#1e1e1e');

    const totalSize = isHorizontal ? bounds.height : bounds.width;
    const dividerSpace = (children.length - 1) * PaneContainer.DIVIDER_SIZE;
    const availableSize = totalSize - dividerSpace;

    let offset = isHorizontal ? bounds.y : bounds.x;

    for (let i = 0; i < children.length - 1; i++) {
      const size = Math.floor(availableSize * ratios[i]!);
      offset += size;

      if (isHorizontal) {
        // Horizontal divider (line across width)
        for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
          buffer.set(x, offset, { char: '─', fg: dividerFg, bg: dividerBg });
        }
      } else {
        // Vertical divider (line down height)
        for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
          buffer.set(offset, y, { char: '│', fg: dividerFg, bg: dividerBg });
        }
      }

      offset += PaneContainer.DIVIDER_SIZE;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Serialization
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Serialize the layout.
   */
  serialize(): PaneConfig | SplitConfig {
    if (!this.root) {
      return { id: 'empty', mode: 'tabs', elements: [] };
    }
    return this.serializeNode(this.root);
  }

  private serializeNode(node: LayoutNode): PaneConfig | SplitConfig {
    if (node instanceof Pane) {
      return node.serialize();
    }

    return {
      id: node.id,
      direction: node.direction,
      children: node.children.map((c) => this.serializeNode(c)),
      ratios: node.ratios,
    };
  }

  /**
   * Deserialize a layout.
   */
  deserialize(config: PaneConfig | SplitConfig): void {
    // Clear existing panes
    for (const pane of this.panes.values()) {
      pane.unmountAll();
    }
    this.panes.clear();

    this.root = this.deserializeNode(config);
    this.layoutNode(this.root, this.bounds);
  }

  private deserializeNode(config: PaneConfig | SplitConfig): LayoutNode {
    if ('mode' in config) {
      // PaneConfig
      const pane = this.createPane();
      pane.deserialize(config);
      return pane;
    }

    // SplitConfig
    return {
      type: 'split',
      id: config.id,
      direction: config.direction,
      children: config.children.map((c) => this.deserializeNode(c)),
      ratios: config.ratios,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Queries
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get all panes.
   */
  getPanes(): Pane[] {
    return Array.from(this.panes.values());
  }

  /**
   * Get a pane by ID.
   */
  getPane(id: string): Pane | null {
    return this.panes.get(id) ?? null;
  }

  /**
   * Get pane count.
   */
  getPaneCount(): number {
    return this.panes.size;
  }

  /**
   * Check if empty.
   */
  isEmpty(): boolean {
    return this.panes.size === 0;
  }

  /**
   * Find the pane at a specific position (for mouse clicks).
   */
  findPaneAtPoint(x: number, y: number): Pane | null {
    if (!this.root) return null;
    return this.findPaneAtPointInNode(this.root, x, y);
  }

  private findPaneAtPointInNode(node: LayoutNode, x: number, y: number): Pane | null {
    if (node instanceof Pane) {
      const bounds = node.getBounds();
      if (x >= bounds.x && x < bounds.x + bounds.width &&
          y >= bounds.y && y < bounds.y + bounds.height) {
        return node;
      }
      return null;
    }

    // Split node - check children
    for (const child of node.children) {
      const found = this.findPaneAtPointInNode(child, x, y);
      if (found) return found;
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private findParent(node: LayoutNode, target: LayoutNode): SplitNode | null {
    if (node instanceof Pane) {
      return null;
    }

    for (const child of node.children) {
      if (child === target) {
        return node;
      }
      const found = this.findParent(child, target);
      if (found) return found;
    }

    return null;
  }

  private findFirstPane(node: LayoutNode): Pane {
    if (node instanceof Pane) {
      return node;
    }
    return this.findFirstPane(node.children[0]!);
  }

  private findSplit(node: LayoutNode | null, splitId: string): SplitNode | null {
    if (!node || node instanceof Pane) {
      return null;
    }

    if (node.id === splitId) {
      return node;
    }

    for (const child of node.children) {
      const found = this.findSplit(child, splitId);
      if (found) return found;
    }

    return null;
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a new pane container.
 */
export function createPaneContainer(callbacks: PaneContainerCallbacks): PaneContainer {
  return new PaneContainer(callbacks);
}
