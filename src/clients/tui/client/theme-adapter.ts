/**
 * Theme Adapter
 *
 * Connects the TUI client to the session service for theme management.
 * Provides centralized focus color management for consistent UI.
 */

import type { SessionService } from '../../../services/session/interface.ts';
import type { Theme, ThemeColors, ThemeInfo, Unsubscribe } from '../../../services/session/types.ts';
import { hexToRgb, rgbToHex, darken, lighten } from '../ansi/colors.ts';

// ============================================
// Types
// ============================================

/**
 * Theme change callback.
 */
export type ThemeChangeCallback = (theme: Theme) => void;

/**
 * Element type for focus color lookups.
 */
export type FocusableElementType = 'editor' | 'sidebar' | 'panel' | 'terminal';

/**
 * Focus colors for an element.
 */
export interface FocusColors {
  /** Background color when focused */
  focusedBackground: string;
  /** Background color when unfocused */
  unfocusedBackground: string;
  /** Foreground color when focused */
  focusedForeground: string;
  /** Foreground color when unfocused */
  unfocusedForeground: string;
  /** Selection background when focused */
  selectionBackground: string;
  /** Selection background when unfocused (dimmed) */
  inactiveSelectionBackground: string;
  /** Selection foreground */
  selectionForeground: string;
}

/**
 * Tab colors for a pane.
 */
export interface TabFocusColors {
  /** Tab bar background when pane is focused */
  focusedTabBarBackground: string;
  /** Tab bar background when pane is unfocused */
  unfocusedTabBarBackground: string;
  /** Active tab background when pane is focused */
  focusedActiveTabBackground: string;
  /** Active tab background when pane is unfocused */
  unfocusedActiveTabBackground: string;
  /** Active tab foreground when pane is focused */
  focusedActiveTabForeground: string;
  /** Active tab foreground when pane is unfocused */
  unfocusedActiveTabForeground: string;
  /** Inactive tab background */
  inactiveTabBackground: string;
  /** Inactive tab foreground */
  inactiveTabForeground: string;
  /** Tab border color */
  tabBorder: string;
  /** Active tab top border (accent) when focused */
  focusedActiveBorderTop: string;
  /** Active tab top border when unfocused */
  unfocusedActiveBorderTop: string;
}

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

  // ─────────────────────────────────────────────────────────────────────────
  // Focus Color Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get focus colors for an element type.
   * Provides consistent focused/unfocused colors across all UI elements.
   */
  getFocusColors(elementType: FocusableElementType): FocusColors {
    const baseColors = this.getBaseColors(elementType);

    // Compute focused background: slightly darker to indicate focus
    const focusedBg = this.computeFocusedBackground(baseColors.background);
    // Unfocused uses base background
    const unfocusedBg = baseColors.background;

    // Compute unfocused foreground: slightly dimmed
    const unfocusedFg = this.computeUnfocusedForeground(baseColors.foreground);

    // Selection colors
    const selectionBg = this.getColor('list.activeSelectionBackground', '#094771');
    const selectionFg = this.getColor('list.activeSelectionForeground', '#ffffff');
    // Inactive selection: lighter than focused bg but distinct
    const inactiveSelectionBg = this.computeInactiveSelectionBackground(baseColors.background);

    return {
      focusedBackground: focusedBg,
      unfocusedBackground: unfocusedBg,
      focusedForeground: baseColors.foreground,
      unfocusedForeground: unfocusedFg,
      selectionBackground: selectionBg,
      inactiveSelectionBackground: inactiveSelectionBg,
      selectionForeground: selectionFg,
    };
  }

  /**
   * Get tab colors for pane focus state.
   */
  getTabFocusColors(): TabFocusColors {
    const tabBarBg = this.getColor('editorGroupHeader.tabsBackground', '#252526');
    const activeTabBg = this.getColor('tab.activeBackground', '#1e1e1e');
    const activeTabFg = this.getColor('tab.activeForeground', '#ffffff');
    const inactiveTabBg = this.getColor('tab.inactiveBackground', '#2d2d2d');
    const inactiveTabFg = this.getColor('tab.inactiveForeground', '#ffffff80');
    const tabBorder = this.getColor('tab.border', '#252526');
    const activeBorderTop = this.getColor('tab.activeBorderTop', '#007acc');

    // Unfocused: dim the tab bar and active tab
    const unfocusedTabBarBg = this.computeUnfocusedBackground(tabBarBg);
    const unfocusedActiveTabBg = this.computeUnfocusedBackground(activeTabBg);
    const unfocusedActiveTabFg = this.computeUnfocusedForeground(activeTabFg);
    // Unfocused pane has no accent border
    const unfocusedBorderTop = tabBorder;

    return {
      focusedTabBarBackground: tabBarBg,
      unfocusedTabBarBackground: unfocusedTabBarBg,
      focusedActiveTabBackground: activeTabBg,
      unfocusedActiveTabBackground: unfocusedActiveTabBg,
      focusedActiveTabForeground: activeTabFg,
      unfocusedActiveTabForeground: unfocusedActiveTabFg,
      inactiveTabBackground: inactiveTabBg,
      inactiveTabForeground: inactiveTabFg,
      tabBorder,
      focusedActiveBorderTop: activeBorderTop,
      unfocusedActiveBorderTop: unfocusedBorderTop,
    };
  }

  /**
   * Convenience method to get the appropriate background for current focus state.
   */
  getBackgroundForFocus(elementType: FocusableElementType, isFocused: boolean): string {
    const colors = this.getFocusColors(elementType);
    return isFocused ? colors.focusedBackground : colors.unfocusedBackground;
  }

  /**
   * Convenience method to get the appropriate foreground for current focus state.
   */
  getForegroundForFocus(elementType: FocusableElementType, isFocused: boolean): string {
    const colors = this.getFocusColors(elementType);
    return isFocused ? colors.focusedForeground : colors.unfocusedForeground;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get base colors for an element type from theme.
   */
  private getBaseColors(elementType: FocusableElementType): { background: string; foreground: string } {
    switch (elementType) {
      case 'editor':
        return {
          background: this.getColor('editor.background', '#1e1e1e'),
          foreground: this.getColor('editor.foreground', '#d4d4d4'),
        };
      case 'sidebar':
        return {
          background: this.getColor('sideBar.background', '#252526'),
          foreground: this.getColor('sideBar.foreground', '#cccccc'),
        };
      case 'panel':
        return {
          background: this.getColor('panel.background', '#1e1e1e'),
          foreground: this.getColor('panel.foreground', '#cccccc'),
        };
      case 'terminal':
        return {
          background: this.getColor('terminal.background', '#1e1e1e'),
          foreground: this.getColor('terminal.foreground', '#cccccc'),
        };
    }
  }

  /**
   * Compute focused background: slightly darker to show focus.
   */
  private computeFocusedBackground(baseColor: string): string {
    const rgb = hexToRgb(baseColor);
    if (!rgb) return baseColor;
    // Darken by 8% for subtle but visible focus indication
    return rgbToHex(darken(rgb, 0.08));
  }

  /**
   * Compute unfocused background: slightly lighter/faded.
   */
  private computeUnfocusedBackground(baseColor: string): string {
    const rgb = hexToRgb(baseColor);
    if (!rgb) return baseColor;
    // Lighten by 3% for subtle unfocused state
    return rgbToHex(lighten(rgb, 0.03));
  }

  /**
   * Compute unfocused foreground: dimmed text.
   */
  private computeUnfocusedForeground(baseColor: string): string {
    const rgb = hexToRgb(baseColor);
    if (!rgb) return baseColor;
    // Darken foreground by 25% when unfocused
    return rgbToHex(darken(rgb, 0.25));
  }

  /**
   * Compute inactive selection background.
   */
  private computeInactiveSelectionBackground(baseBackground: string): string {
    const rgb = hexToRgb(baseBackground);
    if (!rgb) return baseBackground;
    // Lighten base by 15% for inactive selection
    return rgbToHex(lighten(rgb, 0.15));
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
