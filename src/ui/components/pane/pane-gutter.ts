/**
 * Pane Gutter Component
 *
 * Handles rendering of the editor gutter including:
 * - Git change indicators (added/modified/deleted)
 * - Line numbers
 * - Fold indicators
 *
 * Extracted from Pane to improve maintainability and testability.
 */

import { hexToRgb, type RGB } from '../../colors.ts';
import { themeLoader } from '../../themes/theme-loader.ts';
import type { FoldManager } from '../../../core/fold.ts';
import type { GitLineChange } from '../../../features/git/git-integration.ts';

/**
 * Theme colors for the gutter
 */
export interface GutterTheme {
  lineNumberForeground: string;
  lineNumberActiveForeground: string;
  gutterBackground: string;
}

/**
 * Get git indicator color from theme
 */
function getGitColor(type: 'added' | 'modified' | 'deleted'): RGB {
  const colorKeys: Record<string, string> = {
    added: 'editorGutter.addedBackground',
    modified: 'editorGutter.modifiedBackground',
    deleted: 'editorGutter.deletedBackground',
  };
  const themeColor = themeLoader.getColor(colorKeys[type] || '');
  const rgb = themeColor ? hexToRgb(themeColor) : null;
  // Derive fallback from editor foreground if theme color not available
  if (!rgb) {
    const fgColor = themeLoader.getColor('editor.foreground');
    const fgRgb = fgColor ? hexToRgb(fgColor) : { r: 171, g: 178, b: 191 };
    return fgRgb || { r: 171, g: 178, b: 191 };
  }
  return rgb;
}

/**
 * Git indicator characters
 */
const GIT_INDICATORS = {
  added: '│',     // Vertical bar (U+2502)
  modified: '│',  // Vertical bar (U+2502)
  deleted: '▼',   // Small triangle
} as const;

/**
 * Fold indicator characters
 */
const FOLD_INDICATORS = {
  folded: '▶',
  expanded: '▼',
} as const;

/**
 * Context for rendering a gutter line
 */
export interface GutterLineContext {
  /** Line number in buffer (0-based) */
  lineNum: number;
  /** Total line count in document */
  totalLines: number;
  /** Whether this is the current cursor line */
  isCurrentLine: boolean;
  /** Whether this is the first wrap of the line (for wrapped lines) */
  isFirstWrap: boolean;
  /** Git change type for this line, if any */
  gitChange?: GitLineChange['type'];
  /** Whether the line can be folded */
  canFold: boolean;
  /** Whether the line is currently folded */
  isFolded: boolean;
}

/**
 * Pane gutter renderer
 */
export class PaneGutter {
  private theme: GutterTheme;

  constructor() {
    this.theme = this.loadTheme();
  }

  /**
   * Update theme colors
   */
  updateTheme(): void {
    this.theme = this.loadTheme();
  }

  private loadTheme(): GutterTheme {
    return {
      lineNumberForeground: themeLoader.getColor('editorLineNumber.foreground') || '#495162',
      lineNumberActiveForeground: themeLoader.getColor('editorLineNumber.activeForeground') || '#abb2bf',
      gutterBackground: themeLoader.getColor('editorGutter.background') ||
                        themeLoader.getColor('editor.background') || '#282c34',
    };
  }

  /**
   * Calculate gutter width based on line count
   */
  calculateWidth(lineCount: number): number {
    const digits = Math.max(3, String(lineCount).length);
    return digits + 3;  // 1 git indicator + digits + fold indicator + space
  }

  /**
   * Render gutter for a single line
   *
   * @param ctx - Gutter line context
   * @returns ANSI escape sequence for the gutter
   */
  renderLine(ctx: GutterLineContext): string {
    const digits = Math.max(3, String(ctx.totalLines).length);
    const lineNumStr = ctx.isFirstWrap
      ? String(ctx.lineNum + 1).padStart(digits, ' ')
      : ' '.repeat(digits);

    const lnColor = ctx.isCurrentLine
      ? hexToRgb(this.theme.lineNumberActiveForeground)
      : hexToRgb(this.theme.lineNumberForeground);
    const gutterBg = hexToRgb(this.theme.gutterBackground);

    let output = '';

    // Apply gutter background
    if (gutterBg) {
      output += `\x1b[48;2;${gutterBg.r};${gutterBg.g};${gutterBg.b}m`;
    }

    // Git indicator (first column)
    output += this.renderGitIndicator(ctx.gitChange, ctx.isFirstWrap);

    // Line number
    if (lnColor) {
      output += `\x1b[38;2;${lnColor.r};${lnColor.g};${lnColor.b}m`;
    }
    output += lineNumStr;

    // Fold indicator
    output += this.renderFoldIndicator(ctx.canFold, ctx.isFolded, ctx.isFirstWrap);

    // Space and reset after gutter
    output += ' \x1b[0m';

    return output;
  }

  /**
   * Render git change indicator
   */
  private renderGitIndicator(
    gitChange: GitLineChange['type'] | undefined,
    isFirstWrap: boolean
  ): string {
    // Only show git indicator on first wrap of wrapped lines
    if (!isFirstWrap || !gitChange) {
      return ' ';
    }

    const color = getGitColor(gitChange);
    const indicator = GIT_INDICATORS[gitChange];

    return `\x1b[38;2;${color.r};${color.g};${color.b}m${indicator}`;
  }

  /**
   * Render fold indicator
   */
  private renderFoldIndicator(
    canFold: boolean,
    isFolded: boolean,
    isFirstWrap: boolean
  ): string {
    if (!isFirstWrap || !canFold) {
      return ' ';
    }

    // Use line number color for fold indicator to blend with theme
    const foldColor = themeLoader.getColor('editorLineNumber.foreground') ||
                      this.theme.lineNumberForeground || '#626880';
    const foldRgb = hexToRgb(foldColor);

    let output = '';
    if (foldRgb) {
      output += `\x1b[38;2;${foldRgb.r};${foldRgb.g};${foldRgb.b}m`;
    }

    output += isFolded ? FOLD_INDICATORS.folded : FOLD_INDICATORS.expanded;

    return output;
  }

  /**
   * Check if a click is within the gutter area
   */
  isInGutter(x: number, gutterWidth: number, editorX: number): boolean {
    return x >= editorX && x < editorX + gutterWidth;
  }

  /**
   * Check if a click is on the git indicator column
   */
  isOnGitIndicator(x: number, editorX: number): boolean {
    return x === editorX;
  }

  /**
   * Check if a click is on the fold indicator column
   */
  isOnFoldIndicator(x: number, editorX: number, lineCount: number): boolean {
    const digits = Math.max(3, String(lineCount).length);
    // Fold indicator is at position: editorX + 1 (git) + digits (line number)
    const foldX = editorX + 1 + digits;
    return x === foldX;
  }

  /**
   * Get the gutter column widths for layout calculations
   */
  getColumnWidths(lineCount: number): {
    gitIndicator: number;
    lineNumber: number;
    foldIndicator: number;
    padding: number;
    total: number;
  } {
    const digits = Math.max(3, String(lineCount).length);
    return {
      gitIndicator: 1,
      lineNumber: digits,
      foldIndicator: 1,
      padding: 1,
      total: digits + 3,
    };
  }
}

/**
 * Shared gutter instance for consistent theming
 */
export const paneGutter = new PaneGutter();

export default PaneGutter;
