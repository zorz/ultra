/**
 * Tab Bar Component
 * 
 * Displays open file tabs with close buttons and dirty indicators.
 */

import type { RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import { themeLoader } from '../themes/theme-loader.ts';
import { hexToRgb } from '../colors.ts';

export interface Tab {
  id: string;
  fileName: string;
  filePath: string | null;
  isDirty: boolean;
  isActive: boolean;
}

export class TabBar implements MouseHandler {
  private rect: Rect = { x: 1, y: 1, width: 80, height: 1 };
  private tabs: Tab[] = [];
  private activeTabId: string | null = null;
  private tabPositions: { id: string; startX: number; endX: number; closeX: number }[] = [];
  private isFocused: boolean = true;  // Whether this tab bar's pane is focused

  // Callbacks
  private onTabClickCallback?: (tabId: string) => void;
  private onTabCloseCallback?: (tabId: string) => void;

  /**
   * Set the tab bar rect
   */
  setRect(rect: Rect): void {
    this.rect = rect;
  }

  /**
   * Set focus state (affects visual styling)
   */
  setFocused(focused: boolean): void {
    this.isFocused = focused;
  }

  /**
   * Set tabs
   */
  setTabs(tabs: Tab[]): void {
    this.tabs = tabs;
    this.activeTabId = tabs.find(t => t.isActive)?.id || null;
  }

  /**
   * Set active tab
   */
  setActiveTab(tabId: string): void {
    this.activeTabId = tabId;
    for (const tab of this.tabs) {
      tab.isActive = tab.id === tabId;
    }
  }

  /**
   * Register tab click callback
   */
  onTabClick(callback: (tabId: string) => void): void {
    this.onTabClickCallback = callback;
  }

  /**
   * Register tab close callback
   */
  onTabClose(callback: (tabId: string) => void): void {
    this.onTabCloseCallback = callback;
  }

  /**
   * Render the tab bar
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
    const dirtyColor = { r: 231, g: 130, b: 132 }; // Catppuccin red

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
    const maxTabWidth = Math.min(30, Math.floor(width / Math.max(1, this.tabs.length)));

    for (const tab of this.tabs) {
      const tabContent = this.formatTabContent(tab, maxTabWidth - 5);  // -5 for padding and close button area
      const tabWidth = tabContent.length + 5;  // space + content + space + × + space

      if (currentX + tabWidth > x + width) break;  // No more room

      // Track tab position for click handling (store close button start position)
      const closeButtonX = currentX + tabWidth - 3;  // × takes last 3 chars including padding
      this.tabPositions.push({
        id: tab.id,
        startX: currentX,
        endX: currentX + tabWidth,
        closeX: closeButtonX
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

      // Tab name
      const tabFg = tab.isActive ? activeFg : inactiveFg;
      output += fgRgb(tabFg.r, tabFg.g, tabFg.b) + tabContent;

      // Close button with visible hover area
      const closeFg = tab.isActive ? inactiveFg : { r: Math.floor(inactiveFg.r * 0.6), g: Math.floor(inactiveFg.g * 0.6), b: Math.floor(inactiveFg.b * 0.6) };
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
   * Dim a color by a factor
   */
  private dimColor(color: { r: number; g: number; b: number }, factor: number): { r: number; g: number; b: number } {
    return {
      r: Math.floor(color.r * factor),
      g: Math.floor(color.g * factor),
      b: Math.floor(color.b * factor)
    };
  }

  /**
   * Format tab content to fit within max width
   */
  private formatTabContent(tab: Tab, maxWidth: number): string {
    let name = tab.fileName;
    
    if (name.length > maxWidth) {
      name = name.slice(0, maxWidth - 1) + '…';
    }
    
    return name;
  }

  // MouseHandler implementation

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
          // Check if close button was clicked (the × area)
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
   * Get tab at index
   */
  getTabAtIndex(index: number): Tab | undefined {
    return this.tabs[index];
  }

  /**
   * Get tab count
   */
  get tabCount(): number {
    return this.tabs.length;
  }
}

export const tabBar = new TabBar();

export default tabBar;
