/**
 * Terminal Panel Element
 *
 * A container for terminal sessions with tab support.
 * Appears at the bottom of the editor (like VS Code terminal panel).
 */

import { BaseElement, type ElementContext } from './base.ts';
import { TerminalSession, createTerminalSession } from './terminal-session.ts';
import type { KeyEvent, MouseEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import type { PTYBackend } from '../../../terminal/pty-backend.ts';
import { createPtyBackend } from '../../../terminal/pty-factory.ts';
import { debugLog } from '../../../debug.ts';
import { localSessionService } from '../../../services/session/local.ts';

// ============================================
// Types
// ============================================

/**
 * Terminal tab info.
 */
interface TerminalTab {
  id: string;
  title: string;
  session: TerminalSession;
  pty: PTYBackend | null;
}

// ============================================
// TerminalPanel Element
// ============================================

/**
 * Terminal tab dropdown info for callbacks.
 */
export interface TerminalTabDropdownInfo {
  id: string;
  title: string;
  isActive: boolean;
}

export class TerminalPanel extends BaseElement {
  /** Terminal tabs */
  private tabs: TerminalTab[] = [];

  /** Active tab index */
  private activeTabIndex: number = -1;

  /** Tab bar height */
  private tabBarHeight = 1;

  /** Next terminal ID counter */
  private nextTerminalId = 1;

  /** Tab scroll offset (number of tabs scrolled from left) */
  private tabScrollOffset = 0;

  /** Callback for showing tab dropdown menu */
  private onShowTabDropdown?: (
    tabs: TerminalTabDropdownInfo[],
    x: number,
    y: number
  ) => void;

  constructor(ctx: ElementContext) {
    super('TerminalPanel', 'terminal-panel', 'Terminal', ctx);
  }

  /**
   * Set callback for showing tab dropdown menu.
   */
  setTabDropdownCallback(
    callback: (tabs: TerminalTabDropdownInfo[], x: number, y: number) => void
  ): void {
    this.onShowTabDropdown = callback;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tab Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a new terminal.
   */
  async createTerminal(cwd?: string): Promise<string> {
    const id = `term-${this.nextTerminalId++}`;
    const title = `Terminal ${this.tabs.length + 1}`;

    debugLog(`[TerminalPanel] Creating terminal: ${id}`);

    // Create terminal session element
    const session = createTerminalSession(id, title, this.ctx, {
      onTitleChange: (newTitle) => {
        const tab = this.tabs.find((t) => t.id === id);
        if (tab) {
          tab.title = newTitle;
          this.ctx.markDirty();
        }
      },
      onExit: (code) => {
        debugLog(`[TerminalPanel] Terminal ${id} exited with code ${code}`);
      },
    });

    // Create and attach PTY backend
    let pty: PTYBackend | null = null;
    try {
      pty = await createPtyBackend({
        cwd: cwd ?? process.cwd(),
        cols: Math.max(1, this.bounds.width),
        rows: Math.max(1, this.bounds.height - this.tabBarHeight),
      });

      // Attach PTY to session
      session.attachPty(pty);

      // Start the PTY
      await pty.start();

      debugLog(`[TerminalPanel] PTY started for ${id}`);
    } catch (error) {
      debugLog(`[TerminalPanel] Failed to create PTY: ${error}`);
      // Session will work without PTY (just won't have live terminal)
    }

    // Add tab
    this.tabs.push({ id, title, session, pty });
    this.activeTabIndex = this.tabs.length - 1;

    // Layout the session
    this.layoutActiveSession();

    this.ctx.markDirty();

    return id;
  }

  /**
   * Close a terminal by ID.
   */
  closeTerminal(id: string): void {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index === -1) return;

    debugLog(`[TerminalPanel] Closing terminal: ${id}`);

    const tab = this.tabs[index]!;

    // Kill PTY if running
    if (tab.pty) {
      tab.pty.kill();
    }

    // Remove tab
    this.tabs.splice(index, 1);

    // Update active index
    if (this.tabs.length === 0) {
      this.activeTabIndex = -1;
    } else if (this.activeTabIndex >= this.tabs.length) {
      this.activeTabIndex = this.tabs.length - 1;
    }

    this.ctx.markDirty();
  }

  /**
   * Close the active terminal.
   */
  closeActiveTerminal(): void {
    if (this.activeTabIndex >= 0 && this.activeTabIndex < this.tabs.length) {
      this.closeTerminal(this.tabs[this.activeTabIndex]!.id);
    }
  }

  /**
   * Set active terminal by ID.
   */
  setActiveTerminal(id: string): void {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index !== -1) {
      this.activeTabIndex = index;
      this.layoutActiveSession();
      this.ctx.markDirty();
    }
  }

  /**
   * Switch to next terminal tab.
   */
  nextTerminal(): void {
    if (this.tabs.length > 1) {
      this.activeTabIndex = (this.activeTabIndex + 1) % this.tabs.length;
      this.layoutActiveSession();
      this.ctx.markDirty();
    }
  }

  /**
   * Switch to previous terminal tab.
   */
  previousTerminal(): void {
    if (this.tabs.length > 1) {
      this.activeTabIndex = (this.activeTabIndex - 1 + this.tabs.length) % this.tabs.length;
      this.layoutActiveSession();
      this.ctx.markDirty();
    }
  }

  /**
   * Get active terminal session.
   */
  getActiveSession(): TerminalSession | null {
    if (this.activeTabIndex >= 0 && this.activeTabIndex < this.tabs.length) {
      return this.tabs[this.activeTabIndex]!.session;
    }
    return null;
  }

  /**
   * Write data to the active terminal session.
   * Used for paste operations.
   */
  write(data: string): void {
    const session = this.getActiveSession();
    if (session) {
      session.write(data);
    }
  }

  /**
   * Check if panel has any terminals.
   */
  hasTerminals(): boolean {
    return this.tabs.length > 0;
  }

  /**
   * Get number of terminals.
   */
  getTerminalCount(): number {
    return this.tabs.length;
  }

  /**
   * Scroll tabs left by configured amount.
   */
  scrollTabsLeft(): void {
    const scrollAmount = (localSessionService.getSetting('tui.tabBar.scrollAmount') as number) ?? 1;
    this.tabScrollOffset = Math.max(0, this.tabScrollOffset - scrollAmount);
    this.ctx.markDirty();
  }

  /**
   * Scroll tabs right by configured amount.
   */
  scrollTabsRight(): void {
    const scrollAmount = (localSessionService.getSetting('tui.tabBar.scrollAmount') as number) ?? 1;

    // Calculate max offset so that the last tab is just visible
    const maxOffset = this.calculateMaxScrollOffset();
    if (this.tabScrollOffset >= maxOffset) return; // Already at max

    this.tabScrollOffset = Math.min(maxOffset, this.tabScrollOffset + scrollAmount);
    this.ctx.markDirty();
  }

  /**
   * Calculate the maximum scroll offset (so last tab is still visible).
   */
  private calculateMaxScrollOffset(): number {
    if (this.tabs.length === 0) return 0;

    const dropdownWidth = 3;
    const newTabWidth = 3;
    const arrowWidth = 3;
    const availableWidth = this.bounds.width - dropdownWidth - newTabWidth - arrowWidth * 2;

    // Calculate tab widths and find max offset
    let widthFromEnd = 0;
    let maxOffset = this.tabs.length - 1;

    for (let i = this.tabs.length - 1; i >= 0; i--) {
      const tab = this.tabs[i]!;
      const label = ` ${tab.title} `;
      const closeBtn = '×';
      const tabW = label.length + closeBtn.length + 1;

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
   * Ensure the active tab is visible (scroll if necessary).
   */
  ensureActiveTabVisible(): void {
    if (this.activeTabIndex < this.tabScrollOffset) {
      this.tabScrollOffset = this.activeTabIndex;
    }
    // We'll adjust the upper bound in render based on visible tabs
    this.ctx.markDirty();
  }

  /**
   * Get tabs for dropdown menu.
   */
  getTabsForDropdown(): TerminalTabDropdownInfo[] {
    return this.tabs.map((tab, index) => ({
      id: tab.id,
      title: tab.title,
      isActive: index === this.activeTabIndex,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Layout
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Layout the active session to fill the panel area.
   */
  private layoutActiveSession(): void {
    const session = this.getActiveSession();
    if (!session) return;

    // Session fills area below tab bar
    session.setBounds({
      x: this.bounds.x,
      y: this.bounds.y + this.tabBarHeight,
      width: this.bounds.width,
      height: Math.max(1, this.bounds.height - this.tabBarHeight),
    });

    session.onResize({
      width: this.bounds.width,
      height: Math.max(1, this.bounds.height - this.tabBarHeight),
    });
  }

  override onResize(size: { width: number; height: number }): void {
    super.onResize(size);
    this.layoutActiveSession();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  render(buffer: ScreenBuffer): void {
    const { x, y, width, height } = this.bounds;

    // Theme colors
    const tabBg = this.ctx.getThemeColor('tab.inactiveBackground', '#2d2d2d');
    const tabActiveBg = this.ctx.getThemeColor('tab.activeBackground', '#1e1e1e');
    const tabFg = this.ctx.getThemeColor('tab.inactiveForeground', '#888888');
    const tabActiveFg = this.ctx.getThemeColor('tab.activeForeground', '#ffffff');
    const arrowFg = this.ctx.getThemeColor('tab.inactiveForeground', '#888888');
    const arrowHoverFg = this.ctx.getThemeColor('tab.activeForeground', '#ffffff');

    // Draw tab bar background
    buffer.writeString(x, y, ' '.repeat(width), tabFg, tabBg);

    // Reserve space for controls on the right: dropdown (3) + "+" button (3)
    // Also potentially left/right arrows (3 each) when tabs overflow
    const dropdownWidth = 3; // " ▼ "
    const newTabWidth = 3; // " + "
    const arrowWidth = 3; // " < " or " > "

    // Calculate available width for tabs
    let tabAreaStart = x;
    let tabAreaEnd = x + width - dropdownWidth - newTabWidth;

    // Check if we need scroll arrows
    const needsScrollArrows = this.tabs.length > 0 && this.tabScrollOffset > 0 || this.checkTabsOverflow(tabAreaEnd - tabAreaStart);

    if (needsScrollArrows) {
      // Reserve space for left arrow if we're scrolled
      if (this.tabScrollOffset > 0) {
        tabAreaStart += arrowWidth;
      }
      // Reserve space for right arrow
      tabAreaEnd -= arrowWidth;
    }

    // Draw left scroll arrow if needed
    let leftArrowX = x;
    if (this.tabScrollOffset > 0) {
      buffer.writeString(leftArrowX, y, ' < ', arrowHoverFg, tabBg);
    }

    // Draw tabs in the available area
    let tabX = tabAreaStart;
    let lastVisibleTabIndex = -1;

    for (let i = this.tabScrollOffset; i < this.tabs.length; i++) {
      const tab = this.tabs[i]!;
      const isActive = i === this.activeTabIndex;
      const bg = isActive ? tabActiveBg : tabBg;
      const fg = isActive ? tabActiveFg : tabFg;

      // Tab label with padding
      const label = ` ${tab.title} `;
      const closeBtn = '×';
      const tabWidth = label.length + closeBtn.length + 1;

      if (tabX + tabWidth > tabAreaEnd) break; // Don't overflow into control area

      buffer.writeString(tabX, y, label, fg, bg);
      buffer.writeString(tabX + label.length, y, closeBtn, '#888888', bg);
      buffer.writeString(tabX + label.length + closeBtn.length, y, ' ', fg, tabBg);

      tabX += tabWidth;
      lastVisibleTabIndex = i;
    }

    // Draw right scroll arrow if there are more tabs
    const hasMoreTabsRight = lastVisibleTabIndex < this.tabs.length - 1;
    if (hasMoreTabsRight || this.tabScrollOffset > 0) {
      const rightArrowX = tabAreaEnd;
      if (hasMoreTabsRight) {
        buffer.writeString(rightArrowX, y, ' > ', arrowHoverFg, tabBg);
      } else {
        buffer.writeString(rightArrowX, y, '   ', tabFg, tabBg);
      }
    }

    // Draw dropdown button (always visible)
    const dropdownX = x + width - dropdownWidth - newTabWidth;
    buffer.writeString(dropdownX, y, ' ▼ ', arrowFg, tabBg);

    // Draw "+" button for new terminal
    const newTabX = x + width - newTabWidth;
    buffer.writeString(newTabX, y, ' + ', tabFg, tabBg);

    // Render active session
    const session = this.getActiveSession();
    if (session && height > this.tabBarHeight) {
      session.render(buffer);
    } else if (height > this.tabBarHeight) {
      // No terminals - show empty state
      const emptyBg = this.ctx.getThemeColor('terminal.background', '#1e1e1e');
      const emptyFg = this.ctx.getThemeColor('terminal.foreground', '#888888');
      for (let row = y + this.tabBarHeight; row < y + height; row++) {
        buffer.writeString(x, row, ' '.repeat(width), emptyFg, emptyBg);
      }
      const msg = 'No terminal. Press Ctrl+Shift+` to create one.';
      const msgX = x + Math.floor((width - msg.length) / 2);
      const msgY = y + this.tabBarHeight + Math.floor((height - this.tabBarHeight) / 2);
      if (msgY < y + height) {
        buffer.writeString(msgX, msgY, msg, emptyFg, emptyBg);
      }
    }
  }

  /**
   * Check if tabs would overflow the given width.
   */
  private checkTabsOverflow(availableWidth: number): boolean {
    let totalWidth = 0;
    for (const tab of this.tabs) {
      const label = ` ${tab.title} `;
      const closeBtn = '×';
      totalWidth += label.length + closeBtn.length + 1;
    }
    return totalWidth > availableWidth;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  override handleKey(event: KeyEvent): boolean {
    // Handle tab switching shortcuts
    if (event.ctrl && event.key === 'PageDown') {
      this.nextTerminal();
      return true;
    }
    if (event.ctrl && event.key === 'PageUp') {
      this.previousTerminal();
      return true;
    }

    // Forward to active session
    const session = this.getActiveSession();
    if (session) {
      return session.handleKey(event);
    }

    return false;
  }

  override handleMouse(event: MouseEvent): boolean {
    const { x, y, width } = this.bounds;

    // Check if click is in tab bar
    if (event.type === 'press' && event.y === y) {
      const dropdownWidth = 3;
      const newTabWidth = 3;
      const arrowWidth = 3;

      // Check "+" button (rightmost)
      const newTabX = x + width - newTabWidth;
      if (event.x >= newTabX && event.x < newTabX + newTabWidth) {
        this.createTerminal().catch((err) => {
          debugLog(`[TerminalPanel] Failed to create terminal: ${err}`);
        });
        return true;
      }

      // Check dropdown button
      const dropdownX = x + width - dropdownWidth - newTabWidth;
      if (event.x >= dropdownX && event.x < dropdownX + dropdownWidth) {
        if (this.onShowTabDropdown) {
          const tabs = this.getTabsForDropdown();
          this.onShowTabDropdown(tabs, dropdownX, y + 1);
        }
        return true;
      }

      // Check scroll arrows
      const needsScrollArrows = this.tabScrollOffset > 0 || this.checkTabsOverflow(width - dropdownWidth - newTabWidth);

      let tabAreaStart = x;
      let tabAreaEnd = x + width - dropdownWidth - newTabWidth;

      if (needsScrollArrows) {
        tabAreaEnd -= arrowWidth;
      }

      // Left arrow
      if (this.tabScrollOffset > 0 && event.x >= x && event.x < x + arrowWidth) {
        this.scrollTabsLeft();
        return true;
      }

      // Adjust tab area start if left arrow is shown
      if (this.tabScrollOffset > 0) {
        tabAreaStart += arrowWidth;
      }

      // Right arrow
      const rightArrowX = tabAreaEnd;
      if (needsScrollArrows && event.x >= rightArrowX && event.x < rightArrowX + arrowWidth) {
        this.scrollTabsRight();
        return true;
      }

      // Calculate which tab was clicked
      let tabX = tabAreaStart;
      for (let i = this.tabScrollOffset; i < this.tabs.length; i++) {
        const tab = this.tabs[i]!;
        const label = ` ${tab.title} `;
        const closeBtn = '×';
        const tabWidth = label.length + closeBtn.length + 1;

        if (tabX + tabWidth > tabAreaEnd) break;

        if (event.x >= tabX && event.x < tabX + tabWidth) {
          // Check if close button was clicked
          if (event.x >= tabX + label.length && event.x < tabX + label.length + closeBtn.length) {
            this.closeTerminal(tab.id);
          } else {
            this.setActiveTerminal(tab.id);
          }
          return true;
        }

        tabX += tabWidth;
      }

      return true;
    }

    // Forward to active session
    const session = this.getActiveSession();
    if (session) {
      return session.handleMouse(event);
    }

    return false;
  }

  override onFocus(): void {
    super.onFocus();
    // Focus the active session
    const session = this.getActiveSession();
    if (session) {
      session.onFocus();
    }
  }

  override onBlur(): void {
    super.onBlur();
    const session = this.getActiveSession();
    if (session) {
      session.onBlur();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Kill all terminals and clean up.
   */
  destroy(): void {
    for (const tab of this.tabs) {
      if (tab.pty) {
        tab.pty.kill();
      }
    }
    this.tabs = [];
    this.activeTabIndex = -1;
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a terminal panel element.
 */
export function createTerminalPanel(ctx: ElementContext): TerminalPanel {
  return new TerminalPanel(ctx);
}
