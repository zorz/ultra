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

    // Default items - Left side
    this.addItem({ id: 'branch', content: '', align: 'left', priority: 1 });
    this.addItem({ id: 'sync', content: '', align: 'left', priority: 2 });
    this.addItem({ id: 'file', content: '', align: 'left', priority: 3 });
    this.addItem({ id: 'command', content: '', align: 'left', priority: 4 });

    // Default items - Right side
    this.addItem({ id: 'position', content: '', align: 'right', priority: 1 });
    this.addItem({ id: 'selection', content: '', align: 'right', priority: 2 });
    this.addItem({ id: 'language', content: '', align: 'right', priority: 3 });
    this.addItem({ id: 'lsp', content: '', align: 'right', priority: 4 });
    this.addItem({ id: 'indent', content: '', align: 'right', priority: 5 });
    this.addItem({ id: 'encoding', content: 'UTF-8', align: 'right', priority: 6 });
    this.addItem({ id: 'eol', content: 'LF', align: 'right', priority: 7 });
  }

  /**
   * Show a command briefly in the status bar.
   * Auto-clears after the specified duration.
   */
  showCommand(command: string, duration = 2000): void {
    this.setItemContent('command', command);
    setTimeout(() => {
      this.setItemContent('command', '');
    }, duration);
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
    const startX = this.bounds.x;

    const bg = this.callbacks.getThemeColor('statusBar.background', '#007acc');
    const fg = this.callbacks.getThemeColor('statusBar.foreground', '#ffffff');
    const separatorChar = '│';

    // Fill entire background first with a single consistent color
    const emptyCell = { char: ' ', fg, bg, bold: false, dim: false, italic: false, underline: false, strikethrough: false };
    for (let x = startX; x < startX + width; x++) {
      buffer.set(x, y, emptyCell);
    }

    // Build left side string with separators (compact: single space between items)
    const leftItems = this.getItemsSorted('left');
    let leftStr = '';
    for (let idx = 0; idx < leftItems.length; idx++) {
      const item = leftItems[idx]!;
      if (idx === 0) {
        leftStr += ` ${item.content}`;
      } else {
        leftStr += ` ${separatorChar} ${item.content}`;
      }
    }

    // Build right side string with separators (compact: single space between items)
    const rightItems = this.getItemsSorted('right');
    let rightStr = '';
    for (let idx = 0; idx < rightItems.length; idx++) {
      const item = rightItems[idx]!;
      if (idx === 0) {
        rightStr += `${item.content}`;
      } else {
        rightStr += ` ${separatorChar} ${item.content}`;
      }
    }
    if (rightStr) {
      rightStr += ' '; // Trailing space for right side
    }

    // Calculate right side starting position
    const rightStartX = startX + width - this.getDisplayWidth(rightStr);

    // Render left side (use writeString for proper Unicode handling)
    if (leftStr) {
      buffer.writeString(startX, y, leftStr, fg, bg);
    }

    // Render right side if it doesn't overlap with left
    const leftEndX = startX + this.getDisplayWidth(leftStr);
    if (rightStr && rightStartX >= leftEndX + 1) {
      buffer.writeString(rightStartX, y, rightStr, fg, bg);
    }
  }

  /**
   * Get display width of a string (handles emoji/wide chars).
   */
  private getDisplayWidth(str: string): number {
    let width = 0;
    for (const char of str) {
      const code = char.codePointAt(0) ?? 0;
      if (code < 32) continue; // Control chars
      if (code < 127) { width++; continue; } // ASCII
      // Emoji and CJK are 2 cells wide
      if (
        (code >= 0x1F300 && code <= 0x1F9FF) ||
        (code >= 0x2600 && code <= 0x26FF) ||
        (code >= 0x2700 && code <= 0x27BF) ||
        (code >= 0x1F600 && code <= 0x1F64F) ||
        (code >= 0x1F680 && code <= 0x1F6FF) ||
        (code >= 0x1F1E0 && code <= 0x1F1FF) ||
        (code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0xF900 && code <= 0xFAFF) ||
        (code >= 0xFF00 && code <= 0xFFEF)
      ) {
        width += 2;
      } else {
        width++;
      }
    }
    return width;
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
