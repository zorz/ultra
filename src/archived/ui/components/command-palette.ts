/**
 * Command Palette Component
 *
 * Fuzzy search command palette for executing commands.
 * Now extends SearchableDialog for consistent API.
 *
 * Supports:
 * - Command mode: Shows registered commands
 * - Custom items mode: Shows arbitrary selectable items
 * - Fuzzy matching (characters in order)
 * - Word-initial matching ("ts" matches "toggleSidebar")
 * - Substring matching
 * - Re-show during handler (for nested menus)
 */

import type { RenderContext } from '../renderer.ts';
import type { MouseEvent } from '../mouse.ts';
import type { KeyEvent } from '../../terminal/input.ts';
import type { Command } from '../../input/commands.ts';
import { SearchableDialog, type SearchableDialogConfig, type ItemDisplayConfig, type ScoredItem } from './searchable-dialog.ts';
import { RenderUtils } from '../render-utils.ts';
import { keymap } from '../../input/keymap.ts';

/**
 * Custom palette item (for non-command selections)
 */
export interface PaletteItem {
  id: string;
  title: string;
  category?: string;
  handler: () => void | Promise<void>;
}

/**
 * Union type for items the palette can display
 */
type PaletteEntry = Command | PaletteItem;

/**
 * Type guard for Command
 */
function isCommand(item: PaletteEntry): item is Command {
  return 'handler' in item && !('id' in item && 'title' in item && typeof (item as any).handler === 'function');
}

/**
 * Type guard for PaletteItem
 */
function isPaletteItem(item: PaletteEntry): item is PaletteItem {
  return 'id' in item && 'title' in item && 'handler' in item;
}

/**
 * Category icons for commands
 */
const CATEGORY_ICONS: Record<string, string> = {
  'File': '󰈔',
  'Edit': '',
  'Selection': '󰒅',
  'View': '',
  'Navigation': '',
  'Search': '',
  'Tabs': '󰓩',
  'Git': '',
  'Terminal': '',
};

/**
 * CommandPalette - Fuzzy search command/item selector
 *
 * @example Command mode:
 * ```typescript
 * commandPalette.showCommands(config, commands);
 * commandPalette.onSelect((cmd) => cmd.handler());
 * ```
 *
 * @example Custom items mode:
 * ```typescript
 * commandPalette.showItems(config, items, 'Select Theme', currentThemeId);
 * ```
 *
 * @example Legacy API (still supported):
 * ```typescript
 * commandPalette.show(commands, screenWidth, screenHeight);
 * commandPalette.showWithItems(items, 'Select Item', highlightId);
 * ```
 */
export class CommandPalette extends SearchableDialog<PaletteEntry> {
  // Mode tracking
  private _isCustomMode: boolean = false;
  private _commands: Command[] = [];
  private _customItems: PaletteItem[] = [];

  // Re-show tracking (for nested menus)
  private _wasReShown: boolean = false;

  // Command select callback
  private _commandSelectCallbacks: Set<(command: Command) => void> = new Set();

  constructor() {
    super();
    this._debugName = 'CommandPalette';
  }

  // === Lifecycle ===

  /**
   * Show palette with commands (new API)
   */
  showCommands(config: SearchableDialogConfig, commands: Command[]): void {
    this._wasReShown = this._isVisible;
    this._isCustomMode = false;
    this._commands = commands;

    this.showWithItems(
      {
        ...config,
        title: 'Command Palette',
        width: config.width || 70,
        height: config.height || 20
      },
      commands,
      ''
    );

    this.debugLog(`Showing ${commands.length} commands`);
  }

  /**
   * Show palette with custom items (new API)
   */
  showItems(
    config: SearchableDialogConfig,
    items: PaletteItem[],
    title: string = 'Select Item',
    highlightId: string = ''
  ): void {
    this._wasReShown = this._isVisible;
    this._isCustomMode = true;
    this._customItems = items;

    this.showWithItems(
      {
        ...config,
        title,
        width: config.width || 70,
        height: config.height || 20
      },
      items,
      highlightId
    );

    this.debugLog(`Showing ${items.length} custom items with title "${title}"`);
  }

  /**
   * Show palette with commands (legacy API)
   */
  show(
    commands: Command[],
    screenWidth: number,
    screenHeight: number,
    editorX?: number,
    editorWidth?: number
  ): void {
    this.showCommands(
      { screenWidth, screenHeight, editorX, editorWidth },
      commands
    );
  }

  /**
   * Show palette with custom items (legacy API)
   */
  showWithItems(
    items: PaletteItem[],
    title?: string,
    highlightId?: string,
    editorX?: number,
    editorWidth?: number
  ): void;
  showWithItems(
    config: SearchableDialogConfig,
    items: PaletteEntry[],
    highlightId: string
  ): void;
  showWithItems(
    configOrItems: SearchableDialogConfig | PaletteItem[],
    itemsOrTitle?: PaletteEntry[] | string,
    highlightIdOrHighlightId?: string,
    editorX?: number,
    editorWidth?: number
  ): void {
    // Detect which overload was called
    if (Array.isArray(configOrItems)) {
      // Legacy API: showWithItems(items, title, highlightId, editorX, editorWidth)
      const items = configOrItems as PaletteItem[];
      const title = (itemsOrTitle as string) || 'Select Item';
      const highlightId = highlightIdOrHighlightId || '';
      const screenWidth = process.stdout.columns || 80;
      const screenHeight = process.stdout.rows || 24;

      this._wasReShown = this._isVisible;
      this._isCustomMode = true;
      this._customItems = items;

      super.showWithItems(
        {
          screenWidth,
          screenHeight,
          editorX,
          editorWidth,
          title,
          width: 70,
          height: 20
        },
        items,
        highlightId
      );
    } else {
      // New API: showWithItems(config, items, highlightId)
      const config = configOrItems;
      const items = itemsOrTitle as PaletteEntry[];
      const highlightId = highlightIdOrHighlightId || '';

      super.showWithItems(config, items, highlightId);
    }
  }

  /**
   * Find item index by ID
   */
  protected findItemIndex(id: string): number {
    if (this._isCustomMode) {
      return this._customItems.findIndex(item => item.id === id);
    }
    return this._commands.findIndex(cmd => cmd.id === id);
  }

  // === Selection Getters ===

  /**
   * Get selected command (command mode only)
   */
  getSelectedCommand(): Command | null {
    if (this._isCustomMode) return null;
    const item = this.getSelectedItem();
    return item as Command | null;
  }

  /**
   * Get selected custom item (custom mode only)
   */
  getSelectedPaletteItem(): PaletteItem | null {
    if (!this._isCustomMode) return null;
    const item = this.getSelectedItem();
    return item as PaletteItem | null;
  }

  // === Scoring ===

  protected scoreItem(item: PaletteEntry, query: string): number {
    if (this._isCustomMode) {
      return this.scorePaletteItem(item as PaletteItem, query);
    } else {
      return this.scoreCommand(item as Command, query);
    }
  }

  /**
   * Score a command against the query
   */
  private scoreCommand(cmd: Command, query: string): number {
    const title = cmd.title;
    const lowerTitle = title.toLowerCase();
    const id = cmd.id;
    const lowerId = id.toLowerCase();
    const lowerQuery = query.toLowerCase();

    let bestScore = 0;

    // 1. Exact substring match in title (highest priority)
    if (lowerTitle.includes(lowerQuery)) {
      bestScore = Math.max(bestScore, 100 + (50 - lowerQuery.length));
    }

    // 2. Word-initial letter match
    const wordInitialScore = this.scoreWordInitials(title, lowerQuery);
    if (wordInitialScore > 0) {
      bestScore = Math.max(bestScore, 80 + wordInitialScore);
    }

    // 3. Fuzzy match in title
    const fuzzyTitleScore = this.fuzzyScore(lowerQuery, lowerTitle);
    if (fuzzyTitleScore > 0) {
      bestScore = Math.max(bestScore, 40 + fuzzyTitleScore);
    }

    // 4. Match in command ID
    if (lowerId.includes(lowerQuery)) {
      bestScore = Math.max(bestScore, 30);
    }

    // 5. Fuzzy match in command ID
    const fuzzyIdScore = this.fuzzyScore(lowerQuery, lowerId);
    if (fuzzyIdScore > 0) {
      bestScore = Math.max(bestScore, 20 + fuzzyIdScore);
    }

    return bestScore;
  }

  /**
   * Score a custom palette item
   */
  private scorePaletteItem(item: PaletteItem, query: string): number {
    const title = item.title;
    const lowerTitle = title.toLowerCase();
    const lowerQuery = query.toLowerCase();

    let bestScore = 0;

    // Exact substring match
    if (lowerTitle.includes(lowerQuery)) {
      bestScore = Math.max(bestScore, 100 + (50 - lowerQuery.length));
    }

    // Fuzzy match
    const fuzzyScoreVal = this.fuzzyScore(lowerQuery, lowerTitle);
    if (fuzzyScoreVal > 0) {
      bestScore = Math.max(bestScore, 40 + fuzzyScoreVal);
    }

    return bestScore;
  }

  // === Item Display ===

  protected getItemDisplay(item: PaletteEntry, isSelected: boolean): ItemDisplayConfig {
    if (this._isCustomMode) {
      const paletteItem = item as PaletteItem;
      return {
        text: paletteItem.title,
        secondary: paletteItem.category,
        isCurrent: paletteItem.id === this._highlightedId
      };
    } else {
      const command = item as Command;
      return {
        text: command.title,
        secondary: command.category,
        icon: CATEGORY_ICONS[command.category || ''] || ''
      };
    }
  }

  // === Actions ===

  async confirm(): Promise<void> {
    this._wasReShown = false;

    const item = this.getSelectedItem();
    if (!item) return;

    if (this._isCustomMode) {
      const paletteItem = item as PaletteItem;
      try {
        await paletteItem.handler();
      } catch (e) {
        this.debugLog(`Handler error: ${e}`);
      }
    } else {
      const command = item as Command;
      // Trigger command select callbacks
      for (const callback of this._commandSelectCallbacks) {
        try {
          await callback(command);
        } catch (e) {
          this.debugLog(`Command callback error: ${e}`);
        }
      }
    }

    // Only hide if the handler didn't re-show the palette
    if (!this._wasReShown) {
      this.hide();
    }
    this._wasReShown = false;
  }

  // === Callbacks ===

  /**
   * Register command selection callback
   */
  onSelect(callback: (command: Command) => void): () => void {
    this._commandSelectCallbacks.add(callback);
    return () => {
      this._commandSelectCallbacks.delete(callback);
    };
  }

  // === Rendering ===

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
    if (this._isCustomMode) {
      this.renderCustomItems(ctx);
    } else {
      this.renderCommands(ctx);
    }
  }

  /**
   * Render search input with command prefix
   */
  protected renderSearchInput(ctx: RenderContext): void {
    const colors = this.getColors();
    const inputY = this._rect.y + 1;
    const inputX = this._rect.x + 1;
    const inputWidth = this._rect.width - 2;

    // Input background
    ctx.fill(inputX, inputY, inputWidth, 1, ' ', colors.inputForeground, colors.inputBackground);

    // Prompt
    ctx.drawStyled(inputX + 1, inputY, '> ', colors.titleForeground, colors.inputBackground);

    // Query text
    const query = this._textInput.value;
    const displayQuery = RenderUtils.truncateText(query, inputWidth - 6);
    ctx.drawStyled(inputX + 3, inputY, displayQuery, colors.inputForeground, colors.inputBackground);

    // Cursor
    const cursorX = inputX + 3 + Math.min(this._textInput.cursorPosition, inputWidth - 6);
    ctx.drawStyled(cursorX, inputY, '│', colors.inputFocusBorder, colors.inputBackground);
  }

  /**
   * Render command list
   */
  private renderCommands(ctx: RenderContext): void {
    const colors = this.getColors();
    const listStartY = this._rect.y + 3;
    const listHeight = this._rect.height - 4;
    const listWidth = this._rect.width - 2;

    if (this._filteredItems.length === 0) {
      const emptyMessage = this._textInput.value
        ? 'No matching commands'
        : 'Type to search commands';
      ctx.drawStyled(
        this._rect.x + 3,
        listStartY + 1,
        emptyMessage,
        colors.hintForeground,
        colors.background
      );
    } else {
      for (let i = 0; i < Math.min(listHeight, this._filteredItems.length - this._scrollOffset); i++) {
        const itemIndex = this._scrollOffset + i;
        const scoredItem = this._filteredItems[itemIndex]!;
        const cmd = scoredItem.item as Command;
        const isSelected = itemIndex === this._selectedIndex;
        const y = listStartY + i;

        // Background
        const bgColor = isSelected ? colors.selectedBackground : colors.background;
        ctx.fill(this._rect.x + 1, y, listWidth, 1, ' ', undefined, bgColor);

        // Category icon
        const icon = CATEGORY_ICONS[cmd.category || ''] || '';
        ctx.drawStyled(this._rect.x + 2, y, icon, colors.hintForeground, bgColor);

        // Get keyboard shortcut for this command
        const binding = keymap.getBindingForCommand(cmd.id);
        const shortcut = binding ? keymap.formatForDisplay(binding.key) : '';
        const shortcutWidth = shortcut.length;

        // Command title
        const titleColor = isSelected ? colors.selectedForeground : colors.foreground;
        const maxTitleLen = listWidth - 6 - shortcutWidth - 2;  // icon + padding + shortcut + margin
        const displayTitle = RenderUtils.truncateText(cmd.title, maxTitleLen);
        ctx.drawStyled(this._rect.x + 5, y, displayTitle, titleColor, bgColor);

        // Keyboard shortcut (right-aligned)
        if (shortcut) {
          const shortcutColor = colors.hintForeground;
          const shortcutX = this._rect.x + listWidth - shortcutWidth - 1;
          if (shortcutX > this._rect.x + 5 + displayTitle.length + 2) {
            ctx.drawStyled(shortcutX, y, shortcut, shortcutColor, bgColor);
          }
        }
      }
    }

    // Footer
    const footerY = this._rect.y + this._rect.height - 1;
    const count = `${this._filteredItems.length} commands`;
    ctx.drawStyled(
      this._rect.x + this._rect.width - count.length - 2,
      footerY,
      count,
      colors.hintForeground,
      colors.background
    );
  }

  /**
   * Render custom items list
   */
  private renderCustomItems(ctx: RenderContext): void {
    const colors = this.getColors();
    const listStartY = this._rect.y + 3;
    const listHeight = this._rect.height - 4;
    const listWidth = this._rect.width - 2;

    if (this._filteredItems.length === 0) {
      const emptyMessage = this._textInput.value
        ? 'No matching items'
        : 'Type to search';
      ctx.drawStyled(
        this._rect.x + 3,
        listStartY + 1,
        emptyMessage,
        colors.hintForeground,
        colors.background
      );
    } else {
      for (let i = 0; i < Math.min(listHeight, this._filteredItems.length - this._scrollOffset); i++) {
        const itemIndex = this._scrollOffset + i;
        const scoredItem = this._filteredItems[itemIndex]!;
        const item = scoredItem.item as PaletteItem;
        const isSelected = itemIndex === this._selectedIndex;
        const isCurrent = item.id === this._highlightedId;
        const y = listStartY + i;

        // Background
        const bgColor = isSelected ? colors.selectedBackground : colors.background;
        ctx.fill(this._rect.x + 1, y, listWidth, 1, ' ', undefined, bgColor);

        // Checkmark for current item
        const checkmark = isCurrent ? '✓ ' : '  ';
        ctx.drawStyled(this._rect.x + 2, y, checkmark, colors.successForeground, bgColor);

        // Item title
        const titleColor = isSelected ? colors.selectedForeground : colors.foreground;
        const maxTitleLen = listWidth - 20;
        const displayTitle = RenderUtils.truncateText(item.title, maxTitleLen);
        ctx.drawStyled(this._rect.x + 4, y, displayTitle, titleColor, bgColor);

        // Category label (right-aligned)
        if (item.category) {
          const categoryColor = colors.hintForeground;
          const categoryX = this._rect.x + listWidth - item.category.length - 1;
          if (categoryX > this._rect.x + 4 + displayTitle.length + 2) {
            ctx.drawStyled(categoryX, y, item.category, categoryColor, bgColor);
          }
        }
      }
    }

    // Footer
    const footerY = this._rect.y + this._rect.height - 1;
    const count = `${this._filteredItems.length} items`;
    ctx.drawStyled(
      this._rect.x + this._rect.width - count.length - 2,
      footerY,
      count,
      colors.hintForeground,
      colors.background
    );
  }
}

export const commandPalette = new CommandPalette();
export default commandPalette;
