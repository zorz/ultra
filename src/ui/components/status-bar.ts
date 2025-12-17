/**
 * Status Bar Component
 * 
 * Displays file info, cursor position, language, and encoding.
 */

import type { DocumentState } from '../../core/document.ts';
import type { Position } from '../../core/buffer.ts';
import type { RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import { themeLoader } from '../themes/theme-loader.ts';
import { hexToRgb } from '../colors.ts';

export interface StatusBarState {
  document: DocumentState | null;
  cursorPosition: Position;
  cursorCount: number;
  gitBranch?: string;
  mode?: string;  // For future vim modes etc.
  diagnostics?: {
    errors: number;
    warnings: number;
  };
  lspStatus?: 'starting' | 'ready' | 'error' | 'inactive';
}

export class StatusBar {
  private rect: Rect = { x: 1, y: 24, width: 80, height: 1 };
  private state: StatusBarState = {
    document: null,
    cursorPosition: { line: 0, column: 0 },
    cursorCount: 1
  };
  private message: string | null = null;
  private messageTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Set the status bar rect
   */
  setRect(rect: Rect): void {
    this.rect = rect;
  }

  /**
   * Update state
   */
  setState(state: Partial<StatusBarState>): void {
    this.state = { ...this.state, ...state };
  }

  /**
   * Set a temporary message to display
   */
  setMessage(message: string, duration: number = 3000): void {
    this.message = message;
    if (this.messageTimeout) {
      clearTimeout(this.messageTimeout);
    }
    this.messageTimeout = setTimeout(() => {
      this.message = null;
      this.messageTimeout = null;
    }, duration);
  }

  /**
   * Get current message (for copying to clipboard)
   */
  getMessage(): string | null {
    return this.message;
  }

  /**
   * Render the status bar
   */
  render(ctx: RenderContext): void {
    const { x, y, width } = this.rect;
    
    if (width <= 0) return;

    // ANSI helpers
    const bgRgb = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`;
    const fgRgb = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
    const reset = '\x1b[0m';
    const moveTo = (px: number, py: number) => `\x1b[${py};${px}H`;

    // Get theme colors
    const statusBg = this.hexToRgb(themeLoader.getColor('statusBar.background')) || { r: 41, g: 44, b: 60 };
    const statusFg = this.hexToRgb(themeLoader.getColor('statusBar.foreground')) || { r: 198, g: 208, b: 245 };
    const dimFg = { r: Math.floor(statusFg.r * 0.7), g: Math.floor(statusFg.g * 0.7), b: Math.floor(statusFg.b * 0.7) };
    const warningColor = { r: 231, g: 130, b: 132 }; // Catppuccin red for dirty indicator
    const accentColor = { r: 202, g: 158, b: 230 }; // Catppuccin mauve for branch

    // Build entire status bar as one string
    let output = moveTo(x, y) + bgRgb(statusBg.r, statusBg.g, statusBg.b) + ' '.repeat(width) + moveTo(x, y) + bgRgb(statusBg.r, statusBg.g, statusBg.b);

    // If there's a message, show it prominently
    if (this.message) {
      output += fgRgb(accentColor.r, accentColor.g, accentColor.b) + ' ' + this.message;
      output += reset;
      ctx.buffer(output);
      return;
    }

    // Left side
    if (this.state.document) {
      if (this.state.document.isDirty) {
        output += fgRgb(warningColor.r, warningColor.g, warningColor.b) + '● ';
      }
      output += fgRgb(statusFg.r, statusFg.g, statusFg.b) + this.state.document.fileName;
    } else {
      output += fgRgb(dimFg.r, dimFg.g, dimFg.b) + 'No file';
    }

    // Git branch (if available)
    if (this.state.gitBranch) {
      output += fgRgb(dimFg.r, dimFg.g, dimFg.b) + '  ' + fgRgb(accentColor.r, accentColor.g, accentColor.b) + '⎇ ' + this.state.gitBranch;
    }

    // Diagnostics (errors/warnings)
    if (this.state.diagnostics) {
      const { errors, warnings } = this.state.diagnostics;
      if (errors > 0 || warnings > 0) {
        output += fgRgb(dimFg.r, dimFg.g, dimFg.b) + '  ';
        if (errors > 0) {
          output += fgRgb(warningColor.r, warningColor.g, warningColor.b) + `● ${errors}`;
        }
        if (warnings > 0) {
          const warningYellow = { r: 239, g: 159, b: 118 };  // Orange for warnings
          if (errors > 0) output += ' ';
          output += fgRgb(warningYellow.r, warningYellow.g, warningYellow.b) + `▲ ${warnings}`;
        }
      }
    }

    // Build right side content
    const rightParts: string[] = [];

    // Cursor position
    const line = this.state.cursorPosition.line + 1;
    const col = this.state.cursorPosition.column + 1;
    rightParts.push(`Ln ${line}, Col ${col}`);

    // Multi-cursor indicator
    if (this.state.cursorCount > 1) {
      rightParts.push(`${this.state.cursorCount} cursors`);
    }

    // Language
    if (this.state.document) {
      rightParts.push(this.formatLanguage(this.state.document.language));
    }

    // LSP status
    if (this.state.lspStatus && this.state.lspStatus !== 'inactive') {
      const lspIcon = this.state.lspStatus === 'ready' ? '◉' : 
                      this.state.lspStatus === 'starting' ? '○' : '✗';
      rightParts.push(`LSP ${lspIcon}`);
    }

    // Encoding
    if (this.state.document) {
      rightParts.push(this.state.document.encoding.toUpperCase());
    }

    // Line ending
    if (this.state.document) {
      rightParts.push(this.state.document.lineEnding.toUpperCase());
    }

    const right = rightParts.join('  │  ');
    
    // Position and render right side
    const rightX = x + width - right.length - 1;
    if (rightX > x) {
      output += moveTo(rightX, y) + bgRgb(statusBg.r, statusBg.g, statusBg.b) + fgRgb(dimFg.r, dimFg.g, dimFg.b) + right;
    }
    
    output += reset;
    ctx.buffer(output);
  }

  /**
   * Format language name for display
   */
  private formatLanguage(language: string): string {
    const languageNames: Record<string, string> = {
      'typescript': 'TypeScript',
      'typescriptreact': 'TypeScript React',
      'javascript': 'JavaScript',
      'javascriptreact': 'JavaScript React',
      'json': 'JSON',
      'markdown': 'Markdown',
      'python': 'Python',
      'ruby': 'Ruby',
      'rust': 'Rust',
      'go': 'Go',
      'c': 'C',
      'cpp': 'C++',
      'java': 'Java',
      'html': 'HTML',
      'css': 'CSS',
      'scss': 'SCSS',
      'yaml': 'YAML',
      'toml': 'TOML',
      'shellscript': 'Shell',
      'plaintext': 'Plain Text'
    };

    return languageNames[language] || language;
  }
}

export const statusBar = new StatusBar();

export default statusBar;
