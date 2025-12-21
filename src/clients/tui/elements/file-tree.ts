/**
 * FileTree Element
 *
 * A file tree/explorer element for navigating directories and files.
 */

import { BaseElement, type ElementContext } from './base.ts';
import type { KeyEvent, MouseEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';

// ============================================
// Types
// ============================================

/**
 * Node in the file tree.
 */
export interface FileNode {
  /** File/folder name */
  name: string;
  /** Full path */
  path: string;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** Children (if directory) */
  children?: FileNode[];
  /** Whether directory is expanded */
  expanded?: boolean;
  /** Git status (M, A, D, ?, etc.) */
  gitStatus?: string;
  /** Icon (optional) */
  icon?: string;
}

/**
 * Flattened view node for rendering.
 */
interface ViewNode {
  node: FileNode;
  depth: number;
  index: number;
}

/**
 * Callbacks for file tree.
 */
export interface FileTreeCallbacks {
  /** Called when a file is selected (opened) */
  onFileOpen?: (path: string) => void;
  /** Called when selected node changes */
  onSelectionChange?: (path: string | null) => void;
  /** Called when a directory expansion changes */
  onExpand?: (path: string, expanded: boolean) => void;
  /** Called to request children for a directory */
  onLoadChildren?: (path: string) => Promise<FileNode[]>;
}

/**
 * File tree state for serialization.
 */
export interface FileTreeState {
  selectedPath?: string;
  scrollTop: number;
  expandedPaths: string[];
}

// ============================================
// FileTree Element
// ============================================

export class FileTree extends BaseElement {
  /** Root nodes */
  private roots: FileNode[] = [];

  /** Flattened view for rendering */
  private viewNodes: ViewNode[] = [];

  /** Selected index in view */
  private selectedIndex = 0;

  /** Scroll offset */
  private scrollTop = 0;

  /** Callbacks */
  private callbacks: FileTreeCallbacks;

  /** Icons for file types */
  private static readonly ICONS = {
    folder: '📁',
    folderOpen: '📂',
    file: '📄',
    ts: '🔷',
    js: '🟡',
    json: '📋',
    md: '📝',
    git: '🔴',
  };

  constructor(id: string, title: string, ctx: ElementContext, callbacks: FileTreeCallbacks = {}) {
    super('FileTree', id, title, ctx);
    this.callbacks = callbacks;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Callback Configuration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set callbacks after construction.
   * Useful when element is created via factory.
   */
  setCallbacks(callbacks: FileTreeCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Get current callbacks.
   */
  getCallbacks(): FileTreeCallbacks {
    return this.callbacks;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Data Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set root nodes.
   */
  setRoots(roots: FileNode[]): void {
    this.roots = roots;
    this.rebuildView();
    this.ctx.markDirty();
  }

  /**
   * Get root nodes.
   */
  getRoots(): FileNode[] {
    return this.roots;
  }

  /**
   * Find a node by path.
   */
  findNode(path: string): FileNode | null {
    const find = (nodes: FileNode[]): FileNode | null => {
      for (const node of nodes) {
        if (node.path === path) return node;
        if (node.children) {
          const found = find(node.children);
          if (found) return found;
        }
      }
      return null;
    };
    return find(this.roots);
  }

  /**
   * Update a node's children.
   */
  setChildren(path: string, children: FileNode[]): void {
    const node = this.findNode(path);
    if (node && node.isDirectory) {
      node.children = children;
      this.rebuildView();
      this.ctx.markDirty();
    }
  }

  /**
   * Update a node's git status.
   */
  setGitStatus(path: string, status: string): void {
    const node = this.findNode(path);
    if (node) {
      node.gitStatus = status;
      this.ctx.markDirty();
    }
  }

  /**
   * Rebuild the flat view from the tree.
   */
  private rebuildView(): void {
    this.viewNodes = [];
    let index = 0;

    const addNodes = (nodes: FileNode[], depth: number): void => {
      // Sort: directories first, then alphabetically
      const sorted = [...nodes].sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      for (const node of sorted) {
        this.viewNodes.push({ node, depth, index: index++ });
        if (node.isDirectory && node.expanded && node.children) {
          addNodes(node.children, depth + 1);
        }
      }
    };

    addNodes(this.roots, 0);

    // Ensure selected index is valid
    if (this.selectedIndex >= this.viewNodes.length) {
      this.selectedIndex = Math.max(0, this.viewNodes.length - 1);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Selection & Navigation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get selected path.
   */
  getSelectedPath(): string | null {
    const viewNode = this.viewNodes[this.selectedIndex];
    return viewNode?.node.path ?? null;
  }

  /**
   * Select a path.
   */
  selectPath(path: string): void {
    const idx = this.viewNodes.findIndex((v) => v.node.path === path);
    if (idx !== -1) {
      this.selectedIndex = idx;
      this.ensureVisible();
      this.callbacks.onSelectionChange?.(path);
      this.ctx.markDirty();
    }
  }

  /**
   * Move selection up.
   */
  moveUp(): void {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
      this.ensureVisible();
      const path = this.getSelectedPath();
      this.callbacks.onSelectionChange?.(path);
      this.ctx.markDirty();
    }
  }

  /**
   * Move selection down.
   */
  moveDown(): void {
    if (this.selectedIndex < this.viewNodes.length - 1) {
      this.selectedIndex++;
      this.ensureVisible();
      const path = this.getSelectedPath();
      this.callbacks.onSelectionChange?.(path);
      this.ctx.markDirty();
    }
  }

  /**
   * Toggle expand/collapse of selected directory.
   */
  toggle(): void {
    const viewNode = this.viewNodes[this.selectedIndex];
    if (!viewNode) return;

    const node = viewNode.node;
    if (!node.isDirectory) return;

    node.expanded = !node.expanded;
    this.callbacks.onExpand?.(node.path, node.expanded);

    // Load children if needed
    if (node.expanded && !node.children && this.callbacks.onLoadChildren) {
      this.callbacks.onLoadChildren(node.path).then((children) => {
        this.setChildren(node.path, children);
      });
    }

    this.rebuildView();
    this.ctx.markDirty();
  }

  /**
   * Expand selected directory.
   */
  expand(): void {
    const viewNode = this.viewNodes[this.selectedIndex];
    if (!viewNode || !viewNode.node.isDirectory || viewNode.node.expanded) return;
    this.toggle();
  }

  /**
   * Collapse selected directory.
   */
  collapse(): void {
    const viewNode = this.viewNodes[this.selectedIndex];
    if (!viewNode) return;

    const node = viewNode.node;

    // If it's an expanded directory, collapse it
    if (node.isDirectory && node.expanded) {
      this.toggle();
      return;
    }

    // Otherwise, go to parent
    if (viewNode.depth > 0) {
      // Find parent (look backwards for lower depth)
      for (let i = this.selectedIndex - 1; i >= 0; i--) {
        if (this.viewNodes[i]!.depth < viewNode.depth) {
          this.selectedIndex = i;
          this.ensureVisible();
          const path = this.getSelectedPath();
          this.callbacks.onSelectionChange?.(path);
          this.ctx.markDirty();
          break;
        }
      }
    }
  }

  /**
   * Open selected file.
   */
  openSelected(): void {
    const viewNode = this.viewNodes[this.selectedIndex];
    if (!viewNode) return;

    const node = viewNode.node;
    if (node.isDirectory) {
      this.toggle();
    } else {
      this.callbacks.onFileOpen?.(node.path);
    }
  }

  /**
   * Ensure selected item is visible.
   */
  private ensureVisible(): void {
    const viewportHeight = this.bounds.height;

    if (this.selectedIndex < this.scrollTop) {
      this.scrollTop = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollTop + viewportHeight) {
      this.scrollTop = this.selectedIndex - viewportHeight + 1;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  render(buffer: ScreenBuffer): void {
    const { x, y, width, height } = this.bounds;

    // Use centralized focus colors for consistent focus indication
    const bg = this.ctx.getBackgroundForFocus('sidebar', this.focused);
    const fg = this.ctx.getForegroundForFocus('sidebar', this.focused);
    const selectedBg = this.ctx.getSelectionBackground('sidebar', this.focused);
    const selectedFg = this.ctx.getThemeColor('list.activeSelectionForeground', '#ffffff');
    const gitModified = this.ctx.getThemeColor('gitDecoration.modifiedResourceForeground', '#e2c08d');
    const gitAdded = this.ctx.getThemeColor('gitDecoration.addedResourceForeground', '#81b88b');
    const gitDeleted = this.ctx.getThemeColor('gitDecoration.deletedResourceForeground', '#c74e39');
    const gitUntracked = this.ctx.getThemeColor('gitDecoration.untrackedResourceForeground', '#73c991');

    // Clear background
    for (let row = 0; row < height; row++) {
      buffer.writeString(x, y + row, ' '.repeat(width), fg, bg);
    }

    // Render visible nodes
    for (let row = 0; row < height; row++) {
      const viewIdx = this.scrollTop + row;
      if (viewIdx >= this.viewNodes.length) break;

      const viewNode = this.viewNodes[viewIdx]!;
      const node = viewNode.node;
      const isSelected = viewIdx === this.selectedIndex;

      // Determine colors
      let nodeFg = fg;
      let nodeBg = bg;

      if (isSelected) {
        nodeFg = selectedFg;
        nodeBg = selectedBg;
      }

      // Git status color
      if (node.gitStatus) {
        switch (node.gitStatus) {
          case 'M':
            nodeFg = isSelected ? selectedFg : gitModified;
            break;
          case 'A':
            nodeFg = isSelected ? selectedFg : gitAdded;
            break;
          case 'D':
            nodeFg = isSelected ? selectedFg : gitDeleted;
            break;
          case '?':
            nodeFg = isSelected ? selectedFg : gitUntracked;
            break;
        }
      }

      // Build line content (1-char gutter on left)
      const indent = '  '.repeat(viewNode.depth);
      const icon = this.getIcon(node);
      const expander = node.isDirectory ? (node.expanded ? '▼' : '▶') : ' ';
      const statusSuffix = node.gitStatus ? ` [${node.gitStatus}]` : '';

      let line = ` ${indent}${expander} ${icon} ${node.name}${statusSuffix}`;

      // Truncate or pad
      if (line.length > width) {
        line = line.slice(0, width - 1) + '…';
      } else {
        line = line.padEnd(width, ' ');
      }

      buffer.writeString(x, y + row, line, nodeFg, nodeBg);
    }

    // Scrollbar (if needed)
    if (this.viewNodes.length > height) {
      this.renderScrollbar(buffer, x + width - 1, y, height);
    }
  }

  /**
   * Get icon for a file node.
   */
  private getIcon(node: FileNode): string {
    if (node.icon) return node.icon;

    if (node.isDirectory) {
      return node.expanded ? FileTree.ICONS.folderOpen : FileTree.ICONS.folder;
    }

    // Determine by extension
    const ext = node.name.split('.').pop()?.toLowerCase() ?? '';
    switch (ext) {
      case 'ts':
      case 'tsx':
        return FileTree.ICONS.ts;
      case 'js':
      case 'jsx':
        return FileTree.ICONS.js;
      case 'json':
        return FileTree.ICONS.json;
      case 'md':
        return FileTree.ICONS.md;
      default:
        return FileTree.ICONS.file;
    }
  }

  /**
   * Render scrollbar.
   */
  private renderScrollbar(buffer: ScreenBuffer, x: number, y: number, height: number): void {
    const scrollbarBg = this.ctx.getThemeColor('scrollbarSlider.background', '#4e4e4e');
    const trackBg = this.ctx.getThemeColor('sideBar.background', '#252526');

    const total = this.viewNodes.length;
    const thumbHeight = Math.max(1, Math.floor((height / total) * height));
    const thumbStart = Math.floor((this.scrollTop / total) * height);

    for (let row = 0; row < height; row++) {
      const isThumb = row >= thumbStart && row < thumbStart + thumbHeight;
      buffer.set(x, y + row, {
        char: ' ',
        fg: '#ffffff',
        bg: isThumb ? scrollbarBg : trackBg,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  override handleKey(event: KeyEvent): boolean {
    if (event.key === 'ArrowUp' || event.key === 'k') {
      this.moveUp();
      return true;
    }
    if (event.key === 'ArrowDown' || event.key === 'j') {
      this.moveDown();
      return true;
    }
    if (event.key === 'ArrowLeft' || event.key === 'h') {
      this.collapse();
      return true;
    }
    if (event.key === 'ArrowRight' || event.key === 'l') {
      this.expand();
      return true;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      this.openSelected();
      return true;
    }
    if (event.key === 'Home') {
      if (this.viewNodes.length > 0) {
        this.selectedIndex = 0;
        this.ensureVisible();
        this.callbacks.onSelectionChange?.(this.getSelectedPath());
        this.ctx.markDirty();
      }
      return true;
    }
    if (event.key === 'End') {
      if (this.viewNodes.length > 0) {
        this.selectedIndex = this.viewNodes.length - 1;
        this.ensureVisible();
        this.callbacks.onSelectionChange?.(this.getSelectedPath());
        this.ctx.markDirty();
      }
      return true;
    }
    if (event.key === 'PageUp') {
      const jump = Math.max(1, this.bounds.height - 1);
      this.selectedIndex = Math.max(0, this.selectedIndex - jump);
      this.ensureVisible();
      this.callbacks.onSelectionChange?.(this.getSelectedPath());
      this.ctx.markDirty();
      return true;
    }
    if (event.key === 'PageDown') {
      const jump = Math.max(1, this.bounds.height - 1);
      this.selectedIndex = Math.min(this.viewNodes.length - 1, this.selectedIndex + jump);
      this.ensureVisible();
      this.callbacks.onSelectionChange?.(this.getSelectedPath());
      this.ctx.markDirty();
      return true;
    }

    return false;
  }

  /** Last click time for double-click detection */
  private lastClickTime = 0;
  /** Last clicked index for double-click detection */
  private lastClickIndex = -1;

  override handleMouse(event: MouseEvent): boolean {
    if (event.type === 'press' && event.button === 'left') {
      const relY = event.y - this.bounds.y;
      const viewIdx = this.scrollTop + relY;

      if (viewIdx >= 0 && viewIdx < this.viewNodes.length) {
        const now = Date.now();
        const isDoubleClick = viewIdx === this.lastClickIndex && (now - this.lastClickTime) < 300;

        this.selectedIndex = viewIdx;
        this.callbacks.onSelectionChange?.(this.getSelectedPath());
        this.ctx.requestFocus();
        this.ctx.markDirty();

        const node = this.viewNodes[viewIdx]!.node;

        if (node.isDirectory) {
          // Single click on folder: expand/collapse
          this.toggle();
        } else if (isDoubleClick) {
          // Double-click on file: open it
          this.callbacks.onFileOpen?.(node.path);
        }

        this.lastClickTime = now;
        this.lastClickIndex = viewIdx;
        return true;
      }
    }

    if (event.type === 'scroll') {
      // Check if scroll is within our bounds
      if (event.x >= this.bounds.x && event.x < this.bounds.x + this.bounds.width &&
          event.y >= this.bounds.y && event.y < this.bounds.y + this.bounds.height) {
        // Use scrollDirection (1=down, -1=up), multiply by 3 for faster scroll
        const direction = (event.scrollDirection ?? 1) * 3;
        this.scrollTop = Math.max(0, Math.min(this.scrollTop + direction, this.viewNodes.length - this.bounds.height));
        this.ctx.markDirty();
        return true;
      }
    }

    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State Serialization
  // ─────────────────────────────────────────────────────────────────────────

  override getState(): FileTreeState {
    const expandedPaths: string[] = [];
    const collectExpanded = (nodes: FileNode[]): void => {
      for (const node of nodes) {
        if (node.isDirectory && node.expanded) {
          expandedPaths.push(node.path);
          if (node.children) {
            collectExpanded(node.children);
          }
        }
      }
    };
    collectExpanded(this.roots);

    return {
      selectedPath: this.getSelectedPath() ?? undefined,
      scrollTop: this.scrollTop,
      expandedPaths,
    };
  }

  override setState(state: unknown): void {
    const s = state as FileTreeState;

    // Restore expanded paths
    if (s.expandedPaths) {
      for (const path of s.expandedPaths) {
        const node = this.findNode(path);
        if (node && node.isDirectory) {
          node.expanded = true;
        }
      }
      this.rebuildView();
    }

    // Restore selection
    if (s.selectedPath) {
      this.selectPath(s.selectedPath);
    }

    // Restore scroll
    if (s.scrollTop !== undefined) {
      this.scrollTop = s.scrollTop;
    }

    this.ctx.markDirty();
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a file tree element.
 */
export function createFileTree(
  id: string,
  title: string,
  ctx: ElementContext,
  callbacks?: FileTreeCallbacks
): FileTree {
  return new FileTree(id, title, ctx, callbacks);
}
