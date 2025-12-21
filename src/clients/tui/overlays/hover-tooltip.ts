/**
 * Hover Tooltip
 *
 * Displays LSP hover information (type info, documentation) near the cursor.
 */

import type { Overlay, OverlayManagerCallbacks } from './overlay-manager.ts';
import type { Rect, KeyEvent, MouseEvent, InputEvent } from '../types.ts';
import { isKeyEvent, isMouseEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import type { LSPHover } from '../../../services/lsp/types.ts';

// ============================================
// Hover Tooltip
// ============================================

export class HoverTooltip implements Overlay {
  readonly id: string;
  zIndex = 250; // Below autocomplete, above editor

  /** Hover content to display */
  private content: string[] = [];
  /** Maximum width */
  private maxWidth = 80;
  /** Maximum height */
  private maxHeight = 20;

  /** Visibility state */
  private visible = false;
  /** Tooltip bounds */
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 };

  /** Callbacks */
  private callbacks: OverlayManagerCallbacks;

  /** Auto-hide timer */
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(id: string, callbacks: OverlayManagerCallbacks) {
    this.id = id;
    this.callbacks = callbacks;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show hover information.
   *
   * @param hover LSP hover response
   * @param x Screen X position (cursor column)
   * @param y Screen Y position (cursor line)
   */
  showHover(hover: LSPHover, x: number, y: number): void {
    // Parse hover content
    this.content = this.parseHoverContent(hover);

    if (this.content.length === 0) {
      this.hide();
      return;
    }

    this.visible = true;
    this.calculateBounds(x, y);
    this.callbacks.onDirty();
  }

  /**
   * Show simple text content.
   */
  showText(text: string, x: number, y: number): void {
    this.content = this.wrapText(text, this.maxWidth - 4); // Account for borders and padding

    if (this.content.length === 0) {
      this.hide();
      return;
    }

    this.visible = true;
    this.calculateBounds(x, y);
    this.callbacks.onDirty();
  }

  /**
   * Start auto-hide timer.
   */
  startAutoHide(delay: number = 200): void {
    this.cancelAutoHide();
    this.hideTimer = setTimeout(() => {
      this.hide();
    }, delay);
  }

  /**
   * Cancel auto-hide timer.
   */
  cancelAutoHide(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Overlay Interface
  // ─────────────────────────────────────────────────────────────────────────

  isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.callbacks.onDirty();
  }

  hide(): void {
    if (this.visible) {
      this.cancelAutoHide();
      this.visible = false;
      this.content = [];
      this.callbacks.onDirty();
    }
  }

  setBounds(bounds: Rect): void {
    this.bounds = bounds;
  }

  getBounds(): Rect {
    return this.bounds;
  }

  onDismiss(): void {
    this.hide();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  render(buffer: ScreenBuffer): void {
    if (!this.visible || this.content.length === 0) return;

    const { x, y, width, height } = this.bounds;
    const bgColor = this.callbacks.getThemeColor('editorHoverWidget.background', '#252526');
    const fgColor = this.callbacks.getThemeColor('editorHoverWidget.foreground', '#cccccc');
    const borderColor = this.callbacks.getThemeColor('editorHoverWidget.border', '#454545');
    const codeColor = this.callbacks.getThemeColor('textPreformat.foreground', '#d7ba7d');

    // Draw border and background
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const screenX = x + col;
        const screenY = y + row;

        // Border
        if (row === 0 || row === height - 1 || col === 0 || col === width - 1) {
          let char = ' ';
          if (row === 0 && col === 0) char = '┌';
          else if (row === 0 && col === width - 1) char = '┐';
          else if (row === height - 1 && col === 0) char = '└';
          else if (row === height - 1 && col === width - 1) char = '┘';
          else if (row === 0 || row === height - 1) char = '─';
          else char = '│';

          buffer.set(screenX, screenY, { char, fg: borderColor, bg: bgColor });
        } else {
          buffer.set(screenX, screenY, { char: ' ', fg: fgColor, bg: bgColor });
        }
      }
    }

    // Draw content
    const contentWidth = width - 4; // Account for borders and padding
    for (let i = 0; i < this.content.length && i < height - 2; i++) {
      const line = this.content[i];
      if (!line) continue;

      const rowY = y + 1 + i;
      const isCodeLine = line.startsWith('  ') || line.startsWith('\t');
      const lineColor = isCodeLine ? codeColor : fgColor;

      // Draw line with padding
      for (let c = 0; c < contentWidth && c < line.length; c++) {
        const char = line[c] ?? ' ';
        buffer.set(x + 2 + c, rowY, { char, fg: lineColor, bg: bgColor });
      }
    }

    // Draw scroll indicator if content is truncated
    if (this.content.length > height - 2) {
      const moreText = `... (${this.content.length - (height - 2)} more lines)`;
      const moreY = y + height - 2;
      const dimColor = this.callbacks.getThemeColor('descriptionForeground', '#717171');

      for (let c = 0; c < moreText.length && c < contentWidth; c++) {
        buffer.set(x + 2 + c, moreY, { char: moreText[c] ?? ' ', fg: dimColor, bg: bgColor });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  handleInput(event: InputEvent): boolean {
    if (!this.visible) return false;

    if (isKeyEvent(event)) {
      // Escape dismisses tooltip
      if (event.key === 'Escape') {
        this.hide();
        return true;
      }
      // Any other key dismisses and passes through
      this.hide();
      return false;
    }

    if (isMouseEvent(event)) {
      // Press outside dismisses
      if (event.type === 'press') {
        const { x, y, width, height } = this.bounds;
        if (
          event.x < x ||
          event.x >= x + width ||
          event.y < y ||
          event.y >= y + height
        ) {
          this.hide();
          return false;
        }
      }
    }

    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Content Parsing
  // ─────────────────────────────────────────────────────────────────────────

  private parseHoverContent(hover: LSPHover): string[] {
    const lines: string[] = [];

    const processContent = (content: string | { kind: string; value: string }): void => {
      if (typeof content === 'string') {
        lines.push(...this.wrapText(content, this.maxWidth - 4));
      } else if (content && typeof content === 'object') {
        // Markdown content - strip markdown formatting for terminal
        let text = content.value;

        // Remove code block markers
        text = text.replace(/```\w*\n?/g, '');
        text = text.replace(/```/g, '');

        // Handle inline code
        text = text.replace(/`([^`]+)`/g, '$1');

        // Handle bold/italic
        text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
        text = text.replace(/\*([^*]+)\*/g, '$1');
        text = text.replace(/__([^_]+)__/g, '$1');
        text = text.replace(/_([^_]+)_/g, '$1');

        lines.push(...this.wrapText(text.trim(), this.maxWidth - 4));
      }
    };

    if (Array.isArray(hover.contents)) {
      for (const content of hover.contents) {
        processContent(content);
        if (lines.length > 0) {
          lines.push(''); // Blank line between sections
        }
      }
    } else {
      processContent(hover.contents);
    }

    // Remove trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    // Limit total lines
    if (lines.length > this.maxHeight - 2) {
      return lines.slice(0, this.maxHeight - 2);
    }

    return lines;
  }

  private wrapText(text: string, maxWidth: number): string[] {
    const lines: string[] = [];
    const paragraphs = text.split('\n');

    for (const paragraph of paragraphs) {
      if (paragraph.length <= maxWidth) {
        lines.push(paragraph);
      } else {
        // Word wrap
        const words = paragraph.split(' ');
        let currentLine = '';

        for (const word of words) {
          if (currentLine.length === 0) {
            currentLine = word;
          } else if (currentLine.length + 1 + word.length <= maxWidth) {
            currentLine += ' ' + word;
          } else {
            lines.push(currentLine);
            currentLine = word;
          }
        }

        if (currentLine.length > 0) {
          lines.push(currentLine);
        }
      }
    }

    return lines;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Positioning
  // ─────────────────────────────────────────────────────────────────────────

  private calculateBounds(cursorX: number, cursorY: number): void {
    const screenSize = this.callbacks.getScreenSize();

    // Calculate content dimensions
    let contentWidth = 0;
    for (const line of this.content) {
      contentWidth = Math.max(contentWidth, line.length);
    }

    const width = Math.min(contentWidth + 4, this.maxWidth); // +4 for borders and padding
    const height = Math.min(this.content.length + 2, this.maxHeight); // +2 for borders

    // Try to position above cursor (typical hover behavior)
    let x = cursorX;
    let y = cursorY - height;

    // Adjust if would go off-screen horizontally
    if (x + width > screenSize.width) {
      x = Math.max(0, screenSize.width - width);
    }

    // Adjust if would go off-screen vertically
    if (y < 0) {
      // Position below cursor instead
      y = cursorY + 1;
      if (y + height > screenSize.height) {
        y = Math.max(0, screenSize.height - height);
      }
    }

    this.bounds = { x, y, width, height };
  }
}

/**
 * Create a hover tooltip instance.
 */
export function createHoverTooltip(id: string, callbacks: OverlayManagerCallbacks): HoverTooltip {
  return new HoverTooltip(id, callbacks);
}
