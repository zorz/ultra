/**
 * Theme Loader
 *
 * Loads and parses VS Code compatible theme JSON files.
 */

import { hexToRgb as sharedHexToRgb } from '../colors.ts';

export interface ThemeColors {
  'editor.background': string;
  'editor.foreground': string;
  'editor.lineHighlightBackground': string;
  'editor.selectionBackground': string;
  'editorCursor.foreground': string;
  'editorLineNumber.foreground': string;
  'editorLineNumber.activeForeground': string;
  'editorGutter.background': string;
  'editorGutter.addedBackground': string;
  'editorGutter.modifiedBackground': string;
  'editorGutter.deletedBackground': string;
  'statusBar.background': string;
  'statusBar.foreground': string;
  'tab.activeBackground': string;
  'tab.activeForeground': string;
  'tab.inactiveBackground': string;
  'tab.inactiveForeground': string;
  'tab.border': string;
  'sideBar.background': string;
  'sideBar.foreground': string;
  'sideBarTitle.foreground': string;
  'list.activeSelectionBackground': string;
  'list.activeSelectionForeground': string;
  'list.hoverBackground': string;
  'terminal.background': string;
  'terminal.foreground': string;
  'input.background': string;
  'input.foreground': string;
  'input.border': string;
  'focusBorder': string;
  'foreground': string;
  [key: string]: string;
}

export interface TokenColorSettings {
  foreground?: string;
  background?: string;
  fontStyle?: string;
}

export interface TokenColor {
  name?: string;
  scope: string | string[];
  settings: TokenColorSettings;
}

export interface Theme {
  name: string;
  type: 'dark' | 'light';
  colors: ThemeColors;
  tokenColors: TokenColor[];
}

const defaultColors: ThemeColors = {
  'editor.background': '#1e1e1e',
  'editor.foreground': '#d4d4d4',
  'editor.lineHighlightBackground': '#2a2d2e',
  'editor.selectionBackground': '#264f78',
  'editor.findMatchBackground': '#515c6a',
  'editor.findMatchHighlightBackground': '#ea5c00',
  'editorBracketMatch.background': '#2a2d2e',
  'editorCursor.foreground': '#aeafad',
  'editorLineNumber.foreground': '#858585',
  'editorLineNumber.activeForeground': '#c6c6c6',
  'editorGutter.background': '#1e1e1e',
  'editorGutter.addedBackground': '#587c0c',
  'editorGutter.modifiedBackground': '#0c7d9d',
  'editorGutter.deletedBackground': '#94151b',
  'statusBar.background': '#007acc',
  'statusBar.foreground': '#ffffff',
  'tab.activeBackground': '#1e1e1e',
  'tab.activeForeground': '#ffffff',
  'tab.inactiveBackground': '#2d2d2d',
  'tab.inactiveForeground': '#ffffff80',
  'tab.border': '#252526',
  'sideBar.background': '#252526',
  'sideBar.foreground': '#cccccc',
  'sideBarTitle.foreground': '#bbbbbb',
  'list.activeSelectionBackground': '#094771',
  'list.activeSelectionForeground': '#ffffff',
  'list.hoverBackground': '#2a2d2e',
  'terminal.background': '#1e1e1e',
  'terminal.foreground': '#cccccc',
  'input.background': '#3c3c3c',
  'input.foreground': '#cccccc',
  'input.border': '#3c3c3c',
  'focusBorder': '#007fd4',
  'foreground': '#cccccc'
};

export class ThemeLoader {
  private currentTheme: Theme | null = null;
  private scopeColorCache: Map<string, TokenColorSettings> = new Map();

  /**
   * Load theme from file
   */
  async loadFromFile(filePath: string): Promise<Theme | null> {
    try {
      const file = Bun.file(filePath);
      const content = await file.text();
      return this.parse(content);
    } catch (error) {
      console.error(`Failed to load theme from ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Parse theme JSON
   */
  parse(content: string): Theme | null {
    try {
      // Remove comments
      const cleanContent = content
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');

      const raw = JSON.parse(cleanContent);
      
      const theme: Theme = {
        name: raw.name || 'Unknown',
        type: raw.type || 'dark',
        colors: { ...defaultColors, ...raw.colors },
        tokenColors: raw.tokenColors || []
      };

      this.currentTheme = theme;
      this.buildScopeCache();
      
      return theme;
    } catch (error) {
      console.error('Failed to parse theme:', error);
      return null;
    }
  }

  /**
   * Get current theme
   */
  getCurrentTheme(): Theme | null {
    return this.currentTheme;
  }

  /**
   * Get color for a theme key
   */
  getColor(key: keyof ThemeColors): string {
    if (this.currentTheme) {
      return this.currentTheme.colors[key] || defaultColors[key] || '#ffffff';
    }
    return defaultColors[key] || '#ffffff';
  }

  /**
   * Check if current theme is dark
   */
  isThemeDark(): boolean {
    return this.currentTheme?.type === 'dark';
  }

  /**
   * Adjust brightness of a color (hex format)
   * @param color - hex color string (e.g., '#252526')
   * @param amount - positive to lighten, negative to darken (0-100)
   */
  adjustBrightness(color: string, amount: number): string {
    // Parse hex color
    const hex = color.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Adjust brightness
    const adjust = (val: number) => {
      const adjusted = val + (amount * 2.55); // Convert percentage to 0-255 scale
      return Math.max(0, Math.min(255, Math.round(adjusted)));
    };

    const newR = adjust(r);
    const newG = adjust(g);
    const newB = adjust(b);

    // Convert back to hex
    const toHex = (val: number) => val.toString(16).padStart(2, '0');
    return `#${toHex(newR)}${toHex(newG)}${toHex(newB)}`;
  }

  /**
   * Get a focused version of a background color.
   * Makes it slightly lighter for dark themes, slightly darker for light themes.
   * The adjustment is intentionally subtle (3%) to avoid overwhelming the UI.
   */
  getFocusedBackground(baseColor: string): string {
    const isDark = this.isThemeDark();
    const adjustAmount = isDark ? 3 : -3; // Subtle 3% brightness adjustment
    return this.adjustBrightness(baseColor, adjustAmount);
  }

  /**
   * Get token color for a scope
   */
  getTokenColor(scope: string): TokenColorSettings {
    // Check cache first
    const cached = this.scopeColorCache.get(scope);
    if (cached) return cached;

    // Find matching token color
    if (this.currentTheme) {
      for (const tokenColor of this.currentTheme.tokenColors) {
        const scopes = Array.isArray(tokenColor.scope) 
          ? tokenColor.scope 
          : [tokenColor.scope];
        
        for (const s of scopes) {
          if (this.scopeMatches(scope, s)) {
            this.scopeColorCache.set(scope, tokenColor.settings);
            return tokenColor.settings;
          }
        }
      }
    }

    return {};
  }

  /**
   * Check if a scope matches a scope selector
   */
  private scopeMatches(scope: string, selector: string): boolean {
    // Simple scope matching
    if (scope === selector) return true;
    if (scope.startsWith(selector + '.')) return true;
    
    // Handle comma-separated selectors
    const selectors = selector.split(',').map(s => s.trim());
    return selectors.some(s => scope === s || scope.startsWith(s + '.'));
  }

  /**
   * Build scope color cache
   */
  private buildScopeCache(): void {
    this.scopeColorCache.clear();
  }

  /**
   * Convert hex color to terminal-kit color256 index
   */
  hexToColor256(hex: string): number {
    // Remove # if present
    hex = hex.replace('#', '');
    
    // Parse RGB
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    // Convert to 6x6x6 color cube (indices 16-231)
    const r6 = Math.round(r / 255 * 5);
    const g6 = Math.round(g / 255 * 5);
    const b6 = Math.round(b / 255 * 5);
    
    return 16 + 36 * r6 + 6 * g6 + b6;
  }

  /**
   * Convert hex color to RGB
   * @deprecated Use hexToRgb from '../colors.ts' directly
   */
  hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    return sharedHexToRgb(hex);
  }
}

export const themeLoader = new ThemeLoader();

export default themeLoader;
