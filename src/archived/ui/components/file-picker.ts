/**
 * File Picker Component
 *
 * Fuzzy file finder dialog for quick file opening.
 * Now extends SearchableDialog for consistent API.
 */

import type { RenderContext } from '../renderer.ts';
import type { MouseEvent } from '../mouse.ts';
import type { KeyEvent } from '../../terminal/input.ts';
import { SearchableDialog, type SearchableDialogConfig, type ItemDisplayConfig } from './searchable-dialog.ts';
import { RenderUtils } from '../render-utils.ts';
import { fileSearch, type FileSearchResult } from '../../features/search/file-search.ts';
import { themeLoader } from '../themes/theme-loader.ts';

/**
 * File icons by extension
 */
const FILE_ICONS: Record<string, string> = {
  'ts': '󰛦',
  'tsx': '󰜈',
  'js': '󰌞',
  'jsx': '󰜈',
  'json': '',
  'md': '',
  'css': '',
  'scss': '',
  'html': '',
  'vue': '󰡄',
  'svelte': '',
  'py': '',
  'rs': '',
  'go': '',
  'rb': '',
  'sh': '',
  'bash': '',
  'zsh': '',
  'yaml': '',
  'yml': '',
  'toml': '',
  'xml': '󰗀',
  'svg': '󰜡',
  'png': '',
  'jpg': '',
  'jpeg': '',
  'gif': '',
  'sql': '',
  'graphql': '',
  'dockerfile': '',
  'gitignore': '',
};

/**
 * Get file icon based on extension
 */
function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return FILE_ICONS[ext] || '';
}

/**
 * FilePicker - Fuzzy file finder dialog
 *
 * @example New API:
 * ```typescript
 * await filePicker.showPicker(
 *   { screenWidth: 80, screenHeight: 24 },
 *   '/path/to/workspace'
 * );
 * filePicker.onSelect((path) => openFile(path));
 * ```
 *
 * @example Legacy API (still supported):
 * ```typescript
 * await filePicker.show(workspaceRoot, screenWidth, screenHeight);
 * filePicker.onSelect((path) => openFile(path));
 * ```
 */
export class FilePicker extends SearchableDialog<FileSearchResult> {
  private _workspaceRoot: string = '';
  private _isIndexing: boolean = false;
  private _fileSelectCallbacks: Set<(filePath: string) => void> = new Set();

  constructor() {
    super();
    this._debugName = 'FilePicker';
    this._title = 'Quick Open';
  }

  // === Lifecycle ===

  /**
   * Show the file picker (new API)
   */
  async showPicker(config: SearchableDialogConfig, workspaceRoot: string): Promise<void> {
    this._workspaceRoot = workspaceRoot;

    // Show base dialog
    this.showWithItems(
      {
        ...config,
        title: 'Quick Open',
        width: config.width || 80,
        height: config.height || 24
      },
      [],  // Items will be loaded after indexing
      ''
    );

    // Index files if needed
    if (fileSearch.getFileCount() === 0) {
      this._isIndexing = true;
      fileSearch.setWorkspaceRoot(workspaceRoot);
      await fileSearch.indexFiles();
      this._isIndexing = false;
    }

    // Update results with indexed files
    this.updateResults();

    this.debugLog(`Showing for workspace: ${workspaceRoot}`);
  }

  /**
   * Show the file picker (legacy API for backwards compatibility)
   */
  async show(
    workspaceRoot: string,
    screenWidth: number,
    screenHeight: number,
    editorX?: number,
    editorWidth?: number
  ): Promise<void> {
    await this.showPicker(
      {
        screenWidth,
        screenHeight,
        editorX,
        editorWidth
      },
      workspaceRoot
    );
  }

  /**
   * Update results using fileSearch
   */
  private updateResults(): void {
    const maxResults = this._rect.height - 4;
    const results = fileSearch.search(this._textInput.value, maxResults);

    // Convert to scored items (fileSearch already scores)
    this._items = results;
    this._filteredItems = results.map(item => ({ item, score: 0 }));
  }

  // === Query handling (override to use fileSearch) ===

  protected onQueryChange(): void {
    this._selectedIndex = 0;
    this._scrollOffset = 0;
    this.updateResults();
  }

  // === Scoring (not used since fileSearch does scoring) ===

  protected scoreItem(_item: FileSearchResult, _query: string): number {
    // fileSearch handles scoring internally
    return 1;
  }

  // === Item Display ===

  protected getItemDisplay(item: FileSearchResult, isSelected: boolean): ItemDisplayConfig {
    const icon = getFileIcon(item.name);
    const dir = item.relativePath.slice(0, item.relativePath.length - item.name.length - 1);

    return {
      text: item.name,
      secondary: dir || undefined,
      icon,
      isCurrent: false
    };
  }

  // === Selection ===

  /**
   * Get selected file path
   */
  getSelectedPath(): string | null {
    const item = this.getSelectedItem();
    return item?.path || null;
  }

  // === Actions ===

  protected async onItemSelected(item: FileSearchResult): Promise<void> {
    // Trigger file select callbacks
    for (const callback of this._fileSelectCallbacks) {
      try {
        callback(item.path);
      } catch (e) {
        this.debugLog(`File select callback error: ${e}`);
      }
    }
    this.hide();
  }

  // === Callbacks ===

  /**
   * Register file selection callback
   * @returns Cleanup function
   */
  onSelect(callback: (filePath: string) => void): () => void {
    this._fileSelectCallbacks.add(callback);
    return () => {
      this._fileSelectCallbacks.delete(callback);
    };
  }

  // === Rendering (custom for file results) ===

  render(ctx: RenderContext): void {
    if (!this._isVisible) return;

    const colors = this.getColors();

    // Background and border
    this.renderBackground(ctx);

    // Title
    this.renderTitle(ctx);

    // Search input
    this.renderSearchInput(ctx);
    this.renderSeparator(ctx, 2);

    // Results
    if (this._isIndexing) {
      ctx.drawStyled(
        this._rect.x + 3,
        this._rect.y + 4,
        'Indexing files...',
        colors.hintForeground,
        colors.background
      );
    } else {
      this.renderFileResults(ctx);
    }

    // Footer
    this.renderFileFooter(ctx);
  }

  /**
   * Render file results with custom styling
   */
  private renderFileResults(ctx: RenderContext): void {
    const colors = this.getColors();
    const listStartY = this._rect.y + 3;
    const listHeight = this._rect.height - 4;
    const listWidth = this._rect.width - 2;

    if (this._filteredItems.length === 0) {
      const emptyMessage = this._textInput.value
        ? 'No matching files'
        : 'Type to search files';
      ctx.drawStyled(
        this._rect.x + 3,
        listStartY + 1,
        emptyMessage,
        colors.hintForeground,
        colors.background
      );
      return;
    }

    // Render visible items
    for (let i = 0; i < Math.min(listHeight, this._filteredItems.length - this._scrollOffset); i++) {
      const itemIndex = this._scrollOffset + i;
      const scoredItem = this._filteredItems[itemIndex]!;
      const result = scoredItem.item;
      const isSelected = itemIndex === this._selectedIndex;
      const y = listStartY + i;

      // Background
      const bgColor = isSelected ? colors.selectedBackground : colors.background;
      ctx.fill(this._rect.x + 1, y, listWidth, 1, ' ', undefined, bgColor);

      // File icon
      const icon = getFileIcon(result.name);
      const iconColor = result.isHidden
        ? themeLoader.adjustBrightness(colors.hintForeground, -30)
        : colors.hintForeground;
      ctx.drawStyled(this._rect.x + 2, y, icon, iconColor, bgColor);

      // Filename
      let nameColor: string;
      if (result.isHidden) {
        const baseColor = isSelected ? colors.selectedForeground : colors.foreground;
        nameColor = themeLoader.adjustBrightness(baseColor, -20);
      } else {
        nameColor = isSelected ? colors.selectedForeground : colors.foreground;
      }
      const maxNameLen = Math.min(30, listWidth - 8);
      const displayName = RenderUtils.truncateText(result.name, maxNameLen);
      ctx.drawStyled(this._rect.x + 5, y, displayName, nameColor, bgColor);

      // Directory path
      const pathColor = result.isHidden
        ? themeLoader.adjustBrightness(colors.hintForeground, -30)
        : colors.hintForeground;
      const pathStart = this._rect.x + 6 + displayName.length;
      const pathMaxLen = listWidth - (pathStart - this._rect.x) - 1;

      if (pathMaxLen > 5) {
        const dir = result.relativePath.slice(0, result.relativePath.length - result.name.length - 1);
        if (dir) {
          const displayPath = dir.length > pathMaxLen
            ? '…' + dir.slice(-(pathMaxLen - 1))
            : dir;
          ctx.drawStyled(pathStart, y, displayPath, pathColor, bgColor);
        }
      }
    }
  }

  /**
   * Render footer with file count
   */
  private renderFileFooter(ctx: RenderContext): void {
    const colors = this.getColors();
    const footerY = this._rect.y + this._rect.height - 1;
    const fileCount = `${fileSearch.getFileCount()} files`;
    ctx.drawStyled(
      this._rect.x + this._rect.width - fileCount.length - 2,
      footerY,
      fileCount,
      colors.hintForeground,
      colors.background
    );
  }

  // === Search input rendering (custom with search icon) ===

  protected renderSearchInput(ctx: RenderContext): void {
    const colors = this.getColors();
    const inputY = this._rect.y + 1;
    const inputX = this._rect.x + 1;
    const inputWidth = this._rect.width - 2;

    // Input background
    ctx.fill(inputX, inputY, inputWidth, 1, ' ', colors.inputForeground, colors.inputBackground);

    // Search icon
    ctx.drawStyled(inputX + 1, inputY, '🔍 ', colors.hintForeground, colors.inputBackground);

    // Query text
    const query = this._textInput.value;
    const displayQuery = RenderUtils.truncateText(query, inputWidth - 8);
    ctx.drawStyled(inputX + 4, inputY, displayQuery, colors.inputForeground, colors.inputBackground);

    // Cursor
    const cursorX = inputX + 4 + Math.min(this._textInput.cursorPosition, inputWidth - 8);
    ctx.drawStyled(cursorX, inputY, '│', colors.inputFocusBorder, colors.inputBackground);
  }
}

export const filePicker = new FilePicker();
export default filePicker;
