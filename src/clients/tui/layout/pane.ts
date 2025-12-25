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
import { DocumentEditor } from '../elements/document-editor.ts';

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
  /** Get a setting value */
  getSetting: <T>(key: string, defaultValue: T) => T;
  /**
   * Called when user requests to close an element via tab X.
   * Return true to proceed with close, false to cancel.
   * If not provided, close proceeds immediately.
   */
  onElementCloseRequest?: (elementId: string, element: BaseElement) => Promise<boolean>;
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

  /** Tab scroll offset (number of tabs scrolled from left) */
  private tabScrollOffset = 0;

  /** Callback for showing tab dropdown menu */
  private onShowTabDropdown?: (tabs: Array<{ id: string; title: string; isActive: boolean }>, x: number, y: number) => void;

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
   * Request to close an element, with optional confirmation.
   * Uses the onElementCloseRequest callback if provided.
   */
  private requestElementClose(element: BaseElement): void {
    if (this.callbacks.onElementCloseRequest) {
      // Async close with confirmation
      this.callbacks.onElementCloseRequest(element.id, element).then((proceed) => {
        if (proceed) {
          this.removeElement(element.id);
        }
      });
    } else {
      // No callback - close immediately
      this.removeElement(element.id);
    }
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
    this.ensureActiveTabVisible();
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
    this.ensureActiveTabVisible();
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
    this.ensureActiveTabVisible();
    this.markDirty();
  }

  /**
   * Set callback for showing tab dropdown menu.
   */
  setTabDropdownCallback(
    callback: (tabs: Array<{ id: string; title: string; isActive: boolean }>, x: number, y: number) => void
  ): void {
    this.onShowTabDropdown = callback;
  }

  /**
   * Scroll tabs left by the configured amount.
   */
  scrollTabsLeft(): void {
    const scrollAmount = this.callbacks.getSetting('tabBar.scrollAmount', 1);
    this.tabScrollOffset = Math.max(0, this.tabScrollOffset - scrollAmount);
    this.markDirty();
  }

  /**
   * Scroll tabs right by the configured amount.
   */
  scrollTabsRight(): void {
    const scrollAmount = this.callbacks.getSetting('tabBar.scrollAmount', 1);

    // Calculate max offset so that the last tab is just visible
    const maxOffset = this.calculateMaxScrollOffset();
    if (this.tabScrollOffset >= maxOffset) return; // Already at max

    this.tabScrollOffset = Math.min(maxOffset, this.tabScrollOffset + scrollAmount);
    this.markDirty();
  }

  /**
   * Calculate the maximum scroll offset (so last tab is still visible).
   */
  private calculateMaxScrollOffset(): number {
    if (this.elements.length === 0) return 0;

    // Calculate tab widths
    const tabWidths = this.elements.map((el) => {
      const title = this.truncateTitle(el.getTitle(), 20);
      return 1 + title.length + 3; // indicator + title + " × "
    });

    const dropdownWidth = 3;
    const arrowWidth = 3;
    const availableWidth = this.bounds.width - dropdownWidth - arrowWidth * 2;

    // Find the maximum offset where the last tab is still visible
    // Work backwards from the end
    let widthFromEnd = 0;
    let maxOffset = this.elements.length - 1;

    for (let i = this.elements.length - 1; i >= 0; i--) {
      const tabW = tabWidths[i]! + (i < this.elements.length - 1 ? 1 : 0); // +1 for separator
      if (widthFromEnd + tabW <= availableWidth) {
        widthFromEnd += tabW;
        maxOffset = i;
      } else {
        break;
      }
    }

    return Math.max(0, maxOffset);
  }

  /**
   * Ensure the active tab is visible by adjusting scroll offset.
   */
  private ensureActiveTabVisible(): void {
    // If active tab is before scroll offset, scroll left to show it
    if (this.activeElementIndex < this.tabScrollOffset) {
      this.tabScrollOffset = this.activeElementIndex;
      return;
    }

    // Calculate approximate visible range to check if active tab is visible
    // This is a heuristic - we estimate ~15 chars per tab on average
    const avgTabWidth = 15;
    const dropdownWidth = 3;
    const arrowWidth = 3;
    const availableWidth = this.bounds.width - dropdownWidth - arrowWidth * 2;
    const approxVisibleTabs = Math.max(1, Math.floor(availableWidth / avgTabWidth));

    // If active tab is beyond the approximate visible range, scroll right
    if (this.activeElementIndex >= this.tabScrollOffset + approxVisibleTabs) {
      // Scroll so active tab is at the right edge of visible area
      this.tabScrollOffset = Math.max(0, this.activeElementIndex - approxVisibleTabs + 1);
    }
  }

  /**
   * Get tab info for dropdown menu.
   */
  getTabsForDropdown(): Array<{ id: string; title: string; isActive: boolean }> {
    return this.elements.map((el, i) => ({
      id: el.id,
      title: el.getTitle(),
      isActive: i === this.activeElementIndex,
    }));
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
    const isPaneFocused = this.callbacks.isPaneFocused();
    const colors = this.getThemeColors();

    // Get focus-aware tab bar background
    const tabBarBg = isPaneFocused
      ? colors.tabBarBackground
      : this.callbacks.getBackgroundForFocus('editor', false);

    // Calculate tab widths
    const tabWidths = this.elements.map((el) => {
      const title = this.truncateTitle(el.getTitle(), 20);
      return 1 + title.length + 3; // indicator + title + " × "
    });

    const totalTabWidth = tabWidths.reduce((a, b) => a + b, 0) + Math.max(0, this.elements.length - 1); // +separators

    // Reserve space for dropdown (always visible) and arrows (when needed)
    const dropdownWidth = 3; // " ▼ "
    const arrowWidth = 3; // " < " or " > "
    const availableWidth = this.bounds.width - dropdownWidth;

    // Check if we need scroll arrows
    const needsScroll = totalTabWidth > availableWidth;
    const effectiveWidth = needsScroll ? availableWidth - arrowWidth * 2 : availableWidth;

    // Ensure scroll offset is valid
    this.tabScrollOffset = Math.max(0, Math.min(this.tabScrollOffset, this.elements.length - 1));

    // Calculate which tabs are visible starting from scroll offset
    let visibleStartIdx = this.tabScrollOffset;
    let visibleEndIdx = visibleStartIdx;
    let usedWidth = 0;

    for (let i = visibleStartIdx; i < this.elements.length; i++) {
      const tabW = tabWidths[i]! + (i > visibleStartIdx ? 1 : 0); // +1 for separator
      if (usedWidth + tabW <= effectiveWidth) {
        usedWidth += tabW;
        visibleEndIdx = i;
      } else {
        break;
      }
    }

    let x = this.bounds.x;

    // Draw left arrow if needed
    if (needsScroll) {
      const canScrollLeft = this.tabScrollOffset > 0;
      const arrowFg = canScrollLeft ? colors.tabActiveForeground : colors.tabInactiveForeground;
      buffer.set(x, y, { char: ' ', fg: arrowFg, bg: tabBarBg });
      buffer.set(x + 1, y, { char: '<', fg: arrowFg, bg: tabBarBg });
      buffer.set(x + 2, y, { char: ' ', fg: arrowFg, bg: tabBarBg });
      x += arrowWidth;
    }

    // Draw visible tabs
    for (let i = visibleStartIdx; i <= visibleEndIdx && i < this.elements.length; i++) {
      const element = this.elements[i]!;
      const isActive = i === this.activeElementIndex;
      const title = this.truncateTitle(element.getTitle(), 20);

      // Check if element is a modified/untitled document
      const isModified = element instanceof DocumentEditor &&
        (element.isModified() || element.getUri() === null);

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

      // Draw tab indicator
      if (isModified) {
        const modifiedColor = this.callbacks.getThemeColor('editorGutter.modifiedBackground', '#f9e2af');
        buffer.set(x, y, { char: '●', fg: modifiedColor, bg });
      } else {
        buffer.set(x, y, { char: ' ', fg, bg });
      }
      x += 1;

      // Draw title and close button
      const restContent = `${title} × `;
      for (let j = 0; j < restContent.length; j++) {
        buffer.set(x + j, y, { char: restContent[j]!, fg, bg });
      }
      x += restContent.length;

      // Separator
      if (i < visibleEndIdx && i < this.elements.length - 1) {
        buffer.set(x, y, { char: '│', fg: colors.tabBorder, bg: tabBarBg });
        x += 1;
      }
    }

    // Fill space between tabs and right controls
    const rightControlsX = this.bounds.x + this.bounds.width - dropdownWidth - (needsScroll ? arrowWidth : 0);
    while (x < rightControlsX) {
      buffer.set(x, y, { char: ' ', fg: tabBarBg, bg: tabBarBg });
      x++;
    }

    // Draw right arrow if needed
    if (needsScroll) {
      const canScrollRight = visibleEndIdx < this.elements.length - 1;
      const arrowFg = canScrollRight ? colors.tabActiveForeground : colors.tabInactiveForeground;
      buffer.set(x, y, { char: ' ', fg: arrowFg, bg: tabBarBg });
      buffer.set(x + 1, y, { char: '>', fg: arrowFg, bg: tabBarBg });
      buffer.set(x + 2, y, { char: ' ', fg: arrowFg, bg: tabBarBg });
      x += arrowWidth;
    }

    // Draw dropdown button (always visible)
    const dropdownFg = colors.tabActiveForeground;
    buffer.set(x, y, { char: ' ', fg: dropdownFg, bg: tabBarBg });
    buffer.set(x + 1, y, { char: '▼', fg: dropdownFg, bg: tabBarBg });
    buffer.set(x + 2, y, { char: ' ', fg: dropdownFg, bg: tabBarBg });
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

    // Calculate layout info (same as renderTabBar)
    const tabWidths = this.elements.map((el) => {
      const title = this.truncateTitle(el.getTitle(), 20);
      return 1 + title.length + 3; // indicator + title + " × "
    });

    const totalTabWidth = tabWidths.reduce((a, b) => a + b, 0) + Math.max(0, this.elements.length - 1);
    const dropdownWidth = 3;
    const arrowWidth = 3;
    const availableWidth = this.bounds.width - dropdownWidth;
    const needsScroll = totalTabWidth > availableWidth;

    // Check dropdown button click (rightmost)
    const dropdownX = this.bounds.x + this.bounds.width - dropdownWidth;
    if (event.x >= dropdownX) {
      // Show dropdown menu
      if (this.onShowTabDropdown) {
        this.onShowTabDropdown(this.getTabsForDropdown(), dropdownX, this.bounds.y + 1);
      }
      return true;
    }

    // Check right arrow click
    if (needsScroll) {
      const rightArrowX = dropdownX - arrowWidth;
      if (event.x >= rightArrowX && event.x < dropdownX) {
        this.scrollTabsRight();
        return true;
      }
    }

    // Check left arrow click
    if (needsScroll && event.x >= this.bounds.x && event.x < this.bounds.x + arrowWidth) {
      this.scrollTabsLeft();
      return true;
    }

    // Calculate visible tabs range (same as renderTabBar)
    const effectiveWidth = needsScroll ? availableWidth - arrowWidth * 2 : availableWidth;
    let visibleStartIdx = this.tabScrollOffset;
    let visibleEndIdx = visibleStartIdx;
    let usedWidth = 0;

    for (let i = visibleStartIdx; i < this.elements.length; i++) {
      const tabW = tabWidths[i]! + (i > visibleStartIdx ? 1 : 0);
      if (usedWidth + tabW <= effectiveWidth) {
        usedWidth += tabW;
        visibleEndIdx = i;
      } else {
        break;
      }
    }

    // Find which tab was clicked
    let x = this.bounds.x + (needsScroll ? arrowWidth : 0);

    for (let i = visibleStartIdx; i <= visibleEndIdx && i < this.elements.length; i++) {
      const element = this.elements[i]!;
      const title = this.truncateTitle(element.getTitle(), 20);
      const tabWidth = 1 + title.length + 3; // indicator + title + " × "

      if (event.x >= x && event.x < x + tabWidth) {
        // Click is on this tab
        // Check if click is on the close button (last 2 characters: "× ")
        const closeButtonStart = x + tabWidth - 2;
        if (event.x >= closeButtonStart) {
          // Close this tab - use async callback if provided
          this.requestElementClose(element);
        } else {
          // Switch to this tab and focus the element
          this.setActiveElement(element.id);
          this.callbacks.onFocusRequest(element.id);
        }
        return true;
      }

      x += tabWidth;
      // Account for separator
      if (i < visibleEndIdx) {
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
        const wasExpanded = this.expandedElementIds.has(element.id);
        this.toggleAccordionSection(element.id);
        // If we just expanded this section, focus the element
        if (!wasExpanded) {
          this.callbacks.onFocusRequest(element.id);
        }
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
      getSetting: (key, defaultValue) => this.callbacks.getSetting(key, defaultValue),
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
      GitDiffBrowser: 'Diff',
      AgentChat: 'Agent',
      TerminalSession: 'Terminal',
      TerminalPanel: 'Terminal',
      SearchResults: 'Search',
      SearchResultBrowser: 'Search',
      ContentBrowser: 'Browser',
      ProjectSearch: 'Find',
      DiagnosticsView: 'Problems',
      OutlinePanel: 'Outline',
      GitTimelinePanel: 'Timeline',
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
