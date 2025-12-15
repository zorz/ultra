/**
 * Pane Component
 * 
 * A self-contained editor pane that includes its own tab bar, editor, and minimap.
 * Each pane manages its own set of open tabs independently.
 */

import { Document } from '../../core/document.ts';
import { TabBar, type Tab } from './tab-bar.ts';
import { Minimap } from './minimap.ts';
import type { RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import type { Position } from '../../core/buffer.ts';
import { hasSelection, getSelectionRange } from '../../core/cursor.ts';
import { highlighter as shikiHighlighter, type HighlightToken } from '../../features/syntax/shiki-highlighter.ts';
import { themeLoader } from '../themes/theme-loader.ts';
import { inFileSearch, type SearchMatch } from '../../features/search/in-file-search.ts';
import { settings } from '../../config/settings.ts';
import { findMatchingBracket, type BracketMatch } from '../../core/bracket-match.ts';

// Represents a wrapped line segment
interface WrappedLine {
  bufferLine: number;
  startColumn: number;
  endColumn: number;
  isFirstWrap: boolean;
}

interface EditorTheme {
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

interface PaneTab {
  id: string;           // Unique tab ID within this pane
  documentId: string;   // App's document ID (for cross-pane tracking)
  document: Document;   // Reference to shared document
  filePath: string | null;
}

export class Pane implements MouseHandler {
  readonly id: string;
  
  // Sub-components
  private tabBar: TabBar;
  private minimap: Minimap;
  
  // Tab management
  private tabs: PaneTab[] = [];
  private activeTabId: string | null = null;
  private tabIdCounter: number = 0;
  
  // Layout
  private rect: Rect = { x: 1, y: 1, width: 80, height: 24 };
  private tabBarHeight: number = 1;
  
  // Editor state
  private scrollTop: number = 0;
  private scrollLeft: number = 0;
  private gutterWidth: number = 5;
  private theme: EditorTheme = defaultTheme;
  private isFocused: boolean = false;
  private minimapEnabled: boolean = true;
  
  // Word wrap state
  private wrappedLines: WrappedLine[] = [];
  private lastWrapWidth: number = 0;
  private lastWrapContent: string = '';
  
  // Syntax highlighting
  private lastParsedContent: string = '';
  private lastLanguage: string = '';
  private highlighterReady: boolean = false;
  
  // Bracket matching
  private currentBracketMatch: BracketMatch | null = null;
  
  // Callbacks
  private onClickCallback?: (position: Position, clickCount: number, event: MouseEvent) => void;
  private onDragCallback?: (position: Position, event: MouseEvent) => void;
  private onScrollCallback?: (deltaX: number, deltaY: number) => void;
  private onFocusCallback?: () => void;
  private onTabSelectCallback?: (document: Document) => void;
  private onTabCloseCallback?: (document: Document, tabId: string) => void;

  constructor(id: string) {
    this.id = id;
    this.tabBar = new TabBar();
    this.minimap = new Minimap();
    
    this.setupTabBarCallbacks();
    this.setupMinimapCallbacks();
    this.loadSettings();
  }

  private setupTabBarCallbacks(): void {
    this.tabBar.onTabClick((tabId) => {
      this.activateTab(tabId);
    });
    
    this.tabBar.onTabClose((tabId) => {
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab && this.onTabCloseCallback) {
        this.onTabCloseCallback(tab.document, tabId);
      }
    });
  }

  private setupMinimapCallbacks(): void {
    this.minimap.onScroll((line) => {
      this.setScrollTop(line);
      if (this.onScrollCallback) {
        this.onScrollCallback(0, 0);
      }
    });
  }

  private loadSettings(): void {
    this.minimapEnabled = settings.get('editor.minimap.enabled') ?? true;
  }

  // ==================== Tab Management ====================

  /**
   * Generate unique tab ID
   */
  private generateTabId(): string {
    return `${this.id}-tab-${++this.tabIdCounter}`;
  }

  /**
   * Open a document in this pane (creates a new tab or activates existing)
   */
  openDocument(document: Document, documentId?: string): string {
    // Check if document is already open in this pane
    const existingTab = this.tabs.find(t => t.document === document);
    if (existingTab) {
      this.activateTab(existingTab.id);
      return existingTab.id;
    }
    
    // Create new tab - use provided documentId or generate one
    const tabId = this.generateTabId();
    const docId = documentId || tabId;  // Fall back to tabId if no documentId provided
    const tab: PaneTab = {
      id: tabId,
      documentId: docId,
      document,
      filePath: document.filePath
    };
    
    this.tabs.push(tab);
    this.activateTab(tabId);
    
    return tabId;
  }

  /**
   * Close a tab by ID
   */
  closeTab(tabId: string): void {
    const index = this.tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;
    
    this.tabs.splice(index, 1);
    
    // If we closed the active tab, activate another
    if (this.activeTabId === tabId) {
      if (this.tabs.length > 0) {
        const newIndex = Math.min(index, this.tabs.length - 1);
        this.activateTab(this.tabs[newIndex]!.id);
      } else {
        this.activeTabId = null;
        this.minimap.setDocument(null);
      }
    }
  }

  /**
   * Close tab containing a specific document
   */
  closeDocument(document: Document): void {
    const tab = this.tabs.find(t => t.document === document);
    if (tab) {
      this.closeTab(tab.id);
    }
  }

  /**
   * Activate a tab
   */
  private activateTab(tabId: string): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;
    
    this.activeTabId = tabId;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.updateGutterWidth();
    
    // Update minimap
    this.minimap.setDocument(tab.document);
    
    // Setup syntax highlighting
    this.setupHighlighting(tab.document);
    
    if (this.onTabSelectCallback) {
      this.onTabSelectCallback(tab.document);
    }
  }

  /**
   * Get active document
   */
  getActiveDocument(): Document | null {
    if (!this.activeTabId) return null;
    return this.tabs.find(t => t.id === this.activeTabId)?.document || null;
  }

  /**
   * Get active tab ID
   */
  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  /**
   * Check if pane has any tabs
   */
  hasTabs(): boolean {
    return this.tabs.length > 0;
  }

  /**
   * Get tab count
   */
  getTabCount(): number {
    return this.tabs.length;
  }

  /**
   * Check if document is open in this pane
   */
  hasDocument(document: Document): boolean {
    return this.tabs.some(t => t.document === document);
  }

  /**
   * Check if document with given ID is open in this pane
   */
  hasDocumentById(id: string): boolean {
    return this.tabs.some(t => t.documentId === id);
  }

  /**
   * Add a document with a specific ID (for app.ts integration)
   */
  addDocument(id: string, document: Document): void {
    // Check if already exists by documentId
    if (this.tabs.some(t => t.documentId === id)) return;
    
    const tabId = this.generateTabId();
    const tab: PaneTab = {
      id: tabId,
      documentId: id,
      document,
      filePath: document.filePath
    };
    
    this.tabs.push(tab);
  }

  /**
   * Set active document by ID (for app.ts integration)
   */
  setActiveDocument(id: string, document: Document): void {
    // Ensure the document is in our tabs
    let tab = this.tabs.find(t => t.documentId === id);
    if (!tab) {
      this.addDocument(id, document);
      tab = this.tabs.find(t => t.documentId === id);
    }
    
    this.activeTabId = tab?.id || null;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.updateGutterWidth();
    
    // Update minimap
    this.minimap.setDocument(document);
    
    // Setup syntax highlighting
    this.setupHighlighting(document);
    
    if (this.onTabSelectCallback) {
      this.onTabSelectCallback(document);
    }
  }

  /**
   * Get the active document ID (the app's document ID)
   */
  getActiveDocumentId(): string | null {
    if (!this.activeTabId) return null;
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    return tab?.documentId || null;
  }

  /**
   * Remove a document by ID (for app.ts integration)
   */
  removeDocument(id: string): void {
    const index = this.tabs.findIndex(t => t.documentId === id);
    if (index === -1) return;
    
    const closedTab = this.tabs[index]!;
    this.tabs.splice(index, 1);
    
    // If we closed the active tab, activate another
    if (this.activeTabId === closedTab.id) {
      if (this.tabs.length > 0) {
        const newIndex = Math.min(index, this.tabs.length - 1);
        const newTab = this.tabs[newIndex]!;
        this.activeTabId = newTab.id;
        this.minimap.setDocument(newTab.document);
        this.setupHighlighting(newTab.document);
        if (this.onTabSelectCallback) {
          this.onTabSelectCallback(newTab.document);
        }
      } else {
        this.activeTabId = null;
        this.minimap.setDocument(null);
      }
    }
  }

  // ==================== Focus Management ====================

  /**
   * Set focus state
   */
  setFocused(focused: boolean): void {
    const wasFocused = this.isFocused;
    this.isFocused = focused;
    
    if (focused && !wasFocused && this.onFocusCallback) {
      this.onFocusCallback();
    }
  }

  /**
   * Get focus state
   */
  getFocused(): boolean {
    return this.isFocused;
  }

  // ==================== Layout ====================

  /**
   * Set pane rect
   */
  setRect(rect: Rect): void {
    const fs = require('fs');
    const debug = (msg: string) => fs.appendFileSync('debug.log', `[Pane ${this.id}] ${msg}\n`);
    
    debug(`setRect(${JSON.stringify(rect)})`);
    this.rect = rect;
    
    // Tab bar takes top row
    debug('setting tabBar rect...');
    this.tabBar.setRect({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: this.tabBarHeight
    });
    debug('tabBar rect set');
    
    // Calculate editor area (below tab bar)
    const editorY = rect.y + this.tabBarHeight;
    const editorHeight = rect.height - this.tabBarHeight;
    
    // Minimap on right side
    const minimapWidth = this.minimapEnabled ? 10 : 0;
    const editorWidth = rect.width - minimapWidth;
    
    if (this.minimapEnabled) {
      debug('setting minimap rect...');
      this.minimap.setRect({
        x: rect.x + editorWidth,
        y: editorY,
        width: minimapWidth,
        height: editorHeight
      });
      this.minimap.setEditorScroll(this.scrollTop, editorHeight);
      debug('minimap rect set');
    }
    debug('setRect complete');
  }

  /**
   * Get pane rect
   */
  getRect(): Rect {
    return this.rect;
  }

  /**
   * Get editor area rect (excluding tab bar)
   */
  getEditorRect(): Rect {
    const minimapWidth = this.minimapEnabled ? 10 : 0;
    return {
      x: this.rect.x,
      y: this.rect.y + this.tabBarHeight,
      width: this.rect.width - minimapWidth,
      height: this.rect.height - this.tabBarHeight
    };
  }

  // ==================== Scrolling ====================

  setScrollTop(value: number): void {
    const doc = this.getActiveDocument();
    if (!doc) return;
    
    const maxScroll = Math.max(0, doc.lineCount - 1);
    this.scrollTop = Math.max(0, Math.min(value, maxScroll));
    this.minimap.setEditorScroll(this.scrollTop, this.getVisibleLineCount());
  }

  getScrollTop(): number {
    return this.scrollTop;
  }

  setScrollLeft(value: number): void {
    this.scrollLeft = Math.max(0, value);
  }

  getScrollLeft(): number {
    return this.scrollLeft;
  }

  getVisibleLineCount(): number {
    return this.rect.height - this.tabBarHeight;
  }

  /**
   * Ensure cursor is visible
   */
  ensureCursorVisible(): void {
    const doc = this.getActiveDocument();
    if (!doc) return;

    const cursor = doc.primaryCursor;
    const visibleLines = this.getVisibleLineCount();

    // Vertical scrolling
    if (cursor.line < this.scrollTop) {
      this.scrollTop = cursor.line;
    } else if (cursor.line >= this.scrollTop + visibleLines) {
      this.scrollTop = cursor.line - visibleLines + 1;
    }

    // Horizontal scrolling
    const editorWidth = this.rect.width - this.gutterWidth - (this.minimapEnabled ? 10 : 0);
    if (cursor.column < this.scrollLeft) {
      this.scrollLeft = Math.max(0, cursor.column - 5);
    } else if (cursor.column >= this.scrollLeft + editorWidth) {
      this.scrollLeft = cursor.column - editorWidth + 5;
    }

    this.minimap.setEditorScroll(this.scrollTop, visibleLines);
  }

  // ==================== Rendering ====================

  /**
   * Render the pane
   */
  render(ctx: RenderContext): void {
    const fs = require('fs');
    const debug = (msg: string) => fs.appendFileSync('debug.log', `[Pane ${this.id}] ${msg}\n`);
    
    debug(`render() called, rect=${JSON.stringify(this.rect)}, tabs=${this.tabs.length}`);
    this.updateTheme();
    
    // Render tab bar (with focus-aware styling)
    debug('rendering tab bar...');
    this.renderTabBar(ctx);
    
    // Render editor content
    debug('rendering editor...');
    this.renderEditor(ctx);
    
    // Render minimap
    if (this.minimapEnabled) {
      debug('rendering minimap...');
      this.minimap.render(ctx);
    }
    
    // Render focus indicator border if focused
    if (this.isFocused) {
      debug('rendering focus border...');
      this.renderFocusBorder(ctx);
    }
    debug('render() complete');
  }

  private renderTabBar(ctx: RenderContext): void {
    // Convert internal tabs to TabBar format
    const tabBarTabs: Tab[] = this.tabs.map(t => ({
      id: t.id,
      fileName: t.document.fileName,
      filePath: t.document.filePath,
      isDirty: t.document.isDirty,
      isActive: t.id === this.activeTabId
    }));
    
    this.tabBar.setTabs(tabBarTabs);
    this.tabBar.setFocused(this.isFocused);
    this.tabBar.render(ctx);
  }

  private renderFocusBorder(ctx: RenderContext): void {
    // Subtle highlight on the left edge to show this pane is focused
    const accentColor = themeLoader.getColor('focusBorder') || '#528bff';
    const rgb = this.hexToRgb(accentColor);
    if (!rgb) return;
    
    const fgRgb = `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m`;
    const reset = '\x1b[0m';
    
    // Draw left border
    for (let y = this.rect.y; y < this.rect.y + this.rect.height; y++) {
      ctx.buffer(`\x1b[${y};${this.rect.x}H${fgRgb}▎${reset}`);
    }
  }

  private updateTheme(): void {
    this.theme = {
      background: themeLoader.getColor('editor.background') || defaultTheme.background,
      foreground: themeLoader.getColor('editor.foreground') || defaultTheme.foreground,
      lineNumberForeground: themeLoader.getColor('editorLineNumber.foreground') || defaultTheme.lineNumberForeground,
      lineNumberActiveForeground: themeLoader.getColor('editorLineNumber.activeForeground') || defaultTheme.lineNumberActiveForeground,
      gutterBackground: themeLoader.getColor('editorGutter.background') || themeLoader.getColor('editor.background') || defaultTheme.gutterBackground,
      selectionBackground: themeLoader.getColor('editor.selectionBackground') || defaultTheme.selectionBackground,
      cursorForeground: themeLoader.getColor('editorCursor.foreground') || defaultTheme.cursorForeground,
      lineHighlightBackground: themeLoader.getColor('editor.lineHighlightBackground') || defaultTheme.lineHighlightBackground
    };
  }

  private updateGutterWidth(): void {
    const doc = this.getActiveDocument();
    if (!doc) {
      this.gutterWidth = 5;
      return;
    }
    const lineCount = doc.lineCount;
    const digits = Math.max(3, String(lineCount).length);
    this.gutterWidth = digits + 2;
  }

  private setupHighlighting(doc: Document): void {
    const language = doc.language;
    if (language && language !== 'plaintext') {
      shikiHighlighter.setLanguage(language).then(() => {
        this.highlighterReady = true;
        this.lastLanguage = language;
      }).catch(() => {
        this.highlighterReady = false;
      });
    } else {
      this.highlighterReady = false;
    }
  }

  // ==================== Editor Rendering (simplified from EditorPane) ====================

  private renderEditor(ctx: RenderContext): void {
    const fs = require('fs');
    const debug = (msg: string) => fs.appendFileSync('debug.log', `[Pane ${this.id}] ${msg}\n`);
    
    const doc = this.getActiveDocument();
    const editorRect = this.getEditorRect();
    
    debug(`renderEditor: doc=${doc ? 'exists' : 'null'}, editorRect=${JSON.stringify(editorRect)}`);
    
    // Background
    const bgRgb = this.hexToRgb(this.theme.background);
    if (bgRgb) {
      const bg = `\x1b[48;2;${bgRgb.r};${bgRgb.g};${bgRgb.b}m`;
      for (let y = editorRect.y; y < editorRect.y + editorRect.height; y++) {
        ctx.buffer(`\x1b[${y};${editorRect.x}H${bg}${' '.repeat(editorRect.width)}\x1b[0m`);
      }
    }
    debug('renderEditor: background done');
    
    if (!doc) {
      debug('renderEditor: no doc, rendering empty state');
      this.renderEmptyState(ctx, editorRect);
      return;
    }
    
    // Render line numbers and content
    debug('renderEditor: rendering content...');
    this.renderContent(ctx, doc, editorRect);
    debug('renderEditor: content done');
  }

  private renderEmptyState(ctx: RenderContext, rect: Rect): void {
    const message = 'No file open';
    const x = rect.x + Math.floor((rect.width - message.length) / 2);
    const y = rect.y + Math.floor(rect.height / 2);
    
    const fgRgb = this.hexToRgb(this.theme.lineNumberForeground);
    const fg = fgRgb ? `\x1b[38;2;${fgRgb.r};${fgRgb.g};${fgRgb.b}m` : '';
    
    ctx.buffer(`\x1b[${y};${x}H${fg}${message}\x1b[0m`);
  }

  private renderContent(ctx: RenderContext, doc: Document, rect: Rect): void {
    const fs = require('fs');
    const debug = (msg: string) => fs.appendFileSync('debug.log', `[Pane ${this.id}] ${msg}\n`);
    
    const visibleLines = rect.height;
    const startLine = this.scrollTop;
    const endLine = Math.min(startLine + visibleLines, doc.lineCount);
    
    debug(`renderContent: visibleLines=${visibleLines}, startLine=${startLine}, docLineCount=${doc.lineCount}`);
    
    // Parse content for syntax highlighting
    const content = doc.content;
    debug(`renderContent: content.length=${content.length}`);
    if (this.highlighterReady && content !== this.lastParsedContent) {
      debug('renderContent: parsing new content');
      shikiHighlighter.parse(content);
      this.lastParsedContent = content;
    }
    
    // Render each visible line
    debug('renderContent: rendering lines...');
    for (let screenLine = 0; screenLine < visibleLines; screenLine++) {
      const bufferLine = startLine + screenLine;
      const screenY = rect.y + screenLine;
      
      if (bufferLine < doc.lineCount) {
        // Get tokens for this line from the highlighter
        const lineTokens = this.highlighterReady ? shikiHighlighter.highlightLine(bufferLine) : [];
        this.renderLine(ctx, doc, bufferLine, screenY, rect, lineTokens);
      }
    }
    debug('renderContent: lines done');
    
    // Render cursor if focused
    if (this.isFocused) {
      debug('renderContent: rendering cursor');
      this.renderCursor(ctx, doc, rect);
    }
    debug('renderContent: complete');
  }

  private renderLine(
    ctx: RenderContext,
    doc: Document,
    lineNum: number,
    screenY: number,
    rect: Rect,
    lineTokens: HighlightToken[]
  ): void {
    const fs = require('fs');
    const debug = (msg: string) => fs.appendFileSync('debug.log', `[Pane ${this.id}] renderLine: ${msg}\n`);
    
    debug(`lineNum=${lineNum}, screenY=${screenY}`);
    const line = doc.getLine(lineNum);
    debug(`line=${JSON.stringify(line)}`);
    const cursor = doc.primaryCursor;
    debug(`cursor=${JSON.stringify(cursor)}`);
    const isCurrentLine = lineNum === cursor.position.line;
    debug(`isCurrentLine=${isCurrentLine}`);
    
    // Line number
    const lineNumStr = String(lineNum + 1).padStart(this.gutterWidth - 1, ' ');
    const lnColor = isCurrentLine 
      ? this.hexToRgb(this.theme.lineNumberActiveForeground)
      : this.hexToRgb(this.theme.lineNumberForeground);
    const gutterBg = this.hexToRgb(this.theme.gutterBackground);
    
    let output = `\x1b[${screenY};${rect.x}H`;
    if (gutterBg) output += `\x1b[48;2;${gutterBg.r};${gutterBg.g};${gutterBg.b}m`;
    if (lnColor) output += `\x1b[38;2;${lnColor.r};${lnColor.g};${lnColor.b}m`;
    output += lineNumStr + ' \x1b[0m';
    
    debug('gutter done');
    
    // Line highlight for current line
    if (isCurrentLine && this.isFocused) {
      const hlBg = this.hexToRgb(this.theme.lineHighlightBackground);
      if (hlBg) {
        output += `\x1b[48;2;${hlBg.r};${hlBg.g};${hlBg.b}m`;
      }
    }
    
    debug('line highlight done');
    
    // Content with syntax highlighting
    const contentWidth = rect.width - this.gutterWidth;
    const startCol = this.scrollLeft;
    const visibleText = line.substring(startCol, startCol + contentWidth);
    
    debug(`contentWidth=${contentWidth}, visibleText=${JSON.stringify(visibleText)}`);
    
    // Apply syntax highlighting tokens
    if (lineTokens.length > 0) {
      output += this.renderHighlightedText(visibleText, lineTokens, startCol, contentWidth);
    } else {
      const fgColor = this.hexToRgb(this.theme.foreground);
      if (fgColor) output += `\x1b[38;2;${fgColor.r};${fgColor.g};${fgColor.b}m`;
      output += visibleText;
    }
    
    debug('content done');
    
    // Pad rest of line
    const padding = contentWidth - visibleText.length;
    if (padding > 0) {
      output += ' '.repeat(padding);
    }
    
    output += '\x1b[0m';
    ctx.buffer(output);
    debug('buffer done');
    
    // Render selection highlight
    if (hasSelection(cursor.selection)) {
      this.renderSelectionForLine(ctx, doc, lineNum, screenY, rect);
    }
    debug('complete');
  }

  private renderHighlightedText(
    text: string,
    tokens: HighlightToken[],
    startCol: number,
    maxWidth: number
  ): string {
    let result = '';
    let currentCol = 0;
    
    for (const token of tokens) {
      if (currentCol >= maxWidth) break;
      
      const tokenStart = Math.max(0, token.start - startCol);
      const tokenEnd = Math.min(maxWidth, token.end - startCol);
      
      if (tokenEnd <= 0 || tokenStart >= maxWidth) continue;
      
      const tokenText = text.substring(tokenStart, tokenEnd);
      if (tokenText.length === 0) continue;
      
      const rgb = this.hexToRgb(token.color);
      if (rgb) {
        result += `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m${tokenText}`;
      } else {
        result += tokenText;
      }
      
      currentCol = tokenEnd;
    }
    
    return result;
  }

  private renderSelectionForLine(
    ctx: RenderContext,
    doc: Document,
    lineNum: number,
    screenY: number,
    rect: Rect
  ): void {
    const selection = getSelectionRange(doc.primaryCursor);
    if (!selection) return;
    
    const { start, end } = selection;
    if (lineNum < start.line || lineNum > end.line) return;
    
    const line = doc.getLine(lineNum);
    let selStart = lineNum === start.line ? start.column : 0;
    let selEnd = lineNum === end.line ? end.column : line.length;
    
    // Adjust for scroll
    selStart = Math.max(0, selStart - this.scrollLeft);
    selEnd = Math.max(0, selEnd - this.scrollLeft);
    
    if (selStart >= selEnd) return;
    
    const contentX = rect.x + this.gutterWidth;
    const selBg = this.hexToRgb(this.theme.selectionBackground);
    if (!selBg) return;
    
    const bg = `\x1b[48;2;${selBg.r};${selBg.g};${selBg.b}m`;
    ctx.buffer(`\x1b[${screenY};${contentX + selStart}H${bg}${' '.repeat(selEnd - selStart)}\x1b[0m`);
  }

  private renderCursor(ctx: RenderContext, doc: Document, rect: Rect): void {
    const cursor = doc.primaryCursor;
    const screenLine = cursor.line - this.scrollTop;
    const screenCol = cursor.column - this.scrollLeft;
    
    if (screenLine < 0 || screenLine >= rect.height) return;
    if (screenCol < 0 || screenCol >= rect.width - this.gutterWidth) return;
    
    const cursorX = rect.x + this.gutterWidth + screenCol;
    const cursorY = rect.y + screenLine;
    
    const cursorColor = this.hexToRgb(this.theme.cursorForeground);
    if (cursorColor) {
      ctx.buffer(`\x1b[${cursorY};${cursorX}H\x1b[48;2;${cursorColor.r};${cursorColor.g};${cursorColor.b}m \x1b[0m`);
    }
  }

  // ==================== Mouse Handling ====================

  containsPoint(x: number, y: number): boolean {
    return x >= this.rect.x && x < this.rect.x + this.rect.width &&
           y >= this.rect.y && y < this.rect.y + this.rect.height;
  }

  onMouseEvent(event: MouseEvent): boolean {
    // Check tab bar first
    if (event.y === this.rect.y) {
      return this.tabBar.onMouseEvent(event);
    }
    
    // Check minimap
    if (this.minimapEnabled && this.minimap.containsPoint(event.x, event.y)) {
      return this.minimap.onMouseEvent(event);
    }
    
    // Editor area
    const editorRect = this.getEditorRect();
    if (event.x >= editorRect.x && event.x < editorRect.x + editorRect.width &&
        event.y >= editorRect.y && event.y < editorRect.y + editorRect.height) {
      return this.handleEditorMouseEvent(event, editorRect);
    }
    
    return false;
  }

  private handleEditorMouseEvent(event: MouseEvent, editorRect: Rect): boolean {
    const doc = this.getActiveDocument();
    if (!doc) return false;
    
    switch (event.name) {
      case 'MOUSE_LEFT_BUTTON_PRESSED':
      case 'MOUSE_LEFT_BUTTON_PRESSED_DOUBLE':
      case 'MOUSE_LEFT_BUTTON_PRESSED_TRIPLE': {
        const position = this.screenToBuffer(event.x, event.y, editorRect);
        const clickCount = event.name === 'MOUSE_LEFT_BUTTON_PRESSED' ? 1 :
                          event.name === 'MOUSE_LEFT_BUTTON_PRESSED_DOUBLE' ? 2 : 3;
        if (this.onClickCallback) {
          this.onClickCallback(position, clickCount, event);
        }
        return true;
      }
      
      case 'MOUSE_DRAG': {
        const position = this.screenToBuffer(event.x, event.y, editorRect);
        if (this.onDragCallback) {
          this.onDragCallback(position, event);
        }
        return true;
      }
      
      case 'MOUSE_WHEEL_UP':
        this.setScrollTop(this.scrollTop - 3);
        if (this.onScrollCallback) this.onScrollCallback(0, -3);
        return true;
        
      case 'MOUSE_WHEEL_DOWN':
        this.setScrollTop(this.scrollTop + 3);
        if (this.onScrollCallback) this.onScrollCallback(0, 3);
        return true;
    }
    
    return false;
  }

  private screenToBuffer(screenX: number, screenY: number, editorRect: Rect): Position {
    const doc = this.getActiveDocument();
    if (!doc) return { line: 0, column: 0 };
    
    const line = Math.max(0, Math.min(
      this.scrollTop + (screenY - editorRect.y),
      doc.lineCount - 1
    ));
    
    const column = Math.max(0, this.scrollLeft + (screenX - editorRect.x - this.gutterWidth));
    
    return { line, column };
  }

  // ==================== Callbacks ====================

  onClick(callback: (position: Position, clickCount: number, event: MouseEvent) => void): void {
    this.onClickCallback = callback;
  }

  onDrag(callback: (position: Position, event: MouseEvent) => void): void {
    this.onDragCallback = callback;
  }

  onScroll(callback: (deltaX: number, deltaY: number) => void): void {
    this.onScrollCallback = callback;
  }

  onFocus(callback: () => void): void {
    this.onFocusCallback = callback;
  }

  onTabSelect(callback: (document: Document) => void): void {
    this.onTabSelectCallback = callback;
  }

  onTabClose(callback: (document: Document, tabId: string) => void): void {
    this.onTabCloseCallback = callback;
  }

  // ==================== Minimap ====================

  getMinimap(): Minimap {
    return this.minimap;
  }

  toggleMinimap(): void {
    this.minimapEnabled = !this.minimapEnabled;
    this.setRect(this.rect); // Recalculate layout
  }

  // ==================== Utilities ====================

  private hexToRgb(hex: string | undefined): { r: number; g: number; b: number } | null {
    if (!hex) return null;
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1]!, 16),
      g: parseInt(result[2]!, 16),
      b: parseInt(result[3]!, 16)
    } : null;
  }
}
