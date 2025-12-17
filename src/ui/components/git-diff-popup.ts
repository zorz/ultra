/**
 * Git Diff Popup Component
 *
 * Shows inline diff view when clicking on git gutter indicators.
 * Allows staging, reverting, and navigating between changes.
 *
 * Now extends BaseDialog for consistent API.
 */

import type { RenderContext } from '../renderer.ts';
import type { MouseEvent } from '../mouse.ts';
import type { KeyEvent } from '../../terminal/input.ts';
import type { Rect } from '../layout.ts';
import { BaseDialog, type BaseDialogConfig } from './base-dialog.ts';
import { RenderUtils } from '../render-utils.ts';
import { themeLoader } from '../themes/theme-loader.ts';
import { settings } from '../../config/settings.ts';
import { gitIntegration, type GitLineChange } from '../../features/git/git-integration.ts';

interface DiffLine {
  type: 'context' | 'added' | 'deleted' | 'header';
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

/**
 * GitDiffPopup - Inline diff viewer for git changes
 *
 * @example
 * ```typescript
 * await gitDiffPopup.show(filePath, changes, targetLine);
 * gitDiffPopup.setRect(rect);
 * gitDiffPopup.onStage(async (path, start, end) => {...});
 * ```
 */
export class GitDiffPopup extends BaseDialog {
  // Diff state
  private _filePath: string = '';
  private _changes: GitLineChange[] = [];
  private _currentChangeIndex: number = 0;
  private _hunks: DiffHunk[] = [];
  private _scrollTop: number = 0;

  // Specialized callbacks
  private _stageCallback?: (filePath: string, lineStart: number, lineEnd: number) => Promise<void>;
  private _revertCallback?: (filePath: string, lineStart: number, lineEnd: number) => Promise<void>;
  private _refreshCallback?: () => void;

  constructor() {
    super();
    this._debugName = 'GitDiffPopup';
    this._borderStyle = 'square';
  }

  // === Lifecycle ===

  /**
   * Show the diff popup for a specific line change
   */
  async show(filePath: string, changes: GitLineChange[], targetLine: number): Promise<void> {
    this._filePath = filePath;
    this._changes = changes;
    this._scrollTop = 0;

    // Find the change closest to targetLine
    this._currentChangeIndex = this.findClosestChangeIndex(targetLine);

    // Load the diff hunks
    await this.loadDiffHunks();

    this._isVisible = true;
    this.debugLog(`Showing for ${filePath} at line ${targetLine}, change index ${this._currentChangeIndex}`);
  }

  /**
   * Hide the popup
   */
  hide(): void {
    this._hunks = [];
    super.hide();
  }

  /**
   * Check if visible (legacy API compatibility)
   */
  isVisible(): boolean {
    return this._isVisible;
  }

  // === Change Navigation ===

  /**
   * Find the change index closest to a given line
   */
  private findClosestChangeIndex(targetLine: number): number {
    if (this._changes.length === 0) return 0;

    let closest = 0;
    let minDiff = Math.abs(this._changes[0]!.line - targetLine);

    for (let i = 1; i < this._changes.length; i++) {
      const diff = Math.abs(this._changes[i]!.line - targetLine);
      if (diff < minDiff) {
        minDiff = diff;
        closest = i;
      }
    }

    return closest;
  }

  /**
   * Navigate to next change
   */
  nextChange(): void {
    if (this._changes.length === 0) return;
    this._currentChangeIndex = (this._currentChangeIndex + 1) % this._changes.length;
    this._scrollTop = 0;
    this.loadDiffHunks();
  }

  /**
   * Navigate to previous change
   */
  previousChange(): void {
    if (this._changes.length === 0) return;
    this._currentChangeIndex = (this._currentChangeIndex - 1 + this._changes.length) % this._changes.length;
    this._scrollTop = 0;
    this.loadDiffHunks();
  }

  // === Diff Loading ===

  /**
   * Load diff hunks from git
   */
  private async loadDiffHunks(): Promise<void> {
    try {
      const diffHunks = await gitIntegration.diff(this._filePath);
      const contextLines = settings.get('git.diffContextLines') || 3;

      this._hunks = diffHunks.map(hunk => ({
        oldStart: hunk.oldStart,
        oldCount: hunk.oldCount,
        newStart: hunk.newStart,
        newCount: hunk.newCount,
        lines: this.parseHunkLines(hunk.content, contextLines)
      }));

      this.debugLog(`Loaded ${this._hunks.length} hunks`);
    } catch (e) {
      this.debugLog(`Error loading diff: ${e}`);
      this._hunks = [];
    }
  }

  /**
   * Parse hunk content into diff lines
   */
  private parseHunkLines(content: string, _contextLines: number): DiffLine[] {
    const lines: DiffLine[] = [];
    const rawLines = content.split('\n');

    let oldLineNum = 0;
    let newLineNum = 0;

    for (const line of rawLines) {
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          oldLineNum = parseInt(match[1]!, 10);
          newLineNum = parseInt(match[2]!, 10);
        }
        lines.push({ type: 'header', content: line });
      } else if (line.startsWith('-')) {
        lines.push({
          type: 'deleted',
          content: line.substring(1),
          oldLineNum: oldLineNum++
        });
      } else if (line.startsWith('+')) {
        lines.push({
          type: 'added',
          content: line.substring(1),
          newLineNum: newLineNum++
        });
      } else if (line.startsWith(' ') || line === '') {
        lines.push({
          type: 'context',
          content: line.substring(1) || '',
          oldLineNum: oldLineNum++,
          newLineNum: newLineNum++
        });
      }
    }

    return lines;
  }

  /**
   * Get the hunk for the current change
   */
  private getCurrentHunk(): DiffHunk | null {
    if (this._changes.length === 0 || this._hunks.length === 0) return null;

    const currentChange = this._changes[this._currentChangeIndex]!;
    const targetLine = currentChange.line;

    // Find the hunk that contains this line
    for (const hunk of this._hunks) {
      if (targetLine >= hunk.newStart && targetLine < hunk.newStart + Math.max(hunk.newCount, 1)) {
        return hunk;
      }
    }

    // Return first hunk if no exact match
    return this._hunks[0] || null;
  }

  // === Actions ===

  /**
   * Stage the current hunk
   */
  async stageCurrentHunk(): Promise<void> {
    if (this._stageCallback && this._hunks.length > 0) {
      const hunk = this.getCurrentHunk();
      if (hunk) {
        await this._stageCallback(this._filePath, hunk.newStart, hunk.newStart + hunk.newCount - 1);
        if (this._refreshCallback) {
          this._refreshCallback();
        }
      }
    }
  }

  /**
   * Revert the current hunk
   */
  async revertCurrentHunk(): Promise<void> {
    if (this._revertCallback && this._hunks.length > 0) {
      const hunk = this.getCurrentHunk();
      if (hunk) {
        await this._revertCallback(this._filePath, hunk.newStart, hunk.newStart + hunk.newCount - 1);
        if (this._refreshCallback) {
          this._refreshCallback();
        }
      }
    }
  }

  // === Callbacks ===

  onStage(callback: (filePath: string, lineStart: number, lineEnd: number) => Promise<void>): void {
    this._stageCallback = callback;
  }

  onRevert(callback: (filePath: string, lineStart: number, lineEnd: number) => Promise<void>): void {
    this._revertCallback = callback;
  }

  onRefresh(callback: () => void): void {
    this._refreshCallback = callback;
  }

  // === Keyboard Handling ===

  handleKey(event: KeyEvent): boolean {
    if (!this._isVisible) return false;

    const { key, ctrl } = event;

    switch (key) {
      case 'ESCAPE':
      case 'C':
      case 'c':
        this.hide();
        return true;

      case 'N':
      case 'n':
        if (!ctrl) {
          this.nextChange();
          return true;
        }
        break;

      case 'P':
      case 'p':
        if (!ctrl) {
          this.previousChange();
          return true;
        }
        break;

      case 'S':
      case 's':
        if (!ctrl) {
          this.stageCurrentHunk();
          return true;
        }
        break;

      case 'R':
      case 'r':
        if (!ctrl) {
          this.revertCurrentHunk();
          return true;
        }
        break;

      case 'UP':
      case 'K':
      case 'k':
        this._scrollTop = Math.max(0, this._scrollTop - 1);
        return true;

      case 'DOWN':
      case 'J':
      case 'j':
        this._scrollTop++;
        return true;
    }

    return false;
  }

  // === Mouse Handling ===

  onMouseEvent(event: MouseEvent): boolean {
    if (!this._isVisible) return false;

    switch (event.name) {
      case 'MOUSE_LEFT_BUTTON_PRESSED': {
        const relY = event.y - this._rect.y;

        // Check if clicking on header buttons (first row)
        if (relY === 0) {
          const buttons = ' 󰐕  󰜺  󰒭  󰒮  󰅖 ';
          const buttonX = this._rect.x + this._rect.width - buttons.length - 2;
          const clickX = event.x;

          // Each button is 4 chars wide
          if (clickX >= buttonX + 16 && clickX < buttonX + 20) {
            this.hide();
            return true;
          } else if (clickX >= buttonX + 12 && clickX < buttonX + 16) {
            this.previousChange();
            return true;
          } else if (clickX >= buttonX + 8 && clickX < buttonX + 12) {
            this.nextChange();
            return true;
          } else if (clickX >= buttonX + 4 && clickX < buttonX + 8) {
            this.revertCurrentHunk();
            return true;
          } else if (clickX >= buttonX && clickX < buttonX + 4) {
            this.stageCurrentHunk();
            return true;
          }
        }
        return true;
      }

      case 'MOUSE_WHEEL_UP':
        this._scrollTop = Math.max(0, this._scrollTop - 3);
        return true;

      case 'MOUSE_WHEEL_DOWN':
        this._scrollTop += 3;
        return true;
    }

    return this.containsPoint(event.x, event.y);
  }

  // === Rendering ===

  render(ctx: RenderContext): void {
    if (!this._isVisible) return;

    const theme = themeLoader.getCurrentTheme();
    if (!theme) return;
    const colors = theme.colors;

    const x = this._rect.x;
    const y = this._rect.y;
    const width = this._rect.width;
    const height = this._rect.height;

    // Colors
    const bgColor = colors['editor.background'] || '#1e1e1e';
    const borderColor = colors['panel.border'] || '#404040';
    const fgColor = colors['editor.foreground'] || '#d4d4d4';
    const headerBg = colors['titleBar.activeBackground'] || '#3c3c3c';
    const greenColor = colors['gitDecoration.addedResourceForeground'] || '#89d185';
    const redColor = colors['gitDecoration.deletedResourceForeground'] || '#f14c4c';
    const blueColor = colors['textLink.foreground'] || '#3794ff';
    const lineNumColor = colors['editorLineNumber.foreground'] || '#858585';

    // Background
    for (let row = 0; row < height; row++) {
      ctx.drawStyled(x, y + row, ' '.repeat(width), fgColor, bgColor);
    }

    // Border
    ctx.drawStyled(x, y, '┌' + '─'.repeat(width - 2) + '┐', borderColor, bgColor);
    for (let row = 1; row < height - 1; row++) {
      ctx.drawStyled(x, y + row, '│', borderColor, bgColor);
      ctx.drawStyled(x + width - 1, y + row, '│', borderColor, bgColor);
    }
    ctx.drawStyled(x, y + height - 1, '└' + '─'.repeat(width - 2) + '┘', borderColor, bgColor);

    // Header
    const fileName = this._filePath.split('/').pop() || this._filePath;
    const changeInfo = this._changes.length > 0
      ? `${this._currentChangeIndex + 1}/${this._changes.length}`
      : '0/0';

    const buttons = ' 󰐕  󰜺  󰒭  󰒮  󰅖 ';
    const headerText = ` ${fileName} - Changes ${changeInfo}`;
    const availableWidth = width - 4 - buttons.length;
    const truncatedHeader = headerText.length > availableWidth
      ? headerText.substring(0, availableWidth - 1) + '…'
      : headerText.padEnd(availableWidth);

    ctx.drawStyled(x + 1, y, truncatedHeader, fgColor, headerBg);

    // Header buttons
    const buttonX = x + width - buttons.length - 2;
    ctx.drawStyled(buttonX, y, ' 󰐕 ', greenColor, headerBg);      // stage
    ctx.drawStyled(buttonX + 4, y, ' 󰜺 ', redColor, headerBg);    // revert
    ctx.drawStyled(buttonX + 8, y, ' 󰒭 ', blueColor, headerBg);   // next
    ctx.drawStyled(buttonX + 12, y, ' 󰒮 ', blueColor, headerBg);  // previous
    ctx.drawStyled(buttonX + 16, y, ' 󰅖 ', fgColor, headerBg);    // close

    // Diff content
    const currentHunk = this.getCurrentHunk();
    if (!currentHunk) {
      ctx.drawStyled(x + 2, y + 2, 'No changes to display', fgColor, bgColor);
      return;
    }

    const contentHeight = height - 3;
    const lines = currentHunk.lines;
    const maxScroll = Math.max(0, lines.length - contentHeight);
    this._scrollTop = Math.min(this._scrollTop, maxScroll);

    const addedBg = colors['diffEditor.insertedLineBackground'] || '#2ea04326';
    const deletedBg = colors['diffEditor.removedLineBackground'] || '#f8514926';
    const addedFg = greenColor;
    const deletedFg = redColor;

    for (let i = 0; i < contentHeight && this._scrollTop + i < lines.length; i++) {
      const line = lines[this._scrollTop + i]!;
      const lineY = y + 1 + i;
      const contentWidth = width - 14;

      let lineBg = bgColor;
      let lineFg = fgColor;
      let gutterChar = ' ';
      let oldNum = '    ';
      let newNum = '    ';

      switch (line.type) {
        case 'header':
          lineFg = colors['textPreformat.foreground'] || '#d7ba7d';
          break;
        case 'added':
          lineBg = addedBg;
          lineFg = addedFg;
          gutterChar = '+';
          newNum = line.newLineNum !== undefined
            ? line.newLineNum.toString().padStart(4)
            : '    ';
          break;
        case 'deleted':
          lineBg = deletedBg;
          lineFg = deletedFg;
          gutterChar = '-';
          oldNum = line.oldLineNum !== undefined
            ? line.oldLineNum.toString().padStart(4)
            : '    ';
          break;
        case 'context':
          oldNum = line.oldLineNum !== undefined
            ? line.oldLineNum.toString().padStart(4)
            : '    ';
          newNum = line.newLineNum !== undefined
            ? line.newLineNum.toString().padStart(4)
            : '    ';
          break;
      }

      // Line numbers
      ctx.drawStyled(x + 1, lineY, oldNum, lineNumColor, bgColor);
      ctx.drawStyled(x + 6, lineY, newNum, lineNumColor, bgColor);

      // Gutter indicator
      const gutterColor = line.type === 'added' ? addedFg :
                          line.type === 'deleted' ? deletedFg : fgColor;
      ctx.drawStyled(x + 11, lineY, gutterChar, gutterColor, lineBg);

      // Content
      const content = line.content.substring(0, contentWidth);
      const paddedContent = content.padEnd(contentWidth);
      ctx.drawStyled(x + 13, lineY, paddedContent, lineFg, lineBg);
    }

    // Footer
    const footerY = y + height - 1;
    const footerText = ' s:stage r:revert n:next p:prev c/Esc:close ';
    const footerX = x + Math.floor((width - footerText.length) / 2);
    ctx.drawStyled(footerX, footerY, footerText, lineNumColor, bgColor);
  }
}

export const gitDiffPopup = new GitDiffPopup();
export default gitDiffPopup;
