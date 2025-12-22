/**
 * Settings Dialog
 *
 * Searchable dialog for browsing and editing settings.
 * Extends SearchableDialog for consistent fuzzy search behavior.
 */

import type { RenderContext } from '../renderer.ts';
import type { EditorSettings } from '../../config/settings.ts';
import { SearchableDialog, type SearchableDialogConfig, type ItemDisplayConfig } from './searchable-dialog.ts';
import { RenderUtils } from '../render-utils.ts';
import { settings } from '../../config/settings.ts';

/**
 * Setting type for categorization and editing UI
 */
export type SettingType = 'boolean' | 'number' | 'string' | 'enum' | 'object';

/**
 * Metadata for a single setting
 */
export interface SettingMeta {
  key: keyof EditorSettings;
  label: string;
  description: string;
  category: string;
  type: SettingType;
  options?: string[];  // For enum types
  min?: number;        // For number types
  max?: number;        // For number types
}

/**
 * Setting item for display in the dialog
 */
export interface SettingItem {
  meta: SettingMeta;
  value: any;
}

/**
 * Category icons for settings
 */
const CATEGORY_ICONS: Record<string, string> = {
  'Editor': '',
  'Workbench': '',
  'Files': '󰈔',
  'Terminal': '',
  'Git': '',
  'AI': '󰚩',
  'Session': '󰆓',
  'Ultra': '',
};

/**
 * Settings metadata registry
 */
const SETTINGS_META: SettingMeta[] = [
  // Editor settings
  { key: 'editor.fontSize', label: 'Font Size', description: 'Controls the font size in pixels', category: 'Editor', type: 'number', min: 8, max: 32 },
  { key: 'editor.tabSize', label: 'Tab Size', description: 'The number of spaces a tab is equal to', category: 'Editor', type: 'number', min: 1, max: 8 },
  { key: 'editor.insertSpaces', label: 'Insert Spaces', description: 'Insert spaces when pressing Tab', category: 'Editor', type: 'boolean' },
  { key: 'editor.autoIndent', label: 'Auto Indent', description: 'Controls auto indentation behavior', category: 'Editor', type: 'enum', options: ['none', 'keep', 'full'] },
  { key: 'editor.autoClosingBrackets', label: 'Auto Closing Brackets', description: 'Controls auto closing of brackets', category: 'Editor', type: 'enum', options: ['always', 'languageDefined', 'beforeWhitespace', 'never'] },
  { key: 'editor.wordWrap', label: 'Word Wrap', description: 'Controls how lines should wrap', category: 'Editor', type: 'enum', options: ['off', 'on', 'wordWrapColumn', 'bounded'] },
  { key: 'editor.lineNumbers', label: 'Line Numbers', description: 'Controls the display of line numbers', category: 'Editor', type: 'enum', options: ['on', 'off', 'relative'] },
  { key: 'editor.folding', label: 'Folding', description: 'Controls whether code folding is enabled', category: 'Editor', type: 'boolean' },
  { key: 'editor.renderWhitespace', label: 'Render Whitespace', description: 'Controls rendering of whitespace characters', category: 'Editor', type: 'enum', options: ['none', 'boundary', 'selection', 'trailing', 'all'] },
  { key: 'editor.mouseWheelScrollSensitivity', label: 'Mouse Wheel Sensitivity', description: 'Scroll speed multiplier for mouse wheel', category: 'Editor', type: 'number', min: 1, max: 10 },
  { key: 'editor.cursorBlinkRate', label: 'Cursor Blink Rate', description: 'Cursor blink interval in milliseconds', category: 'Editor', type: 'number', min: 100, max: 2000 },
  { key: 'editor.scrollBeyondLastLine', label: 'Scroll Beyond Last Line', description: 'Allow scrolling past the last line', category: 'Editor', type: 'boolean' },

  // Minimap settings
  { key: 'editor.minimap.enabled', label: 'Minimap Enabled', description: 'Controls whether the minimap is shown', category: 'Editor', type: 'boolean' },
  { key: 'editor.minimap.width', label: 'Minimap Width', description: 'Width of the minimap in characters', category: 'Editor', type: 'number', min: 5, max: 20 },
  { key: 'editor.minimap.showSlider', label: 'Minimap Slider', description: 'Controls when the slider is shown', category: 'Editor', type: 'enum', options: ['always', 'mouseover'] },
  { key: 'editor.minimap.side', label: 'Minimap Side', description: 'Controls the side where minimap is rendered', category: 'Editor', type: 'enum', options: ['left', 'right'] },

  // Workbench settings
  { key: 'workbench.colorTheme', label: 'Color Theme', description: 'Specifies the color theme', category: 'Workbench', type: 'string' },
  { key: 'workbench.sideBar.visible', label: 'Sidebar Visible', description: 'Controls sidebar visibility', category: 'Workbench', type: 'boolean' },
  { key: 'workbench.sideBar.location', label: 'Sidebar Location', description: 'Controls sidebar position', category: 'Workbench', type: 'enum', options: ['left', 'right'] },

  // Files settings
  { key: 'files.autoSave', label: 'Auto Save', description: 'Controls auto save behavior', category: 'Files', type: 'enum', options: ['off', 'afterDelay', 'onFocusChange', 'onWindowChange'] },

  // Terminal settings
  { key: 'terminal.integrated.position', label: 'Terminal Position', description: 'Controls terminal panel position', category: 'Terminal', type: 'enum', options: ['bottom', 'top', 'left', 'right'] },
  { key: 'terminal.integrated.defaultHeight', label: 'Terminal Height', description: 'Default terminal panel height in rows', category: 'Terminal', type: 'number', min: 5, max: 50 },
  { key: 'terminal.integrated.openOnStartup', label: 'Open on Startup', description: 'Open terminal panel on startup', category: 'Terminal', type: 'boolean' },
  { key: 'terminal.integrated.spawnOnStartup', label: 'Spawn on Startup', description: 'Spawn terminal process on startup', category: 'Terminal', type: 'boolean' },

  // Git settings
  { key: 'git.panel.location', label: 'Git Panel Location', description: 'Controls git panel position', category: 'Git', type: 'enum', options: ['sidebar-bottom', 'sidebar-top', 'panel'] },
  { key: 'git.panel.openOnStartup', label: 'Open on Startup', description: 'Open git panel on startup', category: 'Git', type: 'boolean' },
  { key: 'git.diffContextLines', label: 'Diff Context Lines', description: 'Number of context lines in diffs', category: 'Git', type: 'number', min: 0, max: 10 },

  // AI settings
  { key: 'ultra.ai.model', label: 'AI Model', description: 'AI model to use for chat', category: 'AI', type: 'string' },
  { key: 'ai.panel.defaultWidth', label: 'AI Panel Width', description: 'Default width of AI panel', category: 'AI', type: 'number', min: 40, max: 200 },
  { key: 'ai.panel.maxWidthPercent', label: 'AI Panel Max Width %', description: 'Maximum width as percentage of screen', category: 'AI', type: 'number', min: 20, max: 80 },
  { key: 'ai.panel.openOnStartup', label: 'Open on Startup', description: 'Open AI panel on startup', category: 'AI', type: 'boolean' },

  // Session settings
  { key: 'session.restoreOnStartup', label: 'Restore on Startup', description: 'Restore previous session on startup', category: 'Session', type: 'boolean' },
  { key: 'session.autoSave', label: 'Auto Save Session', description: 'Automatically save session state', category: 'Session', type: 'boolean' },
  { key: 'session.autoSaveInterval', label: 'Auto Save Interval', description: 'Session auto-save interval in milliseconds', category: 'Session', type: 'number', min: 5000, max: 300000 },
  { key: 'session.save.openFiles', label: 'Save Open Files', description: 'Save list of open files in session', category: 'Session', type: 'boolean' },
  { key: 'session.save.cursorPositions', label: 'Save Cursor Positions', description: 'Save cursor positions in session', category: 'Session', type: 'boolean' },
  { key: 'session.save.unsavedContent', label: 'Save Unsaved Content', description: 'Save unsaved file content in session', category: 'Session', type: 'boolean' },

  // Ultra-specific settings
  { key: 'ultra.sidebar.width', label: 'Sidebar Width', description: 'Width of the sidebar in characters', category: 'Ultra', type: 'number', min: 20, max: 60 },
];

/**
 * SettingsDialog - Searchable settings browser
 */
export class SettingsDialog extends SearchableDialog<SettingItem> {
  private _settingSelectCallbacks: Set<(item: SettingItem) => void> = new Set();

  constructor() {
    super();
    this._debugName = 'SettingsDialog';
  }

  /**
   * Show the settings dialog
   */
  show(config: SearchableDialogConfig): void {
    const items = this.buildSettingItems();

    this.showWithItems(
      {
        ...config,
        title: 'Settings',
        width: config.width || 80,
        height: config.height || 24
      },
      items,
      ''
    );

    this.debugLog(`Showing ${items.length} settings`);
  }

  /**
   * Build setting items from metadata and current values
   */
  private buildSettingItems(): SettingItem[] {
    return SETTINGS_META.map(meta => ({
      meta,
      value: settings.get(meta.key)
    }));
  }

  /**
   * Refresh items with current setting values
   * Call this after a setting has been changed to update the display
   */
  refreshItems(): void {
    // Rebuild items with fresh values
    const items = this.buildSettingItems();

    // Preserve current search/selection state
    const currentQuery = this._textInput.value;
    const currentIndex = this._selectedIndex;

    // Update items
    this._items = items;

    // Re-filter with current query
    if (currentQuery) {
      this._filteredItems = items
        .map(item => ({ item, score: this.scoreItem(item, currentQuery) }))
        .filter(si => si.score > 0)
        .sort((a, b) => b.score - a.score);
    } else {
      this._filteredItems = items.map(item => ({ item, score: 0 }));
    }

    // Restore selection if possible
    this._selectedIndex = Math.min(currentIndex, this._filteredItems.length - 1);
    if (this._selectedIndex < 0) this._selectedIndex = 0;

    this.debugLog('Items refreshed');
  }

  /**
   * Score a setting against the search query
   */
  protected scoreItem(item: SettingItem, query: string): number {
    const lowerQuery = query.toLowerCase();
    let bestScore = 0;

    // Match against label
    const label = item.meta.label.toLowerCase();
    if (label.includes(lowerQuery)) {
      bestScore = Math.max(bestScore, 100 + (50 - lowerQuery.length));
    }

    // Match against key
    const key = item.meta.key.toLowerCase();
    if (key.includes(lowerQuery)) {
      bestScore = Math.max(bestScore, 80);
    }

    // Match against description
    const desc = item.meta.description.toLowerCase();
    if (desc.includes(lowerQuery)) {
      bestScore = Math.max(bestScore, 60);
    }

    // Match against category
    const category = item.meta.category.toLowerCase();
    if (category.includes(lowerQuery)) {
      bestScore = Math.max(bestScore, 40);
    }

    // Fuzzy match on label
    const fuzzyScore = this.fuzzyScore(lowerQuery, label);
    if (fuzzyScore > 0) {
      bestScore = Math.max(bestScore, 30 + fuzzyScore);
    }

    // Word-initial matching on label
    const wordInitialScore = this.scoreWordInitials(item.meta.label, lowerQuery);
    if (wordInitialScore > 0) {
      bestScore = Math.max(bestScore, 70 + wordInitialScore);
    }

    return bestScore;
  }

  /**
   * Get display configuration for a setting item
   */
  protected getItemDisplay(item: SettingItem, isSelected: boolean): ItemDisplayConfig {
    return {
      text: item.meta.label,
      secondary: this.formatValue(item),
      icon: CATEGORY_ICONS[item.meta.category] || ''
    };
  }

  /**
   * Format the current value for display
   */
  private formatValue(item: SettingItem): string {
    const value = item.value;

    if (typeof value === 'boolean') {
      return value ? 'On' : 'Off';
    }
    if (typeof value === 'number') {
      return String(value);
    }
    if (typeof value === 'string') {
      // Truncate long strings
      if (value.length > 20) {
        return value.substring(0, 17) + '...';
      }
      return value;
    }
    if (typeof value === 'object') {
      return '{...}';
    }
    return String(value);
  }

  /**
   * Find item index by key
   */
  protected findItemIndex(id: string): number {
    return this._items.findIndex(item => item.meta.key === id);
  }

  /**
   * Handle item selection
   */
  protected async onItemSelected(item: SettingItem): Promise<void> {
    // Notify callbacks
    for (const callback of this._settingSelectCallbacks) {
      try {
        callback(item);
      } catch (e) {
        this.debugLog(`Setting select callback error: ${e}`);
      }
    }

    // Don't hide - let the callback decide (e.g., show edit dialog)
  }

  /**
   * Register callback for when a setting is selected
   */
  onSettingSelect(callback: (item: SettingItem) => void): () => void {
    this._settingSelectCallbacks.add(callback);
    return () => {
      this._settingSelectCallbacks.delete(callback);
    };
  }

  /**
   * Render the dialog
   */
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

    // Settings list
    this.renderSettings(ctx);
  }

  /**
   * Render settings list with custom layout
   */
  private renderSettings(ctx: RenderContext): void {
    const colors = this.getColors();
    const listStartY = this._rect.y + 3;
    const listHeight = this._rect.height - 4;
    const listWidth = this._rect.width - 2;

    if (this._filteredItems.length === 0) {
      const emptyMessage = this._textInput.value
        ? 'No matching settings'
        : 'Type to search settings';
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
        const item = scoredItem.item;
        const isSelected = itemIndex === this._selectedIndex;
        const y = listStartY + i;

        // Background
        const bgColor = isSelected ? colors.selectedBackground : colors.background;
        ctx.fill(this._rect.x + 1, y, listWidth, 1, ' ', undefined, bgColor);

        // Category icon
        const icon = CATEGORY_ICONS[item.meta.category] || '';
        ctx.drawStyled(this._rect.x + 2, y, icon, colors.hintForeground, bgColor);

        // Setting label
        const titleColor = isSelected ? colors.selectedForeground : colors.foreground;
        const valueStr = this.formatValue(item);
        const maxLabelLen = listWidth - valueStr.length - 8;
        const displayLabel = RenderUtils.truncateText(item.meta.label, maxLabelLen);
        ctx.drawStyled(this._rect.x + 5, y, displayLabel, titleColor, bgColor);

        // Current value (right-aligned)
        const valueColor = this.getValueColor(item, colors);
        const valueX = this._rect.x + listWidth - valueStr.length - 1;
        if (valueX > this._rect.x + 5 + displayLabel.length + 2) {
          ctx.drawStyled(valueX, y, valueStr, valueColor, bgColor);
        }
      }
    }

    // Footer
    const footerY = this._rect.y + this._rect.height - 1;
    const count = `${this._filteredItems.length} settings`;
    ctx.drawStyled(
      this._rect.x + this._rect.width - count.length - 2,
      footerY,
      count,
      colors.hintForeground,
      colors.background
    );
  }

  /**
   * Get color for value display based on type
   */
  private getValueColor(item: SettingItem, colors: any): string {
    if (item.meta.type === 'boolean') {
      return item.value ? colors.successForeground : colors.hintForeground;
    }
    return colors.hintForeground;
  }
}

export const settingsDialog = new SettingsDialog();
export default settingsDialog;
