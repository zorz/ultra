/**
 * Render Utilities
 *
 * Common rendering functions used across UI components.
 * Eliminates code duplication for borders, text manipulation, etc.
 */

import type { RenderContext } from './renderer.ts';
import type { Rect } from './layout.ts';
import { BORDER_CHARS, type BorderStyle, type TextAlign } from './types.ts';
import {
  hexToRgb,
  rgbToHex,
  lighten,
  darken,
  type RGB,
} from './colors.ts';

// Re-export RGB type for backward compatibility
export type { RGB };

/**
 * Utility class for common rendering operations
 */
export class RenderUtils {
  /**
   * Convert hex color string to RGB object
   * @param hex - Color in #RRGGBB format
   * @returns RGB object or null if invalid
   * @deprecated Use hexToRgb from './colors.ts' directly
   */
  static hexToRgb(hex: string): RGB | null {
    return hexToRgb(hex);
  }

  /**
   * Convert RGB to hex string
   * @deprecated Use rgbToHex from './colors.ts' directly
   */
  static rgbToHex(rgb: RGB): string {
    return rgbToHex(rgb);
  }

  /**
   * Lighten a hex color by a percentage
   * @deprecated Use lighten from './colors.ts' directly
   */
  static lighten(hex: string, percent: number): string {
    return lighten(hex, percent);
  }

  /**
   * Darken a hex color by a percentage
   * @deprecated Use darken from './colors.ts' directly
   */
  static darken(hex: string, percent: number): string {
    return darken(hex, percent);
  }

  /**
   * Draw a border around a rectangle
   */
  static drawBorder(
    ctx: RenderContext,
    rect: Rect,
    color: string,
    bgColor?: string,
    style: BorderStyle = 'rounded'
  ): void {
    if (style === 'none') return;

    const chars = BORDER_CHARS[style];
    const { x, y, width, height } = rect;

    // Top border
    ctx.drawStyled(
      x, y,
      chars.topLeft + chars.horizontal.repeat(width - 2) + chars.topRight,
      color, bgColor
    );

    // Side borders
    for (let row = 1; row < height - 1; row++) {
      ctx.drawStyled(x, y + row, chars.vertical, color, bgColor);
      ctx.drawStyled(x + width - 1, y + row, chars.vertical, color, bgColor);
    }

    // Bottom border
    ctx.drawStyled(
      x, y + height - 1,
      chars.bottomLeft + chars.horizontal.repeat(width - 2) + chars.bottomRight,
      color, bgColor
    );
  }

  /**
   * Fill a rectangle with a background color
   */
  static fillRect(
    ctx: RenderContext,
    rect: Rect,
    bgColor: string,
    fgColor?: string
  ): void {
    ctx.fill(rect.x, rect.y, rect.width, rect.height, ' ', fgColor, bgColor);
  }

  /**
   * Draw a box (filled rectangle with border)
   */
  static drawBox(
    ctx: RenderContext,
    rect: Rect,
    bgColor: string,
    borderColor: string,
    borderStyle: BorderStyle = 'rounded'
  ): void {
    this.fillRect(ctx, rect, bgColor);
    this.drawBorder(ctx, rect, borderColor, bgColor, borderStyle);
  }

  /**
   * Truncate text to fit within a maximum length
   * @param text - Text to truncate
   * @param maxLength - Maximum character length
   * @param ellipsis - Ellipsis character to use (default: '…')
   */
  static truncateText(text: string, maxLength: number, ellipsis: string = '…'): string {
    if (text.length <= maxLength) return text;
    if (maxLength <= ellipsis.length) return ellipsis.slice(0, maxLength);
    return text.slice(0, maxLength - ellipsis.length) + ellipsis;
  }

  /**
   * Pad/align text within a given width
   */
  static alignText(text: string, width: number, align: TextAlign = 'left'): string {
    if (text.length >= width) return text.slice(0, width);

    const padding = width - text.length;
    switch (align) {
      case 'center': {
        const left = Math.floor(padding / 2);
        const right = padding - left;
        return ' '.repeat(left) + text + ' '.repeat(right);
      }
      case 'right':
        return ' '.repeat(padding) + text;
      default:
        return text + ' '.repeat(padding);
    }
  }

  /**
   * Draw text centered within a rectangle
   */
  static drawCenteredText(
    ctx: RenderContext,
    rect: Rect,
    text: string,
    fgColor: string,
    bgColor?: string
  ): void {
    const truncated = this.truncateText(text, rect.width - 2);
    const x = rect.x + Math.floor((rect.width - truncated.length) / 2);
    const y = rect.y + Math.floor(rect.height / 2);
    ctx.drawStyled(x, y, truncated, fgColor, bgColor);
  }

  /**
   * Draw a horizontal separator line
   */
  static drawSeparator(
    ctx: RenderContext,
    x: number,
    y: number,
    width: number,
    color: string,
    bgColor?: string,
    char: string = '─'
  ): void {
    ctx.drawStyled(x, y, char.repeat(width), color, bgColor);
  }

  /**
   * Draw text with a label prefix
   * E.g., "Name: value"
   */
  static drawLabeledText(
    ctx: RenderContext,
    x: number,
    y: number,
    label: string,
    value: string,
    labelColor: string,
    valueColor: string,
    bgColor?: string
  ): void {
    ctx.drawStyled(x, y, label, labelColor, bgColor);
    ctx.drawStyled(x + label.length, y, value, valueColor, bgColor);
  }

  /**
   * Draw a progress bar
   */
  static drawProgressBar(
    ctx: RenderContext,
    x: number,
    y: number,
    width: number,
    progress: number,
    fgColor: string,
    bgColor: string,
    fillChar: string = '█',
    emptyChar: string = '░'
  ): void {
    const clampedProgress = Math.max(0, Math.min(1, progress));
    const filledWidth = Math.round(width * clampedProgress);
    const emptyWidth = width - filledWidth;

    ctx.drawStyled(x, y, fillChar.repeat(filledWidth), fgColor, bgColor);
    ctx.drawStyled(x + filledWidth, y, emptyChar.repeat(emptyWidth), fgColor, bgColor);
  }

  /**
   * Draw a scrollbar
   */
  static drawScrollbar(
    ctx: RenderContext,
    x: number,
    y: number,
    height: number,
    scrollPosition: number,
    contentHeight: number,
    trackColor: string,
    thumbColor: string
  ): void {
    if (contentHeight <= height) {
      // No scrollbar needed
      for (let i = 0; i < height; i++) {
        ctx.drawStyled(x, y + i, '│', trackColor);
      }
      return;
    }

    // Calculate thumb size and position
    const thumbHeight = Math.max(1, Math.floor(height * (height / contentHeight)));
    const maxScroll = contentHeight - height;
    const thumbPosition = Math.floor((height - thumbHeight) * (scrollPosition / maxScroll));

    for (let i = 0; i < height; i++) {
      const isThumb = i >= thumbPosition && i < thumbPosition + thumbHeight;
      ctx.drawStyled(x, y + i, isThumb ? '█' : '│', isThumb ? thumbColor : trackColor);
    }
  }

  /**
   * Calculate centered position for a dialog
   */
  static centerRect(
    dialogWidth: number,
    dialogHeight: number,
    screenWidth: number,
    screenHeight: number,
    editorX?: number,
    editorWidth?: number
  ): Rect {
    const centerX = editorX !== undefined && editorWidth !== undefined
      ? editorX + Math.floor(editorWidth / 2)
      : Math.floor(screenWidth / 2);

    const width = Math.min(dialogWidth, (editorWidth || screenWidth) - 4);
    const height = Math.min(dialogHeight, screenHeight - 4);

    return {
      x: centerX - Math.floor(width / 2) + 1,
      y: 2,
      width,
      height
    };
  }

  /**
   * Check if a point is within a rectangle
   */
  static containsPoint(rect: Rect, x: number, y: number): boolean {
    return x >= rect.x && x < rect.x + rect.width &&
           y >= rect.y && y < rect.y + rect.height;
  }

  /**
   * Get a sub-rectangle within a parent rectangle
   */
  static insetRect(rect: Rect, top: number, right: number, bottom: number, left: number): Rect {
    return {
      x: rect.x + left,
      y: rect.y + top,
      width: Math.max(0, rect.width - left - right),
      height: Math.max(0, rect.height - top - bottom)
    };
  }
}

export default RenderUtils;
