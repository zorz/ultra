/**
 * Status Bar
 *
 * Bottom status bar showing file info, position, and expandable history.
 */

import type { Rect } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';

// ============================================
// Types
// ============================================

/**
 * Status bar item alignment.
 */
export type StatusItemAlign = 'left' | 'right';

/**
 * A status bar item.
 */
export interface StatusItem {
  /** Unique item ID */
  id: string;
  /** Display content */
  content: string;
  /** Alignment */
  align: StatusItemAlign;
  /** Priority (lower = more important, shown first) */
  priority: number;
  /** Optional tooltip */
  tooltip?: string;
}

/**
 * History entry type.
 */
export type HistoryType = 'info' | 'warning' | 'error' | 'success';

/**
 * A history entry for the expanded view.
 */
export interface HistoryEntry {
  /** Timestamp */
  timestamp: Date;
  /** Message */
  message: string;
  /** Entry type */
  type: HistoryType;
}

/**
 * Callbacks for status bar events.
 */
export interface StatusBarCallbacks {
  /** Called when status bar is toggled */
  onToggle: () => void;
  /** Get a theme color */
  getThemeColor: (key: string, fallback?: string) => string;
}

// ============================================
// Status Bar Class
// ============================================

export class StatusBar {
  /** Status bar bounds */
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 1 };

  /** Status items */
  private items: Map<string, StatusItem> = new Map();

  /** History entries */
  private history: HistoryEntry[] = [];

  /** Whether expanded */
  private expanded = false;

  /** Expanded height */
  private expandedHeight = 10;

  /** Scroll offset in expanded view */
  private scrollOffset = 0;

  /** Callbacks */
  private callbacks: StatusBarCallbacks;

  /** Maximum history size */
  private static readonly MAX_HISTORY = 100;

  constructor(callbacks: StatusBarCallbacks) {
    this.callbacks = callbacks;

    // Default items
    this.addItem({ id: 'branch', content: '', align: 'left', priority: 1 });
    this.addItem({ id: 'file', content: '', align: 'left', priority: 2 });
    this.addItem({ id: 'position', content: '', align: 'right', priority: 1 });
    this.addItem({ id: 'encoding', content: 'UTF-8', align: 'right', priority: 3 });
    this.addItem({ id: 'language', content: '', align: 'right', priority: 2 });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Layout
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set status bar bounds.
   */
  setBounds(bounds: Rect): void {
    this.bounds = { ...bounds };
  }

  /**
   * Get status bar bounds.
   */
  getBounds(): Rect {
    return { ...this.bounds };
  }

  /**
   * Get the collapsed height (always 1).
   */
  getCollapsedHeight(): number {
    return 1;
  }

  /**
   * Get the expanded height.
   */
  getExpandedHeight(): number {
    return this.expandedHeight;
  }

  /**
   * Set the expanded height.
   */
  setExpandedHeight(height: number): void {
    this.expandedHeight = Math.max(2, height);
  }

  /**
   * Get the current height based on expanded state.
   */
  getCurrentHeight(): number {
    return this.expanded ? this.expandedHeight : 1;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Expand/Collapse
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check if expanded.
   */
  isExpanded(): boolean {
    return this.expanded;
  }

  /**
   * Toggle expanded state.
   */
  toggle(): void {
    this.expanded = !this.expanded;
    this.callbacks.onToggle();
  }

  /**
   * Expand the status bar.
   */
  expand(): void {
    if (!this.expanded) {
      this.expanded = true;
      this.callbacks.onToggle();
    }
  }

  /**
   * Collapse the status bar.
   */
  collapse(): void {
    if (this.expanded) {
      this.expanded = false;
      this.callbacks.onToggle();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Status Items
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Add or update a status item.
   */
  addItem(item: StatusItem): void {
    this.items.set(item.id, item);
  }

  /**
   * Remove a status item.
   */
  removeItem(id: string): boolean {
    return this.items.delete(id);
  }

  /**
   * Get a status item.
   */
  getItem(id: string): StatusItem | null {
    return this.items.get(id) ?? null;
  }

  /**
   * Set item content.
   */
  setItemContent(id: string, content: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    item.content = content;
    return true;
  }

  /**
   * Get all items.
   */
  getItems(): StatusItem[] {
    return Array.from(this.items.values());
  }

  /**
   * Get items sorted by priority.
   */
  private getItemsSorted(align: StatusItemAlign): StatusItem[] {
    return Array.from(this.items.values())
      .filter((item) => item.align === align && item.content)
      .sort((a, b) => a.priority - b.priority);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // History
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Add a history entry.
   */
  addHistory(message: string, type: HistoryType = 'info'): void {
    this.history.push({
      timestamp: new Date(),
      message,
      type,
    });

    // Trim to max size
    while (this.history.length > StatusBar.MAX_HISTORY) {
      this.history.shift();
    }

    // Auto-scroll to bottom
    this.scrollToBottom();
  }

  /**
   * Clear history.
   */
  clearHistory(): void {
    this.history = [];
    this.scrollOffset = 0;
  }

  /**
   * Get history entries.
   */
  getHistory(): HistoryEntry[] {
    return [...this.history];
  }

  /**
   * Get history count.
   */
  getHistoryCount(): number {
    return this.history.length;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scroll
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Scroll up in expanded view.
   */
  scrollUp(lines = 1): void {
    this.scrollOffset = Math.max(0, this.scrollOffset - lines);
  }

  /**
   * Scroll down in expanded view.
   */
  scrollDown(lines = 1): void {
    const maxOffset = Math.max(0, this.history.length - (this.expandedHeight - 1));
    this.scrollOffset = Math.min(maxOffset, this.scrollOffset + lines);
  }

  /**
   * Scroll to top.
   */
  scrollToTop(): void {
    this.scrollOffset = 0;
  }

  /**
   * Scroll to bottom.
   */
  scrollToBottom(): void {
    const maxOffset = Math.max(0, this.history.length - (this.expandedHeight - 1));
    this.scrollOffset = maxOffset;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Render the status bar.
   */
  render(buffer: ScreenBuffer): void {
    if (this.expanded) {
      this.renderExpanded(buffer);
    } else {
      this.renderCollapsed(buffer);
    }
  }

  private renderCollapsed(buffer: ScreenBuffer): void {
    const y = this.bounds.y;
    const { width } = this.bounds;

    const bg = this.callbacks.getThemeColor('statusBar.background', '#007acc');
    const fg = this.callbacks.getThemeColor('statusBar.foreground', '#ffffff');

    // Fill background
    for (let x = this.bounds.x; x < this.bounds.x + width; x++) {
      buffer.set(x, y, { char: ' ', fg, bg });
    }

    // Render left-aligned items
    let leftX = this.bounds.x + 1;
    const leftItems = this.getItemsSorted('left');
    for (const item of leftItems) {
      if (leftX >= this.bounds.x + width - 10) break;

      const text = ` ${item.content} `;
      for (let i = 0; i < text.length && leftX + i < this.bounds.x + width; i++) {
        buffer.set(leftX + i, y, { char: text[i]!, fg, bg });
      }
      leftX += text.length;
    }

    // Render right-aligned items
    let rightX = this.bounds.x + width - 1;
    const rightItems = this.getItemsSorted('right').reverse();
    for (const item of rightItems) {
      const text = ` ${item.content} `;
      rightX -= text.length;

      if (rightX < leftX + 3) break;

      for (let i = 0; i < text.length; i++) {
        buffer.set(rightX + i, y, { char: text[i]!, fg, bg });
      }
    }
  }

  private renderExpanded(buffer: ScreenBuffer): void {
    // Render collapsed bar at bottom
    const barY = this.bounds.y + this.bounds.height - 1;
    const originalY = this.bounds.y;
    this.bounds.y = barY;
    this.renderCollapsed(buffer);
    this.bounds.y = originalY;

    // Render history above
    const historyBg = this.callbacks.getThemeColor('panel.background', '#1e1e1e');
    const historyFg = this.callbacks.getThemeColor('panel.foreground', '#cccccc');
    const errorFg = this.callbacks.getThemeColor('errorForeground', '#f48771');
    const warningFg = this.callbacks.getThemeColor('warningForeground', '#cca700');
    const successFg = this.callbacks.getThemeColor('successForeground', '#89d185');

    const historyHeight = this.bounds.height - 1;
    const startIdx = this.scrollOffset;
    const endIdx = Math.min(startIdx + historyHeight, this.history.length);

    for (let row = 0; row < historyHeight; row++) {
      const y = this.bounds.y + row;
      const entryIdx = startIdx + row;

      // Clear line
      for (let x = this.bounds.x; x < this.bounds.x + this.bounds.width; x++) {
        buffer.set(x, y, { char: ' ', fg: historyFg, bg: historyBg });
      }

      if (entryIdx < this.history.length) {
        const entry = this.history[entryIdx]!;
        const time = this.formatTime(entry.timestamp);
        const prefix = `[${time}] `;

        // Get color for type
        let entryFg = historyFg;
        switch (entry.type) {
          case 'error':
            entryFg = errorFg;
            break;
          case 'warning':
            entryFg = warningFg;
            break;
          case 'success':
            entryFg = successFg;
            break;
        }

        // Render timestamp
        let x = this.bounds.x + 1;
        for (let i = 0; i < prefix.length && x < this.bounds.x + this.bounds.width; i++) {
          buffer.set(x, y, { char: prefix[i]!, fg: historyFg, bg: historyBg, dim: true });
          x++;
        }

        // Render message
        const message = entry.message.slice(0, this.bounds.width - prefix.length - 2);
        for (let i = 0; i < message.length && x < this.bounds.x + this.bounds.width; i++) {
          buffer.set(x, y, { char: message[i]!, fg: entryFg, bg: historyBg });
          x++;
        }
      }
    }
  }

  private formatTime(date: Date): string {
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    const s = date.getSeconds().toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a new status bar.
 */
export function createStatusBar(callbacks: StatusBarCallbacks): StatusBar {
  return new StatusBar(callbacks);
}
