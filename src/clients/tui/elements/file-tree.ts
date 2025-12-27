/**
 * FileTree Element
 *
 * A file tree/explorer element for navigating directories and files.
 */

import { BaseElement, type ElementContext } from './base.ts';
import type { KeyEvent, MouseEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';

// ============================================
// Display Width Utilities
// ============================================

/**
 * Get the display width of a character in terminal cells.
 * Most emojis are 2 cells wide, ASCII chars are 1 cell.
 */
function getCharWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;

  // ASCII control chars
  if (code < 32) return 0;

  // Basic ASCII (most common case)
  if (code < 127) return 1;

  // Common emoji ranges (simplified - most emojis are 2 cells wide)
  // Emoji presentation sequences, pictographs, symbols
  if (
    (code >= 0x1F300 && code <= 0x1F9FF) || // Misc Symbols, Emoticons, etc.
    (code >= 0x2600 && code <= 0x26FF) ||   // Misc Symbols
    (code >= 0x2700 && code <= 0x27BF) ||   // Dingbats
    (code >= 0x1F600 && code <= 0x1F64F) || // Emoticons
    (code >= 0x1F680 && code <= 0x1F6FF) || // Transport/Map
    (code >= 0x1F1E0 && code <= 0x1F1FF)    // Flags
  ) {
    return 2;
  }

  // CJK characters (2 cells wide)
  if (
    (code >= 0x4E00 && code <= 0x9FFF) ||   // CJK Unified Ideographs
    (code >= 0x3400 && code <= 0x4DBF) ||   // CJK Extension A
    (code >= 0xF900 && code <= 0xFAFF) ||   // CJK Compatibility
    (code >= 0xFF00 && code <= 0xFFEF)      // Fullwidth Forms
  ) {
    return 2;
  }

  // Default to 1 for other characters
  return 1;
}

/**
 * Get the display width of a string in terminal cells.
 */
function getDisplayWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    width += getCharWidth(char);
  }
  return width;
}

/**
 * Truncate a string to fit within a given display width.
 * Appends suffix (like '…') if truncated.
 */
function truncateToWidth(str: string, maxWidth: number, suffix = '…'): string {
  const strWidth = getDisplayWidth(str);
  if (strWidth <= maxWidth) {
    return str;
  }

  const suffixWidth = getDisplayWidth(suffix);
  const targetWidth = maxWidth - suffixWidth;

  let result = '';
  let currentWidth = 0;

  for (const char of str) {
    const charWidth = getCharWidth(char);
    if (currentWidth + charWidth > targetWidth) {
      break;
    }
    result += char;
    currentWidth += charWidth;
  }

  return result + suffix;
}

/**
 * Pad a string to a given display width with spaces.
 */
function padToWidth(str: string, targetWidth: number): string {
  const strWidth = getDisplayWidth(str);
  if (strWidth >= targetWidth) {
    return str;
  }
  return str + ' '.repeat(targetWidth - strWidth);
}

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
 * Dialog mode for file operations.
 */
export type FileDialogMode = 'none' | 'new-file' | 'new-folder' | 'rename' | 'delete-confirm';

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
  /** Called to refresh root nodes */
  onRefreshRoots?: () => Promise<FileNode[]>;
  /** Called to create a new file */
  onCreateFile?: (dirPath: string, fileName: string) => Promise<string | null>;
  /** Called to create a new folder */
  onCreateFolder?: (dirPath: string, folderName: string) => Promise<boolean>;
  /** Called to rename a file/folder */
  onRename?: (oldPath: string, newName: string) => Promise<string | null>;
  /** Called to delete a file/folder */
  onDelete?: (path: string) => Promise<boolean>;
  /** Called to show a notification message */
  onNotify?: (message: string, type: 'info' | 'error' | 'success') => void;
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

  /** Dialog mode for file operations */
  private dialogMode: FileDialogMode = 'none';

  /** Dialog input text */
  private dialogInput = '';

  /** Cursor position within dialog input */
  private dialogCursorPos = 0;

  /** Target node for dialog operation */
  private dialogTarget: FileNode | null = null;

  /** Workspace root path for file operations */
  private workspaceRoot: string | null = null;

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

  /**
   * Cancel any open dialog when focus is lost.
   */
  override onBlur(): void {
    super.onBlur();
    if (this.dialogMode !== 'none') {
      this.cancelDialog();
    }
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

  /**
   * Set workspace root path.
   */
  setWorkspaceRoot(path: string): void {
    this.workspaceRoot = path;
  }

  /**
   * Get workspace root path.
   */
  getWorkspaceRoot(): string | null {
    return this.workspaceRoot;
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
   * Refresh the file tree.
   * Reloads root nodes and all expanded directories.
   */
  async refresh(): Promise<void> {
    // Collect expanded paths before refresh
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

    // Remember selected path
    const selectedPath = this.getSelectedPath();

    // Reload root nodes if callback is provided
    if (this.callbacks.onRefreshRoots) {
      try {
        const newRoots = await this.callbacks.onRefreshRoots();
        // Preserve expanded state from old roots
        for (const newNode of newRoots) {
          if (newNode.isDirectory && expandedPaths.includes(newNode.path)) {
            newNode.expanded = true;
          }
        }
        this.roots = newRoots;
      } catch {
        // Keep existing roots on error
      }
    }

    // Reload all expanded directories
    if (this.callbacks.onLoadChildren) {
      for (const expandedPath of expandedPaths) {
        const node = this.findNode(expandedPath);
        if (node && node.isDirectory && node.expanded) {
          try {
            const children = await this.callbacks.onLoadChildren(node.path);
            node.children = children;
            // Restore expanded state for child directories
            for (const child of children) {
              if (child.isDirectory && expandedPaths.includes(child.path)) {
                child.expanded = true;
              }
            }
          } catch {
            // Keep existing children on error
          }
        }
      }
    }

    // Rebuild view
    this.rebuildView();

    // Try to restore selection
    if (selectedPath) {
      const idx = this.viewNodes.findIndex((v) => v.node.path === selectedPath);
      if (idx !== -1) {
        this.selectedIndex = idx;
      }
    }

    this.ctx.markDirty();
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
   * Go to first item.
   */
  goToFirst(): void {
    if (this.viewNodes.length > 0) {
      this.selectedIndex = 0;
      this.ensureVisible();
      this.callbacks.onSelectionChange?.(this.getSelectedPath());
      this.ctx.markDirty();
    }
  }

  /**
   * Go to last item.
   */
  goToLast(): void {
    if (this.viewNodes.length > 0) {
      this.selectedIndex = this.viewNodes.length - 1;
      this.ensureVisible();
      this.callbacks.onSelectionChange?.(this.getSelectedPath());
      this.ctx.markDirty();
    }
  }

  /**
   * Page up.
   */
  pageUp(): void {
    const jump = Math.max(1, this.bounds.height - 1);
    this.selectedIndex = Math.max(0, this.selectedIndex - jump);
    this.ensureVisible();
    this.callbacks.onSelectionChange?.(this.getSelectedPath());
    this.ctx.markDirty();
  }

  /**
   * Page down.
   */
  pageDown(): void {
    const jump = Math.max(1, this.bounds.height - 1);
    this.selectedIndex = Math.min(this.viewNodes.length - 1, this.selectedIndex + jump);
    this.ensureVisible();
    this.callbacks.onSelectionChange?.(this.getSelectedPath());
    this.ctx.markDirty();
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

    // Calculate height reserved for hint/dialog bar at bottom
    const hintBarHeight = this.focused ? (this.dialogMode !== 'none' ? 2 : 1) : 0;
    const listHeight = height - hintBarHeight;

    // Clear background
    for (let row = 0; row < height; row++) {
      buffer.writeString(x, y + row, ' '.repeat(width), fg, bg);
    }

    // Render visible nodes
    for (let row = 0; row < listHeight; row++) {
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

      // Truncate or pad using display width (handles emoji properly)
      const lineWidth = getDisplayWidth(line);
      if (lineWidth > width) {
        line = truncateToWidth(line, width);
      }
      // Pad to fill the width
      line = padToWidth(line, width);

      buffer.writeString(x, y + row, line, nodeFg, nodeBg);
    }

    // Scrollbar (if needed)
    if (this.viewNodes.length > listHeight) {
      this.renderScrollbar(buffer, x + width - 1, y, listHeight);
    }

    // Render hint bar or dialog at bottom when focused
    if (this.focused) {
      this.renderHintBar(buffer, x, y + height - hintBarHeight, width, hintBarHeight);
    }
  }

  /**
   * Render the hint bar or dialog input at the bottom.
   */
  private renderHintBar(buffer: ScreenBuffer, x: number, y: number, width: number, height: number): void {
    const hintBg = this.ctx.getThemeColor('statusBar.background', '#007acc');
    const hintFg = this.ctx.getThemeColor('statusBar.foreground', '#ffffff');
    const accentFg = this.ctx.getThemeColor('focusBorder', '#007acc');
    const cursorBg = this.ctx.getThemeColor('editorCursor.foreground', '#ffffff');
    const cursorFg = this.ctx.getThemeColor('editor.background', '#1e1e1e');

    if (this.dialogMode !== 'none') {
      // Dialog mode - show input line and help hint
      let label = '';
      switch (this.dialogMode) {
        case 'new-file':
          label = ' New file: ';
          break;
        case 'new-folder':
          label = ' New folder: ';
          break;
        case 'rename':
          label = ' Rename: ';
          break;
        case 'delete-confirm':
          label = ' Delete? ';
          break;
      }

      // First line: label and input
      buffer.writeString(x, y, label, hintFg, hintBg);

      if (this.dialogMode === 'delete-confirm') {
        // Show filename and y/n prompt
        const targetName = this.dialogTarget?.name || '';
        const prompt = `${targetName} (y/n)`;
        const remaining = width - label.length;
        const truncated = prompt.length > remaining ? prompt.slice(0, remaining - 1) + '…' : prompt;
        buffer.writeString(x + label.length, y, truncated.padEnd(remaining, ' '), accentFg, hintBg);
      } else {
        // Show text input with visible cursor
        const inputWidth = width - label.length;
        const inputX = x + label.length;

        // Calculate visible portion of input and cursor position
        let displayStart = 0;
        let cursorDisplayPos = this.dialogCursorPos;

        // Scroll input if cursor would be off-screen
        if (this.dialogCursorPos >= inputWidth - 1) {
          displayStart = this.dialogCursorPos - inputWidth + 2;
          cursorDisplayPos = inputWidth - 2;
        }

        const displayInput = this.dialogInput.slice(displayStart, displayStart + inputWidth);

        // Render input text (before cursor)
        const beforeCursor = displayInput.slice(0, cursorDisplayPos);
        buffer.writeString(inputX, y, beforeCursor, accentFg, hintBg);

        // Render cursor character with inverted colors
        const cursorChar = displayInput[cursorDisplayPos] ?? ' ';
        buffer.writeString(inputX + cursorDisplayPos, y, cursorChar, cursorFg, cursorBg);

        // Render text after cursor
        const afterCursor = displayInput.slice(cursorDisplayPos + 1).padEnd(inputWidth - cursorDisplayPos - 1, ' ');
        buffer.writeString(inputX + cursorDisplayPos + 1, y, afterCursor, accentFg, hintBg);
      }

      // Second line: keyboard hints
      if (height > 1) {
        const hint = ' Enter:confirm  Esc:cancel';
        buffer.writeString(x, y + 1, hint.slice(0, width).padEnd(width, ' '), hintFg, hintBg);
      }
    } else {
      // Normal mode - show keyboard shortcuts
      const hint = ' n:new  N:folder  r:rename  d:del';
      buffer.writeString(x, y, hint.slice(0, width).padEnd(width, ' '), hintFg, hintBg);
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
    // Handle dialog input first - dialogs intercept all keys
    if (this.dialogMode !== 'none') {
      return this.handleDialogKey(event);
    }

    // Note: Most keys are now handled via the keybinding system (fileTree.* commands)
    // with "when": "fileTreeFocus" context. See config/default-keybindings.jsonc
    // This includes navigation (arrows, j/k/h/l), open (Enter/Space), and file ops (n/N/r/d/F2/Delete)

    return false;
  }

  /**
   * Handle keyboard input in dialog mode.
   */
  private handleDialogKey(event: KeyEvent): boolean {
    // Escape cancels dialog (check both 'Escape' and raw escape character)
    if (event.key === 'Escape' || event.key === '\x1b') {
      this.cancelDialog();
      return true;
    }

    // Enter confirms dialog
    if (event.key === 'Enter') {
      this.confirmDialog();
      return true;
    }

    // Delete confirmation with y/n
    if (this.dialogMode === 'delete-confirm') {
      if (event.key === 'y' || event.key === 'Y') {
        this.confirmDialog();
        return true;
      }
      if (event.key === 'n' || event.key === 'N') {
        this.cancelDialog();
        return true;
      }
      return true; // Consume all other keys in delete confirm mode
    }

    // Cursor navigation for text input
    if (event.key === 'ArrowLeft') {
      if (this.dialogCursorPos > 0) {
        this.dialogCursorPos--;
        this.ctx.markDirty();
      }
      return true;
    }
    if (event.key === 'ArrowRight') {
      if (this.dialogCursorPos < this.dialogInput.length) {
        this.dialogCursorPos++;
        this.ctx.markDirty();
      }
      return true;
    }
    if (event.key === 'Home') {
      this.dialogCursorPos = 0;
      this.ctx.markDirty();
      return true;
    }
    if (event.key === 'End') {
      this.dialogCursorPos = this.dialogInput.length;
      this.ctx.markDirty();
      return true;
    }

    // Text input handling for new/rename dialogs
    if (event.key === 'Backspace') {
      if (this.dialogCursorPos > 0) {
        this.dialogInput =
          this.dialogInput.slice(0, this.dialogCursorPos - 1) +
          this.dialogInput.slice(this.dialogCursorPos);
        this.dialogCursorPos--;
        this.ctx.markDirty();
      }
      return true;
    }
    if (event.key === 'Delete') {
      if (this.dialogCursorPos < this.dialogInput.length) {
        this.dialogInput =
          this.dialogInput.slice(0, this.dialogCursorPos) +
          this.dialogInput.slice(this.dialogCursorPos + 1);
        this.ctx.markDirty();
      }
      return true;
    }

    // Add printable characters at cursor position
    if (event.key.length === 1 && !event.ctrl && !event.alt && !event.meta) {
      this.dialogInput =
        this.dialogInput.slice(0, this.dialogCursorPos) +
        event.key +
        this.dialogInput.slice(this.dialogCursorPos);
      this.dialogCursorPos++;
      this.ctx.markDirty();
      return true;
    }

    return true; // Consume all keys in dialog mode
  }

  // ─────────────────────────────────────────────────────────────────────────
  // File Operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start new file dialog.
   */
  startNewFile(): void {
    const selected = this.viewNodes[this.selectedIndex]?.node;
    this.dialogTarget = selected ?? null;
    this.dialogMode = 'new-file';
    this.dialogInput = '';
    this.dialogCursorPos = 0;
    this.ctx.markDirty();
  }

  /**
   * Start new folder dialog.
   */
  startNewFolder(): void {
    const selected = this.viewNodes[this.selectedIndex]?.node;
    this.dialogTarget = selected ?? null;
    this.dialogMode = 'new-folder';
    this.dialogInput = '';
    this.dialogCursorPos = 0;
    this.ctx.markDirty();
  }

  /**
   * Start rename dialog.
   */
  startRename(): void {
    const selected = this.viewNodes[this.selectedIndex]?.node;
    if (selected) {
      this.dialogTarget = selected;
      this.dialogMode = 'rename';
      this.dialogInput = selected.name;
      // Position cursor at the end of the filename, before extension
      const dotIndex = selected.name.lastIndexOf('.');
      this.dialogCursorPos = dotIndex > 0 ? dotIndex : selected.name.length;
      this.ctx.markDirty();
    }
  }

  /**
   * Start delete confirmation.
   */
  startDelete(): void {
    const selected = this.viewNodes[this.selectedIndex]?.node;
    if (selected) {
      this.dialogTarget = selected;
      this.dialogMode = 'delete-confirm';
      this.dialogInput = '';
      this.dialogCursorPos = 0;
      this.ctx.markDirty();
    }
  }

  /**
   * Cancel dialog.
   */
  private cancelDialog(): void {
    this.dialogMode = 'none';
    this.dialogInput = '';
    this.dialogCursorPos = 0;
    this.dialogTarget = null;
    this.ctx.markDirty();
  }

  /**
   * Confirm dialog action.
   */
  private async confirmDialog(): Promise<void> {
    const mode = this.dialogMode;
    const input = this.dialogInput.trim();
    const target = this.dialogTarget;

    // Reset dialog state before async operations
    this.dialogMode = 'none';
    this.dialogInput = '';
    this.dialogCursorPos = 0;
    this.dialogTarget = null;
    this.ctx.markDirty();

    switch (mode) {
      case 'new-file':
        await this.createNewFile(input, target);
        break;
      case 'new-folder':
        await this.createNewFolder(input, target);
        break;
      case 'rename':
        if (target) await this.renameTarget(target, input);
        break;
      case 'delete-confirm':
        if (target) await this.deleteTarget(target);
        break;
    }
  }

  /**
   * Get the directory path for creating new files/folders.
   */
  private getTargetDir(target: FileNode | null): string {
    if (target) {
      if (target.isDirectory) {
        return target.path;
      }
      // If file selected, use its parent directory
      const lastSlash = target.path.lastIndexOf('/');
      return lastSlash > 0 ? target.path.slice(0, lastSlash) : this.workspaceRoot ?? '/';
    }
    return this.workspaceRoot ?? '/';
  }

  /**
   * Create a new file.
   */
  private async createNewFile(fileName: string, target: FileNode | null): Promise<void> {
    if (!fileName) return;

    const dirPath = this.getTargetDir(target);

    if (this.callbacks.onCreateFile) {
      const newPath = await this.callbacks.onCreateFile(dirPath, fileName);
      if (newPath) {
        // Refresh and select the new file
        await this.refresh();
        this.selectPath(newPath);
        // Open the new file
        this.callbacks.onFileOpen?.(newPath);
      }
    }
  }

  /**
   * Create a new folder.
   */
  private async createNewFolder(folderName: string, target: FileNode | null): Promise<void> {
    if (!folderName) return;

    const dirPath = this.getTargetDir(target);

    if (this.callbacks.onCreateFolder) {
      const success = await this.callbacks.onCreateFolder(dirPath, folderName);
      if (success) {
        // Refresh and select the new folder
        await this.refresh();
        const newPath = `${dirPath}/${folderName}`;
        this.selectPath(newPath);
      }
    }
  }

  /**
   * Rename the target file or folder.
   */
  private async renameTarget(target: FileNode, newName: string): Promise<void> {
    if (!newName || newName === target.name) return;

    if (this.callbacks.onRename) {
      const newPath = await this.callbacks.onRename(target.path, newName);
      if (newPath) {
        await this.refresh();
        this.selectPath(newPath);
      }
    }
  }

  /**
   * Delete the target file or folder.
   */
  private async deleteTarget(target: FileNode): Promise<void> {
    if (this.callbacks.onDelete) {
      const success = await this.callbacks.onDelete(target.path);
      if (success) {
        await this.refresh();
        // Selection will be adjusted by rebuildView
      }
    }
  }

  /**
   * Check if dialog is currently open.
   */
  isDialogOpen(): boolean {
    return this.dialogMode !== 'none';
  }

  /** Last click time for double-click detection */
  private lastClickTime = 0;
  /** Last clicked index for double-click detection */
  private lastClickIndex = -1;

  override handleMouse(event: MouseEvent): boolean {
    if (event.type === 'press' && event.button === 'left') {
      // Check if click is within our visible bounds first
      if (event.x < this.bounds.x || event.x >= this.bounds.x + this.bounds.width ||
          event.y < this.bounds.y || event.y >= this.bounds.y + this.bounds.height) {
        return false;
      }

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
