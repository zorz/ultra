/**
 * Theme Adapter
 *
 * Connects the TUI client to the session service for theme management.
 */

import type { SessionService } from '../../../services/session/interface.ts';
import type { Theme, ThemeColors, ThemeInfo, Unsubscribe } from '../../../services/session/types.ts';

// ============================================
// Types
// ============================================

/**
 * Theme change callback.
 */
export type ThemeChangeCallback = (theme: Theme) => void;

/**
 * Default theme colors (Dark+)
 */
export const DEFAULT_THEME_COLORS: ThemeColors = {
  // Editor
  'editor.background': '#1e1e1e',
  'editor.foreground': '#d4d4d4',
  'editor.lineHighlightBackground': '#2a2d2e',
  'editor.selectionBackground': '#264f78',
  'editor.findMatchBackground': '#515c6a',
  'editor.findMatchHighlightBackground': '#314365',
  'editorCursor.foreground': '#aeafad',
  'editorLineNumber.foreground': '#858585',
  'editorLineNumber.activeForeground': '#c6c6c6',

  // Sidebar
  'sideBar.background': '#252526',
  'sideBar.foreground': '#cccccc',
  'sideBarSectionHeader.background': '#383838',
  'sideBarSectionHeader.foreground': '#cccccc',

  // Status bar
  'statusBar.background': '#007acc',
  'statusBar.foreground': '#ffffff',
  'statusBar.debuggingBackground': '#cc6633',
  'statusBar.noFolderBackground': '#68217a',

  // Panel
  'panel.background': '#1e1e1e',
  'panel.foreground': '#cccccc',
  'panel.border': '#80808059',

  // Terminal
  'terminal.background': '#1e1e1e',
  'terminal.foreground': '#cccccc',
  'terminal.ansiBlack': '#000000',
  'terminal.ansiRed': '#cd3131',
  'terminal.ansiGreen': '#0dbc79',
  'terminal.ansiYellow': '#e5e510',
  'terminal.ansiBlue': '#2472c8',
  'terminal.ansiMagenta': '#bc3fbc',
  'terminal.ansiCyan': '#11a8cd',
  'terminal.ansiWhite': '#e5e5e5',
  'terminal.ansiBrightBlack': '#666666',
  'terminal.ansiBrightRed': '#f14c4c',
  'terminal.ansiBrightGreen': '#23d18b',
  'terminal.ansiBrightYellow': '#f5f543',
  'terminal.ansiBrightBlue': '#3b8eea',
  'terminal.ansiBrightMagenta': '#d670d6',
  'terminal.ansiBrightCyan': '#29b8db',
  'terminal.ansiBrightWhite': '#e5e5e5',

  // Input
  'input.background': '#3c3c3c',
  'input.foreground': '#cccccc',
  'input.border': '#3c3c3c',
  'inputOption.activeBackground': '#007acc',
  'inputOption.activeForeground': '#ffffff',
  'focusBorder': '#007acc',

  // List
  'list.activeSelectionBackground': '#094771',
  'list.activeSelectionForeground': '#ffffff',
  'list.hoverBackground': '#2a2d2e',
  'list.focusBackground': '#094771',

  // Button
  'button.background': '#0e639c',
  'button.foreground': '#ffffff',
  'button.hoverBackground': '#1177bb',

  // Git decorations
  'gitDecoration.modifiedResourceForeground': '#e2c08d',
  'gitDecoration.addedResourceForeground': '#81b88b',
  'gitDecoration.deletedResourceForeground': '#c74e39',
  'gitDecoration.untrackedResourceForeground': '#73c991',
  'gitDecoration.conflictingResourceForeground': '#e4676b',
  'gitDecoration.stageModifiedResourceForeground': '#c4a000',
  'gitDecoration.stageDeletedResourceForeground': '#9b2335',

  // Diff colors
  'diffEditor.insertedTextBackground': '#9bb95533',
  'diffEditor.removedTextBackground': '#ff000033',

  // Errors and warnings
  'editorError.foreground': '#f48771',
  'editorWarning.foreground': '#cca700',
  'editorInfo.foreground': '#75beff',

  // Description / dim text
  'descriptionForeground': '#888888',

  // Scrollbar
  'scrollbar.shadow': '#000000',
  'scrollbarSlider.background': '#79797966',
  'scrollbarSlider.hoverBackground': '#646464b3',
  'scrollbarSlider.activeBackground': '#bfbfbf66',

  // Minimap
  'minimap.background': '#1e1e1e',
  'minimap.foregroundOpacity': '#000000c0',
  'minimap.selectionHighlight': '#264f78',

  // Tab bar
  'tab.activeBackground': '#1e1e1e',
  'tab.activeForeground': '#ffffff',
  'tab.inactiveBackground': '#2d2d2d',
  'tab.inactiveForeground': '#ffffff80',
  'tab.border': '#252526',
  'tab.activeBorderTop': '#007acc',

  // Title bar
  'titleBar.activeBackground': '#3c3c3c',
  'titleBar.activeForeground': '#cccccc',
  'titleBar.inactiveBackground': '#3c3c3c99',
  'titleBar.inactiveForeground': '#cccccc99',

  // Menu
  'menu.background': '#252526',
  'menu.foreground': '#cccccc',
  'menu.selectionBackground': '#094771',
  'menu.selectionForeground': '#ffffff',

  // Breadcrumb
  'breadcrumb.background': '#1e1e1e',
  'breadcrumb.foreground': '#cccccccc',
  'breadcrumb.focusForeground': '#e0e0e0',
  'breadcrumb.activeSelectionForeground': '#e0e0e0',

  // Keybinding
  'keybindingLabel.foreground': '#cccccc',
  'keybindingLabel.background': '#8080802b',
  'keybindingLabel.border': '#33333399',
};

/**
 * Default theme definition.
 */
export const DEFAULT_THEME: Theme = {
  id: 'dark-plus',
  name: 'Dark+ (Default)',
  type: 'dark',
  colors: DEFAULT_THEME_COLORS,
  tokenColors: [],
};

// ============================================
// Theme Adapter
// ============================================

export class ThemeAdapter {
  private sessionService: SessionService | null = null;
  private currentTheme: Theme = DEFAULT_THEME;
  private changeCallbacks: ThemeChangeCallback[] = [];
  private unsubscribe: Unsubscribe | null = null;

  /**
   * Connect to the session service.
   */
  connect(sessionService: SessionService): void {
    this.sessionService = sessionService;
    this.currentTheme = sessionService.getCurrentTheme();

    // Subscribe to theme changes
    this.unsubscribe = sessionService.onSettingChange((event) => {
      if (event.key === 'theme') {
        this.currentTheme = sessionService.getCurrentTheme();
        this.notifyChange();
      }
    });
  }

  /**
   * Disconnect from the session service.
   */
  disconnect(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.sessionService = null;
    this.currentTheme = DEFAULT_THEME;
  }

  /**
   * Get the current theme.
   */
  getCurrentTheme(): Theme {
    return this.currentTheme;
  }

  /**
   * Get a color from the current theme with fallback.
   */
  getColor(key: string, fallback?: string): string {
    return this.currentTheme.colors[key] ?? fallback ?? '#ffffff';
  }

  /**
   * List available themes.
   */
  listThemes(): ThemeInfo[] {
    if (!this.sessionService) {
      return [{ id: DEFAULT_THEME.id, name: DEFAULT_THEME.name, type: DEFAULT_THEME.type, builtin: true }];
    }
    return this.sessionService.listThemes();
  }

  /**
   * Set the current theme.
   */
  setTheme(themeId: string): boolean {
    if (!this.sessionService) return false;

    const theme = this.sessionService.getTheme(themeId);
    if (!theme) return false;

    this.sessionService.setTheme(themeId);
    return true;
  }

  /**
   * Subscribe to theme changes.
   */
  onThemeChange(callback: ThemeChangeCallback): Unsubscribe {
    this.changeCallbacks.push(callback);
    return () => {
      const index = this.changeCallbacks.indexOf(callback);
      if (index !== -1) {
        this.changeCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Notify all listeners of theme change.
   */
  private notifyChange(): void {
    for (const callback of this.changeCallbacks) {
      callback(this.currentTheme);
    }
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a theme adapter.
 */
export function createThemeAdapter(): ThemeAdapter {
  return new ThemeAdapter();
}
