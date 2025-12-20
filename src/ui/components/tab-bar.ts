/**
 * Tab Bar Component
 * 
 * Displays open file tabs with close buttons and dirty indicators.
 */

import type { RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import { renderer } from '../renderer.ts';
import { themeLoader } from '../themes/theme-loader.ts';
import { hexToRgb } from '../colors.ts';

export interface Tab {
  id: string;
  fileName: string;
  filePath: string | null;
  isDirty: boolean;
  isActive: boolean;
  /** Whether the file is missing from disk */
  isMissing?: boolean;
}

// Minimum characters for tab name (before truncation makes it unreadable)
const MIN_TAB_NAME_CHARS = 3;
// Minimum tab width: space + indicator + name + space + × + space
const MIN_TAB_WIDTH = 2 + MIN_TAB_NAME_CHARS + 3;  // = 8
// Width of scroll arrow buttons (larger for easier clicking)
const SCROLL_ARROW_WIDTH = 4;  // " ◀ " or " ▶ " with extra padding

export class TabBar implements MouseHandler {
  private rect: Rect = { x: 1, y: 1, width: 80, height: 1 };
  private tabs: Tab[] = [];
  private activeTabId: string | null = null;
  private tabPositions: { id: string; startX: number; endX: number; closeX: number }[] = [];
  private isFocused: boolean = true;  // Whether this tab bar's pane is focused

  // Scroll state
  private scrollOffset: number = 0;  // Index of first visible tab
  private hasLeftArrow: boolean = false;
  private hasRightArrow: boolean = false;
  private leftArrowX: number = 0;
  private rightArrowX: number = 0;

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
    const wasFocused = this.isFocused;
    this.isFocused = focused;

    // Trigger re-render to update focus-dependent colors (background highlighting)
    if (focused !== wasFocused) {
      renderer.scheduleRender();
    }
  }

  /**
   * Set tabs
   */
  setTabs(tabs: Tab[]): void {
    this.tabs = tabs;
    this.activeTabId = tabs.find(t => t.isActive)?.id || null;
    // Ensure scroll offset is valid
    this.clampScrollOffset();
    // Ensure active tab is visible
    this.ensureActiveTabVisible();
  }

  /**
   * Set active tab
   */
  setActiveTab(tabId: string): void {
    this.activeTabId = tabId;
    for (const tab of this.tabs) {
      tab.isActive = tab.id === tabId;
    }
    // Ensure the newly active tab is visible
    this.ensureActiveTabVisible();
  }

  /**
   * Clamp scroll offset to valid range
   */
  private clampScrollOffset(): void {
    if (this.tabs.length === 0) {
      this.scrollOffset = 0;
    } else {
      this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, this.tabs.length - 1));
    }
  }

  /**
   * Ensure the active tab is scrolled into view
   */
  private ensureActiveTabVisible(): void {
    if (!this.activeTabId) return;

    const activeIndex = this.tabs.findIndex(t => t.id === this.activeTabId);
    if (activeIndex < 0) return;

    // If active tab is before the scroll offset, scroll left to show it
    if (activeIndex < this.scrollOffset) {
      this.scrollOffset = activeIndex;
    }
    // Note: We can't easily check if it's past the visible area without knowing
    // the rendered widths, so we'll handle that in the render method
  }

  /**
   * Scroll tabs left (show earlier tabs)
   */
  scrollLeft(): void {
    if (this.scrollOffset > 0) {
      this.scrollOffset--;
    }
  }

  /**
   * Scroll tabs right (show later tabs)
   */
  scrollRight(): void {
    if (this.scrollOffset < this.tabs.length - 1) {
      this.scrollOffset++;
    }
  }

  /**
   * Register tab click callback
   */
  onTabClick(callback: (tabId: string) => void): () => void {
    this.onTabClickCallback = callback;
    return () => { this.onTabClickCallback = undefined; };
  }

  /**
   * Register tab close callback
   */
  onTabClose(callback: (tabId: string) => void): () => void {
    this.onTabCloseCallback = callback;
    return () => { this.onTabCloseCallback = undefined; };
  }

  /**
   * Calculate tab widths based on available space
   * Returns array of { tab, width, contentWidth } for visible tabs
   */
  private calculateTabWidths(availableWidth: number): { tab: Tab; width: number; contentWidth: number }[] {
    if (this.tabs.length === 0) return [];

    const visibleTabs = this.tabs.slice(this.scrollOffset);
    if (visibleTabs.length === 0) return [];

    // Start with ideal widths (max 30 chars total per tab)
    const MAX_TAB_WIDTH = 30;
    const FIXED_CHARS = 5;  // space + indicator(1) + space + × + space

    // Calculate ideal widths for all visible tabs
    let tabWidths = visibleTabs.map(tab => {
      const idealNameWidth = tab.fileName.length;
      const idealTotal = Math.min(MAX_TAB_WIDTH, idealNameWidth + FIXED_CHARS);
      return { tab, width: idealTotal, contentWidth: idealTotal - FIXED_CHARS };
    });

    // Calculate total width needed
    const separatorWidth = 1;  // │ between tabs
    const totalNeeded = tabWidths.reduce((sum, t) => sum + t.width, 0) +
                        (tabWidths.length - 1) * separatorWidth;

    // If everything fits, return as-is
    if (totalNeeded <= availableWidth) {
      return tabWidths;
    }

    // Need to shrink tabs - calculate how much space we have per tab
    const avgWidthPerTab = Math.floor((availableWidth - (tabWidths.length - 1) * separatorWidth) / tabWidths.length);

    // If average is less than minimum, we need to show fewer tabs
    if (avgWidthPerTab < MIN_TAB_WIDTH) {
      // Calculate how many tabs can fit at minimum width
      const maxTabs = Math.floor((availableWidth + separatorWidth) / (MIN_TAB_WIDTH + separatorWidth));
      tabWidths = tabWidths.slice(0, Math.max(1, maxTabs));

      // Recalculate with fewer tabs
      const newAvgWidth = Math.floor((availableWidth - (tabWidths.length - 1) * separatorWidth) / tabWidths.length);
      tabWidths = tabWidths.map(t => ({
        tab: t.tab,
        width: Math.max(MIN_TAB_WIDTH, Math.min(newAvgWidth, t.width)),
        contentWidth: Math.max(MIN_TAB_NAME_CHARS, Math.min(newAvgWidth - FIXED_CHARS, t.contentWidth))
      }));
    } else {
      // Shrink all tabs proportionally
      tabWidths = tabWidths.map(t => ({
        tab: t.tab,
        width: Math.max(MIN_TAB_WIDTH, Math.min(avgWidthPerTab, t.width)),
        contentWidth: Math.max(MIN_TAB_NAME_CHARS, Math.min(avgWidthPerTab - FIXED_CHARS, t.contentWidth))
      }));
    }

    // Final pass: fit as many tabs as possible
    let usedWidth = 0;
    const result: typeof tabWidths = [];
    for (const t of tabWidths) {
      const neededWidth = t.width + (result.length > 0 ? separatorWidth : 0);
      if (usedWidth + neededWidth <= availableWidth) {
        result.push(t);
        usedWidth += neededWidth;
      } else {
        break;
      }
    }

    return result;
  }

  /**
   * Render the tab bar
   */
  render(ctx: RenderContext): void {
    const { x, y, width } = this.rect;
    this.tabPositions = [];
    this.hasLeftArrow = false;
    this.hasRightArrow = false;

    // Guard against invalid dimensions
    if (width <= 0) return;

    // ANSI helpers
    const bgRgb = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`;
    const fgRgb = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
    const reset = '\x1b[0m';
    const moveTo = (px: number, py: number) => `\x1b[${py};${px}H`;

    // Get theme colors - adjust background brightness when focused (same as file-tree/git-panel)
    const baseInactiveBg = themeLoader.getColor('tab.inactiveBackground');
    const baseActiveBg = themeLoader.getColor('tab.activeBackground');
    const inactiveBgColor = this.isFocused ? themeLoader.getFocusedBackground(baseInactiveBg) : baseInactiveBg;
    const activeBgColor = this.isFocused ? themeLoader.getFocusedBackground(baseActiveBg) : baseActiveBg;

    const inactiveBg = hexToRgb(inactiveBgColor) || { r: 41, g: 44, b: 60 };
    const activeBg = hexToRgb(activeBgColor) || { r: 48, g: 52, b: 70 };
    const activeFg = hexToRgb(themeLoader.getColor('tab.activeForeground')) || { r: 198, g: 208, b: 245 };
    const inactiveFg = hexToRgb(themeLoader.getColor('tab.inactiveForeground')) || { r: 131, g: 139, b: 167 };
    const borderColor = hexToRgb(themeLoader.getColor('tab.border')) || { r: 35, g: 38, b: 52 };
    // Use theme colors for dirty/missing indicators - fallback to reasonable defaults
    const dirtyColor = hexToRgb(themeLoader.getColor('editorGutter.modifiedBackground')) || { r: 229, g: 192, b: 123 };
    const missingColor = hexToRgb(themeLoader.getColor('editorGutter.deletedBackground')) || { r: 224, g: 108, b: 117 };
    const strikethrough = '\x1b[9m';
    const noStrikethrough = '\x1b[29m';

    // Determine if we need scroll arrows
    const needsLeftArrow = this.scrollOffset > 0;
    const tabAreaStart = x + (needsLeftArrow ? SCROLL_ARROW_WIDTH : 0);

    // Calculate available width for tabs (reserve space for potential right arrow)
    let availableWidth = width - (needsLeftArrow ? SCROLL_ARROW_WIDTH : 0);

    // Calculate tab widths
    const tabWidths = this.calculateTabWidths(availableWidth - SCROLL_ARROW_WIDTH);

    // Determine if we need a right arrow (more tabs after the visible ones)
    const visibleTabCount = tabWidths.length;
    const needsRightArrow = (this.scrollOffset + visibleTabCount) < this.tabs.length;

    // If we don't need right arrow, recalculate with full width
    const finalTabWidths = needsRightArrow ? tabWidths : this.calculateTabWidths(availableWidth);

    // Check if active tab is visible; if not, adjust scroll
    const activeIndex = this.tabs.findIndex(t => t.id === this.activeTabId);
    if (activeIndex >= 0) {
      const visibleEndIndex = this.scrollOffset + finalTabWidths.length;
      if (activeIndex >= visibleEndIndex) {
        // Active tab is past visible area, scroll right
        this.scrollOffset = activeIndex - finalTabWidths.length + 1;
        if (this.scrollOffset < 0) this.scrollOffset = 0;
        // Re-render with new scroll position
        this.render(ctx);
        return;
      }
    }

    // Build entire tab bar as one string
    let output = moveTo(x, y) + bgRgb(inactiveBg.r, inactiveBg.g, inactiveBg.b) + ' '.repeat(width);

    // Render left arrow if needed
    if (needsLeftArrow) {
      this.hasLeftArrow = true;
      this.leftArrowX = x;
      output += moveTo(x, y) + bgRgb(inactiveBg.r, inactiveBg.g, inactiveBg.b) +
                fgRgb(activeFg.r, activeFg.g, activeFg.b) + ' ◀  ';
    }

    let currentX = tabAreaStart;

    for (const { tab, width: tabWidth, contentWidth } of finalTabWidths) {
      const tabContent = this.formatTabContent(tab, contentWidth);
      const actualTabWidth = tabContent.length + 5;  // space + indicator + space + × + space

      // Track tab position for click handling (store close button start position)
      const closeButtonX = currentX + actualTabWidth - 3;  // × takes last 3 chars including padding
      this.tabPositions.push({
        id: tab.id,
        startX: currentX,
        endX: currentX + actualTabWidth,
        closeX: closeButtonX
      });

      // Tab background
      const tabBg = tab.isActive ? activeBg : inactiveBg;
      output += moveTo(currentX, y) + bgRgb(tabBg.r, tabBg.g, tabBg.b);

      // Missing/Dirty indicator or space
      if (tab.isMissing) {
        output += fgRgb(missingColor.r, missingColor.g, missingColor.b) + ' ⚠';
      } else if (tab.isDirty) {
        output += fgRgb(dirtyColor.r, dirtyColor.g, dirtyColor.b) + ' ●';
      } else {
        output += '  ';
      }

      // Tab name (with strikethrough for missing files)
      const tabFg = tab.isMissing ? missingColor : (tab.isActive ? activeFg : inactiveFg);
      if (tab.isMissing) {
        output += strikethrough + fgRgb(tabFg.r, tabFg.g, tabFg.b) + tabContent + noStrikethrough;
      } else {
        output += fgRgb(tabFg.r, tabFg.g, tabFg.b) + tabContent;
      }

      // Close button with visible hover area
      const closeFg = tab.isActive ? inactiveFg : { r: Math.floor(inactiveFg.r * 0.6), g: Math.floor(inactiveFg.g * 0.6), b: Math.floor(inactiveFg.b * 0.6) };
      output += ' ' + fgRgb(closeFg.r, closeFg.g, closeFg.b) + '×' + ' ';

      // Tab separator
      currentX += actualTabWidth;
      if (currentX < x + width - (needsRightArrow ? SCROLL_ARROW_WIDTH : 0)) {
        output += moveTo(currentX, y) + bgRgb(inactiveBg.r, inactiveBg.g, inactiveBg.b) + fgRgb(borderColor.r, borderColor.g, borderColor.b) + '│';
        currentX += 1;
      }
    }

    // Render right arrow if needed
    if (needsRightArrow) {
      this.hasRightArrow = true;
      this.rightArrowX = x + width - SCROLL_ARROW_WIDTH;
      output += moveTo(this.rightArrowX, y) + bgRgb(inactiveBg.r, inactiveBg.g, inactiveBg.b) +
                fgRgb(activeFg.r, activeFg.g, activeFg.b) + '  ▶ ';
    }

    output += reset;
    ctx.buffer(output);
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
      // Check if left arrow was clicked
      if (this.hasLeftArrow && event.x >= this.leftArrowX && event.x < this.leftArrowX + SCROLL_ARROW_WIDTH) {
        this.scrollLeft();
        renderer.scheduleRender();
        return true;
      }

      // Check if right arrow was clicked
      if (this.hasRightArrow && event.x >= this.rightArrowX && event.x < this.rightArrowX + SCROLL_ARROW_WIDTH) {
        this.scrollRight();
        renderer.scheduleRender();
        return true;
      }

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
