/**
 * Minimap Component
 * 
 * VS Code-style minimap showing a compressed bird's-eye view of the file
 * using Braille characters for sub-character precision.
 */

import type { Document } from '../../core/document.ts';
import type { RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import { highlighter as shikiHighlighter } from '../../features/syntax/shiki-highlighter.ts';
import { themeLoader } from '../themes/theme-loader.ts';
import { settings } from '../../config/settings.ts';

// Braille dot positions (2x4 matrix per character)
// Dots are numbered:
// [0,0] [0,1]    1  4
// [1,0] [1,1]    2  5
// [2,0] [2,1]    3  6
// [3,0] [3,1]    7  8
const BRAILLE_DOT_BITS = [
  [0x01, 0x08],  // Row 0: dots 1,4
  [0x02, 0x10],  // Row 1: dots 2,5
  [0x04, 0x20],  // Row 2: dots 3,6
  [0x40, 0x80],  // Row 3: dots 7,8
];

/**
 * Convert a 2x4 boolean matrix to a braille character
 */
function toBraille(dots: boolean[][]): string {
  let code = 0x2800; // Base braille character (empty)
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 2; col++) {
      if (dots[row]?.[col]) {
        code |= BRAILLE_DOT_BITS[row]![col]!;
      }
    }
  }
  return String.fromCharCode(code);
}

interface MinimapCache {
  content: string;
  lineCount: number;
  chars: string[];  // Cached braille characters per minimap row
  colors: string[]; // Dominant color per minimap row
}

export class Minimap implements MouseHandler {
  private document: Document | null = null;
  private rect: Rect = { x: 1, y: 1, width: 10, height: 24 };
  private scrollTop: number = 0;
  private editorScrollTop: number = 0;
  private editorVisibleLines: number = 24;
  private enabled: boolean = true;
  private width: number = 10;
  private maxColumn: number = 120;
  
  // Cache for performance
  private cache: MinimapCache | null = null;
  private dirtyLines: Set<number> = new Set();
  private renderDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  
  // Dragging state
  private isDragging: boolean = false;
  private isHovering: boolean = false;
  
  // Callbacks
  private onScrollCallback?: (line: number) => void;

  constructor() {
    this.loadSettings();
  }

  /**
   * Load settings
   */
  loadSettings(): void {
    this.enabled = settings.get('editor.minimap.enabled') ?? true;
    this.width = settings.get('editor.minimap.width') ?? 10;
    this.maxColumn = settings.get('editor.minimap.maxColumn') ?? 120;
  }

  /**
   * Check if minimap is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Toggle minimap visibility
   */
  toggle(): void {
    this.enabled = !this.enabled;
  }

  /**
   * Set enabled state
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Get minimap width (for layout calculations)
   */
  getWidth(): number {
    return this.enabled ? this.width : 0;
  }

  /**
   * Set the document to display
   */
  setDocument(doc: Document | null): void {
    this.document = doc;
    this.invalidateCache();
  }

  /**
   * Set the rect
   */
  setRect(rect: Rect): void {
    if (rect.width !== this.rect.width || rect.height !== this.rect.height) {
      this.invalidateCache();
    }
    this.rect = rect;
  }

  /**
   * Update scroll position from editor
   */
  setEditorScroll(scrollTop: number, visibleLines: number): void {
    this.editorScrollTop = scrollTop;
    this.editorVisibleLines = visibleLines;
    this.updateMinimapScroll();
  }

  /**
   * Set scroll callback
   */
  onScroll(callback: (line: number) => void): void {
    this.onScrollCallback = callback;
  }

  /**
   * Mark lines as dirty (need re-render)
   */
  markDirty(startLine: number, endLine: number): void {
    for (let i = startLine; i <= endLine; i++) {
      this.dirtyLines.add(i);
    }
    this.scheduleRender();
  }

  /**
   * Invalidate entire cache
   */
  invalidateCache(): void {
    this.cache = null;
    this.dirtyLines.clear();
  }

  /**
   * Schedule a debounced re-render
   */
  private scheduleRender(): void {
    if (this.renderDebounceTimer) {
      clearTimeout(this.renderDebounceTimer);
    }
    this.renderDebounceTimer = setTimeout(() => {
      this.updateDirtyRegions();
      this.renderDebounceTimer = null;
    }, 50);
  }

  /**
   * Update only dirty regions in cache
   */
  private updateDirtyRegions(): void {
    if (!this.cache || !this.document) return;
    
    // Calculate which minimap rows need updating
    const linesPerRow = this.getLinesPerRow();
    const dirtyRows = new Set<number>();
    
    for (const line of this.dirtyLines) {
      const row = Math.floor(line / linesPerRow);
      dirtyRows.add(row);
    }
    
    // Update those rows
    for (const row of dirtyRows) {
      const startLine = row * linesPerRow;
      const endLine = Math.min(startLine + linesPerRow, this.document.lineCount);
      const { char, color } = this.renderMinimapRow(startLine, endLine);
      this.cache.chars[row] = char;
      this.cache.colors[row] = color;
    }
    
    this.dirtyLines.clear();
  }

  /**
   * Calculate how many source lines fit in one minimap row
   */
  private getLinesPerRow(): number {
    if (!this.document) return 1;
    const totalLines = this.document.lineCount;
    const availableRows = this.rect.height;
    
    // Each braille char represents 4 vertical dots
    // We want to fit the whole file if possible, or scroll if too large
    const linesPerRow = Math.max(1, Math.ceil(totalLines / (availableRows * 4)));
    return linesPerRow;
  }

  /**
   * Update minimap scroll position based on editor scroll
   */
  private updateMinimapScroll(): void {
    if (!this.document) return;
    
    const totalLines = this.document.lineCount;
    const linesPerRow = this.getLinesPerRow();
    const totalMinimapRows = Math.ceil(totalLines / linesPerRow);
    
    // If the whole file fits, no scrolling needed
    if (totalMinimapRows <= this.rect.height) {
      this.scrollTop = 0;
      return;
    }
    
    // Otherwise, scroll proportionally
    const scrollRatio = this.editorScrollTop / Math.max(1, totalLines - this.editorVisibleLines);
    const maxScroll = totalMinimapRows - this.rect.height;
    this.scrollTop = Math.floor(scrollRatio * maxScroll);
  }

  /**
   * Render the minimap
   */
  render(ctx: RenderContext): void {
    if (!this.enabled || !this.document) return;

    // Build cache if needed
    if (!this.cache || this.cache.lineCount !== this.document.lineCount) {
      this.buildCache();
    }

    const moveTo = (x: number, y: number) => `\x1b[${y};${x}H`;
    const bgRgb = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`;
    const fgRgb = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
    const reset = '\x1b[0m';

    // Get colors from theme - use editor background as base
    const editorBgHex = themeLoader.getColor('editor.background');
    const editorBg = this.hexToRgb(editorBgHex);
    
    // Minimap background is slightly darker/different than editor
    const minimapBg = editorBg 
      ? { r: Math.max(0, editorBg.r - 10), g: Math.max(0, editorBg.g - 10), b: Math.max(0, editorBg.b - 10) }
      : { r: 30, g: 30, b: 46 };
    
    // Slider background is a semi-transparent overlay effect - lighten the background
    const sliderBg = editorBg
      ? { 
          r: Math.min(255, editorBg.r + (this.isDragging ? 60 : this.isHovering ? 45 : 30)), 
          g: Math.min(255, editorBg.g + (this.isDragging ? 60 : this.isHovering ? 45 : 30)), 
          b: Math.min(255, editorBg.b + (this.isDragging ? 60 : this.isHovering ? 45 : 30))
        }
      : { r: 100, g: 100, b: 120 };

    let output = '';
    
    // Calculate viewport indicator position
    const linesPerRow = this.getLinesPerRow();
    const viewportStartRow = Math.floor(this.editorScrollTop / linesPerRow) - this.scrollTop;
    const viewportEndRow = Math.floor((this.editorScrollTop + this.editorVisibleLines) / linesPerRow) - this.scrollTop;

    // Render each row
    for (let screenRow = 0; screenRow < this.rect.height; screenRow++) {
      const cacheRow = screenRow + this.scrollTop;
      const screenY = this.rect.y + screenRow;
      const screenX = this.rect.x;
      
      output += moveTo(screenX, screenY);
      
      // Check if this row is in the viewport
      const isInViewport = screenRow >= viewportStartRow && screenRow <= viewportEndRow;
      
      // Background
      const bg = isInViewport ? sliderBg : minimapBg;
      output += bgRgb(bg.r, bg.g, bg.b);
      
      if (this.cache && cacheRow < this.cache.chars.length) {
        const char = this.cache.chars[cacheRow] || ' ';
        const color = this.cache.colors[cacheRow];
        
        if (color) {
          const rgb = this.hexToRgb(color);
          if (rgb) {
            output += fgRgb(rgb.r, rgb.g, rgb.b);
          }
        }
        
        // Render the braille character(s) to fill width
        const chars = this.cache.chars[cacheRow] || '';
        output += chars.padEnd(this.width, ' ');
      } else {
        output += ' '.repeat(this.width);
      }
    }
    
    output += reset;
    ctx.buffer(output);
  }

  /**
   * Build the complete minimap cache
   */
  private buildCache(): void {
    if (!this.document) {
      this.cache = null;
      return;
    }

    const linesPerRow = this.getLinesPerRow();
    const totalRows = Math.ceil(this.document.lineCount / linesPerRow);
    
    const chars: string[] = [];
    const colors: string[] = [];
    
    for (let row = 0; row < totalRows; row++) {
      const startLine = row * linesPerRow;
      const endLine = Math.min(startLine + linesPerRow, this.document.lineCount);
      const { char, color } = this.renderMinimapRow(startLine, endLine);
      chars.push(char);
      colors.push(color);
    }
    
    this.cache = {
      content: this.document.content,
      lineCount: this.document.lineCount,
      chars,
      colors
    };
  }

  /**
   * Render a single minimap row (may represent multiple source lines)
   */
  private renderMinimapRow(startLine: number, endLine: number): { char: string; color: string } {
    if (!this.document) return { char: ' '.repeat(this.width), color: '' };
    
    // Number of braille characters to render horizontally
    const brailleWidth = this.width;
    // Each braille char is 2 columns wide
    const columnsPerChar = Math.ceil(this.maxColumn / brailleWidth / 2);
    // Each braille char is 4 rows tall
    const linesPerBraille = Math.max(1, Math.ceil((endLine - startLine) / 4));
    
    let result = '';
    const colorCounts = new Map<string, number>();
    
    for (let charIndex = 0; charIndex < brailleWidth; charIndex++) {
      const colStart = charIndex * columnsPerChar * 2;
      const colEnd = colStart + columnsPerChar * 2;
      
      // Build 4x2 dot matrix for this braille char
      const dots: boolean[][] = [
        [false, false],
        [false, false],
        [false, false],
        [false, false],
      ];
      
      // Sample lines for this braille character
      for (let dotRow = 0; dotRow < 4; dotRow++) {
        const lineOffset = Math.floor(dotRow * linesPerBraille / 4);
        const lineNum = startLine + lineOffset;
        
        if (lineNum >= endLine || lineNum >= this.document.lineCount) continue;
        
        const line = this.document.getLine(lineNum);
        const tokens = shikiHighlighter.highlightLine(lineNum);
        
        // Left dot (col 0)
        for (let col = colStart; col < colStart + columnsPerChar && col < line.length; col++) {
          if (line[col] && line[col] !== ' ' && line[col] !== '\t') {
            dots[dotRow]![0] = true;
            
            // Sample color from token
            const token = tokens.find(t => col >= t.start && col < t.end);
            if (token?.color) {
              colorCounts.set(token.color, (colorCounts.get(token.color) || 0) + 1);
            }
            break;
          }
        }
        
        // Right dot (col 1)
        for (let col = colStart + columnsPerChar; col < colEnd && col < line.length; col++) {
          if (line[col] && line[col] !== ' ' && line[col] !== '\t') {
            dots[dotRow]![1] = true;
            
            // Sample color from token
            const token = tokens.find(t => col >= t.start && col < t.end);
            if (token?.color) {
              colorCounts.set(token.color, (colorCounts.get(token.color) || 0) + 1);
            }
            break;
          }
        }
      }
      
      result += toBraille(dots);
    }
    
    // Find dominant color
    let dominantColor = '';
    let maxCount = 0;
    for (const [color, count] of colorCounts) {
      if (count > maxCount) {
        maxCount = count;
        dominantColor = color;
      }
    }
    
    // Default to foreground color if no tokens
    if (!dominantColor) {
      dominantColor = themeLoader.getColor('editor.foreground') || '#c6d0f5';
    }
    
    return { char: result, color: dominantColor };
  }

  /**
   * Convert screen Y to document line
   */
  private screenYToLine(screenY: number): number {
    if (!this.document) return 0;
    
    const row = screenY - this.rect.y + this.scrollTop;
    const linesPerRow = this.getLinesPerRow();
    return Math.floor(row * linesPerRow);
  }

  /**
   * Convert hex color to RGB
   */
  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const match = hex?.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (!match) return null;
    return {
      r: parseInt(match[1]!, 16),
      g: parseInt(match[2]!, 16),
      b: parseInt(match[3]!, 16)
    };
  }

  // MouseHandler implementation

  containsPoint(x: number, y: number): boolean {
    if (!this.enabled) return false;
    return (
      x >= this.rect.x &&
      x < this.rect.x + this.rect.width &&
      y >= this.rect.y &&
      y < this.rect.y + this.rect.height
    );
  }

  onMouseEvent(event: MouseEvent): boolean {
    if (!this.enabled || !this.document) return false;

    switch (event.name) {
      case 'MOUSE_LEFT_BUTTON_PRESSED': {
        this.isDragging = true;
        const targetLine = this.screenYToLine(event.y);
        // Center the viewport on the clicked line
        const centeredLine = Math.max(0, targetLine - Math.floor(this.editorVisibleLines / 2));
        if (this.onScrollCallback) {
          this.onScrollCallback(centeredLine);
        }
        return true;
      }

      case 'MOUSE_LEFT_BUTTON_RELEASED':
        this.isDragging = false;
        return true;

      case 'MOUSE_DRAG': {
        if (this.isDragging) {
          const targetLine = this.screenYToLine(event.y);
          const centeredLine = Math.max(0, targetLine - Math.floor(this.editorVisibleLines / 2));
          if (this.onScrollCallback) {
            this.onScrollCallback(centeredLine);
          }
        }
        return true;
      }

      case 'MOUSE_MOTION':
        this.isHovering = true;
        return false; // Don't consume motion events

      case 'MOUSE_WHEEL_UP': {
        // Scroll editor up
        const newScroll = Math.max(0, this.editorScrollTop - 3);
        if (this.onScrollCallback) {
          this.onScrollCallback(newScroll);
        }
        return true;
      }

      case 'MOUSE_WHEEL_DOWN': {
        // Scroll editor down
        const maxScroll = Math.max(0, this.document.lineCount - this.editorVisibleLines);
        const newScroll = Math.min(maxScroll, this.editorScrollTop + 3);
        if (this.onScrollCallback) {
          this.onScrollCallback(newScroll);
        }
        return true;
      }
    }

    return false;
  }

  /**
   * Clear hover state (called when mouse leaves)
   */
  clearHover(): void {
    this.isHovering = false;
    this.isDragging = false;
  }
}

export const minimap = new Minimap();
export default minimap;
