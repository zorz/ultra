/**
 * Git Commit Dialog
 *
 * Multi-line text input dialog for git commit messages.
 * Shows staged files and supports conventional commit format.
 */

import { PromiseDialog, type DialogConfig, type DialogResult } from './promise-dialog.ts';
import type { OverlayManagerCallbacks } from './overlay-manager.ts';
import type { KeyEvent, MouseEvent, InputEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';

// ============================================
// Types
// ============================================

/**
 * Staged file info for display.
 */
export interface StagedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

/**
 * Options for commit dialog.
 */
export interface CommitDialogOptions extends DialogConfig {
  /** Staged files to display */
  stagedFiles?: StagedFile[];
  /** Initial commit message */
  initialMessage?: string;
  /** Whether to show conventional commit hints */
  showConventionalHints?: boolean;
}

/**
 * Result from commit dialog.
 */
export interface CommitResult {
  message: string;
  amend?: boolean;
}

// ============================================
// Commit Dialog
// ============================================

export class CommitDialog extends PromiseDialog<CommitResult> {
  /** Commit message lines */
  private lines: string[] = [''];

  /** Cursor line */
  private cursorLine: number = 0;

  /** Cursor column */
  private cursorCol: number = 0;

  /** Scroll offset for message area */
  private scrollOffset: number = 0;

  /** Staged files to display */
  private stagedFiles: StagedFile[] = [];

  /** Whether to show conventional commit hints */
  private showConventionalHints: boolean = true;

  /** Whether amend mode is enabled */
  private amendMode: boolean = false;

  /** Max visible lines in message area */
  private maxVisibleLines: number = 8;

  constructor(id: string, callbacks: OverlayManagerCallbacks) {
    super(id, callbacks);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the commit dialog.
   */
  showWithOptions(options: CommitDialogOptions): Promise<DialogResult<CommitResult>> {
    this.stagedFiles = options.stagedFiles ?? [];
    this.showConventionalHints = options.showConventionalHints ?? true;
    this.amendMode = false;

    // Parse initial message into lines
    const initialMessage = options.initialMessage ?? '';
    this.lines = initialMessage ? initialMessage.split('\n') : [''];
    this.cursorLine = 0;
    this.cursorCol = this.lines[0]?.length ?? 0;
    this.scrollOffset = 0;

    // Calculate dialog size
    const stagedHeight = Math.min(5, this.stagedFiles.length + 1);
    const hintsHeight = this.showConventionalHints ? 2 : 0;
    const messageHeight = 10;
    const totalHeight = 4 + stagedHeight + hintsHeight + messageHeight;

    return this.showAsync({
      title: options.title ?? 'Git Commit',
      width: options.width ?? 70,
      height: options.height ?? totalHeight,
      ...options,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  protected override handleKeyInput(event: KeyEvent): boolean {
    // Ctrl+Enter - confirm commit
    if (event.ctrl && event.key === 'Enter') {
      const message = this.lines.join('\n').trim();
      if (message) {
        this.confirm({ message, amend: this.amendMode });
      }
      return true;
    }

    // Enter - new line
    if (event.key === 'Enter') {
      const currentLine = this.lines[this.cursorLine] ?? '';
      const before = currentLine.slice(0, this.cursorCol);
      const after = currentLine.slice(this.cursorCol);
      this.lines[this.cursorLine] = before;
      this.lines.splice(this.cursorLine + 1, 0, after);
      this.cursorLine++;
      this.cursorCol = 0;
      this.ensureCursorVisible();
      this.callbacks.onDirty();
      return true;
    }

    // Backspace
    if (event.key === 'Backspace') {
      if (this.cursorCol > 0) {
        const line = this.lines[this.cursorLine] ?? '';
        this.lines[this.cursorLine] = line.slice(0, this.cursorCol - 1) + line.slice(this.cursorCol);
        this.cursorCol--;
      } else if (this.cursorLine > 0) {
        // Merge with previous line
        const currentLine = this.lines[this.cursorLine] ?? '';
        const prevLine = this.lines[this.cursorLine - 1] ?? '';
        this.cursorCol = prevLine.length;
        this.lines[this.cursorLine - 1] = prevLine + currentLine;
        this.lines.splice(this.cursorLine, 1);
        this.cursorLine--;
      }
      this.ensureCursorVisible();
      this.callbacks.onDirty();
      return true;
    }

    // Delete
    if (event.key === 'Delete') {
      const line = this.lines[this.cursorLine] ?? '';
      if (this.cursorCol < line.length) {
        this.lines[this.cursorLine] = line.slice(0, this.cursorCol) + line.slice(this.cursorCol + 1);
      } else if (this.cursorLine < this.lines.length - 1) {
        // Merge with next line
        const nextLine = this.lines[this.cursorLine + 1] ?? '';
        this.lines[this.cursorLine] = line + nextLine;
        this.lines.splice(this.cursorLine + 1, 1);
      }
      this.callbacks.onDirty();
      return true;
    }

    // Arrow keys
    if (event.key === 'ArrowUp') {
      if (this.cursorLine > 0) {
        this.cursorLine--;
        this.cursorCol = Math.min(this.cursorCol, this.lines[this.cursorLine]?.length ?? 0);
        this.ensureCursorVisible();
        this.callbacks.onDirty();
      }
      return true;
    }

    if (event.key === 'ArrowDown') {
      if (this.cursorLine < this.lines.length - 1) {
        this.cursorLine++;
        this.cursorCol = Math.min(this.cursorCol, this.lines[this.cursorLine]?.length ?? 0);
        this.ensureCursorVisible();
        this.callbacks.onDirty();
      }
      return true;
    }

    if (event.key === 'ArrowLeft') {
      if (this.cursorCol > 0) {
        this.cursorCol--;
      } else if (this.cursorLine > 0) {
        this.cursorLine--;
        this.cursorCol = this.lines[this.cursorLine]?.length ?? 0;
      }
      this.ensureCursorVisible();
      this.callbacks.onDirty();
      return true;
    }

    if (event.key === 'ArrowRight') {
      const lineLen = this.lines[this.cursorLine]?.length ?? 0;
      if (this.cursorCol < lineLen) {
        this.cursorCol++;
      } else if (this.cursorLine < this.lines.length - 1) {
        this.cursorLine++;
        this.cursorCol = 0;
      }
      this.ensureCursorVisible();
      this.callbacks.onDirty();
      return true;
    }

    // Home/End
    if (event.key === 'Home') {
      this.cursorCol = 0;
      this.callbacks.onDirty();
      return true;
    }

    if (event.key === 'End') {
      this.cursorCol = this.lines[this.cursorLine]?.length ?? 0;
      this.callbacks.onDirty();
      return true;
    }

    // Toggle amend mode
    if (event.ctrl && event.key === 'a') {
      this.amendMode = !this.amendMode;
      this.callbacks.onDirty();
      return true;
    }

    // Character input
    if (event.key.length === 1 && !event.ctrl && !event.alt && !event.meta) {
      const line = this.lines[this.cursorLine] ?? '';
      this.lines[this.cursorLine] = line.slice(0, this.cursorCol) + event.key + line.slice(this.cursorCol);
      this.cursorCol++;
      this.callbacks.onDirty();
      return true;
    }

    return false;
  }

  protected override handleMouseInput(event: InputEvent): boolean {
    if (!('type' in event)) return true;
    const mouseEvent = event as MouseEvent;

    if (mouseEvent.type === 'scroll') {
      const direction = mouseEvent.scrollDirection ?? 1;
      this.scrollOffset = Math.max(0, Math.min(
        this.scrollOffset + direction,
        Math.max(0, this.lines.length - this.maxVisibleLines)
      ));
      this.callbacks.onDirty();
      return true;
    }

    return true;
  }

  private ensureCursorVisible(): void {
    if (this.cursorLine < this.scrollOffset) {
      this.scrollOffset = this.cursorLine;
    } else if (this.cursorLine >= this.scrollOffset + this.maxVisibleLines) {
      this.scrollOffset = this.cursorLine - this.maxVisibleLines + 1;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  protected override renderContent(buffer: ScreenBuffer): void {
    const content = this.getContentBounds();
    const bg = this.callbacks.getThemeColor('editorWidget.background', '#252526');
    const fg = this.callbacks.getThemeColor('editorWidget.foreground', '#cccccc');
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');
    const inputBg = this.callbacks.getThemeColor('input.background', '#3c3c3c');
    const focusBorder = this.callbacks.getThemeColor('focusBorder', '#007acc');
    const addedFg = this.callbacks.getThemeColor('gitDecoration.addedResourceForeground', '#81b88b');
    const modifiedFg = this.callbacks.getThemeColor('gitDecoration.modifiedResourceForeground', '#e2c08d');
    const deletedFg = this.callbacks.getThemeColor('gitDecoration.deletedResourceForeground', '#c74e39');

    let y = content.y;

    // Staged files section
    if (this.stagedFiles.length > 0) {
      buffer.writeString(content.x, y, 'Staged Changes:', dimFg, bg);
      y++;

      const maxFiles = Math.min(4, this.stagedFiles.length);
      for (let i = 0; i < maxFiles; i++) {
        const file = this.stagedFiles[i]!;
        const statusChar = file.status === 'added' ? 'A' : file.status === 'modified' ? 'M' : file.status === 'deleted' ? 'D' : 'R';
        const statusColor = file.status === 'added' ? addedFg : file.status === 'modified' ? modifiedFg : deletedFg;

        buffer.writeString(content.x + 2, y, statusChar, statusColor, bg);
        buffer.writeString(content.x + 4, y, file.path.slice(0, content.width - 6), fg, bg);
        y++;
      }

      if (this.stagedFiles.length > maxFiles) {
        buffer.writeString(content.x + 2, y, `... and ${this.stagedFiles.length - maxFiles} more`, dimFg, bg);
        y++;
      }
      y++;
    }

    // Conventional commit hints
    if (this.showConventionalHints) {
      const hints = 'Types: feat fix docs style refactor test chore';
      buffer.writeString(content.x, y, hints, dimFg, bg);
      y += 2;
    }

    // Message label with amend indicator
    const labelText = this.amendMode ? 'Message (amending):' : 'Message:';
    const amendColor = this.amendMode ? this.callbacks.getThemeColor('editorWarning.foreground', '#cca700') : dimFg;
    buffer.writeString(content.x, y, labelText, amendColor, bg);
    y++;

    // Message input area
    const messageHeight = content.height - (y - content.y) - 2;
    this.maxVisibleLines = Math.max(1, messageHeight);
    const inputWidth = content.width;

    // Draw input background
    for (let row = 0; row < this.maxVisibleLines; row++) {
      for (let col = 0; col < inputWidth; col++) {
        buffer.set(content.x + col, y + row, { char: ' ', fg, bg: inputBg });
      }
    }

    // Render message lines
    for (let row = 0; row < this.maxVisibleLines; row++) {
      const lineIndex = this.scrollOffset + row;
      if (lineIndex >= this.lines.length) break;

      const line = this.lines[lineIndex] ?? '';
      const displayLine = line.slice(0, inputWidth - 1);
      buffer.writeString(content.x + 1, y + row, displayLine, fg, inputBg);

      // Cursor
      if (lineIndex === this.cursorLine) {
        const cursorX = content.x + 1 + this.cursorCol;
        if (cursorX < content.x + inputWidth) {
          const cursorChar = line[this.cursorCol] ?? ' ';
          buffer.set(cursorX, y + row, { char: cursorChar, fg: inputBg, bg: focusBorder });
        }
      }
    }

    y += this.maxVisibleLines + 1;

    // Footer with instructions
    const footer = 'Ctrl+Enter: commit  |  Ctrl+A: toggle amend  |  Escape: cancel';
    const footerTruncated = footer.slice(0, content.width);
    buffer.writeString(content.x, y, footerTruncated, dimFg, bg);
  }
}
