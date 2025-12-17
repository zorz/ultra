/**
 * Git Panel Component
 * 
 * VS Code-style Source Control panel showing staged/unstaged changes,
 * allowing users to stage, unstage, discard changes, and commit.
 */

import type { RenderContext } from '../renderer.ts';
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
    this.isFocused = focused;
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
   * Ensure selected item is visible
   */
  private ensureVisible(): void {
    // TODO: Implement scroll adjustment
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
    const panelBg = hexToRgb(bgColor) || { r: 37, g: 37, b: 38 };
    const panelFg = hexToRgb(themeLoader.getColor('sideBar.foreground')) || { r: 204, g: 204, b: 204 };
    const titleFg = hexToRgb(themeLoader.getColor('sideBarTitle.foreground')) || { r: 187, g: 187, b: 187 };
    const selectionBg = hexToRgb(themeLoader.getColor('list.activeSelectionBackground')) || { r: 9, g: 71, b: 113 };
    const selectionFg = hexToRgb(themeLoader.getColor('list.activeSelectionForeground')) || { r: 255, g: 255, b: 255 };
    const accentFg = hexToRgb(themeLoader.getColor('focusBorder')) || { r: 0, g: 127, b: 212 };
    
    // Git status colors
    const addedFg = hexToRgb(themeLoader.getColor('gitDecoration.addedResourceForeground')) || { r: 129, g: 199, b: 132 };
    const modifiedFg = hexToRgb(themeLoader.getColor('gitDecoration.modifiedResourceForeground')) || { r: 224, g: 175, b: 104 };
    const deletedFg = hexToRgb(themeLoader.getColor('gitDecoration.deletedResourceForeground')) || { r: 229, g: 115, b: 115 };
    const untrackedFg = hexToRgb(themeLoader.getColor('gitDecoration.untrackedResourceForeground')) || { r: 115, g: 191, b: 105 };
    
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
      // Staged changes section
      const stagedCount = this.status.staged.length;
      output += moveTo(this.rect.x, y);
      output += fgRgb(titleFg.r, titleFg.g, titleFg.b);
      const stagedHeader = ` ${this.stagedCollapsed ? '▶' : '▼'} Staged (${stagedCount})`;
      output += stagedHeader.padEnd(this.rect.width, ' ');
      y++;
      
      if (!this.stagedCollapsed) {
        for (let i = 0; i < this.status.staged.length && y < this.rect.y + this.rect.height - 2; i++) {
          const file = this.status.staged[i]!;
          const isSelected = this.isFocused && this.selectedSection === 'staged' && this.selectedIndex === i;
          
          output += moveTo(this.rect.x, y);
          if (isSelected) {
            output += bgRgb(selectionBg.r, selectionBg.g, selectionBg.b);
            output += fgRgb(selectionFg.r, selectionFg.g, selectionFg.b);
          } else {
            output += bgRgb(panelBg.r, panelBg.g, panelBg.b);
            const statusColor = file.status === 'A' ? addedFg :
                               file.status === 'D' ? deletedFg : modifiedFg;
            output += fgRgb(statusColor.r, statusColor.g, statusColor.b);
          }
          
          const statusChar = file.status === 'A' ? '+' : file.status === 'D' ? '-' : '~';
          const fileName = path.basename(file.path);
          const line = `   ${statusChar} ${fileName}`;
          output += line.substring(0, this.rect.width).padEnd(this.rect.width, ' ');
          y++;
        }
      }
      
      // Unstaged changes section
      const unstagedCount = this.status.unstaged.length;
      if (y < this.rect.y + this.rect.height - 2) {
        output += moveTo(this.rect.x, y);
        output += bgRgb(panelBg.r, panelBg.g, panelBg.b);
        output += fgRgb(titleFg.r, titleFg.g, titleFg.b);
        const unstagedHeader = ` ${this.unstagedCollapsed ? '▶' : '▼'} Changes (${unstagedCount})`;
        output += unstagedHeader.padEnd(this.rect.width, ' ');
        y++;
      }
      
      if (!this.unstagedCollapsed) {
        for (let i = 0; i < this.status.unstaged.length && y < this.rect.y + this.rect.height - 2; i++) {
          const file = this.status.unstaged[i]!;
          const isSelected = this.isFocused && this.selectedSection === 'unstaged' && this.selectedIndex === i;
          
          output += moveTo(this.rect.x, y);
          if (isSelected) {
            output += bgRgb(selectionBg.r, selectionBg.g, selectionBg.b);
            output += fgRgb(selectionFg.r, selectionFg.g, selectionFg.b);
          } else {
            output += bgRgb(panelBg.r, panelBg.g, panelBg.b);
            const statusColor = file.status === 'D' ? deletedFg : modifiedFg;
            output += fgRgb(statusColor.r, statusColor.g, statusColor.b);
          }
          
          const statusChar = file.status === 'D' ? '-' : '~';
          const fileName = path.basename(file.path);
          const line = `   ${statusChar} ${fileName}`;
          output += line.substring(0, this.rect.width).padEnd(this.rect.width, ' ');
          y++;
        }
      }
      
      // Untracked files section
      const untrackedCount = this.status.untracked.length;
      if (untrackedCount > 0 && y < this.rect.y + this.rect.height - 2) {
        output += moveTo(this.rect.x, y);
        output += bgRgb(panelBg.r, panelBg.g, panelBg.b);
        output += fgRgb(titleFg.r, titleFg.g, titleFg.b);
        const untrackedHeader = ` ${this.untrackedCollapsed ? '▶' : '▼'} Untracked (${untrackedCount})`;
        output += untrackedHeader.padEnd(this.rect.width, ' ');
        y++;
        
        if (!this.untrackedCollapsed) {
          for (let i = 0; i < this.status.untracked.length && y < this.rect.y + this.rect.height - 2; i++) {
            const filePath = this.status.untracked[i]!;
            const isSelected = this.isFocused && this.selectedSection === 'untracked' && this.selectedIndex === i;
            
            output += moveTo(this.rect.x, y);
            if (isSelected) {
              output += bgRgb(selectionBg.r, selectionBg.g, selectionBg.b);
              output += fgRgb(selectionFg.r, selectionFg.g, selectionFg.b);
            } else {
              output += bgRgb(panelBg.r, panelBg.g, panelBg.b);
              output += fgRgb(untrackedFg.r, untrackedFg.g, untrackedFg.b);
            }
            
            const fileName = path.basename(filePath);
            const line = `   ? ${fileName}`;
            output += line.substring(0, this.rect.width).padEnd(this.rect.width, ' ');
            y++;
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
        const clickY = event.y - this.rect.y - 3; // -3 for header, branch, separator
        if (clickY < 0) return true; // Clicked on header area

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

      case 'MOUSE_WHEEL_DOWN':
        this.scrollTop += 3;
        return true;
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
