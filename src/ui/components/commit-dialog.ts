/**
 * Commit Dialog Component
 *
 * Multi-line text input dialog for git commit messages.
 * Supports word wrapping and multiple lines.
 *
 * Controls:
 * - Enter: New line
 * - Ctrl+Enter: Commit
 * - Escape: Cancel
 */

import type { RenderContext } from '../renderer.ts';
import type { MouseEvent } from '../mouse.ts';
import type { KeyEvent } from '../../terminal/input.ts';
import { BaseDialog, type BaseDialogConfig } from './base-dialog.ts';
import { themeLoader } from '../themes/theme-loader.ts';
import { hexToRgb } from '../colors.ts';

/**
 * Configuration for CommitDialog
 */
export interface CommitDialogOptions {
  /** Initial commit message */
  initialMessage?: string;
  /** Custom width (default: 70) */
  width?: number;
  /** Number of visible lines (default: 5) */
  lines?: number;
}

/**
 * CommitDialog - Multi-line commit message input
 */
export class CommitDialog extends BaseDialog {
  // Text content as array of lines
  private _lines: string[] = [''];
  private _cursorLine: number = 0;
  private _cursorCol: number = 0;
  private _scrollTop: number = 0;
  private _visibleLines: number = 5;
  private _maxWidth: number = 66;  // Content width (width - borders - padding)

  // Callbacks
  private _confirmCallbacks: Set<(message: string) => void> = new Set();
  private _cancelCallbacks: Set<() => void> = new Set();

  constructor() {
    super();
    this._debugName = 'CommitDialog';
  }

  /**
   * Show the commit dialog
   */
  showDialog(config: BaseDialogConfig, options: CommitDialogOptions = {}): void {
    const width = options.width || 70;
    this._visibleLines = options.lines || 5;
    this._maxWidth = width - 4;  // -4 for borders and padding

    // Height: title + separator + visible lines + hint + border
    const height = this._visibleLines + 4;

    this.showBase({
      ...config,
      title: 'Commit Message',
      width,
      height
    });

    // Center vertically in upper third of screen
    this._rect.y = Math.floor(config.screenHeight / 4);

    // Initialize with message or empty
    if (options.initialMessage) {
      this._lines = this.wrapText(options.initialMessage);
    } else {
      this._lines = [''];
    }
    this._cursorLine = 0;
    this._cursorCol = 0;
    this._scrollTop = 0;

    this.debugLog('Showing commit dialog');
  }

  /**
   * Legacy show method for backwards compatibility
   */
  show(options: {
    screenWidth: number;
    screenHeight: number;
    width?: number;
    editorX?: number;
    editorWidth?: number;
    initialMessage?: string;
    onConfirm: (message: string) => void;
    onCancel?: () => void;
  }): void {
    this._confirmCallbacks.clear();
    this._cancelCallbacks.clear();

    this.showDialog(
      {
        screenWidth: options.screenWidth,
        screenHeight: options.screenHeight,
        editorX: options.editorX,
        editorWidth: options.editorWidth
      },
      {
        width: options.width,
        initialMessage: options.initialMessage
      }
    );

    this._confirmCallbacks.add(options.onConfirm);
    if (options.onCancel) {
      this._cancelCallbacks.add(options.onCancel);
    }
  }

  /**
   * Get the commit message as a single string
   */
  getMessage(): string {
    return this._lines.join('\n');
  }

  /**
   * Wrap text to fit within maxWidth
   */
  private wrapText(text: string): string[] {
    const result: string[] = [];
    const paragraphs = text.split('\n');

    for (const paragraph of paragraphs) {
      if (paragraph.length <= this._maxWidth) {
        result.push(paragraph);
      } else {
        // Word wrap
        let line = '';
        const words = paragraph.split(' ');

        for (const word of words) {
          if (line.length === 0) {
            line = word;
          } else if (line.length + 1 + word.length <= this._maxWidth) {
            line += ' ' + word;
          } else {
            result.push(line);
            line = word;
          }
        }
        if (line.length > 0) {
          result.push(line);
        }
      }
    }

    return result.length > 0 ? result : [''];
  }

  /**
   * Confirm and commit
   */
  confirm(): void {
    const message = this.getMessage().trim();

    if (message.length === 0) {
      this.debugLog('Confirm blocked: empty message');
      return;
    }

    this.debugLog(`Confirming with message: ${message.substring(0, 50)}...`);

    for (const callback of this._confirmCallbacks) {
      try {
        callback(message);
      } catch (e) {
        this.debugLog(`Confirm callback error: ${e}`);
      }
    }

    this.hide();
  }

  /**
   * Cancel the dialog
   */
  cancel(): void {
    this.debugLog('Cancelled');

    for (const callback of this._cancelCallbacks) {
      try {
        callback();
      } catch (e) {
        this.debugLog(`Cancel callback error: ${e}`);
      }
    }

    this.hide();
  }

  /**
   * Register confirm callback
   */
  onConfirm(callback: (message: string) => void): () => void {
    this._confirmCallbacks.add(callback);
    return () => { this._confirmCallbacks.delete(callback); };
  }

  /**
   * Register cancel callback
   */
  onCancel(callback: () => void): () => void {
    this._cancelCallbacks.add(callback);
    return () => { this._cancelCallbacks.delete(callback); };
  }

  /**
   * Handle keyboard input
   */
  override handleKey(event: KeyEvent): boolean {
    if (!this._isVisible) return false;

    const { key, ctrl, shift } = event;

    // Escape - cancel
    if (key === 'ESCAPE') {
      this.cancel();
      return true;
    }

    // Ctrl+Enter - confirm
    if (key === 'ENTER' && ctrl) {
      this.confirm();
      return true;
    }

    // Enter - new line
    if (key === 'ENTER') {
      this.insertNewLine();
      return true;
    }

    // Navigation
    if (key === 'UP') {
      this.moveCursorUp();
      return true;
    }
    if (key === 'DOWN') {
      this.moveCursorDown();
      return true;
    }
    if (key === 'LEFT') {
      if (ctrl) {
        this.moveWordLeft();
      } else {
        this.moveCursorLeft();
      }
      return true;
    }
    if (key === 'RIGHT') {
      if (ctrl) {
        this.moveWordRight();
      } else {
        this.moveCursorRight();
      }
      return true;
    }
    if (key === 'HOME') {
      this._cursorCol = 0;
      return true;
    }
    if (key === 'END') {
      this._cursorCol = this._lines[this._cursorLine]?.length || 0;
      return true;
    }

    // Deletion
    if (key === 'BACKSPACE') {
      this.backspace();
      return true;
    }
    if (key === 'DELETE') {
      this.deleteChar();
      return true;
    }

    // Character input
    const char = event.char;
    if (char && char.length === 1 && !ctrl && char.charCodeAt(0) >= 32) {
      this.insertChar(char);
      return true;
    }

    return false;
  }

  /**
   * Insert a character at cursor
   */
  private insertChar(char: string): void {
    const line = this._lines[this._cursorLine] || '';
    const newLine = line.slice(0, this._cursorCol) + char + line.slice(this._cursorCol);

    // Check if line needs wrapping
    if (newLine.length > this._maxWidth) {
      // Find word boundary for wrapping
      const wrapPoint = this.findWrapPoint(newLine);
      const beforeWrap = newLine.slice(0, wrapPoint);
      const afterWrap = newLine.slice(wrapPoint).trimStart();

      this._lines[this._cursorLine] = beforeWrap;

      // Insert overflow into next line or create new line
      if (this._cursorLine < this._lines.length - 1) {
        // Prepend to next line
        const nextLine = this._lines[this._cursorLine + 1] || '';
        this._lines[this._cursorLine + 1] = afterWrap + (afterWrap && nextLine ? ' ' : '') + nextLine;
      } else {
        // Create new line
        this._lines.splice(this._cursorLine + 1, 0, afterWrap);
      }

      // Update cursor position
      if (this._cursorCol >= wrapPoint) {
        this._cursorLine++;
        this._cursorCol = this._cursorCol - wrapPoint + (afterWrap.length - afterWrap.trimStart().length === 0 ? 0 : 0);
        // Recalculate cursor position in the wrapped text
        this._cursorCol = Math.min(this._cursorCol - wrapPoint + 1, afterWrap.length);
      } else {
        this._cursorCol++;
      }
    } else {
      this._lines[this._cursorLine] = newLine;
      this._cursorCol++;
    }

    this.ensureCursorVisible();
  }

  /**
   * Find the best point to wrap a line
   */
  private findWrapPoint(line: string): number {
    // Find last space before maxWidth
    for (let i = this._maxWidth; i > 0; i--) {
      if (line[i] === ' ') {
        return i;
      }
    }
    // No space found, hard wrap at maxWidth
    return this._maxWidth;
  }

  /**
   * Insert a new line at cursor
   */
  private insertNewLine(): void {
    const line = this._lines[this._cursorLine] || '';
    const before = line.slice(0, this._cursorCol);
    const after = line.slice(this._cursorCol);

    this._lines[this._cursorLine] = before;
    this._lines.splice(this._cursorLine + 1, 0, after);
    this._cursorLine++;
    this._cursorCol = 0;
    this.ensureCursorVisible();
  }

  /**
   * Delete character before cursor
   */
  private backspace(): void {
    if (this._cursorCol > 0) {
      const line = this._lines[this._cursorLine] || '';
      this._lines[this._cursorLine] = line.slice(0, this._cursorCol - 1) + line.slice(this._cursorCol);
      this._cursorCol--;
    } else if (this._cursorLine > 0) {
      // Join with previous line
      const prevLine = this._lines[this._cursorLine - 1] || '';
      const currentLine = this._lines[this._cursorLine] || '';
      this._cursorCol = prevLine.length;
      this._lines[this._cursorLine - 1] = prevLine + currentLine;
      this._lines.splice(this._cursorLine, 1);
      this._cursorLine--;
      this.ensureCursorVisible();
    }
  }

  /**
   * Delete character at cursor
   */
  private deleteChar(): void {
    const line = this._lines[this._cursorLine] || '';
    if (this._cursorCol < line.length) {
      this._lines[this._cursorLine] = line.slice(0, this._cursorCol) + line.slice(this._cursorCol + 1);
    } else if (this._cursorLine < this._lines.length - 1) {
      // Join with next line
      const nextLine = this._lines[this._cursorLine + 1] || '';
      this._lines[this._cursorLine] = line + nextLine;
      this._lines.splice(this._cursorLine + 1, 1);
    }
  }

  /**
   * Move cursor up
   */
  private moveCursorUp(): void {
    if (this._cursorLine > 0) {
      this._cursorLine--;
      this._cursorCol = Math.min(this._cursorCol, this._lines[this._cursorLine]?.length || 0);
      this.ensureCursorVisible();
    }
  }

  /**
   * Move cursor down
   */
  private moveCursorDown(): void {
    if (this._cursorLine < this._lines.length - 1) {
      this._cursorLine++;
      this._cursorCol = Math.min(this._cursorCol, this._lines[this._cursorLine]?.length || 0);
      this.ensureCursorVisible();
    }
  }

  /**
   * Move cursor left
   */
  private moveCursorLeft(): void {
    if (this._cursorCol > 0) {
      this._cursorCol--;
    } else if (this._cursorLine > 0) {
      this._cursorLine--;
      this._cursorCol = this._lines[this._cursorLine]?.length || 0;
      this.ensureCursorVisible();
    }
  }

  /**
   * Move cursor right
   */
  private moveCursorRight(): void {
    const lineLength = this._lines[this._cursorLine]?.length || 0;
    if (this._cursorCol < lineLength) {
      this._cursorCol++;
    } else if (this._cursorLine < this._lines.length - 1) {
      this._cursorLine++;
      this._cursorCol = 0;
      this.ensureCursorVisible();
    }
  }

  /**
   * Move cursor to previous word
   */
  private moveWordLeft(): void {
    const line = this._lines[this._cursorLine] || '';
    let pos = this._cursorCol - 1;

    // Skip whitespace
    while (pos > 0 && line[pos] === ' ') pos--;
    // Skip word characters
    while (pos > 0 && line[pos - 1] !== ' ') pos--;

    this._cursorCol = Math.max(0, pos);
  }

  /**
   * Move cursor to next word
   */
  private moveWordRight(): void {
    const line = this._lines[this._cursorLine] || '';
    let pos = this._cursorCol;

    // Skip word characters
    while (pos < line.length && line[pos] !== ' ') pos++;
    // Skip whitespace
    while (pos < line.length && line[pos] === ' ') pos++;

    this._cursorCol = pos;
  }

  /**
   * Ensure cursor line is visible
   */
  private ensureCursorVisible(): void {
    if (this._cursorLine < this._scrollTop) {
      this._scrollTop = this._cursorLine;
    } else if (this._cursorLine >= this._scrollTop + this._visibleLines) {
      this._scrollTop = this._cursorLine - this._visibleLines + 1;
    }
  }

  /**
   * Handle mouse events
   */
  onMouseEvent(event: MouseEvent): boolean {
    if (!this._isVisible) return false;

    if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED') {
      if (!this.containsPoint(event.x, event.y)) {
        this.cancel();
        return true;
      }

      // Calculate click position within text area
      const textX = event.x - this._rect.x - 2;
      const textY = event.y - this._rect.y - 2;

      if (textX >= 0 && textY >= 0 && textY < this._visibleLines) {
        const clickedLine = this._scrollTop + textY;
        if (clickedLine < this._lines.length) {
          this._cursorLine = clickedLine;
          this._cursorCol = Math.min(textX, this._lines[clickedLine]?.length || 0);
        }
      }
    }

    if (event.name === 'MOUSE_WHEEL_UP') {
      this._scrollTop = Math.max(0, this._scrollTop - 1);
      return true;
    }

    if (event.name === 'MOUSE_WHEEL_DOWN') {
      this._scrollTop = Math.min(Math.max(0, this._lines.length - this._visibleLines), this._scrollTop + 1);
      return true;
    }

    return this.containsPoint(event.x, event.y);
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

    // Text area
    this.renderTextArea(ctx);

    // Hint
    this.renderHint(ctx);
  }

  /**
   * Render the text area
   */
  private renderTextArea(ctx: RenderContext): void {
    const colors = this.getColors();
    const startY = this._rect.y + 2;
    const startX = this._rect.x + 2;
    const contentWidth = this._rect.width - 4;

    // Input background color
    const inputBg = hexToRgb(themeLoader.getColor('input.background')) ||
                    hexToRgb(colors.inputBackground) ||
                    { r: 60, g: 60, b: 60 };
    const inputFg = colors.inputForeground;

    for (let i = 0; i < this._visibleLines; i++) {
      const lineIndex = this._scrollTop + i;
      const y = startY + i;

      // Draw line background
      ctx.fill(startX, y, contentWidth, 1, ' ', inputFg, colors.inputBackground);

      if (lineIndex < this._lines.length) {
        const line = this._lines[lineIndex] || '';
        const displayLine = line.substring(0, contentWidth);
        ctx.drawStyled(startX, y, displayLine, inputFg, colors.inputBackground);

        // Draw cursor if on this line
        if (lineIndex === this._cursorLine) {
          const cursorX = startX + Math.min(this._cursorCol, contentWidth - 1);
          const charUnderCursor = this._cursorCol < line.length ? line[this._cursorCol] : ' ';
          ctx.drawStyled(cursorX, y, charUnderCursor || ' ', undefined, undefined, { inverse: true });
        }
      }
    }

    // Draw scroll indicator if needed
    if (this._lines.length > this._visibleLines) {
      const scrollPercent = this._scrollTop / Math.max(1, this._lines.length - this._visibleLines);
      const indicatorY = startY + Math.floor(scrollPercent * (this._visibleLines - 1));
      const scrollFg = hexToRgb(themeLoader.getColor('scrollbarSlider.background')) || { r: 100, g: 100, b: 100 };
      ctx.drawStyled(startX + contentWidth - 1, indicatorY, '█',
        `rgb(${scrollFg.r},${scrollFg.g},${scrollFg.b})`, colors.inputBackground);
    }
  }

  /**
   * Render hint text
   */
  private renderHint(ctx: RenderContext): void {
    const colors = this.getColors();
    const hintY = this._rect.y + this._rect.height - 2;
    const hintX = this._rect.x + 2;

    const hint = 'Ctrl+Enter to commit, Escape to cancel';
    ctx.drawStyled(hintX, hintY, hint, colors.hintForeground, colors.background);
  }
}

export const commitDialog = new CommitDialog();
export default commitDialog;
