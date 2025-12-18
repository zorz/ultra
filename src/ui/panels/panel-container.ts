/**
 * Panel Container
 *
 * A generic container that can hold one or more PanelContent instances.
 * Supports two display modes:
 * - 'single': Shows one content at a time (sidebar style)
 * - 'tabbed': Shows tabs for switching between content (editor style)
 */

import type { RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import type { KeyEvent } from '../../terminal/input.ts';
import type { PanelContent, ContentType, ContentState } from './panel-content.interface.ts';
import { PanelTabBar, type TabDisplayMode } from './panel-tab-bar.ts';
import { contentRegistry } from './content-registry.ts';
import { debugLog, isDebugEnabled } from '../../debug.ts';

// ==================== Container Types ====================

/**
 * Display mode for the container.
 * - 'single': One content visible at a time, no tabs
 * - 'tabbed': Tab bar at top, content below
 */
export type ContainerDisplayMode = 'single' | 'tabbed';

/**
 * Serializable container state.
 */
export interface ContainerState {
  containerId: string;
  displayMode: ContainerDisplayMode;
  activeContentId: string | null;
  contentIds: string[];
  contentStates: ContentState[];
}

// ==================== Panel Container ====================

export class PanelContainer implements MouseHandler {
  readonly containerId: string;

  private rect: Rect = { x: 1, y: 1, width: 80, height: 24 };
  private _displayMode: ContainerDisplayMode = 'tabbed';
  private contents: Map<string, PanelContent> = new Map();
  private contentOrder: string[] = []; // Maintains tab order
  private activeContentId: string | null = null;
  private tabBar: PanelTabBar;
  private tabBarHeight: number = 1;
  private isFocused: boolean = false;
  private visible: boolean = true;

  // Region this container belongs to
  private region: 'sidebar-left' | 'sidebar-right' | 'panel-bottom' | 'editor-area' = 'editor-area';

  // Callbacks
  private onContentChangeCallbacks: ((content: PanelContent | null) => void)[] = [];
  private onContentCloseCallbacks: ((contentId: string) => void)[] = [];
  private onFocusCallbacks: (() => void)[] = [];

  constructor(containerId: string, displayMode: ContainerDisplayMode = 'tabbed') {
    this.containerId = containerId;
    this._displayMode = displayMode;
    this.tabBar = new PanelTabBar();
    this.setupTabBarCallbacks();
  }

  /**
   * Set up tab bar event handlers.
   */
  private setupTabBarCallbacks(): void {
    this.tabBar.onTabClick((contentId) => {
      this.setActiveContent(contentId);
    });

    this.tabBar.onTabClose((contentId) => {
      this.emitContentClose(contentId);
    });
  }

  // ==================== Layout ====================

  /**
   * Get container rect.
   */
  getRect(): Rect {
    return this.rect;
  }

  /**
   * Set container rect and update child layouts.
   */
  setRect(rect: Rect): void {
    this.rect = rect;
    this.updateChildRects();
  }

  /**
   * Update child content rects based on container rect and display mode.
   */
  private updateChildRects(): void {
    // Tab bar rect (only in tabbed mode with multiple items)
    const showTabBar = this._displayMode === 'tabbed' && this.contents.size > 0;
    const effectiveTabBarHeight = showTabBar ? this.tabBarHeight : 0;

    if (showTabBar) {
      this.tabBar.setRect({
        x: this.rect.x,
        y: this.rect.y,
        width: this.rect.width,
        height: this.tabBarHeight,
      });
    }

    // Content area rect
    const contentRect: Rect = {
      x: this.rect.x,
      y: this.rect.y + effectiveTabBarHeight,
      width: this.rect.width,
      height: this.rect.height - effectiveTabBarHeight,
    };

    // Update all content rects (they all share the same space)
    for (const content of this.contents.values()) {
      content.setRect(contentRect);
    }
  }

  /**
   * Get the content area rect (excluding tab bar).
   */
  getContentRect(): Rect {
    const showTabBar = this._displayMode === 'tabbed' && this.contents.size > 0;
    const effectiveTabBarHeight = showTabBar ? this.tabBarHeight : 0;

    return {
      x: this.rect.x,
      y: this.rect.y + effectiveTabBarHeight,
      width: this.rect.width,
      height: this.rect.height - effectiveTabBarHeight,
    };
  }

  // ==================== Display Mode ====================

  /**
   * Get current display mode.
   */
  get displayMode(): ContainerDisplayMode {
    return this._displayMode;
  }

  /**
   * Set display mode.
   */
  set displayMode(mode: ContainerDisplayMode) {
    if (this._displayMode !== mode) {
      this._displayMode = mode;
      this.updateChildRects();
    }
  }

  /**
   * Set tab display mode (icon-only, text-only, icon-and-text).
   */
  setTabDisplayMode(mode: TabDisplayMode): void {
    this.tabBar.setDisplayMode(mode);
  }

  /**
   * Get tab display mode.
   */
  getTabDisplayMode(): TabDisplayMode {
    return this.tabBar.getDisplayMode();
  }

  // ==================== Region ====================

  /**
   * Get the region this container belongs to.
   */
  getRegion(): 'sidebar-left' | 'sidebar-right' | 'panel-bottom' | 'editor-area' {
    return this.region;
  }

  /**
   * Set the region this container belongs to.
   */
  setRegion(region: 'sidebar-left' | 'sidebar-right' | 'panel-bottom' | 'editor-area'): void {
    this.region = region;
  }

  // ==================== Content Management ====================

  /**
   * Add content to this container.
   *
   * @param content - Content to add
   * @param activate - Whether to make this the active content
   * @returns The content ID
   */
  addContent(content: PanelContent, activate: boolean = true): string {
    // Check if content is allowed in this region
    if (!contentRegistry.canDisplayInRegion(content.contentType, this.region)) {
      this.debugLog(`Content type ${content.contentType} not allowed in region ${this.region}`);
      return content.contentId;
    }

    // Check if already added
    if (this.contents.has(content.contentId)) {
      if (activate) {
        this.setActiveContent(content.contentId);
      }
      return content.contentId;
    }

    this.contents.set(content.contentId, content);
    this.contentOrder.push(content.contentId);

    // Update content rect
    content.setRect(this.getContentRect());

    // Activate if requested or if this is the first content
    if (activate || this.activeContentId === null) {
      this.setActiveContent(content.contentId);
    }

    this.updateTabBar();
    this.debugLog(`Added content: ${content.contentId}`);

    return content.contentId;
  }

  /**
   * Remove content from this container.
   *
   * @param contentId - ID of content to remove
   * @returns true if content was removed
   */
  removeContent(contentId: string): boolean {
    const content = this.contents.get(contentId);
    if (!content) {
      return false;
    }

    // Deactivate if active
    if (this.activeContentId === contentId) {
      content.onDeactivated?.();
      content.setVisible(false);

      // Find next content to activate
      const orderIndex = this.contentOrder.indexOf(contentId);
      this.contentOrder.splice(orderIndex, 1);
      this.contents.delete(contentId);

      // Activate adjacent tab or null
      const newActiveId = this.contentOrder[Math.min(orderIndex, this.contentOrder.length - 1)] || null;
      this.activeContentId = newActiveId;

      if (newActiveId) {
        const newActive = this.contents.get(newActiveId);
        if (newActive) {
          newActive.setVisible(true);
          newActive.onActivated?.();
        }
      }

      this.emitContentChange(this.getActiveContent());
    } else {
      this.contentOrder = this.contentOrder.filter(id => id !== contentId);
      this.contents.delete(contentId);
    }

    this.updateTabBar();
    this.debugLog(`Removed content: ${contentId}`);

    return true;
  }

  /**
   * Get content by ID.
   */
  getContent(contentId: string): PanelContent | undefined {
    return this.contents.get(contentId);
  }

  /**
   * Get the active content.
   */
  getActiveContent(): PanelContent | null {
    if (!this.activeContentId) return null;
    return this.contents.get(this.activeContentId) || null;
  }

  /**
   * Set the active content.
   *
   * @param contentId - ID of content to activate
   */
  setActiveContent(contentId: string): void {
    if (contentId === this.activeContentId) return;

    const newContent = this.contents.get(contentId);
    if (!newContent) return;

    // Deactivate current
    if (this.activeContentId) {
      const currentContent = this.contents.get(this.activeContentId);
      if (currentContent) {
        currentContent.onDeactivated?.();
        currentContent.setVisible(false);
      }
    }

    // Activate new
    this.activeContentId = contentId;
    newContent.setVisible(true);
    newContent.onActivated?.();

    this.updateTabBar();
    this.emitContentChange(newContent);
    this.debugLog(`Activated content: ${contentId}`);
  }

  /**
   * Get all content in this container.
   */
  getAllContent(): PanelContent[] {
    return this.contentOrder.map(id => this.contents.get(id)!);
  }

  /**
   * Get content count.
   */
  get contentCount(): number {
    return this.contents.size;
  }

  /**
   * Check if container has any content.
   */
  isEmpty(): boolean {
    return this.contents.size === 0;
  }

  /**
   * Get content by type.
   */
  getContentByType(type: ContentType): PanelContent[] {
    return this.getAllContent().filter(c => c.contentType === type);
  }

  /**
   * Move content to a specific index in the tab order.
   */
  moveContent(contentId: string, newIndex: number): void {
    const currentIndex = this.contentOrder.indexOf(contentId);
    if (currentIndex === -1) return;

    this.contentOrder.splice(currentIndex, 1);
    this.contentOrder.splice(Math.max(0, Math.min(newIndex, this.contentOrder.length)), 0, contentId);
    this.updateTabBar();
  }

  // ==================== Focus ====================

  /**
   * Check if container is focused.
   */
  isFocusedState(): boolean {
    return this.isFocused;
  }

  /**
   * Set focus state.
   */
  setFocused(focused: boolean): void {
    if (this.isFocused === focused) return;

    this.isFocused = focused;
    this.tabBar.setFocused(focused);

    if (focused) {
      this.emitFocus();
    }
  }

  // ==================== Visibility ====================

  /**
   * Check if container is visible.
   */
  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Set visibility.
   */
  setVisible(visible: boolean): void {
    this.visible = visible;
  }

  // ==================== Tab Bar ====================

  /**
   * Update tab bar with current content.
   */
  private updateTabBar(): void {
    this.tabBar.updateFromContent(this.getAllContent(), this.activeContentId);
  }

  /**
   * Get tab bar height.
   */
  getTabBarHeight(): number {
    return this._displayMode === 'tabbed' && this.contents.size > 0 ? this.tabBarHeight : 0;
  }

  // ==================== Rendering ====================

  /**
   * Render the container and its content.
   */
  render(ctx: RenderContext): void {
    if (!this.visible || this.rect.width <= 0 || this.rect.height <= 0) {
      return;
    }

    // Render tab bar in tabbed mode
    if (this._displayMode === 'tabbed' && this.contents.size > 0) {
      this.tabBar.render(ctx);
    }

    // Render active content
    const activeContent = this.getActiveContent();
    if (activeContent) {
      activeContent.render(ctx);
    }
  }

  // ==================== Input Handling ====================

  /**
   * Handle keyboard input.
   */
  handleKey(event: KeyEvent): boolean {
    const activeContent = this.getActiveContent();
    if (activeContent?.handleKey) {
      return activeContent.handleKey(event);
    }
    return false;
  }

  /**
   * Check if point is within container bounds.
   */
  containsPoint(x: number, y: number): boolean {
    return (
      x >= this.rect.x &&
      x < this.rect.x + this.rect.width &&
      y >= this.rect.y &&
      y < this.rect.y + this.rect.height
    );
  }

  /**
   * Handle mouse input.
   */
  onMouseEvent(event: MouseEvent): boolean {
    // Check tab bar first (in tabbed mode)
    if (this._displayMode === 'tabbed' && this.contents.size > 0) {
      if (this.tabBar.containsPoint(event.x, event.y)) {
        return this.tabBar.onMouseEvent(event);
      }
    }

    // Delegate to active content
    const activeContent = this.getActiveContent();
    if (activeContent?.handleMouse) {
      return activeContent.handleMouse(event);
    }

    return false;
  }

  // ==================== Serialization ====================

  /**
   * Serialize container state for session persistence.
   */
  serialize(): ContainerState {
    const contentStates: ContentState[] = [];
    for (const content of this.contents.values()) {
      if (content.serialize) {
        contentStates.push(content.serialize());
      }
    }

    return {
      containerId: this.containerId,
      displayMode: this._displayMode,
      activeContentId: this.activeContentId,
      contentIds: [...this.contentOrder],
      contentStates,
    };
  }

  /**
   * Restore container state from serialized data.
   */
  restore(state: ContainerState): void {
    this._displayMode = state.displayMode;

    // Restore content
    for (const contentState of state.contentStates) {
      const content = contentRegistry.restoreContent(contentState);
      if (content) {
        this.addContent(content, false);
      }
    }

    // Restore tab order
    this.contentOrder = state.contentIds.filter(id => this.contents.has(id));

    // Restore active content
    if (state.activeContentId && this.contents.has(state.activeContentId)) {
      this.setActiveContent(state.activeContentId);
    }

    this.updateTabBar();
    this.updateChildRects();
  }

  // ==================== Callbacks ====================

  /**
   * Register callback for content changes.
   */
  onContentChange(callback: (content: PanelContent | null) => void): () => void {
    this.onContentChangeCallbacks.push(callback);
    return () => {
      this.onContentChangeCallbacks = this.onContentChangeCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Register callback for content close requests.
   */
  onContentClose(callback: (contentId: string) => void): () => void {
    this.onContentCloseCallbacks.push(callback);
    return () => {
      this.onContentCloseCallbacks = this.onContentCloseCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Register callback for focus.
   */
  onFocus(callback: () => void): () => void {
    this.onFocusCallbacks.push(callback);
    return () => {
      this.onFocusCallbacks = this.onFocusCallbacks.filter(cb => cb !== callback);
    };
  }

  private emitContentChange(content: PanelContent | null): void {
    for (const cb of this.onContentChangeCallbacks) {
      cb(content);
    }
  }

  private emitContentClose(contentId: string): void {
    for (const cb of this.onContentCloseCallbacks) {
      cb(contentId);
    }
  }

  private emitFocus(): void {
    for (const cb of this.onFocusCallbacks) {
      cb();
    }
  }

  // ==================== Cleanup ====================

  /**
   * Dispose container and all its content.
   */
  dispose(): void {
    for (const content of this.contents.values()) {
      content.dispose?.();
    }
    this.contents.clear();
    this.contentOrder = [];
    this.activeContentId = null;
    this.onContentChangeCallbacks = [];
    this.onContentCloseCallbacks = [];
    this.onFocusCallbacks = [];
  }

  // ==================== Debug ====================

  private debugLog(message: string): void {
    if (isDebugEnabled()) {
      debugLog(`[PanelContainer:${this.containerId}] ${message}`);
    }
  }
}

export default PanelContainer;
