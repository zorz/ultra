/**
 * Tab Bar Component
 * 
 * Displays open file tabs with close buttons and dirty indicators.
 */

import type { RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';

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
  private tabPositions: { id: string; startX: number; endX: number }[] = [];

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
    const bg = (n: number) => `\x1b[48;5;${n}m`;
    const fg = (n: number) => `\x1b[38;5;${n}m`;
    const reset = '\x1b[0m';
    const moveTo = (px: number, py: number) => `\x1b[${py};${px}H`;

    // Build entire tab bar as one string
    let output = moveTo(x, y) + bg(234) + ' '.repeat(width);
    
    let currentX = x;
    const maxTabWidth = Math.min(30, Math.floor(width / Math.max(1, this.tabs.length)));

    for (const tab of this.tabs) {
      const tabContent = this.formatTabContent(tab, maxTabWidth - 3);  // -3 for padding and close button
      const tabWidth = tabContent.length + 3;

      if (currentX + tabWidth > x + width) break;  // No more room

      // Track tab position for click handling
      this.tabPositions.push({
        id: tab.id,
        startX: currentX,
        endX: currentX + tabWidth
      });

      // Tab background
      const tabBg = tab.isActive ? 235 : 234;
      output += moveTo(currentX, y) + bg(tabBg);

      // Dirty indicator or space
      if (tab.isDirty) {
        output += fg(203) + ' ●';
      } else {
        output += '  ';
      }

      // Tab name
      output += fg(tab.isActive ? 252 : 245) + tabContent;

      // Close button
      output += fg(241) + ' ×';

      // Tab separator
      currentX += tabWidth;
      if (currentX < x + width) {
        output += moveTo(currentX, y) + bg(234) + fg(238) + '│';
        currentX += 1;
      }
    }
    
    output += reset;
    process.stdout.write(output);
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
          // Check if close button was clicked (last 2 chars of tab)
          if (event.x >= pos.endX - 2) {
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
