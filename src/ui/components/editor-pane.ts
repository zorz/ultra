/**
 * Editor Pane Component
 * 
 * Renders a single editor pane with document content, line numbers,
 * cursor, and selection highlighting.
 */

import type { Document } from '../../core/document.ts';
import type { RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import type { Position } from '../../core/buffer.ts';
import { hasSelection, getSelectionRange } from '../../core/cursor.ts';
import { highlighter as shikiHighlighter, type HighlightToken } from '../../features/syntax/shiki-highlighter.ts';
import { themeLoader } from '../themes/theme-loader.ts';
import { minimap } from './minimap.ts';
import { inFileSearch, type SearchMatch } from '../../features/search/in-file-search.ts';
import { settings } from '../../config/settings.ts';

// Represents a wrapped line segment
interface WrappedLine {
  bufferLine: number;      // The actual line in the buffer
  startColumn: number;     // Starting column in the buffer line
  endColumn: number;       // Ending column (exclusive) in the buffer line
  isFirstWrap: boolean;    // True if this is the first segment of the line
}

export interface EditorTheme {
  background: string;
  foreground: string;
  lineNumberForeground: string;
  lineNumberActiveForeground: string;
  gutterBackground: string;
  selectionBackground: string;
  cursorForeground: string;
  lineHighlightBackground: string;
}

const defaultTheme: EditorTheme = {
  background: '#282c34',
  foreground: '#abb2bf',
  lineNumberForeground: '#495162',
  lineNumberActiveForeground: '#abb2bf',
  gutterBackground: '#282c34',
  selectionBackground: '#3e4451',
  cursorForeground: '#528bff',
  lineHighlightBackground: '#2c313c'
};

export class EditorPane implements MouseHandler {
  private document: Document | null = null;
  private rect: Rect = { x: 1, y: 1, width: 80, height: 24 };
  private scrollTop: number = 0;  // Now represents screen line, not buffer line
  private scrollLeft: number = 0;
  private gutterWidth: number = 5;  // Line numbers + margin
  private theme: EditorTheme = defaultTheme;
  private isFocused: boolean = true;
  private lastParsedContent: string = '';
  private lastLanguage: string = '';
  private highlighterReady: boolean = false;
  private minimapEnabled: boolean = true;
  
  // Word wrap state
  private wrappedLines: WrappedLine[] = [];
  private lastWrapWidth: number = 0;
  private lastWrapContent: string = '';  // Track content for wrap cache invalidation

  // Callbacks
  private onClickCallback?: (position: Position, clickCount: number, event: MouseEvent) => void;
  private onDragCallback?: (position: Position, event: MouseEvent) => void;
  private onScrollCallback?: (deltaX: number, deltaY: number) => void;

  constructor() {
    // Setup minimap scroll callback
    minimap.onScroll((line) => {
      this.setScrollTop(line);
      if (this.onScrollCallback) {
        this.onScrollCallback(0, 0);
      }
    });
  }

  /**
   * Set the document to display
   */
  setDocument(doc: Document | null): void {
    this.document = doc;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.updateGutterWidth();
    
    // Setup minimap
    minimap.setDocument(doc);
    
    // Setup syntax highlighting with Shiki
    if (doc) {
      const language = doc.language;
      if (language !== this.lastLanguage) {
        // Try to set language - this may trigger async loading
        this.highlighterReady = shikiHighlighter.setLanguageSync(language);
        if (!this.highlighterReady) {
          // Async load and re-parse when ready
          shikiHighlighter.setLanguage(language).then((success) => {
            if (success && this.document) {
              this.highlighterReady = true;
              shikiHighlighter.parse(this.document.content);
              this.lastParsedContent = this.document.content;
            }
          });
        }
        this.lastLanguage = language;
      }
      // Parse the document for highlighting
      const content = doc.content;
      if (content !== this.lastParsedContent && this.highlighterReady) {
        shikiHighlighter.parse(content);
        this.lastParsedContent = content;
      }
    }
  }

  /**
   * Get the current document
   */
  getDocument(): Document | null {
    return this.document;
  }

  /**
   * Set the pane rect
   */
  setRect(rect: Rect): void {
    this.rect = rect;
    this.updateGutterWidth();
    
    // Update minimap rect (right side of editor)
    const minimapWidth = minimap.getWidth();
    if (minimapWidth > 0) {
      minimap.setRect({
        x: rect.x + rect.width - minimapWidth,
        y: rect.y,
        width: minimapWidth,
        height: rect.height
      });
    }
  }

  /**
   * Toggle minimap visibility
   */
  toggleMinimap(): void {
    this.minimapEnabled = !this.minimapEnabled;
    minimap.setEnabled(this.minimapEnabled);
  }

  /**
   * Get minimap instance (for registering as mouse handler)
   */
  getMinimap(): typeof minimap {
    return minimap;
  }

  /**
   * Check if word wrap is enabled
   */
  private isWordWrapEnabled(): boolean {
    const wrapSetting = settings.get('editor.wordWrap');
    return wrapSetting === 'on' || wrapSetting === 'wordWrapColumn' || wrapSetting === 'bounded';
  }

  /**
   * Compute wrapped lines for the entire document
   * This builds a mapping from screen lines to buffer line segments
   */
  private computeWrappedLines(): void {
    if (!this.document) {
      this.wrappedLines = [];
      return;
    }

    const textWidth = this.getVisibleColumnCount();
    const content = this.document.content;

    // Cache check - only recompute if width or content changed
    if (textWidth === this.lastWrapWidth && content === this.lastWrapContent && this.wrappedLines.length > 0) {
      return;
    }

    this.lastWrapWidth = textWidth;
    this.lastWrapContent = content;
    this.wrappedLines = [];

    const lineCount = this.document.lineCount;

    if (!this.isWordWrapEnabled() || textWidth <= 0) {
      // No wrapping - each buffer line is one screen line
      for (let i = 0; i < lineCount; i++) {
        const lineLen = this.document.getLine(i).length;
        this.wrappedLines.push({
          bufferLine: i,
          startColumn: 0,
          endColumn: lineLen,
          isFirstWrap: true
        });
      }
      return;
    }

    // Compute wrapped lines
    for (let bufferLine = 0; bufferLine < lineCount; bufferLine++) {
      const line = this.document.getLine(bufferLine);
      const lineLen = line.length;

      if (lineLen <= textWidth) {
        // Line fits on one screen line
        this.wrappedLines.push({
          bufferLine,
          startColumn: 0,
          endColumn: lineLen,
          isFirstWrap: true
        });
      } else {
        // Line needs wrapping - break at word boundaries
        let col = 0;
        let isFirst = true;
        while (col < lineLen) {
          let endCol = Math.min(col + textWidth, lineLen);
          
          // If we're not at the end of the line, try to find a good break point
          if (endCol < lineLen) {
            // Look backwards for a break point (space or delimiter)
            let breakCol = endCol;
            while (breakCol > col) {
              const char = line[breakCol - 1];
              // Break after spaces, or after common delimiters
              if (char === ' ' || char === '\t') {
                // Break at this position (include the space in current segment)
                break;
              }
              if (char === '.' || char === ',' || char === ';' || char === ':' ||
                  char === ')' || char === ']' || char === '}' || char === '>' ||
                  char === '-' || char === '/' || char === '\\') {
                // Break after the delimiter
                break;
              }
              breakCol--;
            }
            
            // Only use the break point if it's not too far back (at least 50% of width)
            if (breakCol > col + Math.floor(textWidth / 2)) {
              endCol = breakCol;
            }
            // Otherwise, just break at the character boundary (original endCol)
          }
          
          this.wrappedLines.push({
            bufferLine,
            startColumn: col,
            endColumn: endCol,
            isFirstWrap: isFirst
          });
          col = endCol;
          isFirst = false;
        }
      }
    }
  }

  /**
   * Convert buffer position to screen line
   */
  private bufferToScreenLine(bufferLine: number, column: number = 0): number {
    if (!this.isWordWrapEnabled()) {
      return bufferLine;
    }

    for (let i = 0; i < this.wrappedLines.length; i++) {
      const wrap = this.wrappedLines[i]!;
      if (wrap.bufferLine === bufferLine && column >= wrap.startColumn && column < wrap.endColumn) {
        return i;
      }
      // Handle cursor at end of line
      if (wrap.bufferLine === bufferLine && column === wrap.endColumn && 
          (i + 1 >= this.wrappedLines.length || this.wrappedLines[i + 1]!.bufferLine !== bufferLine)) {
        return i;
      }
    }
    // Fallback - find last wrap for this buffer line
    for (let i = this.wrappedLines.length - 1; i >= 0; i--) {
      if (this.wrappedLines[i]!.bufferLine === bufferLine) {
        return i;
      }
    }
    return Math.min(bufferLine, this.wrappedLines.length - 1);
  }

  /**
   * Convert screen position to buffer position
   */
  private screenToBufferPosition(screenLine: number, screenColumn: number): Position {
    if (!this.isWordWrapEnabled() || screenLine >= this.wrappedLines.length) {
      return { line: screenLine, column: screenColumn };
    }

    const wrap = this.wrappedLines[screenLine];
    if (!wrap) {
      return { line: screenLine, column: screenColumn };
    }

    return {
      line: wrap.bufferLine,
      column: wrap.startColumn + screenColumn
    };
  }

  /**
   * Set theme
   */
  setTheme(theme: Partial<EditorTheme>): void {
    this.theme = { ...defaultTheme, ...theme };
  }

  /**
   * Set focus state
   */
  setFocused(focused: boolean): void {
    this.isFocused = focused;
  }

  /**
   * Set click callback
   */
  onClick(callback: (position: Position, clickCount: number, event: MouseEvent) => void): void {
    this.onClickCallback = callback;
  }

  /**
   * Set drag callback
   */
  onDrag(callback: (position: Position, event: MouseEvent) => void): void {
    this.onDragCallback = callback;
  }

  /**
   * Set scroll callback
   */
  onScroll(callback: (deltaX: number, deltaY: number) => void): void {
    this.onScrollCallback = callback;
  }

  /**
   * Scroll to ensure cursor is visible
   */
  ensureCursorVisible(): void {
    if (!this.document) return;

    const cursor = this.document.primaryCursor;
    const visibleLines = this.getVisibleLineCount();
    const visibleCols = this.getVisibleColumnCount();

    // Recompute wrapped lines for accurate positioning
    this.computeWrappedLines();

    if (this.isWordWrapEnabled()) {
      // With word wrap, we scroll by screen lines
      const screenLine = this.bufferToScreenLine(cursor.position.line, cursor.position.column);
      
      if (screenLine < this.scrollTop) {
        this.scrollTop = screenLine;
      } else if (screenLine >= this.scrollTop + visibleLines) {
        this.scrollTop = screenLine - visibleLines + 1;
      }
      // No horizontal scrolling with word wrap
      this.scrollLeft = 0;
    } else {
      // Without word wrap, scroll by buffer lines
      if (cursor.position.line < this.scrollTop) {
        this.scrollTop = cursor.position.line;
      } else if (cursor.position.line >= this.scrollTop + visibleLines) {
        this.scrollTop = cursor.position.line - visibleLines + 1;
      }

      // Horizontal scrolling
      if (cursor.position.column < this.scrollLeft) {
        this.scrollLeft = cursor.position.column;
      } else if (cursor.position.column >= this.scrollLeft + visibleCols) {
        this.scrollLeft = cursor.position.column - visibleCols + 1;
      }
    }
  }

  /**
   * Scroll by delta
   */
  scroll(deltaX: number, deltaY: number): void {
    if (!this.document) return;

    this.computeWrappedLines();
    const totalLines = this.isWordWrapEnabled() ? this.wrappedLines.length : this.document.lineCount;
    const maxScrollTop = Math.max(0, totalLines - this.getVisibleLineCount());
    this.scrollTop = Math.max(0, Math.min(maxScrollTop, this.scrollTop + deltaY));
    
    if (!this.isWordWrapEnabled()) {
      this.scrollLeft = Math.max(0, this.scrollLeft + deltaX);
    }
  }

  /**
   * Get visible line count
   */
  getVisibleLineCount(): number {
    return this.rect.height;
  }

  /**
   * Get visible column count (after gutter and minimap)
   */
  getVisibleColumnCount(): number {
    return this.rect.width - this.gutterWidth - minimap.getWidth();
  }

  /**
   * Render the editor pane
   */
  render(ctx: RenderContext): void {
    if (!this.document) {
      this.renderEmptyState(ctx);
      return;
    }

    // Update gutter width based on line count
    this.updateGutterWidth();
    
    // Update syntax highlighting if content changed
    const content = this.document.content;
    if (content !== this.lastParsedContent && this.highlighterReady) {
      shikiHighlighter.parse(content);
      this.lastParsedContent = content;
      minimap.invalidateCache();
    }

    // Compute wrapped lines
    this.computeWrappedLines();

    // Update minimap scroll state
    minimap.setEditorScroll(this.scrollTop, this.getVisibleLineCount());

    const visibleLines = this.getVisibleLineCount();
    const minimapWidth = minimap.getWidth();
    const textWidth = this.rect.width - this.gutterWidth - minimapWidth;

    // Get all selection ranges for highlighting
    const selections = this.document.cursors
      .filter(c => c.selection && hasSelection(c.selection))
      .map(c => getSelectionRange(c.selection!));

    // Get search matches for highlighting
    const searchState = inFileSearch.getState(this.document);
    const searchMatches = searchState.isActive ? searchState.matches : [];
    const currentMatchIndex = searchState.currentMatchIndex;

    // Build entire screen as one string
    let screenOutput = '';
    const moveTo = (x: number, y: number) => `\x1b[${y};${x}H`;

    const wordWrapEnabled = this.isWordWrapEnabled();

    // Render each visible line as a single string with embedded ANSI
    for (let i = 0; i < visibleLines; i++) {
      const screenLineIndex = this.scrollTop + i;
      const screenY = this.rect.y + i;

      screenOutput += moveTo(this.rect.x, screenY);

      if (wordWrapEnabled && screenLineIndex < this.wrappedLines.length) {
        // Render wrapped line segment
        const wrap = this.wrappedLines[screenLineIndex]!;
        screenOutput += this.buildWrappedLineString(wrap, textWidth, selections, searchMatches, currentMatchIndex);
      } else if (!wordWrapEnabled) {
        // Render normal line (screenLineIndex is buffer line)
        screenOutput += this.buildLineString(screenLineIndex, textWidth, selections, searchMatches, currentMatchIndex);
      } else {
        // Past end of wrapped lines - render empty
        screenOutput += this.buildEmptyLineString(textWidth);
      }
    }

    // Render cursor(s) - these are overlaid on top
    screenOutput += this.buildCursorsString(ctx);
    
    // Buffer everything for atomic write
    ctx.buffer(screenOutput);
    
    // Render minimap
    minimap.render(ctx);
  }

  /**
   * Build empty line string (for lines past document end)
   */
  private buildEmptyLineString(textWidth: number): string {
    const bgRgb = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`;
    const gutterBgColor = this.hexToRgb(themeLoader.getColor('editorGutter.background')) || { r: 40, g: 44, b: 52 };
    const editorBgColor = this.hexToRgb(themeLoader.getColor('editor.background')) || { r: 40, g: 44, b: 52 };
    
    let output = '';
    output += bgRgb(gutterBgColor.r, gutterBgColor.g, gutterBgColor.b) + ' '.repeat(this.gutterWidth);
    output += bgRgb(editorBgColor.r, editorBgColor.g, editorBgColor.b) + ' '.repeat(textWidth);
    return output;
  }

  /**
   * Build a wrapped line segment string with ANSI codes (gutter + partial content)
   */
  private buildWrappedLineString(
    wrap: WrappedLine,
    textWidth: number,
    selections: { start: Position; end: Position }[],
    searchMatches: SearchMatch[] = [],
    currentMatchIndex: number = -1
  ): string {
    const bgRgb = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`;
    const fgRgb = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
    
    // Get theme colors
    const gutterBgColor = this.hexToRgb(themeLoader.getColor('editorGutter.background')) || { r: 40, g: 44, b: 52 };
    const lineNumColor = this.hexToRgb(themeLoader.getColor('editorLineNumber.foreground')) || { r: 73, g: 81, b: 98 };
    const lineNumActiveColor = this.hexToRgb(themeLoader.getColor('editorLineNumber.activeForeground')) || { r: 171, g: 178, b: 191 };
    const editorBgColor = this.hexToRgb(themeLoader.getColor('editor.background')) || { r: 40, g: 44, b: 52 };
    const lineHighlightColor = this.hexToRgb(themeLoader.getColor('editor.lineHighlightBackground')) || { r: 44, g: 49, b: 60 };
    const selectionBgColor = this.hexToRgb(themeLoader.getColor('editor.selectionBackground')) || { r: 62, g: 68, b: 81 };
    const defaultFgColor = this.hexToRgb(themeLoader.getColor('editor.foreground')) || { r: 171, g: 178, b: 191 };
    const findMatchBgColor = this.hexToRgb(themeLoader.getColor('editor.findMatchBackground')) || { r: 81, g: 92, b: 106 };
    const findMatchHighlightBgColor = this.hexToRgb(themeLoader.getColor('editor.findMatchHighlightBackground')) || { r: 234, g: 92, b: 0 };
    
    let output = '';
    const lineNum = wrap.bufferLine;
    
    // Gutter - only show line number on first wrap
    const gutterBg = bgRgb(gutterBgColor.r, gutterBgColor.g, gutterBgColor.b);
    if (wrap.isFirstWrap && this.document) {
      const isCursorLine = this.document.cursors.some(c => c.position.line === lineNum);
      const gutterFgRgb = isCursorLine ? lineNumActiveColor : lineNumColor;
      const gutterFg = fgRgb(gutterFgRgb.r, gutterFgRgb.g, gutterFgRgb.b);
      const numStr = String(lineNum + 1).padStart(this.gutterWidth - 1, ' ') + ' ';
      output += gutterBg + gutterFg + numStr;
    } else {
      // Continuation line - show wrap indicator
      const gutterFg = fgRgb(lineNumColor.r, lineNumColor.g, lineNumColor.b);
      output += gutterBg + gutterFg + ' '.repeat(this.gutterWidth - 2) + '↳ ';
    }
    
    // Line content
    const line = this.document!.getLine(lineNum);
    const isCursorLine = this.document?.cursors.some(c => c.position.line === lineNum);
    const baseBgColor = isCursorLine && this.isFocused ? lineHighlightColor : editorBgColor;
    
    // Get highlight tokens for this line
    const tokens = shikiHighlighter.highlightLine(lineNum);
    const colorMap = this.buildColorMap(line.length, tokens);
    
    // Pre-compute search match ranges for this line
    const lineSearchMatches = searchMatches.filter(m => {
      const { start, end } = m.range;
      return lineNum >= start.line && lineNum <= end.line;
    });
    
    let currentBgKey = this.rgbToKey(baseBgColor);
    let currentFgKey = -1;
    output += bgRgb(baseBgColor.r, baseBgColor.g, baseBgColor.b);
    
    // Render the portion of the line specified by wrap
    for (let screenCol = 0; screenCol < textWidth; screenCol++) {
      const col = wrap.startColumn + screenCol;
      const char = col < line.length ? line[col]! : ' ';
      
      // Check if selected
      const isSelected = selections.some(sel => {
        if (lineNum < sel.start.line || lineNum > sel.end.line) return false;
        if (lineNum === sel.start.line && lineNum === sel.end.line) {
          return col >= sel.start.column && col < sel.end.column;
        }
        if (lineNum === sel.start.line) return col >= sel.start.column;
        if (lineNum === sel.end.line) return col < sel.end.column;
        return true;
      });
      
      // Check if in a search match
      let isInSearchMatch = false;
      let isCurrentMatch = false;
      for (const match of lineSearchMatches) {
        const { start, end } = match.range;
        let inMatch = false;
        if (lineNum === start.line && lineNum === end.line) {
          inMatch = col >= start.column && col < end.column;
        } else if (lineNum === start.line) {
          inMatch = col >= start.column;
        } else if (lineNum === end.line) {
          inMatch = col < end.column;
        } else {
          inMatch = true;
        }
        if (inMatch) {
          isInSearchMatch = true;
          isCurrentMatch = match.index === currentMatchIndex;
          break;
        }
      }
      
      // Apply background
      let newBgColor = baseBgColor;
      if (isSelected) {
        newBgColor = selectionBgColor;
      } else if (isCurrentMatch) {
        newBgColor = findMatchHighlightBgColor;
      } else if (isInSearchMatch) {
        newBgColor = findMatchBgColor;
      }
      
      const newBgKey = this.rgbToKey(newBgColor);
      if (newBgKey !== currentBgKey) {
        currentBgKey = newBgKey;
        output += bgRgb(newBgColor.r, newBgColor.g, newBgColor.b);
      }
      
      // Apply foreground color from syntax highlighting
      const tokenColor = col < colorMap.length ? colorMap[col] : null;
      if (tokenColor) {
        const rgb = this.hexToRgb(tokenColor);
        if (rgb) {
          const newFgKey = this.rgbToKey(rgb);
          if (newFgKey !== currentFgKey) {
            currentFgKey = newFgKey;
            output += fgRgb(rgb.r, rgb.g, rgb.b);
          }
        }
      } else if (currentFgKey !== -1) {
        currentFgKey = -1;
        output += fgRgb(defaultFgColor.r, defaultFgColor.g, defaultFgColor.b);
      }
      
      // Only output actual character, not beyond wrap.endColumn
      if (col < wrap.endColumn) {
        output += char === '\t' ? ' ' : char;
      } else {
        output += ' ';
      }
    }
    
    return output;
  }

  /**
   * Build a complete line string with ANSI codes (gutter + content)
   */
  private buildLineString(
    lineNum: number,
    textWidth: number,
    selections: { start: Position; end: Position }[],
    searchMatches: SearchMatch[] = [],
    currentMatchIndex: number = -1
  ): string {
    // ANSI escape helpers
    const bgRgb = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`;
    const fgRgb = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
    const reset = '\x1b[0m';
    
    // Get theme colors
    const gutterBgColor = this.hexToRgb(themeLoader.getColor('editorGutter.background')) || { r: 40, g: 44, b: 52 };
    const lineNumColor = this.hexToRgb(themeLoader.getColor('editorLineNumber.foreground')) || { r: 73, g: 81, b: 98 };
    const lineNumActiveColor = this.hexToRgb(themeLoader.getColor('editorLineNumber.activeForeground')) || { r: 171, g: 178, b: 191 };
    const editorBgColor = this.hexToRgb(themeLoader.getColor('editor.background')) || { r: 40, g: 44, b: 52 };
    const lineHighlightColor = this.hexToRgb(themeLoader.getColor('editor.lineHighlightBackground')) || { r: 44, g: 49, b: 60 };
    const selectionBgColor = this.hexToRgb(themeLoader.getColor('editor.selectionBackground')) || { r: 62, g: 68, b: 81 };
    const defaultFgColor = this.hexToRgb(themeLoader.getColor('editor.foreground')) || { r: 171, g: 178, b: 191 };
    
    // Search match highlight colors
    const findMatchBgColor = this.hexToRgb(themeLoader.getColor('editor.findMatchBackground')) || { r: 81, g: 92, b: 106 };
    const findMatchHighlightBgColor = this.hexToRgb(themeLoader.getColor('editor.findMatchHighlightBackground')) || { r: 234, g: 92, b: 0 };
    
    let output = '';
    
    // Gutter
    const gutterBg = bgRgb(gutterBgColor.r, gutterBgColor.g, gutterBgColor.b);
    if (lineNum >= 0 && lineNum < (this.document?.lineCount || 0)) {
      const isCursorLine = this.document?.cursors.some(c => c.position.line === lineNum);
      const gutterFgRgb = isCursorLine ? lineNumActiveColor : lineNumColor;
      const gutterFg = fgRgb(gutterFgRgb.r, gutterFgRgb.g, gutterFgRgb.b);
      const numStr = String(lineNum + 1).padStart(this.gutterWidth - 1, ' ') + ' ';
      output += gutterBg + gutterFg + numStr;
    } else {
      output += gutterBg + ' '.repeat(this.gutterWidth);
    }
    
    // Line content
    if (lineNum < 0 || lineNum >= (this.document?.lineCount || 0)) {
      // Empty line after document end
      output += bgRgb(editorBgColor.r, editorBgColor.g, editorBgColor.b) + ' '.repeat(textWidth);
    } else {
      const line = this.document!.getLine(lineNum);
      const isCursorLine = this.document?.cursors.some(c => c.position.line === lineNum);
      const baseBgColor = isCursorLine && this.isFocused ? lineHighlightColor : editorBgColor;
      
      const visibleStart = this.scrollLeft;
      const visibleEnd = this.scrollLeft + textWidth;
      
      // Get highlight tokens for this line
      const tokens = shikiHighlighter.highlightLine(lineNum);
      
      // Build a color map for each column
      const colorMap = this.buildColorMap(line.length, tokens);
      
      // Pre-compute search match ranges for this line
      const lineSearchMatches = searchMatches.filter(m => {
        const { start, end } = m.range;
        return lineNum >= start.line && lineNum <= end.line;
      });
      
      let currentBgKey = this.rgbToKey(baseBgColor);
      let currentFgKey = -1; // -1 means default foreground
      output += bgRgb(baseBgColor.r, baseBgColor.g, baseBgColor.b);
      
      for (let col = visibleStart; col < visibleEnd; col++) {
        const char = col < line.length ? line[col]! : ' ';
        
        // Check if selected
        const isSelected = selections.some(sel => {
          if (lineNum < sel.start.line || lineNum > sel.end.line) return false;
          if (lineNum === sel.start.line && lineNum === sel.end.line) {
            return col >= sel.start.column && col < sel.end.column;
          }
          if (lineNum === sel.start.line) return col >= sel.start.column;
          if (lineNum === sel.end.line) return col < sel.end.column;
          return true;
        });
        
        // Check if in a search match
        let isInSearchMatch = false;
        let isCurrentMatch = false;
        for (const match of lineSearchMatches) {
          const { start, end } = match.range;
          let inMatch = false;
          if (lineNum === start.line && lineNum === end.line) {
            inMatch = col >= start.column && col < end.column;
          } else if (lineNum === start.line) {
            inMatch = col >= start.column;
          } else if (lineNum === end.line) {
            inMatch = col < end.column;
          } else {
            inMatch = true;  // Line is fully within match
          }
          if (inMatch) {
            isInSearchMatch = true;
            isCurrentMatch = match.index === currentMatchIndex;
            break;
          }
        }
        
        // Apply background: selection > current match > other matches > base
        let newBgColor = baseBgColor;
        if (isSelected) {
          newBgColor = selectionBgColor;
        } else if (isCurrentMatch) {
          newBgColor = findMatchHighlightBgColor;
        } else if (isInSearchMatch) {
          newBgColor = findMatchBgColor;
        }
        
        const newBgKey = this.rgbToKey(newBgColor);
        if (newBgKey !== currentBgKey) {
          currentBgKey = newBgKey;
          output += bgRgb(newBgColor.r, newBgColor.g, newBgColor.b);
        }
        
        // Apply foreground color from syntax highlighting
        const tokenColor = col < colorMap.length ? colorMap[col] : null;
        if (tokenColor) {
          const rgb = this.hexToRgb(tokenColor);
          if (rgb && this.rgbToKey(rgb) !== currentFgKey) {
            currentFgKey = this.rgbToKey(rgb);
            output += fgRgb(rgb.r, rgb.g, rgb.b);
          }
        } else if (currentFgKey !== this.rgbToKey(defaultFgColor)) {
          currentFgKey = this.rgbToKey(defaultFgColor);
          output += fgRgb(defaultFgColor.r, defaultFgColor.g, defaultFgColor.b);
        }
        
        output += char === '\t' ? '  ' : char;
      }
    }
    
    output += reset;
    return output;
  }

  /**
   * Build a color map for a line based on highlight tokens
   */
  private buildColorMap(lineLength: number, tokens: HighlightToken[]): (string | null)[] {
    const colorMap: (string | null)[] = new Array(lineLength).fill(null);
    
    for (const token of tokens) {
      // Shiki tokens already have the color - use it directly
      const color = token.color || this.getColorForScope(token.scope);
      if (color) {
        for (let col = token.start; col < token.end && col < lineLength; col++) {
          colorMap[col] = color;
        }
      }
    }
    
    return colorMap;
  }

  /**
   * Get color for a TextMate scope from the theme
   */
  private getColorForScope(scope: string): string | null {
    // Try the full scope first, then progressively shorter prefixes
    const parts = scope.split('.');
    
    for (let i = parts.length; i > 0; i--) {
      const testScope = parts.slice(0, i).join('.');
      const settings = themeLoader.getTokenColor(testScope);
      if (settings.foreground) {
        return settings.foreground;
      }
    }
    
    // Fallback colors based on common scope prefixes
    return this.getFallbackColor(scope);
  }

  /**
   * Get fallback color for scope when theme doesn't have a match
   */
  private getFallbackColor(scope: string): string | null {
    // Catppuccin Frappé inspired fallback colors
    if (scope.startsWith('comment')) return '#626880';
    if (scope.startsWith('string')) return '#a6d189';
    if (scope.startsWith('constant.numeric')) return '#ef9f76';
    if (scope.startsWith('constant.language')) return '#ef9f76';
    if (scope.startsWith('constant.other.color')) return '#ef9f76';
    if (scope.startsWith('keyword')) return '#ca9ee6';
    if (scope.startsWith('storage')) return '#ca9ee6';
    if (scope.startsWith('entity.name.function')) return '#8caaee';
    if (scope.startsWith('entity.name.class')) return '#e5c890';
    if (scope.startsWith('entity.name.type')) return '#e5c890';
    if (scope.startsWith('entity.name.tag')) return '#e78284';
    if (scope.startsWith('entity.other.attribute-name')) return '#e5c890';
    if (scope.startsWith('variable.parameter')) return '#eebebe';
    if (scope.startsWith('variable.other.property')) return '#8caaee';
    if (scope.startsWith('variable.language')) return '#e78284';
    if (scope.startsWith('variable')) return '#c6d0f5';
    if (scope.startsWith('support.type.property-name')) return '#8caaee';
    if (scope.startsWith('support.constant.property-value')) return '#99d1db';
    if (scope.startsWith('support.function')) return '#8caaee';
    if (scope.startsWith('support.type')) return '#e5c890';
    if (scope.startsWith('punctuation')) return '#c6d0f5';
    
    // Markdown-specific scopes
    if (scope.startsWith('markup.heading')) return '#e78284';
    if (scope.startsWith('markup.bold')) return '#ef9f76';
    if (scope.startsWith('markup.italic')) return '#f4b8e4';
    if (scope.startsWith('markup.inline.raw')) return '#a6d189';
    if (scope.startsWith('markup.fenced_code')) return '#a6d189';
    if (scope.startsWith('markup.underline.link')) return '#8caaee';
    if (scope.startsWith('markup.link')) return '#99d1db';
    if (scope.startsWith('markup.list.marker')) return '#8caaee';
    if (scope.startsWith('markup.quote')) return '#626880';
    if (scope.startsWith('markup.hr')) return '#626880';
    if (scope.startsWith('markup.strikethrough')) return '#626880';
    if (scope.startsWith('markup')) return '#c6d0f5';
    
    return null;
  }

  /**
   * Convert hex color to RGB
   */
  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (!match) return null;
    return {
      r: parseInt(match[1]!, 16),
      g: parseInt(match[2]!, 16),
      b: parseInt(match[3]!, 16)
    };
  }

  /**
   * Create a unique key for an RGB color (for comparison)
   */
  private rgbToKey(rgb: { r: number; g: number; b: number }): number {
    return (rgb.r << 16) | (rgb.g << 8) | rgb.b;
  }

  /**
   * Render empty state (no document)
   */
  private renderEmptyState(ctx: RenderContext): void {
    const bgRgb = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`;
    const fgRgb = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
    const reset = '\x1b[0m';
    const moveTo = (x: number, y: number) => `\x1b[${y};${x}H`;
    
    const editorBg = this.hexToRgb(themeLoader.getColor('editor.background')) || { r: 40, g: 44, b: 52 };
    const fgColor = this.hexToRgb(themeLoader.getColor('editorLineNumber.foreground')) || { r: 133, g: 133, b: 133 };
    
    let output = '';
    const emptyLine = bgRgb(editorBg.r, editorBg.g, editorBg.b) + ' '.repeat(Math.max(0, this.rect.width)) + reset;
    for (let y = 0; y < this.rect.height; y++) {
      output += moveTo(this.rect.x, this.rect.y + y) + emptyLine;
    }

    // Center message
    const message = 'No file open';
    const msgX = this.rect.x + Math.floor((this.rect.width - message.length) / 2);
    const msgY = this.rect.y + Math.floor(this.rect.height / 2);
    output += moveTo(msgX, msgY) + fgRgb(fgColor.r, fgColor.g, fgColor.b) + message + reset;
    
    ctx.buffer(output);
  }

  /**
   * Build cursors string - overlaid on content
   */
  private buildCursorsString(ctx: RenderContext): string {
    if (!this.document || !this.isFocused) return '';

    const textStartX = this.rect.x + this.gutterWidth;
    const bgRgb = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`;
    const fgRgb = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
    const reset = '\x1b[0m';
    const moveTo = (x: number, y: number) => `\x1b[${y};${x}H`;
    
    // Get cursor color from theme
    const cursorColor = this.hexToRgb(themeLoader.getColor('editorCursor.foreground')) || { r: 82, g: 139, b: 255 };
    const editorBg = this.hexToRgb(themeLoader.getColor('editor.background')) || { r: 40, g: 44, b: 52 };
    
    let output = '';
    const wordWrapEnabled = this.isWordWrapEnabled();

    for (const cursor of this.document.cursors) {
      let screenLine: number;
      let screenCol: number;

      if (wordWrapEnabled) {
        // Find the screen line for this cursor
        screenLine = this.bufferToScreenLine(cursor.position.line, cursor.position.column) - this.scrollTop;
        // Find the column within the wrapped segment
        const wrapIndex = this.bufferToScreenLine(cursor.position.line, cursor.position.column);
        if (wrapIndex < this.wrappedLines.length) {
          const wrap = this.wrappedLines[wrapIndex]!;
          screenCol = cursor.position.column - wrap.startColumn;
        } else {
          screenCol = cursor.position.column;
        }
      } else {
        screenLine = cursor.position.line - this.scrollTop;
        screenCol = cursor.position.column - this.scrollLeft;
      }

      if (screenLine < 0 || screenLine >= this.rect.height) continue;
      if (screenCol < 0 || screenCol >= this.getVisibleColumnCount()) continue;

      const cursorX = textStartX + screenCol;
      const cursorY = this.rect.y + screenLine;

      // Get character under cursor
      const line = this.document.getLine(cursor.position.line);
      const char = cursor.position.column < line.length ? line[cursor.position.column]! : ' ';
      
      output += moveTo(cursorX, cursorY) + bgRgb(cursorColor.r, cursorColor.g, cursorColor.b) + fgRgb(editorBg.r, editorBg.g, editorBg.b) + char + reset;
    }
    
    return output;
  }

  /**
   * Update gutter width based on line count
   */
  private updateGutterWidth(): void {
    if (!this.document) {
      this.gutterWidth = 5;
      return;
    }
    const lineCount = this.document.lineCount;
    const digits = Math.max(3, String(lineCount).length);
    this.gutterWidth = digits + 2;  // digits + space + margin
  }

  /**
   * Convert screen coordinates to buffer position
   */
  screenToBufferPosition(screenX: number, screenY: number): Position | null {
    if (!this.document) return null;

    // Check if in text area (not gutter)
    const textStartX = this.rect.x + this.gutterWidth;
    if (screenX < textStartX) {
      screenX = textStartX;  // Snap to text area
    }

    const screenLineOffset = (screenY - this.rect.y);
    const screenCol = (screenX - textStartX);
    const screenLineIndex = screenLineOffset + this.scrollTop;

    if (this.isWordWrapEnabled()) {
      // With word wrap, map screen position to buffer position
      this.computeWrappedLines();
      
      if (screenLineIndex < 0) return { line: 0, column: 0 };
      if (screenLineIndex >= this.wrappedLines.length) {
        const lastLine = Math.max(0, this.document.lineCount - 1);
        return { line: lastLine, column: this.document.getLineLength(lastLine) };
      }

      const wrap = this.wrappedLines[screenLineIndex]!;
      const bufferCol = wrap.startColumn + screenCol;
      const lineLength = this.document.getLineLength(wrap.bufferLine);
      
      return {
        line: wrap.bufferLine,
        column: Math.max(0, Math.min(bufferCol, lineLength))
      };
    } else {
      // Without word wrap, direct mapping
      const line = screenLineIndex;
      const col = screenCol + this.scrollLeft;

      if (line < 0) return { line: 0, column: 0 };
      if (line >= this.document.lineCount) {
        const lastLine = Math.max(0, this.document.lineCount - 1);
        return { line: lastLine, column: this.document.getLineLength(lastLine) };
      }

      const lineLength = this.document.getLineLength(line);
      return {
        line,
        column: Math.max(0, Math.min(col, lineLength))
      };
    }
  }

  // MouseHandler implementation

  containsPoint(x: number, y: number): boolean {
    return (
      x >= this.rect.x &&
      x < this.rect.x + this.rect.width &&
      y >= this.rect.y &&
      y < this.rect.y + this.rect.height
    );
  }

  onMouseEvent(event: MouseEvent): boolean {
    if (!this.document) return false;

    // Ignore pure motion events - only handle clicks, drags, and scrolls
    if (event.name === 'MOUSE_MOTION' || event.name === 'MOUSE_OTHER_BUTTON_PRESSED') {
      return false;
    }

    const position = this.screenToBufferPosition(event.x, event.y);
    if (!position) return false;

    switch (event.name) {
      case 'MOUSE_LEFT_BUTTON_PRESSED':
        if (this.onClickCallback) {
          // Click count is handled by MouseManager
          this.onClickCallback(position, 1, event);
        }
        return true;

      case 'MOUSE_DRAG':
        if (this.onDragCallback) {
          this.onDragCallback(position, event);
        }
        return true;

      case 'MOUSE_WHEEL_UP':
        this.scroll(0, -3);
        if (this.onScrollCallback) {
          this.onScrollCallback(0, -3);
        }
        return true;

      case 'MOUSE_WHEEL_DOWN':
        this.scroll(0, 3);
        if (this.onScrollCallback) {
          this.onScrollCallback(0, 3);
        }
        return true;
    }

    return false;
  }

  /**
   * Get scroll position
   */
  getScrollTop(): number {
    return this.scrollTop;
  }

  getScrollLeft(): number {
    return this.scrollLeft;
  }

  /**
   * Set scroll position
   */
  setScrollTop(value: number): void {
    if (!this.document) return;
    this.computeWrappedLines();
    const totalLines = this.isWordWrapEnabled() ? this.wrappedLines.length : this.document.lineCount;
    const maxScrollTop = Math.max(0, totalLines - this.getVisibleLineCount());
    this.scrollTop = Math.max(0, Math.min(maxScrollTop, value));
  }

  setScrollLeft(value: number): void {
    if (!this.isWordWrapEnabled()) {
      this.scrollLeft = Math.max(0, value);
    }
  }

  /**
   * Invalidate wrapped lines cache (call when document changes)
   */
  invalidateWrapCache(): void {
    this.lastWrapWidth = 0;
    this.lastWrapContent = '';
  }
}

export default EditorPane;
