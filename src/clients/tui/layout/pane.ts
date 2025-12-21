/**
 * Pane
 *
 * Container for elements that can display in tabs or accordion mode.
 * Manages element lifecycle, layout, and rendering.
 */

import type {
  Rect,
  Size,
  ContainerMode,
  PaneConfig,
  ElementType,
  ElementConfig,
} from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import { BaseElement, type ElementContext } from '../elements/base.ts';
import { createElement, createElementWithFallback } from '../elements/factory.ts';

// ============================================
// Types
// ============================================

/**
 * Element type for focus color lookups.
 */
export type FocusableElementType = 'editor' | 'sidebar' | 'panel' | 'terminal';

/**
 * Callbacks for pane events.
 */
export interface PaneCallbacks {
  /** Called when pane content is dirty and needs re-render */
  onDirty: (region?: Rect) => void;
  /** Called when an element requests focus */
  onFocusRequest: (elementId: string) => void;
  /** Get a theme color */
  getThemeColor: (key: string, fallback?: string) => string;
  /** Called when an element is closed via tab X (optional) */
  onElementClose?: (elementId: string, element: BaseElement) => void;
  /** Check if this pane is focused */
  isPaneFocused: () => boolean;
  /** Get background color for focus state */
  getBackgroundForFocus: (elementType: FocusableElementType, isFocused: boolean) => string;
  /** Get foreground color for focus state */
  getForegroundForFocus: (elementType: FocusableElementType, isFocused: boolean) => string;
  /** Get selection background for focus state */
  getSelectionBackground: (elementType: FocusableElementType, isFocused: boolean) => string;
}

/**
 * Theme colors used by pane rendering.
 */
export interface PaneThemeColors {
  tabActiveBackground: string;
  tabActiveForeground: string;
  tabInactiveBackground: string;
  tabInactiveForeground: string;
  tabBorder: string;
  tabBarBackground: string;
  accordionHeaderBackground: string;
  accordionHeaderForeground: string;
}

// ============================================
// Pane Class
// ============================================

export class Pane {
  /** Unique pane ID */
  readonly id: string;

  /** Container mode (tabs or accordion) */
  private mode: ContainerMode = 'tabs';

  /** Elements in this pane */
  private elements: BaseElement[] = [];

  /** Active element index (for tabs) */
  private activeElementIndex = 0;

  /** Expanded element IDs (for accordion) */
  private expandedElementIds: Set<string> = new Set();

  /** Pane bounds */
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 };

  /** Callbacks */
  private callbacks: PaneCallbacks;

  /** Element ID counter */
  private nextElementId = 1;

  /** Tab bar height */
  private static readonly TAB_BAR_HEIGHT = 1;

  /** Accordion header height */
  private static readonly HEADER_HEIGHT = 1;

  constructor(id: string, callbacks: PaneCallbacks) {
    this.id = id;
    this.callbacks = callbacks;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Mode
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the current container mode.
   */
  getMode(): ContainerMode {
    return this.mode;
  }

  /**
   * Set the container mode.
   */
  setMode(mode: ContainerMode): void {
    if (this.mode === mode) return;

    this.mode = mode;

    // Reset visibility states
    if (mode === 'tabs') {
      // Only active element is visible
      this.elements.forEach((el, i) => {
        el.onVisibilityChange(i === this.activeElementIndex);
      });
    } else {
      // Accordion: all expanded elements are visible
      this.elements.forEach((el) => {
        el.onVisibilityChange(this.expandedElementIds.has(el.id));
      });
    }

    this.layoutElements();
    this.markDirty();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Element Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Add an element to the pane.
   * @returns The new element's ID
   */
  addElement(type: ElementType, title?: string, state?: unknown): string {
    const id = `${this.id}-elem-${this.nextElementId++}`;
    const elementTitle = title ?? this.getDefaultTitle(type);

    const ctx = this.createElementContext(id);
    const config: ElementConfig = { type, id, title: elementTitle, state };
    const element = createElementWithFallback(config, ctx);

    this.elements.push(element);
    element.onMount();

    // For tabs, make new element active
    if (this.mode === 'tabs') {
      // Hide previous active
      if (this.elements.length > 1) {
        this.elements[this.activeElementIndex]?.onVisibilityChange(false);
      }
      this.activeElementIndex = this.elements.length - 1;
    }

    // For accordion, expand it
    if (this.mode === 'accordion') {
      this.expandedElementIds.add(id);
    }

    this.layoutElements();
    element.onVisibilityChange(true);
    this.markDirty();

    return id;
  }

  /**
   * Remove an element from the pane.
   */
  removeElement(elementId: string): boolean {
    const idx = this.elements.findIndex((e) => e.id === elementId);
    if (idx === -1) return false;

    const element = this.elements[idx]!;
    element.onVisibilityChange(false);
    element.onUnmount();
    this.elements.splice(idx, 1);
    this.expandedElementIds.delete(elementId);

    // Adjust active index
    if (this.mode === 'tabs') {
      if (idx < this.activeElementIndex) {
        this.activeElementIndex--;
      } else if (idx === this.activeElementIndex) {
        this.activeElementIndex = Math.min(
          this.activeElementIndex,
          this.elements.length - 1
        );
        if (this.activeElementIndex >= 0) {
          this.elements[this.activeElementIndex]?.onVisibilityChange(true);
        }
      }
    }

    this.layoutElements();
    this.markDirty();
    return true;
  }

  /**
   * Detach an element without unmounting (for moving to another pane).
   */
  detachElement(elementId: string): BaseElement | null {
    const idx = this.elements.findIndex((e) => e.id === elementId);
    if (idx === -1) return null;

    const element = this.elements[idx]!;
    element.onVisibilityChange(false);
    this.elements.splice(idx, 1);
    this.expandedElementIds.delete(elementId);

    // Adjust active index for tabs
    if (this.mode === 'tabs' && idx <= this.activeElementIndex) {
      this.activeElementIndex = Math.max(0, this.activeElementIndex - 1);
      if (this.elements[this.activeElementIndex]) {
        this.elements[this.activeElementIndex]!.onVisibilityChange(true);
      }
    }

    this.layoutElements();
    this.markDirty();
    return element;
  }

  /**
   * Attach an element that was detached from another pane.
   */
  attachElement(element: BaseElement): void {
    // Update element context
    element.setContext(this.createElementContext(element.id));

    this.elements.push(element);

    if (this.mode === 'tabs') {
      // Hide previous active
      if (this.elements.length > 1) {
        this.elements[this.activeElementIndex]?.onVisibilityChange(false);
      }
      this.activeElementIndex = this.elements.length - 1;
    }

    if (this.mode === 'accordion') {
      this.expandedElementIds.add(element.id);
    }

    this.layoutElements();
    element.onVisibilityChange(true);
    this.markDirty();
  }

  /**
   * Check if pane contains an element.
   */
  hasElement(elementId: string): boolean {
    return this.elements.some((e) => e.id === elementId);
  }

  /**
   * Get an element by ID.
   */
  getElement(elementId: string): BaseElement | null {
    return this.elements.find((e) => e.id === elementId) ?? null;
  }

  /**
   * Get all elements.
   */
  getElements(): BaseElement[] {
    return [...this.elements];
  }

  /**
   * Get element count.
   */
  getElementCount(): number {
    return this.elements.length;
  }

  /**
   * Unmount all elements (for cleanup).
   */
  unmountAll(): void {
    for (const element of this.elements) {
      element.onVisibilityChange(false);
      element.onUnmount();
    }
    this.elements = [];
    this.expandedElementIds.clear();
    this.activeElementIndex = 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tab Operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the active element (for tabs mode).
   */
  getActiveElement(): BaseElement | null {
    if (this.elements.length === 0) {
      return null;
    }
    return this.elements[this.activeElementIndex] ?? null;
  }

  /**
   * Get the active element index.
   */
  getActiveElementIndex(): number {
    return this.activeElementIndex;
  }

  /**
   * Set the active element (for tabs mode).
   */
  setActiveElement(elementId: string): boolean {
    const idx = this.elements.findIndex((e) => e.id === elementId);
    if (idx === -1) return false;
    if (idx === this.activeElementIndex) return true;

    // Hide previous
    this.elements[this.activeElementIndex]?.onVisibilityChange(false);

    this.activeElementIndex = idx;

    // Show new
    this.elements[idx]!.onVisibilityChange(true);
    this.layoutElements();
    this.markDirty();
    return true;
  }

  /**
   * Switch to next tab.
   */
  nextTab(): void {
    if (this.elements.length === 0) return;

    const prev = this.elements[this.activeElementIndex];
    prev?.onVisibilityChange(false);

    this.activeElementIndex = (this.activeElementIndex + 1) % this.elements.length;

    const next = this.elements[this.activeElementIndex]!;
    next.onVisibilityChange(true);
    this.layoutElements();
    this.markDirty();
  }

  /**
   * Switch to previous tab.
   */
  prevTab(): void {
    if (this.elements.length === 0) return;

    const prev = this.elements[this.activeElementIndex];
    prev?.onVisibilityChange(false);

    this.activeElementIndex =
      (this.activeElementIndex - 1 + this.elements.length) % this.elements.length;

    const next = this.elements[this.activeElementIndex]!;
    next.onVisibilityChange(true);
    this.layoutElements();
    this.markDirty();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Accordion Operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Toggle an accordion section.
   */
  toggleAccordionSection(elementId: string): boolean {
    if (!this.hasElement(elementId)) return false;

    if (this.expandedElementIds.has(elementId)) {
      this.expandedElementIds.delete(elementId);
      this.getElement(elementId)?.onVisibilityChange(false);
    } else {
      this.expandedElementIds.add(elementId);
      this.getElement(elementId)?.onVisibilityChange(true);
    }

    this.layoutElements();
    this.markDirty();
    return true;
  }

  /**
   * Check if an accordion section is expanded.
   */
  isAccordionExpanded(elementId: string): boolean {
    return this.expandedElementIds.has(elementId);
  }

  /**
   * Expand an accordion section.
   */
  expandAccordionSection(elementId: string): boolean {
    if (!this.hasElement(elementId)) return false;
    if (this.expandedElementIds.has(elementId)) return true;

    this.expandedElementIds.add(elementId);
    this.getElement(elementId)?.onVisibilityChange(true);
    this.layoutElements();
    this.markDirty();
    return true;
  }

  /**
   * Collapse an accordion section.
   */
  collapseAccordionSection(elementId: string): boolean {
    if (!this.expandedElementIds.has(elementId)) return false;

    this.expandedElementIds.delete(elementId);
    this.getElement(elementId)?.onVisibilityChange(false);
    this.layoutElements();
    this.markDirty();
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Layout
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set pane bounds.
   */
  setBounds(bounds: Rect): void {
    this.bounds = { ...bounds };
    this.layoutElements();
  }

  /**
   * Get pane bounds.
   */
  getBounds(): Rect {
    return { ...this.bounds };
  }

  /**
   * Get content bounds (excluding tab bar or headers).
   */
  getContentBounds(): Rect {
    if (this.mode === 'tabs') {
      return {
        x: this.bounds.x,
        y: this.bounds.y + Pane.TAB_BAR_HEIGHT,
        width: this.bounds.width,
        height: Math.max(0, this.bounds.height - Pane.TAB_BAR_HEIGHT),
      };
    }
    // Accordion content bounds depend on which sections are expanded
    // This returns the total available area
    const headerTotal = this.elements.length * Pane.HEADER_HEIGHT;
    return {
      x: this.bounds.x,
      y: this.bounds.y,
      width: this.bounds.width,
      height: Math.max(0, this.bounds.height - headerTotal),
    };
  }

  private layoutElements(): void {
    if (this.mode === 'tabs') {
      this.layoutTabs();
    } else {
      this.layoutAccordion();
    }
  }

  private layoutTabs(): void {
    // All elements share same content bounds
    const contentBounds = this.getContentBounds();

    for (const element of this.elements) {
      element.setBounds(contentBounds);
    }
  }

  private layoutAccordion(): void {
    let y = this.bounds.y;

    // Calculate height per expanded element
    const expandedCount = this.expandedElementIds.size;
    const totalHeaderHeight = this.elements.length * Pane.HEADER_HEIGHT;
    const availableContentHeight = Math.max(0, this.bounds.height - totalHeaderHeight);
    const heightPerExpanded =
      expandedCount > 0 ? Math.floor(availableContentHeight / expandedCount) : 0;

    for (const element of this.elements) {
      const isExpanded = this.expandedElementIds.has(element.id);

      // Element bounds start after header
      element.setBounds({
        x: this.bounds.x,
        y: y + Pane.HEADER_HEIGHT,
        width: this.bounds.width,
        height: isExpanded ? heightPerExpanded : 0,
      });

      y += Pane.HEADER_HEIGHT + (isExpanded ? heightPerExpanded : 0);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Render the pane to the buffer.
   */
  render(buffer: ScreenBuffer): void {
    if (this.mode === 'tabs') {
      this.renderTabs(buffer);
    } else {
      this.renderAccordion(buffer);
    }
  }

  private renderTabs(buffer: ScreenBuffer): void {
    this.renderTabBar(buffer);

    // Render active element only
    const activeElement = this.getActiveElement();
    if (activeElement && activeElement.isVisible()) {
      activeElement.render(buffer);
    } else if (this.elements.length === 0) {
      // Render placeholder for empty pane
      this.renderEmptyPane(buffer);
    }
  }

  private renderEmptyPane(buffer: ScreenBuffer): void {
    const isPaneFocused = this.callbacks.isPaneFocused();
    const bg = this.callbacks.getBackgroundForFocus('editor', isPaneFocused);
    const fg = this.callbacks.getForegroundForFocus('editor', isPaneFocused);

    // Fill content area with background
    const contentY = this.bounds.y + Pane.TAB_BAR_HEIGHT;
    const contentHeight = this.bounds.height - Pane.TAB_BAR_HEIGHT;

    for (let y = contentY; y < contentY + contentHeight; y++) {
      for (let x = this.bounds.x; x < this.bounds.x + this.bounds.width; x++) {
        buffer.set(x, y, { char: ' ', fg, bg });
      }
    }

    // Show a hint in the center
    const hint = 'Use Ctrl+O to open a file';
    const hintY = contentY + Math.floor(contentHeight / 2);
    const hintX = this.bounds.x + Math.floor((this.bounds.width - hint.length) / 2);

    if (hintY < contentY + contentHeight && hintX >= this.bounds.x) {
      const dimFg = this.callbacks.getThemeColor('editorWidget.foreground', '#cccccc') + '80';
      for (let i = 0; i < hint.length && hintX + i < this.bounds.x + this.bounds.width; i++) {
        buffer.set(hintX + i, hintY, { char: hint[i]!, fg: dimFg, bg });
      }
    }
  }

  private renderTabBar(buffer: ScreenBuffer): void {
    const y = this.bounds.y;
    let x = this.bounds.x;
    const isPaneFocused = this.callbacks.isPaneFocused();

    const colors = this.getThemeColors();

    // Get focus-aware tab bar background
    const tabBarBg = isPaneFocused
      ? colors.tabBarBackground
      : this.callbacks.getBackgroundForFocus('editor', false);

    for (let i = 0; i < this.elements.length; i++) {
      const element = this.elements[i]!;
      const isActive = i === this.activeElementIndex;
      const title = this.truncateTitle(element.getTitle(), 20);

      // Active tab uses focus-aware colors
      let bg: string;
      let fg: string;
      if (isActive) {
        bg = isPaneFocused ? colors.tabActiveBackground : this.callbacks.getBackgroundForFocus('editor', false);
        fg = isPaneFocused ? colors.tabActiveForeground : this.callbacks.getForegroundForFocus('editor', false);
      } else {
        bg = colors.tabInactiveBackground;
        fg = colors.tabInactiveForeground;
      }

      // Tab content: " title × "
      const tabContent = ` ${title} × `;

      // Draw tab
      for (let j = 0; j < tabContent.length && x + j < this.bounds.x + this.bounds.width; j++) {
        buffer.set(x + j, y, { char: tabContent[j]!, fg, bg });
      }

      x += tabContent.length;

      // Separator
      if (i < this.elements.length - 1 && x < this.bounds.x + this.bounds.width) {
        buffer.set(x, y, { char: '│', fg: colors.tabBorder, bg: tabBarBg });
        x += 1;
      }
    }

    // Fill rest of tab bar
    while (x < this.bounds.x + this.bounds.width) {
      buffer.set(x, y, {
        char: ' ',
        fg: tabBarBg,
        bg: tabBarBg,
      });
      x++;
    }
  }

  private renderAccordion(buffer: ScreenBuffer): void {
    let y = this.bounds.y;

    for (const element of this.elements) {
      const isExpanded = this.expandedElementIds.has(element.id);

      // Render header
      this.renderAccordionHeader(buffer, element, y, isExpanded);
      y += Pane.HEADER_HEIGHT;

      // Render content if expanded
      if (isExpanded && element.isVisible()) {
        element.render(buffer);
        y += element.getBounds().height;
      }
    }
  }

  private renderAccordionHeader(
    buffer: ScreenBuffer,
    element: BaseElement,
    y: number,
    isExpanded: boolean
  ): void {
    const colors = this.getThemeColors();
    const icon = isExpanded ? '▼' : '▶';
    const title = element.getTitle();
    const status = element.getStatus();

    // " ▼ Title [status] "
    let content = ` ${icon} ${title}`;
    if (status) {
      content += ` [${status}]`;
    }

    // Truncate and pad
    const maxWidth = this.bounds.width;
    if (content.length > maxWidth) {
      content = content.slice(0, maxWidth - 1) + '…';
    }

    let x = this.bounds.x;
    for (let i = 0; i < content.length && x < this.bounds.x + this.bounds.width; i++) {
      buffer.set(x, y, {
        char: content[i]!,
        fg: colors.accordionHeaderForeground,
        bg: colors.accordionHeaderBackground,
      });
      x++;
    }

    // Fill rest
    while (x < this.bounds.x + this.bounds.width) {
      buffer.set(x, y, {
        char: ' ',
        fg: colors.accordionHeaderBackground,
        bg: colors.accordionHeaderBackground,
      });
      x++;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Handle mouse input for tab bar and accordion headers.
   * @returns true if handled
   */
  handleMouse(event: { type: string; x: number; y: number; button?: string }): boolean {
    if (event.type !== 'press' || event.button !== 'left') return false;

    if (this.mode === 'tabs') {
      return this.handleTabBarClick(event);
    } else {
      return this.handleAccordionClick(event);
    }
  }

  /**
   * Handle click on tab bar.
   */
  private handleTabBarClick(event: { x: number; y: number }): boolean {
    // Tab bar is at the top row of the pane
    if (event.y !== this.bounds.y) return false;

    // Find which tab was clicked
    let x = this.bounds.x;

    for (let i = 0; i < this.elements.length; i++) {
      const element = this.elements[i]!;
      const title = this.truncateTitle(element.getTitle(), 20);
      // Tab content: " title × "
      const tabWidth = 1 + title.length + 3; // space + title + " × "

      if (event.x >= x && event.x < x + tabWidth) {
        // Click is on this tab
        // Check if click is on the close button (last 2 characters: "× ")
        const closeButtonStart = x + tabWidth - 2;
        if (event.x >= closeButtonStart) {
          // Close this tab - notify callback first for cleanup
          this.callbacks.onElementClose?.(element.id, element);
          this.removeElement(element.id);
        } else {
          // Switch to this tab
          this.setActiveElement(element.id);
        }
        return true;
      }

      x += tabWidth;
      // Account for separator
      if (i < this.elements.length - 1) {
        x += 1;
      }
    }

    return false;
  }

  /**
   * Handle click on accordion header.
   */
  private handleAccordionClick(event: { x: number; y: number }): boolean {
    // Check if click is on an accordion header
    let y = this.bounds.y;
    const expandedCount = this.expandedElementIds.size;
    const totalHeaderHeight = this.elements.length * Pane.HEADER_HEIGHT;
    const availableContentHeight = Math.max(0, this.bounds.height - totalHeaderHeight);
    const heightPerExpanded =
      expandedCount > 0 ? Math.floor(availableContentHeight / expandedCount) : 0;

    for (const element of this.elements) {
      const isExpanded = this.expandedElementIds.has(element.id);

      // Check if click is on this header
      if (event.y >= y && event.y < y + Pane.HEADER_HEIGHT &&
          event.x >= this.bounds.x && event.x < this.bounds.x + this.bounds.width) {
        this.toggleAccordionSection(element.id);
        return true;
      }

      y += Pane.HEADER_HEIGHT + (isExpanded ? heightPerExpanded : 0);
    }

    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Serialization
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Serialize pane state for persistence.
   */
  serialize(): PaneConfig {
    return {
      id: this.id,
      mode: this.mode,
      elements: this.elements.map((e) => ({
        type: e.type,
        id: e.id,
        title: e.getTitle(),
        state: e.getState(),
      })),
      activeElementId:
        this.mode === 'tabs' ? this.elements[this.activeElementIndex]?.id : undefined,
      expandedElementIds:
        this.mode === 'accordion' ? Array.from(this.expandedElementIds) : undefined,
    };
  }

  /**
   * Deserialize pane state.
   */
  deserialize(config: PaneConfig): void {
    // Unmount existing elements
    this.unmountAll();

    // Set mode first (without triggering layout)
    this.mode = config.mode;

    // Create elements from config
    for (const elemConfig of config.elements) {
      const ctx = this.createElementContext(elemConfig.id);
      const element = createElementWithFallback(elemConfig, ctx);
      this.elements.push(element);
      element.onMount();

      if (elemConfig.state) {
        element.setState(elemConfig.state);
      }
    }

    // Restore active/expanded state
    if (config.activeElementId) {
      const idx = this.elements.findIndex((e) => e.id === config.activeElementId);
      if (idx !== -1) {
        this.activeElementIndex = idx;
      }
    }

    if (config.expandedElementIds) {
      this.expandedElementIds = new Set(config.expandedElementIds);
    }

    // Layout and set visibility
    this.layoutElements();

    if (this.mode === 'tabs') {
      this.elements.forEach((el, i) => {
        el.onVisibilityChange(i === this.activeElementIndex);
      });
    } else {
      this.elements.forEach((el) => {
        el.onVisibilityChange(this.expandedElementIds.has(el.id));
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private createElementContext(elementId: string): ElementContext {
    return {
      markDirty: (region) => this.markDirty(region),
      requestFocus: () => this.callbacks.onFocusRequest(elementId),
      updateTitle: () => this.markDirty(),
      updateStatus: () => this.markDirty(),
      getThemeColor: (key, fallback) => this.callbacks.getThemeColor(key, fallback),
      isPaneFocused: () => this.callbacks.isPaneFocused(),
      getBackgroundForFocus: (type, focused) => this.callbacks.getBackgroundForFocus(type, focused),
      getForegroundForFocus: (type, focused) => this.callbacks.getForegroundForFocus(type, focused),
      getSelectionBackground: (type, focused) => this.callbacks.getSelectionBackground(type, focused),
    };
  }

  private markDirty(region?: Rect): void {
    this.callbacks.onDirty(region);
  }

  private getDefaultTitle(type: ElementType): string {
    const titles: Record<ElementType, string> = {
      DocumentEditor: 'Untitled',
      FileTree: 'Files',
      GitPanel: 'Git',
      GitDiffView: 'Diff',
      AgentChat: 'Agent',
      TerminalSession: 'Terminal',
      SearchResults: 'Search',
      ProjectSearch: 'Find',
      DiagnosticsView: 'Problems',
    };
    return titles[type] ?? type;
  }

  private truncateTitle(title: string, maxLength: number): string {
    if (title.length <= maxLength) return title;
    return title.slice(0, maxLength - 1) + '…';
  }

  private getThemeColors(): PaneThemeColors {
    const get = (key: string, fallback: string) =>
      this.callbacks.getThemeColor(key, fallback);

    return {
      tabActiveBackground: get('tab.activeBackground', '#1e1e1e'),
      tabActiveForeground: get('tab.activeForeground', '#ffffff'),
      tabInactiveBackground: get('tab.inactiveBackground', '#2d2d2d'),
      tabInactiveForeground: get('tab.inactiveForeground', '#808080'),
      tabBorder: get('tab.border', '#404040'),
      tabBarBackground: get('editorGroupHeader.tabsBackground', '#252526'),
      accordionHeaderBackground: get('sideBarSectionHeader.background', '#2d2d2d'),
      accordionHeaderForeground: get('sideBarSectionHeader.foreground', '#ffffff'),
    };
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a new pane.
 */
export function createPane(id: string, callbacks: PaneCallbacks): Pane {
  return new Pane(id, callbacks);
}
