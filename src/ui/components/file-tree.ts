/**
 * File Tree Component
 * 
 * VS Code-style file tree sidebar showing project directory structure.
 */

import type { RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import { themeLoader } from '../themes/theme-loader.ts';
import { settings } from '../../config/settings.ts';
import * as path from 'path';
import * as fs from 'fs';

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  expanded: boolean;
  children: FileTreeNode[] | null;  // null = not loaded yet
  depth: number;
  isHidden: boolean;
}

export type GitFileState = 'added' | 'modified' | 'deleted' | 'untracked' | 'ignored' | 'conflict' | 'none';

// File type icons (nerd font compatible, with fallbacks)
const FILE_ICONS: Record<string, string> = {
  // Folders
  'folder': '📁',
  'folder-open': '📂',
  
  // Languages
  '.ts': '󰛦 ',
  '.tsx': '󰛦 ',
  '.js': '󰌞 ',
  '.jsx': '󰌞 ',
  '.json': ' ',
  '.md': '󰍔 ',
  '.css': '󰌜 ',
  '.scss': '󰌜 ',
  '.html': '󰌝 ',
  '.py': '󰌠 ',
  '.rs': '󱘗 ',
  '.go': '󰟓 ',
  '.sh': ' ',
  '.bash': ' ',
  '.zsh': ' ',
  '.yml': ' ',
  '.yaml': ' ',
  '.toml': ' ',
  '.xml': '󰗀 ',
  '.svg': '󰜡 ',
  '.png': '󰋩 ',
  '.jpg': '󰋩 ',
  '.jpeg': '󰋩 ',
  '.gif': '󰋩 ',
  '.ico': '󰋩 ',
  '.gitignore': '󰊢 ',
  '.env': ' ',
  
  // Default
  'default': '󰈔 ',
};

export class FileTree implements MouseHandler {
  private rect: Rect = { x: 1, y: 1, width: 30, height: 20 };
  private rootPath: string | null = null;
  private rootNode: FileTreeNode | null = null;
  private flatList: FileTreeNode[] = [];  // Flattened visible nodes
  private selectedIndex: number = 0;
  private scrollTop: number = 0;
  private isFocused: boolean = false;
  private isVisible: boolean = false;
  
  // File watchers
  private watchers: Map<string, fs.FSWatcher> = new Map();
  
  // Git status - maps relative paths to their git state
  private gitStatus: Map<string, GitFileState> = new Map();
  
  // Callbacks
  private onFileSelectCallback?: (path: string) => void;
  private onFocusCallback?: () => void;
  
  // Dialog state
  private dialogMode: 'none' | 'new-file' | 'rename' | 'delete-confirm' = 'none';
  private dialogInput: string = '';
  private dialogTarget: FileTreeNode | null = null;

  /**
   * Set the rect for the file tree
   */
  setRect(rect: Rect): void {
    this.rect = rect;
  }

  /**
   * Set visibility
   */
  setVisible(visible: boolean): void {
    this.isVisible = visible;
  }

  /**
   * Check if visible
   */
  getVisible(): boolean {
    return this.isVisible;
  }

  /**
   * Set focus state
   */
  setFocused(focused: boolean): void {
    this.isFocused = focused;
  }

  /**
   * Check if focused
   */
  getFocused(): boolean {
    return this.isFocused;
  }

  /**
   * Set file select callback
   */
  onFileSelect(callback: (path: string) => void): void {
    this.onFileSelectCallback = callback;
  }

  onFocus(callback: () => void): void {
    this.onFocusCallback = callback;
  }

  /**
   * Set git status for files (map of relative paths to states)
   */
  setGitStatus(status: Map<string, GitFileState>): void {
    this.gitStatus = status;
  }

  /**
   * Get git status for a file path
   */
  getGitStatus(filePath: string): GitFileState {
    // Convert to relative path if needed
    let relativePath = filePath;
    if (this.rootPath && filePath.startsWith(this.rootPath)) {
      relativePath = filePath.substring(this.rootPath.length + 1);
    }
    return this.gitStatus.get(relativePath) || 'none';
  }

  /**
   * Load a directory as root
   */
  async loadDirectory(rootPath: string): Promise<void> {
    this.rootPath = rootPath;
    this.rootNode = await this.createNode(rootPath, 0);
    if (this.rootNode) {
      this.rootNode.expanded = true;
      await this.loadChildren(this.rootNode);
    }
    this.rebuildFlatList();
  }

  /**
   * Create a file tree node
   */
  private async createNode(nodePath: string, depth: number): Promise<FileTreeNode | null> {
    try {
      const stat = await fs.promises.stat(nodePath);
      const name = path.basename(nodePath);
      
      return {
        name,
        path: nodePath,
        type: stat.isDirectory() ? 'directory' : 'file',
        expanded: false,
        children: null,  // null = not loaded yet, empty array = loaded but empty
        depth,
        isHidden: name.startsWith('.'),
      };
    } catch {
      return null;
    }
  }

  /**
   * Load children of a directory node
   */
  private async loadChildren(node: FileTreeNode): Promise<void> {
    if (node.type !== 'directory') return;
    
    try {
      const entries = await fs.promises.readdir(node.path, { withFileTypes: true });
      const excludePatterns = settings.get('files.exclude') || {};
      
      const children: FileTreeNode[] = [];
      
      for (const entry of entries) {
        // Check exclusions
        if (this.shouldExclude(entry.name, excludePatterns)) continue;
        
        const childPath = path.join(node.path, entry.name);
        const childNode = await this.createNode(childPath, node.depth + 1);
        if (childNode) {
          children.push(childNode);
        }
      }
      
      // Sort: directories first, then alphabetical
      children.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
      
      node.children = children;
      
      // Setup file watcher for this directory
      this.watchDirectory(node.path);
    } catch (error) {
      node.children = [];
    }
  }

  /**
   * Check if a file/folder should be excluded
   */
  private shouldExclude(name: string, patterns: Record<string, boolean>): boolean {
    // Always exclude these
    if (name === '.DS_Store') return true;
    
    for (const [pattern, enabled] of Object.entries(patterns)) {
      if (!enabled) continue;
      
      // Simple pattern matching
      const cleanPattern = pattern.replace(/^\*\*\//, '');
      if (name === cleanPattern) return true;
      if (pattern.startsWith('**/') && name === cleanPattern) return true;
    }
    
    return false;
  }

  /**
   * Watch a directory for changes
   */
  private watchDirectory(dirPath: string): void {
    if (this.watchers.has(dirPath)) return;
    
    try {
      const watcher = fs.watch(dirPath, { persistent: false }, async (eventType, filename) => {
        // Debounce and refresh
        if (filename) {
          await this.refreshDirectory(dirPath);
        }
      });
      
      this.watchers.set(dirPath, watcher);
    } catch {
      // Ignore watch errors
    }
  }

  /**
   * Refresh a directory's contents
   */
  private async refreshDirectory(dirPath: string): Promise<void> {
    const node = this.findNodeByPath(dirPath);
    if (node && node.type === 'directory' && node.expanded) {
      await this.loadChildren(node);
      this.rebuildFlatList();
    }
  }

  /**
   * Find a node by path
   */
  private findNodeByPath(nodePath: string): FileTreeNode | null {
    const search = (node: FileTreeNode): FileTreeNode | null => {
      if (node.path === nodePath) return node;
      if (node.children) {
        for (const child of node.children) {
          const found = search(child);
          if (found) return found;
        }
      }
      return null;
    };
    
    return this.rootNode ? search(this.rootNode) : null;
  }

  /**
   * Rebuild the flat list of visible nodes
   */
  private rebuildFlatList(): void {
    this.flatList = [];
    
    const addNode = (node: FileTreeNode) => {
      // Don't add root node itself to display
      if (node !== this.rootNode) {
        this.flatList.push(node);
      }
      
      if (node.expanded && node.children) {
        for (const child of node.children) {
          addNode(child);
        }
      }
    };
    
    if (this.rootNode) {
      addNode(this.rootNode);
    }
    
    // Clamp selection
    if (this.selectedIndex >= this.flatList.length) {
      this.selectedIndex = Math.max(0, this.flatList.length - 1);
    }
  }

  /**
   * Toggle expand/collapse of selected directory
   */
  async toggleSelected(): Promise<void> {
    const node = this.flatList[this.selectedIndex];
    if (!node) return;
    
    if (node.type === 'directory') {
      node.expanded = !node.expanded;
      
      // Lazy load children if needed
      if (node.expanded && node.children === null) {
        await this.loadChildren(node);
      }
      
      this.rebuildFlatList();
    } else {
      // Open file
      if (this.onFileSelectCallback) {
        this.onFileSelectCallback(node.path);
      }
    }
  }

  /**
   * Expand selected directory
   */
  async expandSelected(): Promise<void> {
    const node = this.flatList[this.selectedIndex];
    if (!node || node.type !== 'directory') return;
    
    if (!node.expanded) {
      node.expanded = true;
      if (node.children === null) {
        await this.loadChildren(node);
      }
      this.rebuildFlatList();
    } else if (node.children && node.children.length > 0) {
      // Move to first child
      this.selectNext();
    }
  }

  /**
   * Collapse selected directory or go to parent
   */
  collapseSelected(): void {
    const node = this.flatList[this.selectedIndex];
    if (!node) return;
    
    if (node.type === 'directory' && node.expanded) {
      node.expanded = false;
      this.rebuildFlatList();
    } else {
      // Go to parent
      this.goToParent();
    }
  }

  /**
   * Go to parent directory
   */
  goToParent(): void {
    const node = this.flatList[this.selectedIndex];
    if (!node) return;
    
    const parentPath = path.dirname(node.path);
    const parentIndex = this.flatList.findIndex(n => n.path === parentPath);
    if (parentIndex >= 0) {
      this.selectedIndex = parentIndex;
      this.ensureVisible();
    }
  }

  /**
   * Select previous item
   */
  selectPrevious(): void {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
      this.ensureVisible();
    }
  }

  /**
   * Select next item
   */
  selectNext(): void {
    if (this.selectedIndex < this.flatList.length - 1) {
      this.selectedIndex++;
      this.ensureVisible();
    }
  }

  /**
   * Page up
   */
  pageUp(): void {
    const visibleCount = this.getVisibleCount();
    this.selectedIndex = Math.max(0, this.selectedIndex - visibleCount);
    this.ensureVisible();
  }

  /**
   * Page down
   */
  pageDown(): void {
    const visibleCount = this.getVisibleCount();
    this.selectedIndex = Math.min(this.flatList.length - 1, this.selectedIndex + visibleCount);
    this.ensureVisible();
  }

  /**
   * Go to first item
   */
  goToFirst(): void {
    this.selectedIndex = 0;
    this.ensureVisible();
  }

  /**
   * Go to last item
   */
  goToLast(): void {
    this.selectedIndex = Math.max(0, this.flatList.length - 1);
    this.ensureVisible();
  }

  /**
   * Get currently selected node
   */
  getSelectedNode(): FileTreeNode | null {
    return this.flatList[this.selectedIndex] || null;
  }

  /**
   * Get visible line count (accounting for header)
   */
  private getVisibleCount(): number {
    return this.rect.height - 1; // -1 for header
  }

  /**
   * Ensure selected item is visible
   */
  private ensureVisible(): void {
    const visibleCount = this.getVisibleCount();
    
    if (this.selectedIndex < this.scrollTop) {
      this.scrollTop = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollTop + visibleCount) {
      this.scrollTop = this.selectedIndex - visibleCount + 1;
    }
  }

  /**
   * Scroll by delta
   */
  scroll(delta: number): void {
    const maxScroll = Math.max(0, this.flatList.length - this.getVisibleCount());
    this.scrollTop = Math.max(0, Math.min(maxScroll, this.scrollTop + delta));
  }

  /**
   * Get file icon for a node
   */
  private getIcon(node: FileTreeNode): string {
    if (node.type === 'directory') {
      return node.expanded ? '▼ ' : '▶ ';
    }
    
    const ext = path.extname(node.name).toLowerCase();
    
    // Check for special filenames first
    if (FILE_ICONS[node.name]) {
      return FILE_ICONS[node.name]!;
    }
    
    // Then check extension
    if (FILE_ICONS[ext]) {
      return FILE_ICONS[ext]!;
    }
    
    return FILE_ICONS['default']!;
  }

  /**
   * Render the file tree
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
    const sidebarBg = this.hexToRgb(bgColor) || { r: 37, g: 37, b: 38 };
    const sidebarFg = this.hexToRgb(themeLoader.getColor('sideBar.foreground')) || { r: 204, g: 204, b: 204 };
    const titleFg = this.hexToRgb(themeLoader.getColor('sideBarTitle.foreground')) || { r: 187, g: 187, b: 187 };
    const selectionBg = this.hexToRgb(themeLoader.getColor('list.activeSelectionBackground')) || { r: 9, g: 71, b: 113 };
    const selectionFg = this.hexToRgb(themeLoader.getColor('list.activeSelectionForeground')) || { r: 255, g: 255, b: 255 };
    const hoverBg = this.hexToRgb(themeLoader.getColor('list.hoverBackground')) || { r: 42, g: 45, b: 46 };
    const focusBorder = this.hexToRgb(themeLoader.getColor('focusBorder')) || { r: 0, g: 127, b: 212 };
    
    let output = '';
    
    // Draw header
    output += moveTo(this.rect.x, this.rect.y);
    output += bgRgb(sidebarBg.r, sidebarBg.g, sidebarBg.b);
    output += fgRgb(titleFg.r, titleFg.g, titleFg.b);
    
    const title = ' EXPLORER';
    output += title.padEnd(this.rect.width, ' ');

    // Separator line
    output += moveTo(this.rect.x, this.rect.y + 1);
    output += bgRgb(sidebarBg.r, sidebarBg.g, sidebarBg.b);
    output += fgRgb(Math.floor(sidebarFg.r * 0.5), Math.floor(sidebarFg.g * 0.5), Math.floor(sidebarFg.b * 0.5));
    output += '─'.repeat(this.rect.width);

    // Reserve space for help hint when focused (2 lines for dialog mode)
    const helpHeight = this.isFocused ? (this.dialogMode !== 'none' ? 2 : 1) : 0;

    // Draw file list (now starting at +2 for header and separator)
    const visibleCount = this.getVisibleCount() - helpHeight - 1; // -1 for separator line
    
    // Calculate dimmed colors for hidden files
    const dimFg = { 
      r: Math.floor(sidebarFg.r * 0.5), 
      g: Math.floor(sidebarFg.g * 0.5), 
      b: Math.floor(sidebarFg.b * 0.5) 
    };
    const dimSelectionFg = { 
      r: Math.floor(selectionFg.r * 0.7), 
      g: Math.floor(selectionFg.g * 0.7), 
      b: Math.floor(selectionFg.b * 0.7) 
    };
    
    // Git status colors from theme
    const gitAddedFg = this.hexToRgb(themeLoader.getColor('gitDecoration.addedResourceForeground')) || { r: 129, g: 199, b: 132 };
    const gitModifiedFg = this.hexToRgb(themeLoader.getColor('gitDecoration.modifiedResourceForeground')) || { r: 224, g: 175, b: 104 };
    const gitDeletedFg = this.hexToRgb(themeLoader.getColor('gitDecoration.deletedResourceForeground')) || { r: 229, g: 115, b: 115 };
    const gitUntrackedFg = this.hexToRgb(themeLoader.getColor('gitDecoration.untrackedResourceForeground')) || { r: 115, g: 191, b: 105 };
    const gitConflictFg = this.hexToRgb(themeLoader.getColor('gitDecoration.conflictingResourceForeground')) || { r: 255, g: 123, b: 114 };
    
    // Subtle background tints for git status (blend with sidebar background)
    const blendBg = (color: { r: number; g: number; b: number }, amount: number) => ({
      r: Math.round(sidebarBg.r + (color.r - sidebarBg.r) * amount),
      g: Math.round(sidebarBg.g + (color.g - sidebarBg.g) * amount),
      b: Math.round(sidebarBg.b + (color.b - sidebarBg.b) * amount)
    });
    const gitAddedBg = blendBg(gitAddedFg, 0.1);
    const gitModifiedBg = blendBg(gitModifiedFg, 0.1);
    const gitDeletedBg = blendBg(gitDeletedFg, 0.1);
    const gitUntrackedBg = blendBg(gitUntrackedFg, 0.1);
    const gitConflictBg = blendBg(gitConflictFg, 0.15);
    
    for (let i = 0; i < visibleCount; i++) {
      const nodeIndex = this.scrollTop + i;
      const screenY = this.rect.y + 2 + i; // +2 for header and separator

      output += moveTo(this.rect.x, screenY);
      
      if (nodeIndex < this.flatList.length) {
        const node = this.flatList[nodeIndex]!;
        const isSelected = nodeIndex === this.selectedIndex;
        
        // Determine foreground and background color based on git status
        let fg = sidebarFg;
        let lineBg = sidebarBg;
        const gitState = this.getGitStatus(node.path);
        
        if (gitState === 'added') {
          fg = gitAddedFg;
          lineBg = gitAddedBg;
        } else if (gitState === 'modified') {
          fg = gitModifiedFg;
          lineBg = gitModifiedBg;
        } else if (gitState === 'deleted') {
          fg = gitDeletedFg;
          lineBg = gitDeletedBg;
        } else if (gitState === 'untracked') {
          fg = gitUntrackedFg;
          lineBg = gitUntrackedBg;
        } else if (gitState === 'conflict') {
          fg = gitConflictFg;
          lineBg = gitConflictBg;
        } else if (node.isHidden) {
          fg = dimFg;
        }
        
        // Background and foreground
        if (isSelected && this.isFocused) {
          output += bgRgb(selectionBg.r, selectionBg.g, selectionBg.b);
          output += fgRgb(node.isHidden ? dimSelectionFg.r : selectionFg.r, 
                         node.isHidden ? dimSelectionFg.g : selectionFg.g, 
                         node.isHidden ? dimSelectionFg.b : selectionFg.b);
        } else if (isSelected) {
          output += bgRgb(hoverBg.r, hoverBg.g, hoverBg.b);
          output += fgRgb(fg.r, fg.g, fg.b);
        } else {
          output += bgRgb(lineBg.r, lineBg.g, lineBg.b);
          output += fgRgb(fg.r, fg.g, fg.b);
        }
        
        // Indent (depth - 1 because root children are depth 1)
        const indent = '  '.repeat(Math.max(0, node.depth - 1));

        // Icon
        const icon = this.getIcon(node);

        // Build line content with 1-space gutter
        let lineContent = ' ' + indent + icon + node.name;
        
        // Truncate if too long
        if (lineContent.length > this.rect.width) {
          lineContent = lineContent.substring(0, this.rect.width - 1) + '…';
        }
        
        output += lineContent.padEnd(this.rect.width, ' ');
      } else {
        // Empty line
        output += bgRgb(sidebarBg.r, sidebarBg.g, sidebarBg.b);
        output += ' '.repeat(this.rect.width);
      }
    }
    
    // Draw help hint at bottom when focused
    if (this.isFocused) {
      const hintY = this.rect.y + this.rect.height - helpHeight;
      const hintBg = { r: 45, g: 45, b: 48 }; // Slightly lighter than sidebar
      const hintFg = { r: 150, g: 150, b: 150 };
      const accentFg = { r: 100, g: 180, b: 255 };
      
      if (this.dialogMode !== 'none') {
        // Draw dialog
        output += moveTo(this.rect.x, hintY);
        output += bgRgb(hintBg.r, hintBg.g, hintBg.b);
        output += fgRgb(hintFg.r, hintFg.g, hintFg.b);
        
        let dialogLabel = '';
        if (this.dialogMode === 'new-file') {
          dialogLabel = ' New: ';
        } else if (this.dialogMode === 'rename') {
          dialogLabel = ' Rename: ';
        } else if (this.dialogMode === 'delete-confirm') {
          dialogLabel = ' Delete? ';
        }
        
        output += dialogLabel;
        
        if (this.dialogMode === 'delete-confirm') {
          // Show Y/N prompt
          const targetName = this.dialogTarget?.name || '';
          const prompt = `${targetName} (y/n)`;
          const truncated = prompt.length > this.rect.width - dialogLabel.length ? 
            prompt.substring(0, this.rect.width - dialogLabel.length - 1) + '…' : prompt;
          output += fgRgb(accentFg.r, accentFg.g, accentFg.b);
          output += truncated.padEnd(this.rect.width - dialogLabel.length, ' ');
        } else {
          // Show text input
          const inputWidth = this.rect.width - dialogLabel.length;
          const displayInput = this.dialogInput.length > inputWidth - 1 ? 
            this.dialogInput.substring(this.dialogInput.length - inputWidth + 1) : this.dialogInput;
          output += fgRgb(accentFg.r, accentFg.g, accentFg.b);
          output += displayInput.padEnd(inputWidth, ' ');
        }
        
        // Second line - keyboard hints
        output += moveTo(this.rect.x, hintY + 1);
        output += bgRgb(hintBg.r, hintBg.g, hintBg.b);
        output += fgRgb(hintFg.r, hintFg.g, hintFg.b);
        const hint2 = ' Enter:confirm Esc:cancel';
        output += hint2.substring(0, this.rect.width).padEnd(this.rect.width, ' ');
      } else {
        // Draw navigation help hint
        output += moveTo(this.rect.x, hintY);
        output += bgRgb(hintBg.r, hintBg.g, hintBg.b);
        output += fgRgb(hintFg.r, hintFg.g, hintFg.b);
        
        const hint = ' n:new r:rename d:del';
        output += hint.substring(0, this.rect.width).padEnd(this.rect.width, ' ');
      }
    }
    
    // Draw focus border if focused
    if (this.isFocused) {
      // Left border
      output += fgRgb(focusBorder.r, focusBorder.g, focusBorder.b);
      for (let y = this.rect.y; y < this.rect.y + this.rect.height; y++) {
        output += moveTo(this.rect.x + this.rect.width - 1, y);
        output += bgRgb(sidebarBg.r, sidebarBg.g, sidebarBg.b);
        output += '│';
      }
    }
    
    output += reset;
    ctx.buffer(output);
  }

  /**
   * Convert hex to RGB
   */
  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const match = hex?.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (!match) return null;
    return {
      r: parseInt(match[1]!, 16),
      g: parseInt(match[2]!, 16),
      b: parseInt(match[3]!, 16)
    };
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

    switch (event.name) {
      case 'MOUSE_LEFT_BUTTON_PRESSED': {
        // Request focus on any click within bounds
        this.isFocused = true;
        if (this.onFocusCallback) {
          this.onFocusCallback();
        }

        // Calculate which item was clicked
        const clickY = event.y - this.rect.y - 2; // -2 for header and separator
        if (clickY < 0) return true; // Clicked on header or separator

        const clickedIndex = this.scrollTop + clickY;
        if (clickedIndex < this.flatList.length) {
          this.selectedIndex = clickedIndex;
        }
        return true;
      }

      case 'MOUSE_DOUBLE_CLICK':
      case 'MOUSE_LEFT_BUTTON_PRESSED_DOUBLE': {
        // Toggle or open on double click
        this.toggleSelected();  // Fire and forget - will trigger callback
        return true;
      }

      case 'MOUSE_LEFT_BUTTON_PRESSED_TRIPLE': {
        // Ignore triple click
        return true;
      }

      case 'MOUSE_WHEEL_UP':
        this.scroll(-3);
        return true;

      case 'MOUSE_WHEEL_DOWN':
        this.scroll(3);
        return true;
    }

    return false;
  }

  /**
   * Handle keyboard input when focused
   */
  async handleKey(key: string, ctrl: boolean, shift: boolean, char?: string): Promise<boolean> {
    if (!this.isFocused) return false;
    
    // Handle dialog input first
    if (this.dialogMode !== 'none') {
      return await this.handleDialogKey(key, char);
    }
    
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
        await this.toggleSelected();
        return true;
        
      case 'RIGHT':
      case 'L':
        await this.expandSelected();
        return true;
        
      case 'LEFT':
      case 'H':
        if (ctrl) return false;  // Don't capture Ctrl+H
        this.collapseSelected();
        return true;
        
      case 'PAGEUP':
        this.pageUp();
        return true;
        
      case 'PAGEDOWN':
        this.pageDown();
        return true;
        
      case 'HOME':
      case 'G':
        if (key === 'G' && !shift) {
          this.goToFirst();
          return true;
        }
        if (key === 'HOME') {
          this.goToFirst();
          return true;
        }
        if (key === 'G' && shift) {
          this.goToLast();
          return true;
        }
        return false;
        
      case 'END':
        this.goToLast();
        return true;
        
      case 'N':
        if (shift) return false;  // Don't capture Shift+N
        // New file
        this.startNewFile();
        return true;
        
      case 'R':
        if (shift) return false;  // Don't capture Shift+R
        // Rename
        this.startRename();
        return true;
        
      case 'D':
      case 'DELETE':
        if (shift) return false;  // Don't capture Shift+D
        // Delete
        this.startDelete();
        return true;
        
      case 'ESCAPE':
        this.isFocused = false;
        return true;
    }
    
    return false;
  }

  /**
   * Handle keyboard input in dialog mode
   */
  private async handleDialogKey(key: string, char?: string): Promise<boolean> {
    switch (key) {
      case 'ESCAPE':
        this.cancelDialog();
        return true;
        
      case 'ENTER':
        await this.confirmDialog();
        return true;
        
      case 'BACKSPACE':
        if (this.dialogInput.length > 0) {
          this.dialogInput = this.dialogInput.slice(0, -1);
        }
        return true;
        
      case 'Y':
        if (this.dialogMode === 'delete-confirm') {
          await this.confirmDialog();
          return true;
        }
        // Fall through for regular input
        if (char) {
          this.dialogInput += char;
        }
        return true;
        
      case 'N':
        if (this.dialogMode === 'delete-confirm') {
          this.cancelDialog();
          return true;
        }
        // Fall through for regular input
        if (char) {
          this.dialogInput += char;
        }
        return true;
        
      default:
        // Add printable characters to input
        if (char && char.length === 1 && char.charCodeAt(0) >= 32) {
          this.dialogInput += char;
        }
        return true;
    }
  }

  /**
   * Start new file dialog
   */
  private startNewFile(): void {
    const selected = this.getSelectedNode();
    if (selected) {
      // If a file is selected, create new file in its parent directory
      // If a directory is selected, create new file in that directory
      this.dialogTarget = selected;
    } else {
      // Create in root
      this.dialogTarget = null;
    }
    this.dialogMode = 'new-file';
    this.dialogInput = '';
  }

  /**
   * Start rename dialog
   */
  private startRename(): void {
    const selected = this.getSelectedNode();
    if (selected) {
      this.dialogTarget = selected;
      this.dialogMode = 'rename';
      this.dialogInput = selected.name;
    }
  }

  /**
   * Start delete confirmation
   */
  private startDelete(): void {
    const selected = this.getSelectedNode();
    if (selected) {
      this.dialogTarget = selected;
      this.dialogMode = 'delete-confirm';
      this.dialogInput = '';
    }
  }

  /**
   * Cancel dialog
   */
  private cancelDialog(): void {
    this.dialogMode = 'none';
    this.dialogInput = '';
    this.dialogTarget = null;
  }

  /**
   * Confirm dialog action
   */
  private async confirmDialog(): Promise<void> {
    switch (this.dialogMode) {
      case 'new-file':
        await this.createNewFile();
        break;
      case 'rename':
        await this.renameTarget();
        break;
      case 'delete-confirm':
        await this.deleteTarget();
        break;
    }
    this.cancelDialog();
  }

  /**
   * Create a new file
   */
  private async createNewFile(): Promise<void> {
    if (!this.dialogInput.trim()) return;
    
    let targetDir: string;
    if (this.dialogTarget) {
      if (this.dialogTarget.type === 'directory') {
        targetDir = this.dialogTarget.path;
      } else {
        targetDir = path.dirname(this.dialogTarget.path);
      }
    } else {
      targetDir = this.rootPath || process.cwd();
    }
    
    const newPath = path.join(targetDir, this.dialogInput.trim());
    
    try {
      // Check if file already exists
      const exists = await fs.promises.access(newPath).then(() => true).catch(() => false);
      if (exists) {
        // TODO: Show error message
        return;
      }
      
      // Create the file
      await fs.promises.writeFile(newPath, '');
      
      // Make sure the parent directory is expanded so we can see the new file
      const parentNode = this.findNodeByPath(targetDir);
      if (parentNode && parentNode.type === 'directory') {
        parentNode.expanded = true;
        await this.loadChildren(parentNode);
        this.rebuildFlatList();
      }
      
      // Select the new file
      const index = this.flatList.findIndex((node: FileTreeNode) => node.path === newPath);
      if (index >= 0) {
        this.selectedIndex = index;
      }
      
      // Open the new file directly via callback (and unfocus tree)
      if (this.onFileSelectCallback) {
        this.onFileSelectCallback(newPath);
      }
    } catch (error) {
      // TODO: Show error message
    }
  }

  /**
   * Rename the target file or directory
   */
  private async renameTarget(): Promise<void> {
    if (!this.dialogTarget || !this.dialogInput.trim()) return;
    
    const newName = this.dialogInput.trim();
    const oldPath = this.dialogTarget.path;
    const parentDir = path.dirname(oldPath);
    const newPath = path.join(parentDir, newName);
    
    if (oldPath === newPath) return;
    
    try {
      // Check if target already exists
      const exists = await fs.promises.access(newPath).then(() => true).catch(() => false);
      if (exists) {
        // TODO: Show error message
        return;
      }
      
      // Rename
      await fs.promises.rename(oldPath, newPath);
      
      // Refresh to show changes
      await this.refreshDirectory(parentDir);
      
      // Select the renamed item
      const index = this.flatList.findIndex((node: FileTreeNode) => node.path === newPath);
      if (index >= 0) {
        this.selectedIndex = index;
      }
    } catch (error) {
      // TODO: Show error message
    }
  }

  /**
   * Delete the target file or directory
   */
  private async deleteTarget(): Promise<void> {
    if (!this.dialogTarget) return;
    
    try {
      const targetPath = this.dialogTarget.path;
      const parentDir = path.dirname(targetPath);
      
      if (this.dialogTarget.type === 'directory') {
        // Recursively delete directory
        await fs.promises.rm(targetPath, { recursive: true });
      } else {
        // Delete file
        await fs.promises.unlink(targetPath);
      }
      
      // Refresh to show changes
      await this.refreshDirectory(parentDir);
      
      // Adjust selection if needed
      if (this.selectedIndex >= this.flatList.length) {
        this.selectedIndex = Math.max(0, this.flatList.length - 1);
      }
    } catch (error) {
      // TODO: Show error message
    }
  }

  /**
   * Cleanup watchers
   */
  destroy(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }
}

export const fileTree = new FileTree();
export default fileTree;
