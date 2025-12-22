/**
 * Inline Diff Widget
 *
 * Displays a git diff inline within the editor at a specific line.
 * Used to show changes when clicking on git gutter indicators.
 *
 * Features:
 * - Shows diff header with file name and line number
 * - Renders added/deleted/context lines with appropriate highlighting
 * - Provides Stage, Revert, and Close actions
 * - Supports scrolling within the diff widget
 * - Keyboard navigation (j/k to scroll, s to stage, r to revert, c/Esc to close)
 */

import type { RenderContext } from '../../renderer.ts';
import { themeLoader } from '../../themes/theme-loader.ts';
import { hexToRgb, blendColors } from '../../colors.ts';

/**
 * State for an inline diff widget
 */
export interface InlineDiffState {
  /** Whether the diff widget is visible */
  visible: boolean;
  /** Line at which to show diff (0-based) */
  line: number;
  /** Parsed diff lines */
  diffLines: string[];
  /** Scroll position within diff widget */
  scrollTop: number;
  /** Height of widget in lines */
  height: number;
  /** File being diffed */
  filePath: string;
}

/**
 * Create empty inline diff state
 */
export function createInlineDiffState(): InlineDiffState {
  return {
    visible: false,
    line: 0,
    diffLines: [],
    scrollTop: 0,
    height: 10,
    filePath: '',
  };
}

/**
 * Inline diff action callbacks
 */
export interface InlineDiffCallbacks {
  onStage?: (filePath: string, line: number) => Promise<void>;
  onRevert?: (filePath: string, line: number) => Promise<void>;
  onClose?: () => void;
}

/**
 * Theme colors for inline diff
 */
interface InlineDiffTheme {
  background: string;
  borderColor: string;
  foreground: string;
  headerBackground: string;
  addedBackground: string;
  addedForeground: string;
  deletedBackground: string;
  deletedForeground: string;
  hunkHeaderForeground: string;
  descriptionForeground: string;
}

/**
 * Get theme colors for inline diff widget
 */
function getInlineDiffTheme(): InlineDiffTheme | null {
  const theme = themeLoader.getCurrentTheme();
  if (!theme) return null;

  const colors = theme.colors;
  const bgColor = colors['editor.background'] || '#1e1e1e';
  const addedGutterColor = colors['editorGutter.addedBackground'] || '#a6e3a1';
  const deletedGutterColor = colors['editorGutter.deletedBackground'] || '#f38ba8';

  return {
    background: bgColor,
    borderColor: colors['editorWidget.border'] || '#454545',
    foreground: colors['editor.foreground'] || '#d4d4d4',
    headerBackground: colors['editorWidget.background'] || '#252526',
    addedBackground: blendColors(bgColor, addedGutterColor, 0.15),
    addedForeground: colors['gitDecoration.addedResourceForeground'] || addedGutterColor,
    deletedBackground: blendColors(bgColor, deletedGutterColor, 0.15),
    deletedForeground: colors['gitDecoration.deletedResourceForeground'] || deletedGutterColor,
    hunkHeaderForeground: colors['textPreformat.foreground'] || '#d7ba7d',
    descriptionForeground: colors['descriptionForeground'] || '#858585',
  };
}

/**
 * Inline Diff Widget renderer
 */
export class InlineDiffWidget {
  private theme: InlineDiffTheme | null = null;

  /**
   * Update theme colors
   */
  updateTheme(): void {
    this.theme = getInlineDiffTheme();
  }

  /**
   * Render the inline diff widget
   */
  render(
    ctx: RenderContext,
    state: InlineDiffState,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    if (!state.visible || !this.theme) {
      this.updateTheme();
    }
    if (!this.theme) return;

    const theme = this.theme;

    // Draw header with title and buttons
    const fileName = state.filePath.split('/').pop() || 'diff';
    const headerText = ` ${fileName} - Line ${state.line + 1} `;
    const buttons = ' 󰐕 Stage  󰜺 Revert  󰅖 Close ';

    // Header background
    ctx.drawStyled(x, y, ' '.repeat(width), theme.foreground, theme.headerBackground);
    ctx.drawStyled(x, y, headerText, theme.foreground, theme.headerBackground);
    ctx.drawStyled(x + width - buttons.length - 1, y, buttons, theme.foreground, theme.headerBackground);

    // Draw content area
    const contentHeight = height - 2;  // Minus header and footer
    this.renderDiffContent(ctx, state, theme, x, y + 1, width, contentHeight);

    // Draw footer with keybindings
    const footerText = ' s:stage  r:revert  c/Esc:close  j/k:scroll ';
    const footerY = y + height - 1;
    ctx.drawStyled(x, footerY, ' '.repeat(width), theme.foreground, theme.headerBackground);
    const footerX = x + Math.floor((width - footerText.length) / 2);
    ctx.drawStyled(footerX, footerY, footerText, theme.descriptionForeground, theme.headerBackground);

    // Draw border corners
    ctx.drawStyled(x, y, '┌', theme.borderColor, theme.headerBackground);
    ctx.drawStyled(x, footerY, '└', theme.borderColor, theme.headerBackground);
  }

  /**
   * Render the diff content lines
   */
  private renderDiffContent(
    ctx: RenderContext,
    state: InlineDiffState,
    theme: InlineDiffTheme,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    const lines = state.diffLines;

    for (let i = 0; i < height; i++) {
      const lineIdx = state.scrollTop + i;
      const screenY = y + i;

      if (lineIdx < lines.length) {
        const line = lines[lineIdx] || '';
        const { bg, fg, prefix } = this.getLineStyle(line, theme);
        const displayLine = (prefix + line.substring(1)).substring(0, width - 2).padEnd(width - 2);

        // Optimize: draw border and content
        if (bg === theme.background) {
          // Border and content have same background - combine into one call
          ctx.drawStyled(x, screenY, '│' + displayLine, fg, bg);
        } else {
          // Different backgrounds - need separate calls
          ctx.drawStyled(x, screenY, '│', theme.borderColor, theme.background);
          ctx.drawStyled(x + 1, screenY, displayLine, fg, bg);
        }
      } else {
        ctx.drawStyled(x, screenY, '│' + ' '.repeat(width - 1), theme.borderColor, theme.background);
      }
    }
  }

  /**
   * Get style for a diff line based on its prefix
   */
  private getLineStyle(
    line: string,
    theme: InlineDiffTheme
  ): { bg: string; fg: string; prefix: string } {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return {
        bg: theme.addedBackground,
        fg: theme.addedForeground,
        prefix: '+',
      };
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      return {
        bg: theme.deletedBackground,
        fg: theme.deletedForeground,
        prefix: '-',
      };
    }

    if (line.startsWith('@@')) {
      return {
        bg: theme.background,
        fg: theme.hunkHeaderForeground,
        prefix: ' ',
      };
    }

    return {
      bg: theme.background,
      fg: theme.foreground,
      prefix: ' ',
    };
  }

  /**
   * Handle key input for the inline diff widget
   *
   * @returns true if key was handled, false otherwise
   */
  handleKey(
    key: string,
    state: InlineDiffState,
    callbacks: InlineDiffCallbacks
  ): boolean {
    if (!state.visible) return false;

    switch (key) {
      case 'j':
        // Scroll down
        const maxScrollDown = Math.max(0, state.diffLines.length - (state.height - 2));
        if (state.scrollTop < maxScrollDown) {
          state.scrollTop++;
        }
        return true;

      case 'k':
        // Scroll up
        if (state.scrollTop > 0) {
          state.scrollTop--;
        }
        return true;

      case 's':
        // Stage
        if (callbacks.onStage) {
          callbacks.onStage(state.filePath, state.line);
        }
        return true;

      case 'r':
        // Revert
        if (callbacks.onRevert) {
          callbacks.onRevert(state.filePath, state.line);
        }
        return true;

      case 'c':
      case 'Escape':
        // Close
        state.visible = false;
        if (callbacks.onClose) {
          callbacks.onClose();
        }
        return true;

      default:
        return false;
    }
  }

  /**
   * Check if a click is within the inline diff widget
   */
  containsPoint(
    clickX: number,
    clickY: number,
    state: InlineDiffState,
    widgetX: number,
    widgetY: number,
    width: number,
    height: number
  ): boolean {
    if (!state.visible) return false;

    return (
      clickX >= widgetX &&
      clickX < widgetX + width &&
      clickY >= widgetY &&
      clickY < widgetY + height
    );
  }

  /**
   * Handle mouse click on the inline diff widget
   *
   * @returns true if click was handled
   */
  handleClick(
    clickX: number,
    clickY: number,
    state: InlineDiffState,
    widgetX: number,
    widgetY: number,
    width: number,
    height: number,
    callbacks: InlineDiffCallbacks
  ): boolean {
    if (!this.containsPoint(clickX, clickY, state, widgetX, widgetY, width, height)) {
      return false;
    }

    // Check header row for button clicks
    if (clickY === widgetY) {
      const relativeX = clickX - widgetX;
      const buttons = ' 󰐕 Stage  󰜺 Revert  󰅖 Close ';
      const buttonsStart = width - buttons.length - 1;

      if (relativeX >= buttonsStart) {
        const buttonX = relativeX - buttonsStart;
        // Approximate button positions within the buttons string
        // " 󰐕 Stage  󰜺 Revert  󰅖 Close "
        if (buttonX >= 1 && buttonX <= 10) {
          // Stage button
          if (callbacks.onStage) {
            callbacks.onStage(state.filePath, state.line);
          }
          return true;
        } else if (buttonX >= 11 && buttonX <= 22) {
          // Revert button
          if (callbacks.onRevert) {
            callbacks.onRevert(state.filePath, state.line);
          }
          return true;
        } else if (buttonX >= 23) {
          // Close button
          state.visible = false;
          if (callbacks.onClose) {
            callbacks.onClose();
          }
          return true;
        }
      }
    }

    return true; // Consume click even if no button hit
  }

  /**
   * Show the inline diff widget with the given content
   */
  show(
    state: InlineDiffState,
    line: number,
    filePath: string,
    diffContent: string
  ): void {
    state.visible = true;
    state.line = line;
    state.filePath = filePath;
    state.diffLines = diffContent.split('\n');
    state.scrollTop = 0;
  }

  /**
   * Hide the inline diff widget
   */
  hide(state: InlineDiffState): void {
    state.visible = false;
    state.diffLines = [];
    state.scrollTop = 0;
  }
}

/**
 * Shared inline diff widget instance
 */
export const inlineDiffWidget = new InlineDiffWidget();

export default InlineDiffWidget;
