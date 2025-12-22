/**
 * Panel Tab Bar Component
 *
 * A generic tab bar that works with any PanelContent type.
 * Supports configurable display modes: icon-only, text-only, or icon-and-text.
 */

import type { RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import type { PanelContent } from './panel-content.interface.ts';
import { themeLoader } from '../themes/theme-loader.ts';
import { hexToRgb } from '../colors.ts';
import { settings } from '../../config/settings.ts';

// ==================== Tab Display Configuration ====================

/**
 * How tabs should display their content.
 */
export type TabDisplayMode = 'icon-only' | 'text-only' | 'icon-and-text';

/**
 * Tab data derived from PanelContent.
 */
export interface PanelTab {
  id: string;
  contentId: string;
  title: string;
  icon: string;
  isDirty: boolean;
  isActive: boolean;
}

// ==================== Panel Tab Bar ====================

export class PanelTabBar implements MouseHandler {
  private rect: Rect = { x: 1, y: 1, width: 80, height: 1 };
  private tabs: PanelTab[] = [];
  private activeTabId: string | null = null;
  private tabPositions: { id: string; startX: number; endX: number; closeX: number }[] = [];
  private isFocused: boolean = true;
  private displayMode: TabDisplayMode = 'text-only';

  // Callbacks
  private onTabClickCallback?: (tabId: string) => void;
  private onTabCloseCallback?: (tabId: string) => void;

  constructor() {
    this.loadSettings();
  }

  /**
   * Load display settings.
   */
  private loadSettings(): void {
    const mode = settings.get('ui.tabs.displayMode') as TabDisplayMode | undefined;
    if (mode && ['icon-only', 'text-only', 'icon-and-text'].includes(mode)) {
      this.displayMode = mode;
    }
  }

  /**
   * Set the tab bar rect.
   */
  setRect(rect: Rect): void {
    this.rect = rect;
  }

  /**
   * Get the tab bar rect.
   */
  getRect(): Rect {
    return this.rect;
  }

  /**
   * Set focus state (affects visual styling).
   */
  setFocused(focused: boolean): void {
    this.isFocused = focused;
  }

  /**
   * Set display mode.
   */
  setDisplayMode(mode: TabDisplayMode): void {
    this.displayMode = mode;
  }

  /**
   * Get current display mode.
   */
  getDisplayMode(): TabDisplayMode {
    return this.displayMode;
  }

  /**
   * Update tabs from PanelContent array.
   */
  updateFromContent(contents: PanelContent[], activeContentId: string | null): void {
    this.tabs = contents.map(content => ({
      id: content.contentId,
      contentId: content.contentId,
      title: content.getTitle(),
      icon: content.getIcon(),
      isDirty: content.isDirty(),
      isActive: content.contentId === activeContentId,
    }));
    this.activeTabId = activeContentId;
  }

  /**
   * Set tabs directly.
   */
  setTabs(tabs: PanelTab[]): void {
    this.tabs = tabs;
    this.activeTabId = tabs.find(t => t.isActive)?.id || null;
  }

  /**
   * Set active tab.
   */
  setActiveTab(tabId: string): void {
    this.activeTabId = tabId;
    for (const tab of this.tabs) {
      tab.isActive = tab.id === tabId;
    }
  }

  /**
   * Get tabs.
   */
  getTabs(): PanelTab[] {
    return this.tabs;
  }

  /**
   * Register tab click callback.
   */
  onTabClick(callback: (tabId: string) => void): () => void {
    this.onTabClickCallback = callback;
    return () => { this.onTabClickCallback = undefined; };
  }

  /**
   * Register tab close callback.
   */
  onTabClose(callback: (tabId: string) => void): () => void {
    this.onTabCloseCallback = callback;
    return () => { this.onTabCloseCallback = undefined; };
  }

  /**
   * Format tab content based on display mode.
   */
  private formatTabContent(tab: PanelTab, maxWidth: number): string {
    switch (this.displayMode) {
      case 'icon-only':
        return tab.icon || '•';

      case 'icon-and-text': {
        const icon = tab.icon ? tab.icon + ' ' : '';
        const availableWidth = maxWidth - icon.length;
        let title = tab.title;
        if (title.length > availableWidth) {
          title = title.slice(0, availableWidth - 1) + '…';
        }
        return icon + title;
      }

      case 'text-only':
      default: {
        let title = tab.title;
        if (title.length > maxWidth) {
          title = title.slice(0, maxWidth - 1) + '…';
        }
        return title;
      }
    }
  }

  /**
   * Calculate tab width based on display mode.
   */
  private calculateTabWidth(tab: PanelTab): number {
    switch (this.displayMode) {
      case 'icon-only':
        // icon + padding + close button
        return 2 + 4; // icon(2) + space + × + space

      case 'icon-and-text':
      case 'text-only':
      default:
        // Calculate based on content length
        const content = this.formatTabContent(tab, 25);
        return content.length + 5; // content + dirty/space + space + × + space
    }
  }

  /**
   * Render the tab bar.
   */
  render(ctx: RenderContext): void {
    const { x, y, width } = this.rect;
    this.tabPositions = [];

    // Guard against invalid dimensions
    if (width <= 0) return;

    // ANSI helpers
    const bgRgb = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`;
    const fgRgb = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
    const reset = '\x1b[0m';
    const moveTo = (px: number, py: number) => `\x1b[${py};${px}H`;

    // Get theme colors
    let inactiveBg = hexToRgb(themeLoader.getColor('tab.inactiveBackground')) || { r: 41, g: 44, b: 60 };
    let activeBg = hexToRgb(themeLoader.getColor('tab.activeBackground')) || { r: 48, g: 52, b: 70 };
    let activeFg = hexToRgb(themeLoader.getColor('tab.activeForeground')) || { r: 198, g: 208, b: 245 };
    let inactiveFg = hexToRgb(themeLoader.getColor('tab.inactiveForeground')) || { r: 131, g: 139, b: 167 };
    const borderColor = hexToRgb(themeLoader.getColor('tab.border')) || { r: 35, g: 38, b: 52 };
    const dirtyColor = hexToRgb(themeLoader.getColor('editorGutter.modifiedBackground')) || { r: 229, g: 192, b: 123 };

    // Dim colors for unfocused pane
    if (!this.isFocused) {
      const dimFactor = 0.6;
      inactiveBg = this.dimColor(inactiveBg, dimFactor);
      activeBg = this.dimColor(activeBg, dimFactor);
      activeFg = this.dimColor(activeFg, dimFactor);
      inactiveFg = this.dimColor(inactiveFg, dimFactor);
    }

    // Build entire tab bar as one string
    let output = moveTo(x, y) + bgRgb(inactiveBg.r, inactiveBg.g, inactiveBg.b) + ' '.repeat(width);

    let currentX = x;
    const maxTabWidth = this.displayMode === 'icon-only'
      ? 8
      : Math.min(30, Math.floor(width / Math.max(1, this.tabs.length)));

    for (const tab of this.tabs) {
      const contentMaxWidth = maxTabWidth - 5; // Reserve space for indicators and close
      const tabContent = this.formatTabContent(tab, contentMaxWidth);
      const tabWidth = this.calculateTabWidth(tab);

      if (currentX + tabWidth > x + width) break; // No more room

      // Track tab position for click handling
      const closeButtonX = currentX + tabWidth - 3;
      this.tabPositions.push({
        id: tab.id,
        startX: currentX,
        endX: currentX + tabWidth,
        closeX: closeButtonX,
      });

      // Tab background
      const tabBg = tab.isActive ? activeBg : inactiveBg;
      output += moveTo(currentX, y) + bgRgb(tabBg.r, tabBg.g, tabBg.b);

      // Dirty indicator or space
      if (tab.isDirty) {
        output += fgRgb(dirtyColor.r, dirtyColor.g, dirtyColor.b) + ' ●';
      } else {
        output += '  ';
      }

      // Tab content (icon, text, or both)
      const tabFg = tab.isActive ? activeFg : inactiveFg;
      output += fgRgb(tabFg.r, tabFg.g, tabFg.b) + tabContent;

      // Close button
      const closeFg = tab.isActive
        ? inactiveFg
        : { r: Math.floor(inactiveFg.r * 0.6), g: Math.floor(inactiveFg.g * 0.6), b: Math.floor(inactiveFg.b * 0.6) };
      output += ' ' + fgRgb(closeFg.r, closeFg.g, closeFg.b) + '×' + ' ';

      // Tab separator
      currentX += tabWidth;
      if (currentX < x + width) {
        output += moveTo(currentX, y) + bgRgb(inactiveBg.r, inactiveBg.g, inactiveBg.b) + fgRgb(borderColor.r, borderColor.g, borderColor.b) + '│';
        currentX += 1;
      }
    }

    output += reset;
    ctx.buffer(output);
  }

  /**
   * Dim a color by a factor.
   */
  private dimColor(color: { r: number; g: number; b: number }, factor: number): { r: number; g: number; b: number } {
    return {
      r: Math.floor(color.r * factor),
      g: Math.floor(color.g * factor),
      b: Math.floor(color.b * factor),
    };
  }

  // ==================== MouseHandler Implementation ====================

  containsPoint(x: number, y: number): boolean {
    return (
      x >= this.rect.x &&
      x < this.rect.x + this.rect.width &&
      y >= this.rect.y &&
      y < this.rect.y + this.rect.height
    );
  }

  onMouseEvent(event: MouseEvent): boolean {
    if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED') {
      // Find which tab was clicked
      for (const pos of this.tabPositions) {
        if (event.x >= pos.startX && event.x < pos.endX) {
          // Check if close button was clicked
          if (event.x >= pos.closeX) {
            if (this.onTabCloseCallback) {
              this.onTabCloseCallback(pos.id);
            }
          } else {
            if (this.onTabClickCallback) {
              this.onTabClickCallback(pos.id);
            }
          }
          return true;
        }
      }
    }

    if (event.name === 'MOUSE_MIDDLE_BUTTON_PRESSED') {
      // Middle click to close
      for (const pos of this.tabPositions) {
        if (event.x >= pos.startX && event.x < pos.endX) {
          if (this.onTabCloseCallback) {
            this.onTabCloseCallback(pos.id);
          }
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get tab at index.
   */
  getTabAtIndex(index: number): PanelTab | undefined {
    return this.tabs[index];
  }

  /**
   * Get tab count.
   */
  get tabCount(): number {
    return this.tabs.length;
  }
}

export default PanelTabBar;
