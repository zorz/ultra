/**
 * Git Panel Component
 * 
 * VS Code-style Source Control panel showing staged/unstaged changes,
 * allowing users to stage, unstage, discard changes, and commit.
 */

import { renderer, type RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import { themeLoader } from '../themes/theme-loader.ts';
import { settings } from '../../config/settings.ts';
import { gitIntegration, type GitStatus, type GitFileStatus } from '../../features/git/git-integration.ts';
import * as path from 'path';
import { hexToRgb } from '../colors.ts';

type Section = 'staged' | 'unstaged' | 'untracked';

interface GitPanelItem {
  section: Section;
  file: GitFileStatus | string;  // GitFileStatus for staged/unstaged, string for untracked
  index: number;
}

export class GitPanel implements MouseHandler {
  private rect: Rect = { x: 1, y: 1, width: 30, height: 20 };
  private isVisible: boolean = false;
  private isFocused: boolean = false;
  
  // Git status
  private status: GitStatus | null = null;
  private branch: string | null = null;
  
  // Selection state
  private selectedSection: Section = 'unstaged';
  private selectedIndex: number = 0;
  private scrollTop: number = 0;
  
  // Section collapsed state
  private stagedCollapsed: boolean = false;
  private unstagedCollapsed: boolean = false;
  private untrackedCollapsed: boolean = false;
  
  // Callbacks
  private onFileSelectCallback?: (filePath: string) => void;
  private onRefreshCallback?: () => void;
  private onFocusCallback?: () => void;
  private onCommitRequestCallback?: () => void;

  setRect(rect: Rect): void {
    this.rect = rect;
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    if (visible) {
      this.refresh();
    }
  }

  isOpen(): boolean {
    return this.isVisible;
  }

  setFocused(focused: boolean): void {
    const wasFocused = this.isFocused;
    this.isFocused = focused;

    // Trigger re-render to update focus-dependent colors (background highlighting)
    if (focused !== wasFocused) {
      renderer.scheduleRender();
    }
  }

  getFocused(): boolean {
    return this.isFocused;
  }

  /**
   * Refresh git status
   */
  async refresh(): Promise<void> {
    this.status = await gitIntegration.status(true);
    this.branch = await gitIntegration.branch();
    if (this.onRefreshCallback) {
      this.onRefreshCallback();
    }
  }

  /**
   * Get all items in order for selection
   */
  private getAllItems(): GitPanelItem[] {
    const items: GitPanelItem[] = [];
    
    if (this.status) {
      // Staged files
      if (!this.stagedCollapsed) {
        this.status.staged.forEach((file, index) => {
          items.push({ section: 'staged', file, index });
        });
      }
      
      // Unstaged files
      if (!this.unstagedCollapsed) {
        this.status.unstaged.forEach((file, index) => {
          items.push({ section: 'unstaged', file, index });
        });
      }
      
      // Untracked files
      if (!this.untrackedCollapsed) {
        this.status.untracked.forEach((filePath, index) => {
          items.push({ section: 'untracked', file: filePath, index });
        });
      }
    }
    
    return items;
  }

  /**
   * Get currently selected item
   */
  private getSelectedItem(): GitPanelItem | null {
    const items = this.getAllItems();
    let currentIndex = 0;
    
    for (const item of items) {
      if (item.section === this.selectedSection && item.index === this.selectedIndex) {
        return item;
      }
    }
    
    return items[0] || null;
  }

  /**
   * Move selection up
   */
  selectPrevious(): void {
    const items = this.getAllItems();
    if (items.length === 0) return;
    
    // Find current position
    let currentPos = items.findIndex(
      item => item.section === this.selectedSection && item.index === this.selectedIndex
    );
    
    if (currentPos === -1) currentPos = 0;
    else if (currentPos > 0) currentPos--;
    
    const item = items[currentPos]!;
    this.selectedSection = item.section;
    this.selectedIndex = item.index;
    this.ensureVisible();
  }

  /**
   * Move selection down
   */
  selectNext(): void {
    const items = this.getAllItems();
    if (items.length === 0) return;
    
    // Find current position
    let currentPos = items.findIndex(
      item => item.section === this.selectedSection && item.index === this.selectedIndex
    );
    
    if (currentPos === -1) currentPos = 0;
    else if (currentPos < items.length - 1) currentPos++;
    
    const item = items[currentPos]!;
    this.selectedSection = item.section;
    this.selectedIndex = item.index;
    this.ensureVisible();
  }

  /**
   * Get the visual row index for the currently selected item (0-based, relative to content area)
   */
  private getSelectedVisualRow(): number {
    if (!this.status) return 0;

    let row = 0;

    // Staged section header
    row++;
    if (this.selectedSection === 'staged' && !this.stagedCollapsed) {
      return row + this.selectedIndex;
    }
    if (!this.stagedCollapsed) {
      row += this.status.staged.length;
    }

    // Unstaged section header
    row++;
    if (this.selectedSection === 'unstaged' && !this.unstagedCollapsed) {
      return row + this.selectedIndex;
    }
    if (!this.unstagedCollapsed) {
      row += this.status.unstaged.length;
    }

    // Untracked section header
    if (this.status.untracked.length > 0) {
      row++;
      if (this.selectedSection === 'untracked' && !this.untrackedCollapsed) {
        return row + this.selectedIndex;
      }
    }

    return row;
  }

  /**
   * Get total content height (excluding fixed header)
   */
  private getContentHeight(): number {
    if (!this.status) return 1;

    let height = 0;

    // Staged section
    height++; // header
    if (!this.stagedCollapsed) height += this.status.staged.length;

    // Unstaged section
    height++; // header
    if (!this.unstagedCollapsed) height += this.status.unstaged.length;

    // Untracked section
    if (this.status.untracked.length > 0) {
      height++; // header
      if (!this.untrackedCollapsed) height += this.status.untracked.length;
    }

    return height;
  }

  /**
   * Calculate how many lines the hint bar takes
   */
  private getHintLineCount(): number {
    if (!this.isFocused) return 0;

    const hints = ['s:stage', 'u:unstage', 'd:discard', 'c:commit', 'S:stage all'];
    let lineCount = 1;
    let currentLineLength = 0;

    for (const hint of hints) {
      const addition = currentLineLength > 0 ? 2 + hint.length : 1 + hint.length;
      if (currentLineLength + addition > this.rect.width) {
        lineCount++;
        currentLineLength = 1 + hint.length;
      } else {
        currentLineLength += addition;
      }
    }

    return lineCount;
  }

  /**
   * Get the visible content height (accounting for header, hints, etc.)
   */
  private getVisibleHeight(): number {
    // -3 for header/branch/separator, -hintLines for bottom hints
    return this.rect.height - 3 - this.getHintLineCount();
  }

  /**
   * Ensure selected item is visible
   */
  private ensureVisible(): void {
    const selectedRow = this.getSelectedVisualRow();
    const visibleHeight = this.getVisibleHeight();

    if (selectedRow < this.scrollTop) {
      this.scrollTop = selectedRow;
    } else if (selectedRow >= this.scrollTop + visibleHeight) {
      this.scrollTop = selectedRow - visibleHeight + 1;
    }

    // Clamp scrollTop
    const maxScroll = Math.max(0, this.getContentHeight() - visibleHeight);
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, maxScroll));
  }

  /**
   * Stage the selected file
   */
  async stageSelected(): Promise<void> {
    const item = this.getSelectedItem();
    if (!item) return;
    
    let filePath: string;
    if (item.section === 'unstaged') {
      filePath = (item.file as GitFileStatus).path;
    } else if (item.section === 'untracked') {
      filePath = item.file as string;
    } else {
      return;  // Already staged
    }
    
    await gitIntegration.add(filePath);
    await this.refresh();
  }

  /**
   * Unstage the selected file
   */
  async unstageSelected(): Promise<void> {
    const item = this.getSelectedItem();
    if (!item || item.section !== 'staged') return;
    
    const filePath = (item.file as GitFileStatus).path;
    await gitIntegration.reset(filePath);
    await this.refresh();
  }

  /**
   * Discard changes in the selected file
   */
  async discardSelected(): Promise<void> {
    const item = this.getSelectedItem();
    if (!item || item.section !== 'unstaged') return;
    
    const filePath = (item.file as GitFileStatus).path;
    await gitIntegration.checkout(filePath);
    await this.refresh();
  }

  /**
   * Stage all files
   */
  async stageAll(): Promise<void> {
    await gitIntegration.addAll();
    await this.refresh();
  }

  /**
   * Commit staged changes with the given message
   */
  async commitWithMessage(message: string): Promise<boolean> {
    if (!message.trim()) return false;
    
    const success = await gitIntegration.commit(message);
    if (success) {
      await this.refresh();
    }
    return success;
  }

  /**
   * Check if there are staged changes to commit
   */
  hasStagedChanges(): boolean {
    return this.status !== null && this.status.staged.length > 0;
  }

  /**
   * Toggle section collapsed state
   */
  toggleSection(section: Section): void {
    if (section === 'staged') {
      this.stagedCollapsed = !this.stagedCollapsed;
    } else if (section === 'unstaged') {
      this.unstagedCollapsed = !this.unstagedCollapsed;
    } else {
      this.untrackedCollapsed = !this.untrackedCollapsed;
    }
  }

  /**
   * Handle keyboard input
   */
  async handleKey(key: string, ctrl: boolean, shift: boolean, char?: string): Promise<boolean> {
    if (!this.isFocused) return false;
    
    // Normal panel navigation
    switch (key) {
      case 'UP':
      case 'K':
        this.selectPrevious();
        return true;
        
      case 'DOWN':
      case 'J':
        this.selectNext();
        return true;
        
      case 'ENTER':
        // Open file in editor
        const item = this.getSelectedItem();
        if (item && this.onFileSelectCallback) {
          const filePath = typeof item.file === 'string' ? item.file : item.file.path;
          this.onFileSelectCallback(filePath);
        }
        return true;
        
      case 'S':
        if (shift) {
          // Shift+S: Stage all
          await this.stageAll();
        } else {
          // S: Stage selected
          await this.stageSelected();
        }
        return true;
        
      case 'U':
        // U: Unstage selected
        await this.unstageSelected();
        return true;
        
      case 'D':
        if (!shift) {
          // D: Discard changes
          await this.discardSelected();
        }
        return true;
        
      case 'C':
        // C: Open commit dialog
        if (this.onCommitRequestCallback && this.hasStagedChanges()) {
          this.onCommitRequestCallback();
        }
        return true;
        
      case 'R':
        // R: Refresh
        await this.refresh();
        return true;
        
      case 'ESCAPE':
        this.isFocused = false;
        return true;
    }
    
    return false;
  }

  /**
   * Render the git panel
   */
  render(ctx: RenderContext): void {
    if (!this.isVisible) return;
    
    const moveTo = (x: number, y: number) => `\x1b[${y};${x}H`;
    const bgRgb = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`;
    const fgRgb = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
    const reset = '\x1b[0m';
    
    // Get colors from theme (adjust brightness when focused)
    const baseBgColor = themeLoader.getColor('sideBar.background');
    const bgColor = this.isFocused ? themeLoader.getFocusedBackground(baseBgColor) : baseBgColor;
    // Primary fallback is editor background/foreground to maintain visual consistency
    const editorBg = hexToRgb(themeLoader.getColor('editor.background'));
    const editorFg = hexToRgb(themeLoader.getColor('editor.foreground'));
    const panelBg = hexToRgb(bgColor) || editorBg || { r: 37, g: 37, b: 38 };
    const panelFg = hexToRgb(themeLoader.getColor('sideBar.foreground')) || editorFg || { r: 204, g: 204, b: 204 };
    const titleFg = hexToRgb(themeLoader.getColor('sideBarTitle.foreground')) || panelFg;
    const selectionBg = hexToRgb(themeLoader.getColor('list.activeSelectionBackground')) || { r: Math.min(255, panelBg.r + 30), g: Math.min(255, panelBg.g + 30), b: Math.min(255, panelBg.b + 30) };
    const selectionFg = hexToRgb(themeLoader.getColor('list.activeSelectionForeground')) || panelFg;
    const accentFg = hexToRgb(themeLoader.getColor('focusBorder')) || panelFg;

    // Git status colors - fallback to gutter colors or derive from foreground
    const gutterAdded = hexToRgb(themeLoader.getColor('editorGutter.addedBackground'));
    const gutterModified = hexToRgb(themeLoader.getColor('editorGutter.modifiedBackground'));
    const gutterDeleted = hexToRgb(themeLoader.getColor('editorGutter.deletedBackground'));
    const addedFg = hexToRgb(themeLoader.getColor('gitDecoration.addedResourceForeground')) || gutterAdded || panelFg;
    const modifiedFg = hexToRgb(themeLoader.getColor('gitDecoration.modifiedResourceForeground')) || gutterModified || panelFg;
    const deletedFg = hexToRgb(themeLoader.getColor('gitDecoration.deletedResourceForeground')) || gutterDeleted || panelFg;
    const untrackedFg = hexToRgb(themeLoader.getColor('gitDecoration.untrackedResourceForeground')) || gutterAdded || panelFg;
    
    let output = '';
    let y = this.rect.y;
    
    // Clear background
    for (let row = this.rect.y; row < this.rect.y + this.rect.height; row++) {
      output += moveTo(this.rect.x, row);
      output += bgRgb(panelBg.r, panelBg.g, panelBg.b);
      output += ' '.repeat(this.rect.width);
    }
    
    // Header
    output += moveTo(this.rect.x, y);
    output += bgRgb(panelBg.r, panelBg.g, panelBg.b);
    output += fgRgb(titleFg.r, titleFg.g, titleFg.b);
    const title = ` SOURCE CONTROL`;
    output += title.padEnd(this.rect.width, ' ');
    y++;
    
    // Branch info
    output += moveTo(this.rect.x, y);
    output += fgRgb(accentFg.r, accentFg.g, accentFg.b);
    const branchLine = ` ⎇ ${this.branch || 'No branch'}`;
    output += branchLine.substring(0, this.rect.width).padEnd(this.rect.width, ' ');
    y++;
    

    // Separator
    output += moveTo(this.rect.x, y);
    output += fgRgb(panelFg.r * 0.5, panelFg.g * 0.5, panelFg.b * 0.5);
    output += '─'.repeat(this.rect.width);
    y++;
    
    if (!this.status) {
      output += moveTo(this.rect.x, y);
      output += fgRgb(panelFg.r, panelFg.g, panelFg.b);
      output += ' No git repository'.padEnd(this.rect.width, ' ');
    } else {
      // Calculate visible area (reserve space for hints at bottom)
      const contentStartY = y;
      const visibleHeight = this.getVisibleHeight();
      let contentRow = 0; // Virtual row in content (0-indexed)

      // Helper to check if a content row is visible and render it
      const renderRow = (text: string, fg: {r:number,g:number,b:number}, isSelected: boolean = false): boolean => {
        if (contentRow >= this.scrollTop && contentRow < this.scrollTop + visibleHeight) {
          const screenY = contentStartY + (contentRow - this.scrollTop);
          output += moveTo(this.rect.x, screenY);
          if (isSelected) {
            output += bgRgb(selectionBg.r, selectionBg.g, selectionBg.b);
            output += fgRgb(selectionFg.r, selectionFg.g, selectionFg.b);
          } else {
            output += bgRgb(panelBg.r, panelBg.g, panelBg.b);
            output += fgRgb(fg.r, fg.g, fg.b);
          }
          output += text.substring(0, this.rect.width).padEnd(this.rect.width, ' ');
        }
        contentRow++;
        return contentRow < this.scrollTop + visibleHeight;
      };

      // Staged changes section
      const stagedCount = this.status.staged.length;
      const stagedHeader = ` ${this.stagedCollapsed ? '▶' : '▼'} Staged (${stagedCount})`;
      renderRow(stagedHeader, titleFg);

      if (!this.stagedCollapsed) {
        for (let i = 0; i < this.status.staged.length; i++) {
          const file = this.status.staged[i]!;
          const isSelected = this.isFocused && this.selectedSection === 'staged' && this.selectedIndex === i;
          const statusColor = file.status === 'A' ? addedFg : file.status === 'D' ? deletedFg : modifiedFg;
          const statusChar = file.status === 'A' ? '+' : file.status === 'D' ? '-' : '~';
          const fileName = path.basename(file.path);
          const line = `   ${statusChar} ${fileName}`;
          if (!renderRow(line, statusColor, isSelected)) break;
        }
      }

      // Unstaged changes section
      const unstagedCount = this.status.unstaged.length;
      const unstagedHeader = ` ${this.unstagedCollapsed ? '▶' : '▼'} Changes (${unstagedCount})`;
      renderRow(unstagedHeader, titleFg);

      if (!this.unstagedCollapsed) {
        for (let i = 0; i < this.status.unstaged.length; i++) {
          const file = this.status.unstaged[i]!;
          const isSelected = this.isFocused && this.selectedSection === 'unstaged' && this.selectedIndex === i;
          const statusColor = file.status === 'D' ? deletedFg : modifiedFg;
          const statusChar = file.status === 'D' ? '-' : '~';
          const fileName = path.basename(file.path);
          const line = `   ${statusChar} ${fileName}`;
          if (!renderRow(line, statusColor, isSelected)) break;
        }
      }

      // Untracked files section
      const untrackedCount = this.status.untracked.length;
      if (untrackedCount > 0) {
        const untrackedHeader = ` ${this.untrackedCollapsed ? '▶' : '▼'} Untracked (${untrackedCount})`;
        renderRow(untrackedHeader, titleFg);

        if (!this.untrackedCollapsed) {
          for (let i = 0; i < this.status.untracked.length; i++) {
            const filePath = this.status.untracked[i]!;
            const isSelected = this.isFocused && this.selectedSection === 'untracked' && this.selectedIndex === i;
            const fileName = path.basename(filePath);
            const line = `   ? ${fileName}`;
            if (!renderRow(line, untrackedFg, isSelected)) break;
          }
        }
      }
    }
    
    // Help hint at bottom (wrapped to fit width)
    if (this.isFocused) {
      output += bgRgb(45, 45, 48);
      output += fgRgb(150, 150, 150);
      
      const hints = ['s:stage', 'u:unstage', 'd:discard', 'c:commit', 'S:stage all'];
      
      // Wrap hints into lines that fit the width
      const lines: string[] = [];
      let currentLine = '';
      
      for (const hint of hints) {
        const addition = currentLine ? '  ' + hint : ' ' + hint;
        if ((currentLine + addition).length <= this.rect.width) {
          currentLine += addition;
        } else {
          if (currentLine) lines.push(currentLine);
          currentLine = ' ' + hint;
        }
      }
      if (currentLine) lines.push(currentLine);
      
      // Draw from bottom up
      for (let i = 0; i < lines.length; i++) {
        const y = this.rect.y + this.rect.height - lines.length + i;
        output += moveTo(this.rect.x, y);
        output += (lines[i] || '').padEnd(this.rect.width, ' ');
      }
    }
    
    output += reset;
    ctx.buffer(output);
  }

  // MouseHandler implementation

  containsPoint(x: number, y: number): boolean {
    if (!this.isVisible) return false;
    return (
      x >= this.rect.x &&
      x < this.rect.x + this.rect.width &&
      y >= this.rect.y &&
      y < this.rect.y + this.rect.height
    );
  }

  onMouseEvent(event: MouseEvent): boolean {
    if (!this.isVisible) return false;

    // Request focus on any click within bounds
    if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED') {
      this.isFocused = true;
      if (this.onFocusCallback) {
        this.onFocusCallback();
      }
    }

    switch (event.name) {
      case 'MOUSE_LEFT_BUTTON_PRESSED': {
        // Calculate which line was clicked (accounting for header, branch, separator)
        const screenClickY = event.y - this.rect.y - 3; // -3 for header, branch, separator
        if (screenClickY < 0) return true; // Clicked on header area

        // Convert screen position to content position (add scrollTop)
        const clickY = screenClickY + this.scrollTop;

        // Map click to item
        if (!this.status) return true;

        let currentY = 0;

        // Staged section
        currentY++; // Header line
        if (clickY === currentY - 1) {
          // Clicked on staged header - toggle section
          this.toggleSection('staged');
          return true;
        }

        if (!this.stagedCollapsed) {
          for (let i = 0; i < this.status.staged.length; i++) {
            if (clickY === currentY) {
              this.selectedSection = 'staged';
              this.selectedIndex = i;
              return true;
            }
            currentY++;
          }
        }

        // Unstaged section
        currentY++; // Header line
        if (clickY === currentY - 1) {
          // Clicked on unstaged header - toggle section
          this.toggleSection('unstaged');
          return true;
        }

        if (!this.unstagedCollapsed) {
          for (let i = 0; i < this.status.unstaged.length; i++) {
            if (clickY === currentY) {
              this.selectedSection = 'unstaged';
              this.selectedIndex = i;
              return true;
            }
            currentY++;
          }
        }

        // Untracked section
        if (this.status.untracked.length > 0) {
          currentY++; // Header line
          if (clickY === currentY - 1) {
            // Clicked on untracked header - toggle section
            this.toggleSection('untracked');
            return true;
          }

          if (!this.untrackedCollapsed) {
            for (let i = 0; i < this.status.untracked.length; i++) {
              if (clickY === currentY) {
                this.selectedSection = 'untracked';
                this.selectedIndex = i;
                return true;
              }
              currentY++;
            }
          }
        }

        return true;
      }

      case 'MOUSE_DOUBLE_CLICK':
      case 'MOUSE_LEFT_BUTTON_PRESSED_DOUBLE': {
        // Open file on double click
        const item = this.getSelectedItem();
        if (item && this.onFileSelectCallback) {
          const filePath = typeof item.file === 'string' ? item.file : item.file.path;
          this.onFileSelectCallback(filePath);
        }
        return true;
      }

      case 'MOUSE_WHEEL_UP':
        this.scrollTop = Math.max(0, this.scrollTop - 3);
        return true;

      case 'MOUSE_WHEEL_DOWN': {
        const visibleHeight = this.getVisibleHeight();
        const maxScroll = Math.max(0, this.getContentHeight() - visibleHeight);
        this.scrollTop = Math.min(this.scrollTop + 3, maxScroll);
        return true;
      }
    }

    return false;
  }

  // Callbacks
  onFileSelect(callback: (filePath: string) => void): () => void {
    this.onFileSelectCallback = callback;
    return () => { this.onFileSelectCallback = undefined; };
  }

  onRefresh(callback: () => void): () => void {
    this.onRefreshCallback = callback;
    return () => { this.onRefreshCallback = undefined; };
  }

  onFocus(callback: () => void): () => void {
    this.onFocusCallback = callback;
    return () => { this.onFocusCallback = undefined; };
  }

  onCommitRequest(callback: () => void): () => void {
    this.onCommitRequestCallback = callback;
    return () => { this.onCommitRequestCallback = undefined; };
  }
}

export const gitPanel = new GitPanel();
export default gitPanel;
