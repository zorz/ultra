/**
 * Status Bar Component
 * 
 * Displays file info, cursor position, language, and encoding.
 */

import type { DocumentState } from '../../core/document.ts';
import type { Position } from '../../core/buffer.ts';
import type { RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';

export interface StatusBarState {
  document: DocumentState | null;
  cursorPosition: Position;
  cursorCount: number;
  gitBranch?: string;
  mode?: string;  // For future vim modes etc.
}

export class StatusBar {
  private rect: Rect = { x: 1, y: 24, width: 80, height: 1 };
  private state: StatusBarState = {
    document: null,
    cursorPosition: { line: 0, column: 0 },
    cursorCount: 1
  };

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
   * Render the status bar
   */
  render(ctx: RenderContext): void {
    const { x, y, width } = this.rect;
    
    if (width <= 0) return;

    // ANSI helpers
    const bg = (n: number) => `\x1b[48;5;${n}m`;
    const fg = (n: number) => `\x1b[38;5;${n}m`;
    const reset = '\x1b[0m';
    const moveTo = (px: number, py: number) => `\x1b[${py};${px}H`;

    // Build entire status bar as one string
    let output = moveTo(x, y) + bg(236) + ' '.repeat(width) + moveTo(x, y) + bg(236);

    // Left side
    if (this.state.document) {
      if (this.state.document.isDirty) {
        output += fg(203) + '● ';
      }
      output += fg(252) + this.state.document.fileName;
    } else {
      output += fg(245) + 'No file';
    }

    // Git branch (if available)
    if (this.state.gitBranch) {
      output += fg(245) + '  ' + fg(141) + '⎇ ' + this.state.gitBranch;
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
      output += moveTo(rightX, y) + bg(236) + fg(245) + right;
    }
    
    output += reset;
    process.stdout.write(output);
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
