/**
 * Theme Loader
 *
 * Fetches the current theme from the ECP server and applies it as CSS variables.
 */

import { ecpClient } from '../ecp/client';
import { themeStore } from '../stores/theme';

export interface ThemeColor {
  [key: string]: string;
}

export interface TokenColor {
  name?: string;
  scope: string | string[];
  settings: {
    foreground?: string;
    background?: string;
    fontStyle?: string;
  };
}

export interface Theme {
  name: string;
  type: 'dark' | 'light';
  colors: ThemeColor;
  tokenColors?: TokenColor[];
}

// Map Ultra theme color keys to CSS variable names
const colorMappings: Record<string, string> = {
  // Editor
  'editor.background': '--editor-bg',
  'editor.foreground': '--editor-fg',
  'editor.lineHighlightBackground': '--editor-line-highlight',
  'editor.selectionBackground': '--editor-selection',
  'editorCursor.foreground': '--editor-cursor',
  'editorLineNumber.foreground': '--line-number',
  'editorLineNumber.activeForeground': '--line-number-active',

  // Sidebar
  'sideBar.background': '--sidebar-bg',
  'sideBar.foreground': '--sidebar-fg',
  'sideBarTitle.foreground': '--sidebar-title',
  'sideBarSectionHeader.background': '--sidebar-header-bg',
  'sideBarSectionHeader.foreground': '--sidebar-header-fg',

  // Activity bar
  'activityBar.background': '--activity-bg',
  'activityBar.foreground': '--activity-fg',
  'activityBar.inactiveForeground': '--activity-inactive',
  'activityBarBadge.background': '--activity-badge-bg',
  'activityBarBadge.foreground': '--activity-badge-fg',

  // Tab bar
  'tab.activeBackground': '--tab-active-bg',
  'tab.activeForeground': '--tab-active-fg',
  'tab.inactiveBackground': '--tab-inactive-bg',
  'tab.inactiveForeground': '--tab-inactive-fg',
  'tab.border': '--tab-border',
  'editorGroupHeader.tabsBackground': '--tabs-container-bg',

  // Terminal
  'terminal.background': '--terminal-bg',
  'terminal.foreground': '--terminal-fg',
  'terminalCursor.foreground': '--terminal-cursor',
  'terminal.ansiBlack': '--ansi-black',
  'terminal.ansiRed': '--ansi-red',
  'terminal.ansiGreen': '--ansi-green',
  'terminal.ansiYellow': '--ansi-yellow',
  'terminal.ansiBlue': '--ansi-blue',
  'terminal.ansiMagenta': '--ansi-magenta',
  'terminal.ansiCyan': '--ansi-cyan',
  'terminal.ansiWhite': '--ansi-white',
  'terminal.ansiBrightBlack': '--ansi-bright-black',
  'terminal.ansiBrightRed': '--ansi-bright-red',
  'terminal.ansiBrightGreen': '--ansi-bright-green',
  'terminal.ansiBrightYellow': '--ansi-bright-yellow',
  'terminal.ansiBrightBlue': '--ansi-bright-blue',
  'terminal.ansiBrightMagenta': '--ansi-bright-magenta',
  'terminal.ansiBrightCyan': '--ansi-bright-cyan',
  'terminal.ansiBrightWhite': '--ansi-bright-white',

  // Status bar
  'statusBar.background': '--status-bg',
  'statusBar.foreground': '--status-fg',
  'statusBar.border': '--status-border',

  // Panel
  'panel.background': '--panel-bg',
  'panel.border': '--panel-border',
  'panelTitle.activeForeground': '--panel-title-active',
  'panelTitle.inactiveForeground': '--panel-title-inactive',
  'panelTitle.activeBorder': '--panel-title-border',

  // Input
  'input.background': '--input-bg',
  'input.foreground': '--input-fg',
  'input.border': '--input-border',
  'input.placeholderForeground': '--input-placeholder',

  // Lists
  'list.activeSelectionBackground': '--list-active-bg',
  'list.activeSelectionForeground': '--list-active-fg',
  'list.hoverBackground': '--list-hover-bg',
  'list.inactiveSelectionBackground': '--list-inactive-bg',

  // Buttons
  'button.background': '--button-bg',
  'button.foreground': '--button-fg',
  'button.hoverBackground': '--button-hover-bg',

  // Scrollbar
  'scrollbarSlider.background': '--scrollbar-bg',
  'scrollbarSlider.hoverBackground': '--scrollbar-hover-bg',
  'scrollbarSlider.activeBackground': '--scrollbar-active-bg',

  // Focus
  'focusBorder': '--focus-border',

  // Errors/warnings
  'errorForeground': '--error-fg',
  'editorError.foreground': '--editor-error',
  'editorWarning.foreground': '--editor-warning',
  'editorInfo.foreground': '--editor-info',

  // Git decorations
  'gitDecoration.addedResourceForeground': '--git-added',
  'gitDecoration.modifiedResourceForeground': '--git-modified',
  'gitDecoration.deletedResourceForeground': '--git-deleted',
  'gitDecoration.untrackedResourceForeground': '--git-untracked',
  'gitDecoration.conflictingResourceForeground': '--git-conflict',
};

/**
 * Load the current theme from the ECP server.
 */
export async function loadTheme(): Promise<Theme> {
  const result = await ecpClient.request<{ theme: Theme }>('theme/current', {});
  const theme = result.theme;

  applyTheme(theme);
  themeStore.set(theme);

  return theme;
}

/**
 * Apply a theme to the document.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;

  // Set theme type
  root.dataset.theme = theme.type;

  // Apply color mappings
  for (const [key, cssVar] of Object.entries(colorMappings)) {
    const value = theme.colors[key];
    if (value) {
      root.style.setProperty(cssVar, value);
    }
  }

  // Set any additional colors that might not be mapped
  for (const [key, value] of Object.entries(theme.colors)) {
    if (!colorMappings[key]) {
      // Convert key to CSS variable name (e.g., "editor.background" -> "--theme-editor-background")
      const cssVar = `--theme-${key.replace(/\./g, '-')}`;
      root.style.setProperty(cssVar, value);
    }
  }
}

/**
 * Convert theme to Monaco editor theme.
 */
export function toMonacoTheme(theme: Theme): unknown {
  const base = theme.type === 'dark' ? 'vs-dark' : 'vs';

  // Convert token colors to Monaco rules
  const rules: Array<{ token: string; foreground?: string; fontStyle?: string }> = [];

  if (theme.tokenColors) {
    for (const token of theme.tokenColors) {
      const scopes = Array.isArray(token.scope) ? token.scope : [token.scope];

      for (const scope of scopes) {
        const rule: { token: string; foreground?: string; fontStyle?: string } = {
          token: scope,
        };

        if (token.settings.foreground) {
          // Monaco expects colors without #
          rule.foreground = token.settings.foreground.replace('#', '');
        }

        if (token.settings.fontStyle) {
          rule.fontStyle = token.settings.fontStyle;
        }

        rules.push(rule);
      }
    }
  }

  // Convert colors to Monaco format
  const colors: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme.colors)) {
    colors[key] = value;
  }

  return {
    base,
    inherit: true,
    rules,
    colors,
  };
}

/**
 * Convert theme to xterm.js theme.
 */
export function toXtermTheme(theme: Theme): unknown {
  return {
    background: theme.colors['terminal.background'] || theme.colors['editor.background'],
    foreground: theme.colors['terminal.foreground'] || theme.colors['editor.foreground'],
    cursor: theme.colors['terminalCursor.foreground'],
    cursorAccent: theme.colors['terminal.background'],
    selectionBackground: theme.colors['terminal.selectionBackground'] || theme.colors['editor.selectionBackground'],

    // ANSI colors
    black: theme.colors['terminal.ansiBlack'],
    red: theme.colors['terminal.ansiRed'],
    green: theme.colors['terminal.ansiGreen'],
    yellow: theme.colors['terminal.ansiYellow'],
    blue: theme.colors['terminal.ansiBlue'],
    magenta: theme.colors['terminal.ansiMagenta'],
    cyan: theme.colors['terminal.ansiCyan'],
    white: theme.colors['terminal.ansiWhite'],
    brightBlack: theme.colors['terminal.ansiBrightBlack'],
    brightRed: theme.colors['terminal.ansiBrightRed'],
    brightGreen: theme.colors['terminal.ansiBrightGreen'],
    brightYellow: theme.colors['terminal.ansiBrightYellow'],
    brightBlue: theme.colors['terminal.ansiBrightBlue'],
    brightMagenta: theme.colors['terminal.ansiBrightMagenta'],
    brightCyan: theme.colors['terminal.ansiBrightCyan'],
    brightWhite: theme.colors['terminal.ansiBrightWhite'],
  };
}
