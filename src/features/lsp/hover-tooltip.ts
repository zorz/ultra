/**
 * Hover Tooltip Component
 * 
 * Displays LSP hover information (type info, documentation).
 */

import type { RenderContext } from '../../ui/renderer.ts';
import type { LSPHover, LSPRange } from './client.ts';
import { themeLoader } from '../../ui/themes/theme-loader.ts';

export class HoverTooltip {
  private visible = false;
  private content: string[] = [];
  private x = 0;
  private y = 0;
  private range: LSPRange | null = null;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private maxWidth = 80;
  private maxHeight = 15;

  /**
   * Show hover info
   */
  show(hover: LSPHover, x: number, y: number): void {
    // Parse content from hover
    this.content = this.parseContent(hover);
    
    if (this.content.length === 0) {
      this.hide();
      return;
    }
    
    this.x = x;
    this.y = y;
    this.range = hover.range || null;
    this.visible = true;
    
    // Clear any pending hide timeout
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  /**
   * Hide the tooltip
   */
  hide(): void {
    this.visible = false;
    this.content = [];
    this.range = null;
  }

  /**
   * Hide after delay
   */
  hideWithDelay(ms: number = 200): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
    }
    this.hideTimeout = setTimeout(() => {
      this.hide();
    }, ms);
  }

  /**
   * Cancel pending hide
   */
  cancelHide(): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  /**
   * Check if visible
   */
  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Get the hover range
   */
  getRange(): LSPRange | null {
    return this.range;
  }

  /**
   * Parse hover content to lines
   */
  private parseContent(hover: LSPHover): string[] {
    const contents = hover.contents;
    let text = '';

    if (typeof contents === 'string') {
      text = contents;
    } else if (Array.isArray(contents)) {
      text = contents.map(c => {
        if (typeof c === 'string') return c;
        return c.value || '';
      }).join('\n\n');
    } else if (contents && typeof contents === 'object') {
      text = contents.value || '';
    }

    // Strip markdown code fences but keep the content
    text = text.replace(/```\w*\n?/g, '');
    text = text.replace(/```/g, '');
    
    // Handle markdown bold/italic
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
    text = text.replace(/\*([^*]+)\*/g, '$1');
    text = text.replace(/_([^_]+)_/g, '$1');

    // Split into lines and wrap
    const rawLines = text.split('\n');
    const lines: string[] = [];
    
    for (const rawLine of rawLines) {
      if (rawLine.length <= this.maxWidth) {
        lines.push(rawLine);
      } else {
        // Word wrap
        const words = rawLine.split(' ');
        let currentLine = '';
        
        for (const word of words) {
          if (currentLine.length + word.length + 1 <= this.maxWidth) {
            currentLine += (currentLine ? ' ' : '') + word;
          } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
          }
        }
        if (currentLine) lines.push(currentLine);
      }
    }

    // Limit height
    if (lines.length > this.maxHeight) {
      return [...lines.slice(0, this.maxHeight - 1), '...'];
    }

    return lines;
  }

  /**
   * Handle keyboard - Escape dismisses
   */
  handleKey(key: string): boolean {
    if (!this.visible) return false;

    if (key === 'ESCAPE') {
      this.hide();
      return true;
    }

    return false;
  }

  /**
   * Render the tooltip
   */
  render(ctx: RenderContext, screenWidth: number, screenHeight: number): void {
    if (!this.visible || this.content.length === 0) return;

    // Calculate dimensions
    const contentWidth = Math.min(
      this.maxWidth,
      Math.max(...this.content.map(l => l.length))
    );
    const width = contentWidth + 4;  // +4 for padding and borders
    const height = this.content.length + 2;  // +2 for borders

    // Position above cursor by default
    let tooltipX = this.x;
    let tooltipY = this.y - height;

    // Adjust if would go off screen
    if (tooltipX + width > screenWidth) {
      tooltipX = Math.max(1, screenWidth - width);
    }
    
    if (tooltipY < 1) {
      // Show below cursor instead
      tooltipY = this.y + 1;
    }
    
    if (tooltipY + height > screenHeight) {
      tooltipY = Math.max(1, screenHeight - height);
    }

    // Colors - use existing theme colors (sideBar.background is slightly darker than editor)
    const bgColor = themeLoader.getColor('sideBar.background') || themeLoader.getColor('editor.background') || '#252526';
    const fgColor = themeLoader.getColor('editor.foreground') || '#d4d4d4';
    const borderColor = themeLoader.getColor('input.border') || themeLoader.getColor('focusBorder') || '#454545';

    // Draw background
    ctx.fill(tooltipX, tooltipY, width, height, ' ', fgColor, bgColor);

    // Top border
    ctx.drawStyled(tooltipX, tooltipY, '┌' + '─'.repeat(width - 2) + '┐', borderColor, bgColor);

    // Content lines
    for (let i = 0; i < this.content.length; i++) {
      const lineY = tooltipY + 1 + i;
      const line = this.content[i];
      
      // Left border
      ctx.drawStyled(tooltipX, lineY, '│', borderColor, bgColor);
      
      // Content with padding
      const paddedLine = (' ' + line).padEnd(width - 2);
      ctx.drawStyled(tooltipX + 1, lineY, paddedLine, fgColor, bgColor);
      
      // Right border
      ctx.drawStyled(tooltipX + width - 1, lineY, '│', borderColor, bgColor);
    }

    // Bottom border
    ctx.drawStyled(tooltipX, tooltipY + height - 1, '└' + '─'.repeat(width - 2) + '┘', borderColor, bgColor);
  }
}

// Singleton instance
export const hoverTooltip = new HoverTooltip();

export default hoverTooltip;
