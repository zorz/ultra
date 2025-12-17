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
import { hexToRgb, blendColors } from '../colors.ts';

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
  
  // Inline diff widget state
  private inlineDiff: {
    visible: boolean;
    line: number;           // Line at which to show diff
    diffLines: string[];    // Parsed diff lines
    scrollTop: number;      // Scroll within diff widget
    height: number;         // Height of widget in lines
    filePath: string;       // File being diffed
  } = {
    visible: false,
    line: 0,
    diffLines: [],
    scrollTop: 0,
    height: 10,
    filePath: ''
  };
  
  // Inline diff callbacks
  private onInlineDiffStageCallback?: (filePath: string, line: number) => Promise<void>;
  private onInlineDiffRevertCallback?: (filePath: string, line: number) => Promise<void>;
  
  // Callbacks
  private onClickCallback?: (position: Position, clickCount: number, event: MouseEvent) => void;
  private onDragCallback?: (position: Position, event: MouseEvent) => void;
  private onScrollCallback?: (deltaX: number, deltaY: number) => void;
  private onFocusCallback?: () => void;
  private onTabSelectCallback?: (document: Document) => void;
  private onTabCloseCallback?: (document: Document, tabId: string) => void;
  private onFoldToggleCallback?: (line: number) => void;
  private onGitGutterClickCallback?: (line: number) => void;

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
   * Get visible column count (text width)
   */
  private getVisibleColumnCount(): number {
    const minimapWidth = this.minimapEnabled ? 10 : 0;
    return Math.max(1, this.rect.width - this.gutterWidth - minimapWidth);
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
   */
  private computeWrappedLines(): void {
    const doc = this.getActiveDocument();
    if (!doc) {
      this.wrappedLines = [];
      return;
    }

    const textWidth = this.getVisibleColumnCount();
    const content = doc.content;

    // Cache check - only recompute if width or content changed
    if (textWidth === this.lastWrapWidth && content === this.lastWrapContent && this.wrappedLines.length > 0) {
      return;
    }

    this.lastWrapWidth = textWidth;
    this.lastWrapContent = content;
    this.wrappedLines = [];

    const lineCount = doc.lineCount;

    if (!this.isWordWrapEnabled() || textWidth <= 0) {
      // No wrapping - each buffer line is one screen line
      for (let i = 0; i < lineCount; i++) {
        const lineLen = doc.getLine(i).length;
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
      const line = doc.getLine(bufferLine);
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
                break;
              }
              if (char === '.' || char === ',' || char === ';' || char === ':' ||
                  char === ')' || char === ']' || char === '}' || char === '>' ||
                  char === '-' || char === '/' || char === '\\') {
                break;
              }
              breakCol--;
            }

            // Only use the break point if it's not too far back (at least 50% of width)
            if (breakCol > col + Math.floor(textWidth / 2)) {
              endCol = breakCol;
            }
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

    return bufferLine;  // Fallback
  }

  /**
   * Ensure cursor is visible
   */
  ensureCursorVisible(): void {
    const doc = this.getActiveDocument();
    if (!doc) {
      debugLog(`[Pane ${this.id}] ensureCursorVisible: no active document`);
      return;
    }

    const cursor = doc.primaryCursor;
    const visibleLines = this.getVisibleLineCount();

    debugLog(`[Pane ${this.id}] ensureCursorVisible called: cursor=(${cursor.position.line},${cursor.position.column}), scrollTop=${this.scrollTop}, visibleLines=${visibleLines}`);

    // Compute wrapped lines for accurate positioning
    this.computeWrappedLines();

    let scrolled = false;

    if (this.isWordWrapEnabled()) {
      // With word wrap, we scroll by screen lines
      const screenLine = this.bufferToScreenLine(cursor.position.line, cursor.position.column);

      if (screenLine < this.scrollTop) {
        debugLog(`[Pane ${this.id}] ensureCursorVisible: cursor above viewport, scrolling up`);
        this.scrollTop = screenLine;
        scrolled = true;
      } else if (screenLine >= this.scrollTop + visibleLines) {
        debugLog(`[Pane ${this.id}] ensureCursorVisible: cursor below viewport, scrolling down`);
        this.scrollTop = screenLine - visibleLines + 1;
        scrolled = true;
      }
      // No horizontal scrolling with word wrap
      this.scrollLeft = 0;
    } else {
      // Without word wrap, scroll by buffer lines
      if (cursor.position.line < this.scrollTop) {
        debugLog(`[Pane ${this.id}] ensureCursorVisible: cursor above viewport, scrolling up`);
        this.scrollTop = cursor.position.line;
        scrolled = true;
      } else if (cursor.position.line >= this.scrollTop + visibleLines) {
        debugLog(`[Pane ${this.id}] ensureCursorVisible: cursor below viewport, scrolling down`);
        this.scrollTop = cursor.position.line - visibleLines + 1;
        scrolled = true;
      }

      // Horizontal scrolling
      const editorWidth = this.getVisibleColumnCount();
      if (cursor.position.column < this.scrollLeft) {
        debugLog(`[Pane ${this.id}] ensureCursorVisible: cursor left of viewport, scrolling left`);
        this.scrollLeft = Math.max(0, cursor.position.column - 5);
        scrolled = true;
      } else if (cursor.position.column >= this.scrollLeft + editorWidth) {
        debugLog(`[Pane ${this.id}] ensureCursorVisible: cursor right of viewport, scrolling right`);
        this.scrollLeft = cursor.position.column - editorWidth + 5;
        scrolled = true;
      }
    }

    this.minimap.setEditorScroll(this.scrollTop, visibleLines);

    // Trigger render if scrolling occurred
    if (scrolled) {
      debugLog(`[Pane ${this.id}] ensureCursorVisible: scrolled to (${this.scrollTop}, ${this.scrollLeft})`);
      if (this.onScrollCallback) {
        debugLog(`[Pane ${this.id}] ensureCursorVisible: invoking scroll callback`);
        this.onScrollCallback(0, 0);
      } else {
        debugLog(`[Pane ${this.id}] ensureCursorVisible: scrolled but no callback registered!`);
      }
    } else {
      debugLog(`[Pane ${this.id}] ensureCursorVisible: no scrolling needed, cursor is visible`);
    }
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
    const rgb = hexToRgb(accentColor);
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
    const bgRgb = hexToRgb(this.theme.background);
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
    
    const fgRgb = hexToRgb(this.theme.lineNumberForeground);
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

    // Compute wrapped lines
    this.computeWrappedLines();

    // Calculate inline diff position if visible
    const inlineDiffLine = this.inlineDiff.visible ? this.inlineDiff.line : -1;
    const inlineDiffHeight = this.inlineDiff.visible ? this.inlineDiff.height : 0;

    // Render visible lines
    debugLog(`[Pane ${this.id}] renderContent: rendering lines...`);

    if (this.isWordWrapEnabled()) {
      // With word wrap: render wrapped screen lines
      let screenLine = 0;
      let wrapIndex = this.scrollTop;

      while (screenLine < visibleLines && wrapIndex < this.wrappedLines.length) {
        const wrap = this.wrappedLines[wrapIndex]!;

        // Skip hidden (folded) lines
        if (this.foldManager.isHidden(wrap.bufferLine)) {
          // Skip all wraps of this folded line
          while (wrapIndex < this.wrappedLines.length &&
                 this.wrappedLines[wrapIndex]!.bufferLine === wrap.bufferLine) {
            wrapIndex++;
          }
          continue;
        }

        const screenY = rect.y + screenLine;
        const lineTokens = this.highlighterReady ? shikiHighlighter.highlightLine(wrap.bufferLine) : [];
        this.renderWrappedLine(ctx, doc, wrap, screenY, rect, lineTokens);

        screenLine++;
        wrapIndex++;

        // Render inline diff after the target line (only after last wrap of the line)
        if (wrap.bufferLine === inlineDiffLine &&
            (wrapIndex >= this.wrappedLines.length || this.wrappedLines[wrapIndex]!.bufferLine !== wrap.bufferLine) &&
            screenLine + inlineDiffHeight <= visibleLines) {
          this.renderInlineDiff(ctx, rect.x, rect.y + screenLine, rect.width, inlineDiffHeight);
          screenLine += inlineDiffHeight;
        }
      }
    } else {
      // Without word wrap: render buffer lines directly
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

        // Render inline diff after the target line
        if (bufferLine - 1 === inlineDiffLine && screenLine + inlineDiffHeight <= visibleLines) {
          this.renderInlineDiff(ctx, rect.x, rect.y + screenLine, rect.width, inlineDiffHeight);
          screenLine += inlineDiffHeight;
        }
      }
    }

    debugLog(`[Pane ${this.id}] renderContent: lines done`);

    // Render cursor if focused
    if (this.isFocused) {
      debugLog(`[Pane ${this.id}] renderContent: rendering cursor`);
      this.renderCursor(ctx, doc, rect);
    }
    debugLog(`[Pane ${this.id}] renderContent: complete`);
  }

  /**
   * Render the inline diff widget
   */
  private renderInlineDiff(ctx: RenderContext, x: number, y: number, width: number, height: number): void {
    const theme = themeLoader.getCurrentTheme();
    if (!theme) return;
    const colors = theme.colors;
    
    const bgColor = colors['editor.background'] || '#1e1e1e';
    const borderColor = colors['editorWidget.border'] || '#454545';
    const fgColor = colors['editor.foreground'] || '#d4d4d4';
    
    // For diff lines, use a subtle blend of the gutter color with the background
    // We'll darken the gutter colors to create subtle background highlights
    const addedGutterColor = colors['editorGutter.addedBackground'] || '#a6e3a1';
    const deletedGutterColor = colors['editorGutter.deletedBackground'] || '#f38ba8';
    const addedBg = blendColors(bgColor, addedGutterColor, 0.15);
    const deletedBg = blendColors(bgColor, deletedGutterColor, 0.15);
    const addedFg = colors['gitDecoration.addedResourceForeground'] || addedGutterColor;
    const deletedFg = colors['gitDecoration.deletedResourceForeground'] || deletedGutterColor;
    const headerBg = colors['editorWidget.background'] || '#252526';
    
    // Draw header with title and buttons
    const fileName = this.inlineDiff.filePath.split('/').pop() || 'diff';
    const headerText = ` ${fileName} - Line ${this.inlineDiff.line + 1} `;
    const buttons = ' 󰐕 Stage  󰜺 Revert  󰅖 Close ';
    
    // Header background
    ctx.drawStyled(x, y, ' '.repeat(width), fgColor, headerBg);
    ctx.drawStyled(x, y, headerText, fgColor, headerBg);
    ctx.drawStyled(x + width - buttons.length - 1, y, buttons, fgColor, headerBg);
    
    // Draw content area
    const contentHeight = height - 2;  // Minus header and footer
    const lines = this.inlineDiff.diffLines;

    for (let i = 0; i < contentHeight; i++) {
      const lineIdx = this.inlineDiff.scrollTop + i;
      const screenY = y + 1 + i;

      if (lineIdx < lines.length) {
        const line = lines[lineIdx] || '';
        let lineBg = bgColor;
        let lineFg = fgColor;
        let prefix = ' ';

        if (line.startsWith('+') && !line.startsWith('+++')) {
          lineBg = addedBg;
          lineFg = addedFg;
          prefix = '+';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          lineBg = deletedBg;
          lineFg = deletedFg;
          prefix = '-';
        } else if (line.startsWith('@@')) {
          lineFg = colors['textPreformat.foreground'] || '#d7ba7d';
        }

        const displayLine = (prefix + line.substring(1)).substring(0, width - 2).padEnd(width - 2);
        // Optimize: draw border and content in single call when possible
        if (lineBg === bgColor) {
          // Border and content have same background - combine into one call
          ctx.drawStyled(x, screenY, '│' + displayLine, lineFg, lineBg);
        } else {
          // Different backgrounds - need separate calls
          ctx.drawStyled(x, screenY, '│', borderColor, bgColor);
          ctx.drawStyled(x + 1, screenY, displayLine, lineFg, lineBg);
        }
      } else {
        ctx.drawStyled(x, screenY, '│' + ' '.repeat(width - 1), borderColor, bgColor);
      }
    }
    
    // Draw footer with keybindings
    const footerText = ' s:stage  r:revert  c/Esc:close  j/k:scroll ';
    const footerY = y + height - 1;
    ctx.drawStyled(x, footerY, ' '.repeat(width), fgColor, headerBg);
    const footerX = x + Math.floor((width - footerText.length) / 2);
    ctx.drawStyled(footerX, footerY, footerText, colors['descriptionForeground'] || '#858585', headerBg);
    
    // Draw left border
    ctx.drawStyled(x, y, '┌', borderColor, headerBg);
    ctx.drawStyled(x, footerY, '└', borderColor, headerBg);
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
      ? hexToRgb(this.theme.lineNumberActiveForeground)
      : hexToRgb(this.theme.lineNumberForeground);
    const gutterBg = hexToRgb(this.theme.gutterBackground);
    
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
      const foldRgb = hexToRgb(foldColor);
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
      const foldBgRgb = hexToRgb(foldBgColor);
      // Use a muted foreground color (comment color or dimmed foreground)
      const foldFgColor = themeLoader.getColor('editorLineNumber.foreground') || 
                          themeLoader.getColor('editor.foreground') || '#626880';
      const foldFgRgb = hexToRgb(foldFgColor);
      
      // Render the first part of the line content
      const contentWidth = rect.width - this.gutterWidth;
      const startCol = this.scrollLeft;
      const truncatedText = line.substring(startCol, Math.min(line.length, startCol + contentWidth - foldIndicator.length - 1));
      
      // Apply line highlight if current line
      let lineBg: { r: number; g: number; b: number } | null = null;
      if (isCurrentLine && this.isFocused) {
        lineBg = hexToRgb(this.theme.lineHighlightBackground);
      }
      
      if (lineBg) {
        output += `\x1b[48;2;${lineBg.r};${lineBg.g};${lineBg.b}m`;
      }
      
      // Render truncated text with syntax highlighting
      if (lineTokens.length > 0) {
        output += this.renderTextWithSelection(truncatedText, lineTokens, startCol, truncatedText.length, -1, -1, lineBg, null);
      } else {
        const fgColor = hexToRgb(this.theme.foreground);
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
      lineBg = hexToRgb(this.theme.lineHighlightBackground);
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
    
    const selBg = hexToRgb(this.theme.selectionBackground);
    
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

  private renderWrappedLine(
    ctx: RenderContext,
    doc: Document,
    wrap: WrappedLine,
    screenY: number,
    rect: Rect,
    lineTokens: HighlightToken[]
  ): void {
    const line = doc.getLine(wrap.bufferLine);
    const cursor = doc.primaryCursor;
    const isCurrentLine = wrap.bufferLine === cursor.position.line;

    // Calculate gutter parts
    const digits = Math.max(3, String(doc.lineCount).length);
    const lineNumStr = wrap.isFirstWrap ? String(wrap.bufferLine + 1).padStart(digits, ' ') : ' '.repeat(digits);

    const lnColor = isCurrentLine
      ? hexToRgb(this.theme.lineNumberActiveForeground)
      : hexToRgb(this.theme.lineNumberForeground);
    const gutterBg = hexToRgb(this.theme.gutterBackground);

    let output = `\x1b[${screenY};${rect.x}H`;
    if (gutterBg) output += `\x1b[48;2;${gutterBg.r};${gutterBg.g};${gutterBg.b}m`;

    // Git gutter indicator (only on first wrap)
    if (wrap.isFirstWrap) {
      const gitChange = this.gitLineChanges.get(wrap.bufferLine + 1);
      if (gitChange) {
        const gitAddedColor = { r: 129, g: 199, b: 132 };
        const gitModifiedColor = { r: 224, g: 175, b: 104 };
        const gitDeletedColor = { r: 229, g: 115, b: 115 };

        let indicatorColor: { r: number; g: number; b: number };
        let indicator: string;

        if (gitChange === 'added') {
          indicatorColor = gitAddedColor;
          indicator = '│';
        } else if (gitChange === 'modified') {
          indicatorColor = gitModifiedColor;
          indicator = '│';
        } else {
          indicatorColor = gitDeletedColor;
          indicator = '▼';
        }

        const gitSeq = `\x1b[38;2;${indicatorColor.r};${indicatorColor.g};${indicatorColor.b}m${indicator}`;
        output += gitSeq;
      } else {
        output += ' ';
      }
    } else {
      output += ' ';
    }

    // Line number
    if (lnColor) output += `\x1b[38;2;${lnColor.r};${lnColor.g};${lnColor.b}m`;
    output += lineNumStr;

    // Fold indicator (only on first wrap)
    if (wrap.isFirstWrap) {
      const canFold = this.foldManager.canFold(wrap.bufferLine);
      const isFolded = this.foldManager.isFolded(wrap.bufferLine);

      if (canFold) {
        const foldColor = themeLoader.getColor('editorLineNumber.foreground') ||
                          this.theme.lineNumberForeground || '#626880';
        const foldRgb = hexToRgb(foldColor);
        if (foldRgb) {
          output += `\x1b[38;2;${foldRgb.r};${foldRgb.g};${foldRgb.b}m`;
        }
        output += isFolded ? '▶' : '▼';
      } else {
        output += ' ';
      }
    } else {
      output += ' ';
    }

    // Reset after gutter
    output += ' \x1b[0m';

    // Determine background color for line
    let lineBg: { r: number; g: number; b: number } | null = null;
    if (isCurrentLine && this.isFocused) {
      lineBg = hexToRgb(this.theme.lineHighlightBackground);
    }

    // Get selection range for this line segment
    let selStart = -1;
    let selEnd = -1;
    if (hasSelection(cursor.selection)) {
      const selection = getSelectionRange(cursor.selection);
      const { start, end } = selection;
      if (wrap.bufferLine >= start.line && wrap.bufferLine <= end.line) {
        const lineSelStart = wrap.bufferLine === start.line ? start.column : 0;
        const lineSelEnd = wrap.bufferLine === end.line ? end.column : line.length;
        // Map selection to this wrap segment
        if (lineSelEnd > wrap.startColumn && lineSelStart < wrap.endColumn) {
          selStart = Math.max(0, lineSelStart - wrap.startColumn);
          selEnd = Math.min(wrap.endColumn - wrap.startColumn, lineSelEnd - wrap.startColumn);
        }
      }
    }

    const selBg = hexToRgb(this.theme.selectionBackground);

    // Content with syntax highlighting and selection
    const contentWidth = rect.width - this.gutterWidth;
    const visibleText = line.substring(wrap.startColumn, wrap.endColumn);

    // Render text with selection
    output += this.renderTextWithSelection(
      visibleText,
      lineTokens,
      wrap.startColumn,
      contentWidth,
      selStart,
      selEnd,
      lineBg,
      selBg
    );

    // Pad rest of line
    const padding = contentWidth - visibleText.length;
    if (padding > 0) {
      if (lineBg) {
        output += `\x1b[48;2;${lineBg.r};${lineBg.g};${lineBg.b}m`;
      }
      output += ' '.repeat(padding);
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
    const defaultFg = hexToRgb(this.theme.foreground);
    
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
        const rgb = hexToRgb(currentFg);
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
    let screenLine: number;
    let screenCol: number;

    if (this.isWordWrapEnabled()) {
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

    if (screenLine < 0 || screenLine >= rect.height) return;
    if (screenCol < 0 || screenCol >= this.getVisibleColumnCount()) return;

    const cursorX = rect.x + this.gutterWidth + screenCol;
    const cursorY = rect.y + screenLine;

    const cursorColor = hexToRgb(this.theme.cursorForeground);
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

    // Handle inline diff mouse events first
    if (this.inlineDiff.visible) {
      const handled = this.handleInlineDiffMouseEvent(event, editorRect);
      if (handled) return true;
    }
    
    switch (event.name) {
      case 'MOUSE_LEFT_BUTTON_PRESSED':
      case 'MOUSE_LEFT_BUTTON_PRESSED_DOUBLE':
      case 'MOUSE_LEFT_BUTTON_PRESSED_TRIPLE': {
        // Check if click is in the git gutter area (first column)
        const gitGutterEnd = editorRect.x + 1;  // Git indicator is first column
        if (event.x >= editorRect.x && event.x < gitGutterEnd) {
          const screenLine = event.y - editorRect.y;
          const bufferLine = this.screenLineToBufferLine(screenLine);
          if (bufferLine !== -1) {
            // Check if there's a git change at this line
            const gitChange = this.gitLineChanges.get(bufferLine + 1);  // 1-based
            if (gitChange && this.onGitGutterClickCallback) {
              this.onGitGutterClickCallback(bufferLine + 1);  // Pass 1-based line number
              return true;
            }
          }
        }
        
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
   * Handle mouse events for the inline diff widget
   */
  private handleInlineDiffMouseEvent(event: MouseEvent, editorRect: Rect): boolean {
    // Calculate where the inline diff would be rendered
    const inlineDiffScreenStart = this.bufferLineToScreenLine(this.inlineDiff.line) + 1;
    const inlineDiffScreenEnd = inlineDiffScreenStart + this.inlineDiff.height;
    const clickScreenY = event.y - editorRect.y;
    
    // Check if click is within the inline diff area
    if (clickScreenY < inlineDiffScreenStart || clickScreenY >= inlineDiffScreenEnd) {
      return false;
    }
    
    const relativeY = clickScreenY - inlineDiffScreenStart;
    
    switch (event.name) {
      case 'MOUSE_LEFT_BUTTON_PRESSED': {
        // Header row (y=0) - check buttons
        if (relativeY === 0) {
          const width = editorRect.width;
          const relX = event.x - editorRect.x;
          
          // Buttons string: " 󰐕 Stage  󰜺 Revert  󰅖 Close " (30 chars)
          // Rendered at: width - 31
          // Position of each button within the string:
          // Stage: chars 1-8, Revert: chars 10-17, Close: chars 20-27
          const buttonsStart = width - 31;
          const buttonRelX = relX - buttonsStart;
          
          if (buttonRelX >= 0 && buttonRelX < 30) {
            // Close button (chars 20-28)
            if (buttonRelX >= 20) {
              this.hideInlineDiff();
              return true;
            }
            // Revert button (chars 10-18)
            else if (buttonRelX >= 10) {
              if (this.onInlineDiffRevertCallback) {
                this.onInlineDiffRevertCallback(this.inlineDiff.filePath, this.inlineDiff.line);
              }
              return true;
            }
            // Stage button (chars 0-9)
            else {
              if (this.onInlineDiffStageCallback) {
                this.onInlineDiffStageCallback(this.inlineDiff.filePath, this.inlineDiff.line);
              }
              return true;
            }
          }
        }
        return true;  // Consume click within diff area
      }
      
      case 'MOUSE_WHEEL_UP':
        this.inlineDiff.scrollTop = Math.max(0, this.inlineDiff.scrollTop - 3);
        if (this.onScrollCallback) this.onScrollCallback(0, -3);
        return true;

      case 'MOUSE_WHEEL_DOWN':
        this.inlineDiff.scrollTop = Math.min(
          Math.max(0, this.inlineDiff.diffLines.length - this.inlineDiff.height + 2),
          this.inlineDiff.scrollTop + 3
        );
        if (this.onScrollCallback) this.onScrollCallback(0, 3);
        return true;
    }
    
    return true;  // Consume all events in diff area
  }

  /**
   * Convert buffer line to screen line (accounting for folds and inline diff)
   */
  private bufferLineToScreenLine(bufferLine: number): number {
    if (bufferLine < this.scrollTop) return -1;
    
    let screenLine = 0;
    for (let line = this.scrollTop; line < bufferLine; line++) {
      if (!this.foldManager.isHidden(line)) {
        screenLine++;
      }
    }
    return screenLine;
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

    const screenLineOffset = screenY - editorRect.y;
    const screenCol = Math.max(0, screenX - editorRect.x - this.gutterWidth);

    if (this.isWordWrapEnabled()) {
      // With word wrap, map screen position to buffer position
      const wrapIndex = this.scrollTop + screenLineOffset;

      if (wrapIndex < 0) return { line: 0, column: 0 };
      if (wrapIndex >= this.wrappedLines.length) {
        const lastLine = Math.max(0, doc.lineCount - 1);
        return { line: lastLine, column: doc.getLine(lastLine).length };
      }

      const wrap = this.wrappedLines[wrapIndex]!;
      const bufferCol = wrap.startColumn + screenCol;
      const lineLength = doc.getLine(wrap.bufferLine).length;
      const clampedCol = Math.min(Math.max(wrap.startColumn, bufferCol), Math.min(wrap.endColumn, lineLength));

      return { line: wrap.bufferLine, column: clampedCol };
    } else {
      // Without word wrap, use simple mapping
      const line = this.screenLineToBufferLine(screenLineOffset);
      const actualLine = line === -1 ? Math.max(0, doc.lineCount - 1) : line;

      // Get the actual line content to clamp column to line length
      const lineContent = doc.getLine(actualLine);
      const rawColumn = Math.max(0, this.scrollLeft + screenCol);
      const column = Math.min(rawColumn, lineContent.length);

      return { line: actualLine, column };
    }
  }

  // ==================== Callbacks ====================

  onClick(callback: (position: Position, clickCount: number, event: MouseEvent) => void): () => void {
    this.onClickCallback = callback;
    return () => { this.onClickCallback = undefined; };
  }

  onDrag(callback: (position: Position, event: MouseEvent) => void): () => void {
    this.onDragCallback = callback;
    return () => { this.onDragCallback = undefined; };
  }

  onScroll(callback: (deltaX: number, deltaY: number) => void): () => void {
    this.onScrollCallback = callback;
    return () => { this.onScrollCallback = undefined; };
  }

  onFocus(callback: () => void): () => void {
    this.onFocusCallback = callback;
    return () => { this.onFocusCallback = undefined; };
  }

  onTabSelect(callback: (document: Document) => void): () => void {
    this.onTabSelectCallback = callback;
    return () => { this.onTabSelectCallback = undefined; };
  }

  onTabClose(callback: (document: Document, tabId: string) => void): () => void {
    this.onTabCloseCallback = callback;
    return () => { this.onTabCloseCallback = undefined; };
  }

  onFoldToggle(callback: (line: number) => void): () => void {
    this.onFoldToggleCallback = callback;
    return () => { this.onFoldToggleCallback = undefined; };
  }

  onGitGutterClick(callback: (line: number) => void): () => void {
    this.onGitGutterClickCallback = callback;
    return () => { this.onGitGutterClickCallback = undefined; };
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
    debugLog(`[Pane.setGitLineChanges] changes=${changes.length}`);
    this.gitLineChanges.clear();
    for (const change of changes) {
      this.gitLineChanges.set(change.line, change.type);
    }
    debugLog(`[Pane.setGitLineChanges] map size=${this.gitLineChanges.size}`);
  }

  /**
   * Clear git line changes
   */
  clearGitLineChanges(): void {
    this.gitLineChanges.clear();
  }

  /**
   * Get all git line changes as an array
   */
  getGitLineChanges(): GitLineChange[] {
    const changes: GitLineChange[] = [];
    for (const [line, type] of this.gitLineChanges) {
      changes.push({ line, type });
    }
    return changes.sort((a, b) => a.line - b.line);
  }

  // ==================== Inline Diff ====================

  /**
   * Show inline diff at a specific line
   */
  async showInlineDiff(filePath: string, line: number, diffContent: string): Promise<void> {
    const lines = diffContent.split('\n');
    this.inlineDiff = {
      visible: true,
      line: line,
      diffLines: lines,
      scrollTop: 0,
      height: Math.min(lines.length + 2, 15),  // +2 for header/footer, max 15 lines
      filePath: filePath
    };
  }

  /**
   * Hide inline diff
   */
  hideInlineDiff(): void {
    this.inlineDiff.visible = false;
    this.inlineDiff.diffLines = [];
  }

  /**
   * Check if inline diff is visible
   */
  isInlineDiffVisible(): boolean {
    return this.inlineDiff.visible;
  }

  /**
   * Handle keyboard input for inline diff
   */
  handleInlineDiffKey(key: string, ctrl: boolean, _shift: boolean): boolean {
    if (!this.inlineDiff.visible) return false;

    // Normalize key to uppercase for consistent matching
    const upperKey = key.toUpperCase();

    switch (upperKey) {
      case 'ESCAPE':
      case 'C':
        this.hideInlineDiff();
        return true;
      case 'S':
        if (this.onInlineDiffStageCallback) {
          this.onInlineDiffStageCallback(this.inlineDiff.filePath, this.inlineDiff.line);
        }
        return true;
      case 'R':
        if (this.onInlineDiffRevertCallback) {
          this.onInlineDiffRevertCallback(this.inlineDiff.filePath, this.inlineDiff.line);
        }
        return true;
      case 'J':
      case 'DOWN':
        this.inlineDiff.scrollTop = Math.min(
          this.inlineDiff.scrollTop + 1,
          Math.max(0, this.inlineDiff.diffLines.length - this.inlineDiff.height + 2)
        );
        return true;
      case 'K':
      case 'UP':
        this.inlineDiff.scrollTop = Math.max(0, this.inlineDiff.scrollTop - 1);
        return true;
      default:
        // Capture all keys while inline diff is visible to prevent editor input
        return true;
    }
  }

  /**
   * Set callback for inline diff stage action
   */
  onInlineDiffStage(callback: (filePath: string, line: number) => Promise<void>): () => void {
    this.onInlineDiffStageCallback = callback;
    return () => { this.onInlineDiffStageCallback = undefined; };
  }

  /**
   * Set callback for inline diff revert action
   */
  onInlineDiffRevert(callback: (filePath: string, line: number) => Promise<void>): () => void {
    this.onInlineDiffRevertCallback = callback;
    return () => { this.onInlineDiffRevertCallback = undefined; };
  }

}
