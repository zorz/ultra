/**
 * Pane Component
 * 
 * A self-contained editor pane that includes its own tab bar, editor, and minimap.
 * Each pane manages its own set of open tabs independently.
 */

import { Document } from '../../core/document.ts';
import { TabBar, type Tab } from './tab-bar.ts';
import { Minimap } from './minimap.ts';
import { FoldManager } from '../../core/fold.ts';
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
import { debugLog } from '../../debug.ts';
import type { GitLineChange } from '../../features/git/git-integration.ts';

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
  private foldManager: FoldManager;
  
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
  private gutterWidth: number = 6;  // git(1) + digits(3) + fold indicator + space
  private theme: EditorTheme = defaultTheme;
  private isFocused: boolean = false;
  private minimapEnabled: boolean = true;
  private foldingEnabled: boolean = true;
  private lastFoldContent: string = '';  // Track content changes for fold recomputation
  
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
  
  // Git line changes for gutter indicators
  private gitLineChanges: Map<number, GitLineChange['type']> = new Map();
  
  // Callbacks
  private onClickCallback?: (position: Position, clickCount: number, event: MouseEvent) => void;
  private onDragCallback?: (position: Position, event: MouseEvent) => void;
  private onScrollCallback?: (deltaX: number, deltaY: number) => void;
  private onFocusCallback?: () => void;
  private onTabSelectCallback?: (document: Document) => void;
  private onTabCloseCallback?: (document: Document, tabId: string) => void;
  private onFoldToggleCallback?: (line: number) => void;

  constructor(id: string) {
    this.id = id;
    this.tabBar = new TabBar();
    this.minimap = new Minimap();
    this.foldManager = new FoldManager();
    
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
    this.foldingEnabled = settings.get('editor.folding') ?? true;
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
    
    // Compute foldable regions
    if (this.foldingEnabled) {
      this.updateFoldRegions(document);
    }
    
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
    debugLog(`[Pane ${this.id}] setRect(${JSON.stringify(rect)})`);
    this.rect = rect;
    
    // Tab bar takes top row
    debugLog(`[Pane ${this.id}] setting tabBar rect...`);
    this.tabBar.setRect({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: this.tabBarHeight
    });
    debugLog(`[Pane ${this.id}] tabBar rect set`);
    
    // Calculate editor area (below tab bar)
    const editorY = rect.y + this.tabBarHeight;
    const editorHeight = rect.height - this.tabBarHeight;
    
    // Minimap on right side
    const minimapWidth = this.minimapEnabled ? 10 : 0;
    const editorWidth = rect.width - minimapWidth;
    
    if (this.minimapEnabled) {
      debugLog(`[Pane ${this.id}] setting minimap rect...`);
      this.minimap.setRect({
        x: rect.x + editorWidth,
        y: editorY,
        width: minimapWidth,
        height: editorHeight
      });
      this.minimap.setEditorScroll(this.scrollTop, editorHeight);
      debugLog(`[Pane ${this.id}] minimap rect set`);
    }
    debugLog(`[Pane ${this.id}] setRect complete`);
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
    debugLog(`[Pane ${this.id}] render() called, rect=${JSON.stringify(this.rect)}, tabs=${this.tabs.length}`);
    this.updateTheme();
    
    // Render tab bar (with focus-aware styling)
    debugLog(`[Pane ${this.id}] rendering tab bar...`);
    this.renderTabBar(ctx);
    
    // Render editor content
    debugLog(`[Pane ${this.id}] rendering editor...`);
    this.renderEditor(ctx);
    
    // Render minimap
    if (this.minimapEnabled) {
      debugLog(`[Pane ${this.id}] rendering minimap...`);
      this.minimap.render(ctx);
    }
    
    // Render focus indicator border if focused
    if (this.isFocused) {
      debugLog(`[Pane ${this.id}] rendering focus border...`);
      this.renderFocusBorder(ctx);
    }
    debugLog(`[Pane ${this.id}] render() complete`);
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
    // Note: We skip the editor content area to avoid covering the git gutter
    // The tab bar already shows focus state, so this is just for the bottom area
    const accentColor = themeLoader.getColor('focusBorder') || '#528bff';
    const rgb = this.hexToRgb(accentColor);
    if (!rgb) return;
    
    const fgRgb = `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m`;
    const reset = '\x1b[0m';
    
    // Only draw on the tab bar row (first row)
    ctx.buffer(`\x1b[${this.rect.y};${this.rect.x}H${fgRgb}▎${reset}`);
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
      this.gutterWidth = 6;  // default: 1 git indicator + 3 digits + fold indicator + space
      return;
    }
    const lineCount = doc.lineCount;
    const digits = Math.max(3, String(lineCount).length);
    this.gutterWidth = digits + 3;  // 1 git indicator + digits + fold indicator + space
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

  private updateFoldRegions(doc: Document): void {
    const lines: string[] = [];
    for (let i = 0; i < doc.lineCount; i++) {
      lines.push(doc.getLine(i));
    }
    this.foldManager.computeRegions(lines);
  }

  // ==================== Editor Rendering (simplified from EditorPane) ====================

  private renderEditor(ctx: RenderContext): void {
    const doc = this.getActiveDocument();
    const editorRect = this.getEditorRect();
    
    debugLog(`[Pane ${this.id}] renderEditor: doc=${doc ? 'exists' : 'null'}, editorRect=${JSON.stringify(editorRect)}`);
    
    // Background
    const bgRgb = this.hexToRgb(this.theme.background);
    if (bgRgb) {
      const bg = `\x1b[48;2;${bgRgb.r};${bgRgb.g};${bgRgb.b}m`;
      for (let y = editorRect.y; y < editorRect.y + editorRect.height; y++) {
        ctx.buffer(`\x1b[${y};${editorRect.x}H${bg}${' '.repeat(editorRect.width)}\x1b[0m`);
      }
    }
    debugLog(`[Pane ${this.id}] renderEditor: background done`);
    
    if (!doc) {
      debugLog(`[Pane ${this.id}] renderEditor: no doc, rendering empty state`);
      this.renderEmptyState(ctx, editorRect);
      return;
    }
    
    // Render line numbers and content
    debugLog(`[Pane ${this.id}] renderEditor: rendering content...`);
    this.renderContent(ctx, doc, editorRect);
    debugLog(`[Pane ${this.id}] renderEditor: content done`);
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
    const visibleLines = rect.height;
    
    debugLog(`[Pane ${this.id}] renderContent: visibleLines=${visibleLines}, scrollTop=${this.scrollTop}, docLineCount=${doc.lineCount}`);
    
    // Recompute fold regions if content changed
    const content = doc.content;
    if (content !== this.lastFoldContent) {
      const lines = content.split('\n');
      this.foldManager.computeRegions(lines);
      this.lastFoldContent = content;
    }
    
    // Parse content for syntax highlighting
    debugLog(`[Pane ${this.id}] renderContent: content.length=${content.length}`);
    if (this.highlighterReady && content !== this.lastParsedContent) {
      debugLog(`[Pane ${this.id}] renderContent: parsing new content`);
      shikiHighlighter.parse(content);
      this.lastParsedContent = content;
    }
    
    // Render visible lines, skipping folded ones
    debugLog(`[Pane ${this.id}] renderContent: rendering lines...`);
    let screenLine = 0;
    let bufferLine = this.scrollTop;
    
    while (screenLine < visibleLines && bufferLine < doc.lineCount) {
      // Skip hidden (folded) lines
      if (this.foldManager.isHidden(bufferLine)) {
        bufferLine++;
        continue;
      }
      
      const screenY = rect.y + screenLine;
      const lineTokens = this.highlighterReady ? shikiHighlighter.highlightLine(bufferLine) : [];
      this.renderLine(ctx, doc, bufferLine, screenY, rect, lineTokens);
      
      screenLine++;
      bufferLine++;
    }
    debugLog(`[Pane ${this.id}] renderContent: lines done`);
    
    // Render cursor if focused
    if (this.isFocused) {
      debugLog(`[Pane ${this.id}] renderContent: rendering cursor`);
      this.renderCursor(ctx, doc, rect);
    }
    debugLog(`[Pane ${this.id}] renderContent: complete`);
  }

  private renderLine(
    ctx: RenderContext,
    doc: Document,
    lineNum: number,
    screenY: number,
    rect: Rect,
    lineTokens: HighlightToken[]
  ): void {
    const line = doc.getLine(lineNum);
    const cursor = doc.primaryCursor;
    const isCurrentLine = lineNum === cursor.position.line;
    
    // Calculate gutter parts
    const digits = Math.max(3, String(doc.lineCount).length);
    const lineNumStr = String(lineNum + 1).padStart(digits, ' ');
    
    const lnColor = isCurrentLine 
      ? this.hexToRgb(this.theme.lineNumberActiveForeground)
      : this.hexToRgb(this.theme.lineNumberForeground);
    const gutterBg = this.hexToRgb(this.theme.gutterBackground);
    
    let output = `\x1b[${screenY};${rect.x}H`;
    if (gutterBg) output += `\x1b[48;2;${gutterBg.r};${gutterBg.g};${gutterBg.b}m`;
    
    // Git gutter indicator (first column - before line number)
    const gitChange = this.gitLineChanges.get(lineNum + 1);  // Git uses 1-based line numbers
    if (gitChange) {
      // Use hardcoded colors that are known to work well
      const gitAddedColor = { r: 129, g: 199, b: 132 };    // Green
      const gitModifiedColor = { r: 224, g: 175, b: 104 }; // Orange/Yellow
      const gitDeletedColor = { r: 229, g: 115, b: 115 };  // Red
      
      let indicatorColor: { r: number; g: number; b: number };
      let indicator: string;
      
      if (gitChange === 'added') {
        indicatorColor = gitAddedColor;
        indicator = '│';  // Simple vertical bar for added (U+2502)
      } else if (gitChange === 'modified') {
        indicatorColor = gitModifiedColor;
        indicator = '│';  // Simple vertical bar for modified (U+2502)
      } else {  // deleted
        indicatorColor = gitDeletedColor;
        indicator = '▼';  // Small triangle for deleted
      }
      
      const gitSeq = `\x1b[38;2;${indicatorColor.r};${indicatorColor.g};${indicatorColor.b}m${indicator}`;
      output += gitSeq;
    } else {
      output += ' ';  // Empty space for git column when no change
    }
    
    // Line number
    if (lnColor) output += `\x1b[38;2;${lnColor.r};${lnColor.g};${lnColor.b}m`;
    output += lineNumStr;
    
    // Fold indicator
    const canFold = this.foldManager.canFold(lineNum);
    const isFolded = this.foldManager.isFolded(lineNum);
    
    if (canFold) {
      // Use line number color for fold indicator to blend with theme
      const foldColor = themeLoader.getColor('editorLineNumber.foreground') || 
                        this.theme.lineNumberForeground || '#626880';
      const foldRgb = this.hexToRgb(foldColor);
      if (foldRgb) {
        output += `\x1b[38;2;${foldRgb.r};${foldRgb.g};${foldRgb.b}m`;
      }
      output += isFolded ? '▶' : '▼';
    } else {
      output += ' ';
    }
    
    // Reset after gutter
    output += ' \x1b[0m';
    
    // If this line is folded, show fold indicator and skip content
    if (isFolded) {
      const foldedCount = this.foldManager.getFoldedLineCount(lineNum);
      const foldIndicator = ` ⋯ ${foldedCount} lines `;
      
      // Use a subtle background for folded indicator - blend with line highlight or use comment color
      const foldBgColor = themeLoader.getColor('editor.lineHighlightBackground') || 
                          themeLoader.getColor('editor.background') || '#2c313c';
      const foldBgRgb = this.hexToRgb(foldBgColor);
      // Use a muted foreground color (comment color or dimmed foreground)
      const foldFgColor = themeLoader.getColor('editorLineNumber.foreground') || 
                          themeLoader.getColor('editor.foreground') || '#626880';
      const foldFgRgb = this.hexToRgb(foldFgColor);
      
      // Render the first part of the line content
      const contentWidth = rect.width - this.gutterWidth;
      const startCol = this.scrollLeft;
      const truncatedText = line.substring(startCol, Math.min(line.length, startCol + contentWidth - foldIndicator.length - 1));
      
      // Apply line highlight if current line
      let lineBg: { r: number; g: number; b: number } | null = null;
      if (isCurrentLine && this.isFocused) {
        lineBg = this.hexToRgb(this.theme.lineHighlightBackground);
      }
      
      if (lineBg) {
        output += `\x1b[48;2;${lineBg.r};${lineBg.g};${lineBg.b}m`;
      }
      
      // Render truncated text with syntax highlighting
      if (lineTokens.length > 0) {
        output += this.renderTextWithSelection(truncatedText, lineTokens, startCol, truncatedText.length, -1, -1, lineBg, null);
      } else {
        const fgColor = this.hexToRgb(this.theme.foreground);
        if (fgColor) output += `\x1b[38;2;${fgColor.r};${fgColor.g};${fgColor.b}m`;
        output += truncatedText;
      }
      
      // Fold count indicator
      if (foldBgRgb) output += `\x1b[48;2;${foldBgRgb.r};${foldBgRgb.g};${foldBgRgb.b}m`;
      if (foldFgRgb) output += `\x1b[38;2;${foldFgRgb.r};${foldFgRgb.g};${foldFgRgb.b}m`;
      output += foldIndicator;
      
      // Pad rest of line
      const usedWidth = truncatedText.length + foldIndicator.length;
      const padding = contentWidth - usedWidth;
      if (padding > 0) {
        if (lineBg) {
          output += `\x1b[48;2;${lineBg.r};${lineBg.g};${lineBg.b}m`;
        } else {
          output += '\x1b[49m';
        }
        output += ' '.repeat(padding);
      }
      
      output += '\x1b[0m';
      ctx.buffer(output);
      return;
    }
    
    // Determine background color for line
    let lineBg: { r: number; g: number; b: number } | null = null;
    if (isCurrentLine && this.isFocused) {
      lineBg = this.hexToRgb(this.theme.lineHighlightBackground);
    }
    
    // Get selection range for this line (if any)
    let selStart = -1;
    let selEnd = -1;
    if (hasSelection(cursor.selection)) {
      const selection = getSelectionRange(cursor.selection);
      const { start, end } = selection;
      if (lineNum >= start.line && lineNum <= end.line) {
        selStart = lineNum === start.line ? start.column : 0;
        selEnd = lineNum === end.line ? end.column : line.length;
        // Adjust for scroll
        selStart = Math.max(0, selStart - this.scrollLeft);
        selEnd = Math.max(0, selEnd - this.scrollLeft);
      }
    }
    
    const selBg = this.hexToRgb(this.theme.selectionBackground);
    
    // Content with syntax highlighting and selection
    const contentWidth = rect.width - this.gutterWidth;
    const startCol = this.scrollLeft;
    const visibleText = line.substring(startCol, startCol + contentWidth);
    
    // Render text character by character with appropriate backgrounds
    output += this.renderTextWithSelection(
      visibleText,
      lineTokens,
      startCol,
      contentWidth,
      selStart,
      selEnd,
      lineBg,
      selBg
    );
    
    // Pad rest of line (with selection bg if selection extends past text)
    const padding = contentWidth - visibleText.length;
    if (padding > 0) {
      // Check if selection extends into padding area
      const paddingStart = visibleText.length;
      const paddingEnd = paddingStart + padding;
      
      if (selStart >= 0 && selEnd > paddingStart && selStart < paddingEnd && selBg) {
        // Some of the padding is selected
        const selPaddingStart = Math.max(0, selStart - paddingStart);
        const selPaddingEnd = Math.min(padding, selEnd - paddingStart);
        
        // Non-selected padding before selection
        if (selPaddingStart > 0) {
          if (lineBg) {
            output += `\x1b[48;2;${lineBg.r};${lineBg.g};${lineBg.b}m`;
          }
          output += ' '.repeat(selPaddingStart);
        }
        
        // Selected padding
        output += `\x1b[48;2;${selBg.r};${selBg.g};${selBg.b}m`;
        output += ' '.repeat(selPaddingEnd - selPaddingStart);
        
        // Non-selected padding after selection
        if (selPaddingEnd < padding) {
          if (lineBg) {
            output += `\x1b[48;2;${lineBg.r};${lineBg.g};${lineBg.b}m`;
          } else {
            output += '\x1b[49m';  // Default background
          }
          output += ' '.repeat(padding - selPaddingEnd);
        }
      } else {
        // No selection in padding
        if (lineBg) {
          output += `\x1b[48;2;${lineBg.r};${lineBg.g};${lineBg.b}m`;
        }
        output += ' '.repeat(padding);
      }
    }
    
    output += '\x1b[0m';
    ctx.buffer(output);
  }

  private renderTextWithSelection(
    text: string,
    tokens: HighlightToken[],
    startCol: number,
    maxWidth: number,
    selStart: number,
    selEnd: number,
    lineBg: { r: number; g: number; b: number } | null,
    selBg: { r: number; g: number; b: number } | null
  ): string {
    if (text.length === 0) return '';
    
    let result = '';
    const defaultFg = this.hexToRgb(this.theme.foreground);
    
    // Build a color map for each character position
    const charColors: (string | null)[] = new Array(text.length).fill(null);
    
    // Apply syntax highlighting colors
    for (const token of tokens) {
      const tokenStart = Math.max(0, token.start - startCol);
      const tokenEnd = Math.min(text.length, token.end - startCol);
      
      if (tokenEnd <= 0 || tokenStart >= text.length) continue;
      
      for (let i = tokenStart; i < tokenEnd; i++) {
        charColors[i] = token.color;
      }
    }
    
    // Render character by character, grouping by same style
    let currentFg: string | null = null;
    let currentBg: 'line' | 'selection' | 'none' = 'none';
    let pendingText = '';
    
    const flushPending = () => {
      if (pendingText.length === 0) return;
      
      let style = '';
      
      // Set background
      if (currentBg === 'selection' && selBg) {
        style += `\x1b[48;2;${selBg.r};${selBg.g};${selBg.b}m`;
      } else if (currentBg === 'line' && lineBg) {
        style += `\x1b[48;2;${lineBg.r};${lineBg.g};${lineBg.b}m`;
      }
      
      // Set foreground
      if (currentFg) {
        const rgb = this.hexToRgb(currentFg);
        if (rgb) {
          style += `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m`;
        }
      } else if (defaultFg) {
        style += `\x1b[38;2;${defaultFg.r};${defaultFg.g};${defaultFg.b}m`;
      }
      
      result += style + pendingText;
      pendingText = '';
    };
    
    for (let i = 0; i < text.length && i < maxWidth; i++) {
      const char = text[i]!;
      const fg = charColors[i];
      const isSelected = selStart >= 0 && i >= selStart && i < selEnd;
      const bg: 'line' | 'selection' | 'none' = isSelected ? 'selection' : (lineBg ? 'line' : 'none');
      
      // Check if style changed
      if (fg !== currentFg || bg !== currentBg) {
        flushPending();
        currentFg = fg;
        currentBg = bg;
      }
      
      pendingText += char;
    }
    
    flushPending();
    return result;
  }

  private renderCursor(ctx: RenderContext, doc: Document, rect: Rect): void {
    // Only render cursor in focused pane
    if (!this.isFocused) return;
    
    const cursor = doc.primaryCursor;
    const screenLine = cursor.position.line - this.scrollTop;
    const screenCol = cursor.position.column - this.scrollLeft;
    
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
        // Check if click is in the gutter area (line numbers or fold indicator)
        const gutterEnd = editorRect.x + this.gutterWidth;
        if (this.foldingEnabled && event.x >= editorRect.x && event.x < gutterEnd) {
          const screenLine = event.y - editorRect.y;
          const bufferLine = this.screenLineToBufferLine(screenLine);
          if (bufferLine !== -1 && this.foldManager.isFoldableAt(bufferLine)) {
            this.foldManager.toggleFold(bufferLine);
            if (this.onFoldToggleCallback) {
              this.onFoldToggleCallback(bufferLine);
            }
            return true;
          }
        }
        
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

  /**
   * Convert a screen line (relative to editor top) to a buffer line number.
   * Accounts for folded lines when folding is enabled.
   * Returns -1 if the screen line doesn't map to a valid buffer line.
   */
  private screenLineToBufferLine(screenLine: number): number {
    const doc = this.getActiveDocument();
    if (!doc) return -1;
    
    if (!this.foldingEnabled) {
      // Simple case: no folding, direct mapping
      const bufferLine = this.scrollTop + screenLine;
      return bufferLine < doc.lineCount ? bufferLine : -1;
    }
    
    // With folding: count visible lines from scrollTop
    let visibleCount = 0;
    let bufferLine = this.scrollTop;
    
    while (bufferLine < doc.lineCount && visibleCount <= screenLine) {
      if (!this.foldManager.isLineHidden(bufferLine)) {
        if (visibleCount === screenLine) {
          return bufferLine;
        }
        visibleCount++;
      }
      bufferLine++;
    }
    
    return -1;
  }

  private screenToBuffer(screenX: number, screenY: number, editorRect: Rect): Position {
    const doc = this.getActiveDocument();
    if (!doc) return { line: 0, column: 0 };
    
    const screenLine = screenY - editorRect.y;
    const line = this.screenLineToBufferLine(screenLine);
    const actualLine = line === -1 ? Math.max(0, doc.lineCount - 1) : line;
    
    // Get the actual line content to clamp column to line length
    const lineContent = doc.getLine(actualLine);
    const rawColumn = Math.max(0, this.scrollLeft + (screenX - editorRect.x - this.gutterWidth));
    const column = Math.min(rawColumn, lineContent.length);
    
    return { line: actualLine, column };
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

  onFoldToggle(callback: (line: number) => void): void {
    this.onFoldToggleCallback = callback;
  }

  // ==================== Folding ====================

  /**
   * Toggle fold at the cursor's current line (or the block containing it)
   */
  toggleFoldAtCursor(): boolean {
    const doc = this.getActiveDocument();
    if (!doc || !this.foldingEnabled) return false;
    
    const cursorLine = doc.primaryCursor.position.line;
    
    // First try to toggle fold that starts at cursor line
    if (this.foldManager.isFoldableAt(cursorLine)) {
      return this.foldManager.toggleFold(cursorLine);
    }
    
    // Otherwise, fold the containing block
    return this.foldManager.foldContaining(cursorLine);
  }

  /**
   * Fold all regions in the document
   */
  foldAll(): void {
    if (!this.foldingEnabled) return;
    this.foldManager.foldAll();
  }

  /**
   * Unfold all regions in the document
   */
  unfoldAll(): void {
    if (!this.foldingEnabled) return;
    this.foldManager.unfoldAll();
  }

  /**
   * Check if folding is enabled
   */
  isFoldingEnabled(): boolean {
    return this.foldingEnabled;
  }

  /**
   * Set folding enabled state
   */
  setFoldingEnabled(enabled: boolean): void {
    this.foldingEnabled = enabled;
    if (enabled) {
      const doc = this.getActiveDocument();
      if (doc) this.updateFoldRegions(doc);
    } else {
      this.foldManager.clear();
    }
    this.updateGutterWidth();
  }

  // ==================== Minimap ====================

  getMinimap(): Minimap {
    return this.minimap;
  }

  toggleMinimap(): void {
    this.minimapEnabled = !this.minimapEnabled;
    this.setRect(this.rect); // Recalculate layout
  }

  // ==================== Git Integration ====================

  /**
   * Set git line changes for gutter indicators
   */
  setGitLineChanges(changes: GitLineChange[]): void {
    // Direct file write to bypass any caching issues
    const fs = require('fs');
    fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [Pane.setGitLineChanges DIRECT] changes=${changes.length}\n`);
    this.gitLineChanges.clear();
    for (const change of changes) {
      this.gitLineChanges.set(change.line, change.type);
    }
    fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [Pane.setGitLineChanges DIRECT] map size=${this.gitLineChanges.size}\n`);
  }

  /**
   * Clear git line changes
   */
  clearGitLineChanges(): void {
    this.gitLineChanges.clear();
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
