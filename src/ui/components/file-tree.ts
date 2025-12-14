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
}

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
  
  // Callbacks
  private onFileSelectCallback?: (path: string) => void;

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
        children: stat.isDirectory() ? null : undefined,
        depth,
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
    
    // Get colors from theme
    const sidebarBg = this.hexToRgb(themeLoader.getColor('sideBar.background')) || { r: 37, g: 37, b: 38 };
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
    
    // Draw file list
    const visibleCount = this.getVisibleCount();
    
    for (let i = 0; i < visibleCount; i++) {
      const nodeIndex = this.scrollTop + i;
      const screenY = this.rect.y + 1 + i;
      
      output += moveTo(this.rect.x, screenY);
      
      if (nodeIndex < this.flatList.length) {
        const node = this.flatList[nodeIndex]!;
        const isSelected = nodeIndex === this.selectedIndex;
        
        // Background
        if (isSelected && this.isFocused) {
          output += bgRgb(selectionBg.r, selectionBg.g, selectionBg.b);
          output += fgRgb(selectionFg.r, selectionFg.g, selectionFg.b);
        } else if (isSelected) {
          output += bgRgb(hoverBg.r, hoverBg.g, hoverBg.b);
          output += fgRgb(sidebarFg.r, sidebarFg.g, sidebarFg.b);
        } else {
          output += bgRgb(sidebarBg.r, sidebarBg.g, sidebarBg.b);
          output += fgRgb(sidebarFg.r, sidebarFg.g, sidebarFg.b);
        }
        
        // Indent (depth - 1 because root children are depth 1)
        const indent = '  '.repeat(Math.max(0, node.depth - 1));
        
        // Icon
        const icon = this.getIcon(node);
        
        // Build line content
        let lineContent = indent + icon + node.name;
        
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
        // Calculate which item was clicked
        const clickY = event.y - this.rect.y - 1; // -1 for header
        if (clickY < 0) return true; // Clicked on header
        
        const clickedIndex = this.scrollTop + clickY;
        if (clickedIndex < this.flatList.length) {
          this.selectedIndex = clickedIndex;
          
          // Request focus
          this.isFocused = true;
        }
        return true;
      }

      case 'MOUSE_DOUBLE_CLICK':
      case 'MOUSE_LEFT_BUTTON_PRESSED_DOUBLE': {
        // Toggle or open on double click
        this.toggleSelected();
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
  async handleKey(key: string, ctrl: boolean, shift: boolean): Promise<boolean> {
    if (!this.isFocused) return false;
    
    switch (key) {
      case 'UP':
      case 'k':
        this.selectPrevious();
        return true;
        
      case 'DOWN':
      case 'j':
        this.selectNext();
        return true;
        
      case 'ENTER':
        await this.toggleSelected();
        return true;
        
      case 'RIGHT':
      case 'l':
        await this.expandSelected();
        return true;
        
      case 'LEFT':
      case 'h':
        this.collapseSelected();
        return true;
        
      case 'PAGEUP':
        this.pageUp();
        return true;
        
      case 'PAGEDOWN':
        this.pageDown();
        return true;
        
      case 'HOME':
      case 'g':
        if (key === 'g' && !shift) {
          this.goToFirst();
          return true;
        }
        if (key === 'HOME') {
          this.goToFirst();
          return true;
        }
        return false;
        
      case 'END':
      case 'G':
        this.goToLast();
        return true;
        
      case 'ESCAPE':
        this.isFocused = false;
        return true;
    }
    
    return false;
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
