/**
 * Minimap Component
 * 
 * VS Code-style minimap showing a compressed bird's-eye view of the file.
 * Multiple source lines are grouped per minimap row for a compact display.
 */

import type { Document } from '../../core/document.ts';
import type { RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import { highlighter as shikiHighlighter } from '../../features/syntax/shiki-highlighter.ts';
import { themeLoader } from '../themes/theme-loader.ts';
import { settings } from '../../config/settings.ts';

// Block characters for representing code density (from empty to full)
const DENSITY_CHARS = [' ', '░', '▒', '▓', '█'];

interface MinimapCache {
  content: string;
  lineCount: number;
  linesPerRow: number;
  rows: { chars: string; colors: string[] }[];
}

export class Minimap implements MouseHandler {
  private document: Document | null = null;
  private rect: Rect = { x: 1, y: 1, width: 10, height: 24 };
  private scrollTop: number = 0;  // In minimap rows, not source lines
  private editorScrollTop: number = 0;
  private editorVisibleLines: number = 24;
  private enabled: boolean = true;
  private width: number = 10;
  private maxColumn: number = 120;
  private scale: number = 3;  // How many source lines per minimap row
  
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
    this.scale = settings.get('editor.minimap.scale') ?? 3;
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
    
    const linesPerRow = this.cache.linesPerRow;
    const dirtyRows = new Set<number>();
    
    for (const line of this.dirtyLines) {
      dirtyRows.add(Math.floor(line / linesPerRow));
    }
    
    for (const row of dirtyRows) {
      if (row < this.cache.rows.length) {
        const startLine = row * linesPerRow;
        const endLine = Math.min(startLine + linesPerRow, this.document.lineCount);
        this.cache.rows[row] = this.renderMinimapRow(startLine, endLine);
      }
    }
    
    this.dirtyLines.clear();
  }

  /**
   * Get number of source lines per minimap row
   */
  private getLinesPerRow(): number {
    return Math.max(1, this.scale);
  }

  /**
   * Update minimap scroll position based on editor scroll
   */
  private updateMinimapScroll(): void {
    if (!this.document) return;
    
    const linesPerRow = this.getLinesPerRow();
    const totalMinimapRows = Math.ceil(this.document.lineCount / linesPerRow);
    
    // If the whole file fits, no scrolling needed
    if (totalMinimapRows <= this.rect.height) {
      this.scrollTop = 0;
      return;
    }
    
    // Scroll proportionally
    const scrollRatio = this.editorScrollTop / Math.max(1, this.document.lineCount - this.editorVisibleLines);
    const maxScroll = totalMinimapRows - this.rect.height;
    this.scrollTop = Math.floor(scrollRatio * maxScroll);
  }

  /**
   * Render the minimap
   */
  render(ctx: RenderContext): void {
    if (!this.enabled || !this.document) return;

    const linesPerRow = this.getLinesPerRow();
    
    // Build cache if needed
    if (!this.cache || this.cache.lineCount !== this.document.lineCount || this.cache.linesPerRow !== linesPerRow) {
      this.buildCache();
    }

    const moveTo = (x: number, y: number) => `\x1b[${y};${x}H`;
    const bgRgb = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`;
    const fgRgb = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
    const reset = '\x1b[0m';

    // Get colors from theme
    const editorBgHex = themeLoader.getColor('editor.background');
    const editorBg = this.hexToRgb(editorBgHex);
    
    // Minimap background is slightly darker than editor
    const minimapBg = editorBg 
      ? { r: Math.max(0, editorBg.r - 10), g: Math.max(0, editorBg.g - 10), b: Math.max(0, editorBg.b - 10) }
      : { r: 30, g: 30, b: 46 };
    
    // Slider background is lighter
    const sliderBg = editorBg
      ? { 
          r: Math.min(255, editorBg.r + (this.isDragging ? 60 : this.isHovering ? 45 : 30)), 
          g: Math.min(255, editorBg.g + (this.isDragging ? 60 : this.isHovering ? 45 : 30)), 
          b: Math.min(255, editorBg.b + (this.isDragging ? 60 : this.isHovering ? 45 : 30))
        }
      : { r: 100, g: 100, b: 120 };

    let output = '';
    
    // Calculate viewport indicator position (in minimap rows)
    const viewportStartRow = Math.floor(this.editorScrollTop / linesPerRow);
    const viewportEndRow = Math.ceil((this.editorScrollTop + this.editorVisibleLines) / linesPerRow);

    // Render each row
    for (let screenRow = 0; screenRow < this.rect.height; screenRow++) {
      const cacheRow = screenRow + this.scrollTop;
      const screenY = this.rect.y + screenRow;
      const screenX = this.rect.x;
      
      output += moveTo(screenX, screenY);
      
      // Check if this row is in the viewport
      const isInViewport = cacheRow >= viewportStartRow && cacheRow < viewportEndRow;
      
      // Background
      const bg = isInViewport ? sliderBg : minimapBg;
      output += bgRgb(bg.r, bg.g, bg.b);
      
      if (this.cache && cacheRow < this.cache.rows.length) {
        const row = this.cache.rows[cacheRow]!;
        
        // Render each character with its color
        for (let i = 0; i < this.width; i++) {
          const char = row.chars[i] || ' ';
          const color = row.colors[i];
          
          if (color && char !== ' ') {
            const rgb = this.hexToRgb(color);
            if (rgb) {
              output += fgRgb(rgb.r, rgb.g, rgb.b);
            }
          }
          output += char;
        }
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
    const rows: { chars: string; colors: string[] }[] = [];
    
    for (let row = 0; row < totalRows; row++) {
      const startLine = row * linesPerRow;
      const endLine = Math.min(startLine + linesPerRow, this.document.lineCount);
      rows.push(this.renderMinimapRow(startLine, endLine));
    }
    
    this.cache = {
      content: this.document.content,
      lineCount: this.document.lineCount,
      linesPerRow,
      rows
    };
  }

  /**
   * Render a minimap row (may represent multiple source lines)
   */
  private renderMinimapRow(startLine: number, endLine: number): { chars: string; colors: string[] } {
    if (!this.document || startLine >= this.document.lineCount) {
      return { chars: ' '.repeat(this.width), colors: [] };
    }
    
    // How many source columns per minimap column
    const colsPerChar = Math.ceil(this.maxColumn / this.width);
    
    let chars = '';
    const colors: string[] = [];
    const defaultColor = themeLoader.getColor('editor.foreground') || '#c6d0f5';
    
    for (let i = 0; i < this.width; i++) {
      const colStart = i * colsPerChar;
      const colEnd = colStart + colsPerChar;
      
      // Aggregate density across all lines in this row
      let totalDensity = 0;
      let segmentColor = '';
      
      for (let lineNum = startLine; lineNum < endLine && lineNum < this.document.lineCount; lineNum++) {
        const line = this.document.getLine(lineNum);
        const tokens = shikiHighlighter.highlightLine(lineNum);
        
        for (let col = colStart; col < colEnd && col < line.length; col++) {
          const char = line[col];
          if (char && char !== ' ' && char !== '\t') {
            totalDensity++;
            // Get color from token if we don't have one yet
            if (!segmentColor) {
              const token = tokens.find(t => col >= t.start && col < t.end);
              segmentColor = token?.color || defaultColor;
            }
          }
        }
      }
      
      // Convert density to block character
      if (totalDensity === 0) {
        chars += ' ';
        colors.push('');
      } else {
        // Normalize density based on how many lines are combined
        const numLines = endLine - startLine;
        const normalizedDensity = totalDensity / numLines;
        const densityIndex = Math.min(4, Math.ceil(normalizedDensity / Math.max(1, colsPerChar / 4)));
        chars += DENSITY_CHARS[densityIndex] || '░';
        colors.push(segmentColor || defaultColor);
      }
    }
    
    return { chars, colors };
  }

  /**
   * Convert screen Y to document line
   */
  private screenYToLine(screenY: number): number {
    if (!this.document) return 0;
    const linesPerRow = this.getLinesPerRow();
    const row = screenY - this.rect.y + this.scrollTop;
    return row * linesPerRow;
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
