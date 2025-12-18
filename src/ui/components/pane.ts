/**
 * Pane Component
 *
 * A container for editor tabs using the panel content abstraction.
 * Each tab contains an EditorContent instance that wraps a Document.
 * This provides backward-compatible API while using the new panel architecture.
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
import { findMatchingBracket, type BracketMatch } from '../../core/bracket-match.ts';
import { debugLog } from '../../debug.ts';
import type { GitLineChange } from '../../features/git/git-integration.ts';
import { hexToRgb, blendColors } from '../colors.ts';
import { settings } from '../../config/settings.ts';
import { PanelContainer } from '../panels/panel-container.ts';
import { EditorContent } from '../panels/editor-content.ts';

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
  editorContent: EditorContent;  // The EditorContent instance for this tab
}

export class Pane implements MouseHandler {
  readonly id: string;

  // Panel container for structure (used for future flexibility)
  private container: PanelContainer;

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
  private gutterWidth: number = 6;
  private theme: EditorTheme = defaultTheme;
  private isFocused: boolean = false;
  private minimapEnabled: boolean = true;
  private foldingEnabled: boolean = true;
  private lastFoldContent: string = '';

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
    line: number;
    diffLines: string[];
    scrollTop: number;
    height: number;
    filePath: string;
  } = {
    visible: false,
    line: 0,
    diffLines: [],
    scrollTop: 0,
    height: 10,
    filePath: ''
  };

  // Callbacks
  private onInlineDiffStageCallback?: (filePath: string, line: number) => Promise<void>;
  private onInlineDiffRevertCallback?: (filePath: string, line: number) => Promise<void>;
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
    this.container = new PanelContainer(`${id}-container`, 'tabbed');
    this.container.setRegion('editor-area');
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

  private generateTabId(): string {
    return `${this.id}-tab-${++this.tabIdCounter}`;
  }

  private createEditorContent(document: Document, documentId: string): EditorContent {
    const contentId = `${this.id}-editor-${documentId}`;
    const editorContent = new EditorContent(contentId, document, documentId);

    // Wire up callbacks
    editorContent.onClick((pos, clickCount, event) => {
      if (this.onClickCallback) this.onClickCallback(pos, clickCount, event);
    });

    editorContent.onDrag((pos, event) => {
      if (this.onDragCallback) this.onDragCallback(pos, event);
    });

    editorContent.onScroll((dx, dy) => {
      if (this.onScrollCallback) this.onScrollCallback(dx, dy);
    });

    editorContent.onFoldToggle((line) => {
      if (this.onFoldToggleCallback) this.onFoldToggleCallback(line);
    });

    editorContent.onGitGutterClick((line) => {
      if (this.onGitGutterClickCallback) this.onGitGutterClickCallback(line);
    });

    return editorContent;
  }

  openDocument(document: Document, documentId?: string): string {
    const existingTab = this.tabs.find(t => t.document === document);
    if (existingTab) {
      this.activateTab(existingTab.id);
      return existingTab.id;
    }

    const tabId = this.generateTabId();
    const docId = documentId || tabId;
    const editorContent = this.createEditorContent(document, docId);

    const tab: PaneTab = {
      id: tabId,
      documentId: docId,
      document,
      filePath: document.filePath,
      editorContent
    };

    this.tabs.push(tab);
    this.activateTab(tabId);

    return tabId;
  }

  closeTab(tabId: string): void {
    const index = this.tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;

    const tab = this.tabs[index]!;
    tab.editorContent.dispose?.();
    this.tabs.splice(index, 1);

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

  closeDocument(document: Document): void {
    const tab = this.tabs.find(t => t.document === document);
    if (tab) this.closeTab(tab.id);
  }

  private activateTab(tabId: string): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    if (this.activeTabId && this.activeTabId !== tabId) {
      const prevTab = this.tabs.find(t => t.id === this.activeTabId);
      if (prevTab) {
        prevTab.editorContent.onDeactivated?.();
        prevTab.editorContent.setVisible(false);
      }
    }

    this.activeTabId = tabId;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.updateGutterWidth();
    this.minimap.setDocument(tab.document);
    this.setupHighlighting(tab.document);

    tab.editorContent.setVisible(true);
    tab.editorContent.onActivated?.();

    if (this.onTabSelectCallback) {
      this.onTabSelectCallback(tab.document);
    }
  }

  getActiveDocument(): Document | null {
    if (!this.activeTabId) return null;
    return this.tabs.find(t => t.id === this.activeTabId)?.document || null;
  }

  getActiveEditorContent(): EditorContent | null {
    if (!this.activeTabId) return null;
    return this.tabs.find(t => t.id === this.activeTabId)?.editorContent || null;
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  hasTabs(): boolean {
    return this.tabs.length > 0;
  }

  getTabCount(): number {
    return this.tabs.length;
  }

  hasDocument(document: Document): boolean {
    return this.tabs.some(t => t.document === document);
  }

  hasDocumentById(id: string): boolean {
    return this.tabs.some(t => t.documentId === id);
  }

  addDocument(id: string, document: Document): void {
    if (this.tabs.some(t => t.documentId === id)) return;

    const tabId = this.generateTabId();
    const editorContent = this.createEditorContent(document, id);

    const tab: PaneTab = {
      id: tabId,
      documentId: id,
      document,
      filePath: document.filePath,
      editorContent
    };

    this.tabs.push(tab);
  }

  setActiveDocument(id: string, document: Document): void {
    let tab = this.tabs.find(t => t.documentId === id);
    if (!tab) {
      this.addDocument(id, document);
      tab = this.tabs.find(t => t.documentId === id);
    }
    if (!tab) return;

    if (this.activeTabId && this.activeTabId !== tab.id) {
      const prevTab = this.tabs.find(t => t.id === this.activeTabId);
      if (prevTab) {
        prevTab.editorContent.onDeactivated?.();
        prevTab.editorContent.setVisible(false);
      }
    }

    this.activeTabId = tab.id;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.updateGutterWidth();
    this.minimap.setDocument(document);
    this.setupHighlighting(document);

    if (this.foldingEnabled) {
      this.updateFoldRegions(document);
    }

    tab.editorContent.setVisible(true);
    tab.editorContent.onActivated?.();

    if (this.onTabSelectCallback) {
      this.onTabSelectCallback(document);
    }
  }

  getActiveDocumentId(): string | null {
    if (!this.activeTabId) return null;
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    return tab?.documentId || null;
  }

  getTabsInfo(): Array<{
    documentId: string;
    filePath: string | null;
    isActive: boolean;
    tabOrder: number;
  }> {
    return this.tabs.map((tab, index) => ({
      documentId: tab.documentId,
      filePath: tab.filePath,
      isActive: tab.id === this.activeTabId,
      tabOrder: index
    }));
  }

  getDocumentIds(): string[] {
    return this.tabs.map(t => t.documentId);
  }

  removeDocument(id: string): void {
    const index = this.tabs.findIndex(t => t.documentId === id);
    if (index === -1) return;

    const closedTab = this.tabs[index]!;
    closedTab.editorContent.dispose?.();
    this.tabs.splice(index, 1);

    if (this.activeTabId === closedTab.id) {
      if (this.tabs.length > 0) {
        const newIndex = Math.min(index, this.tabs.length - 1);
        const newTab = this.tabs[newIndex]!;
        this.activeTabId = newTab.id;
        this.minimap.setDocument(newTab.document);
        this.setupHighlighting(newTab.document);
        newTab.editorContent.setVisible(true);
        newTab.editorContent.onActivated?.();
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

  setFocused(focused: boolean): void {
    const wasFocused = this.isFocused;
    this.isFocused = focused;

    const activeContent = this.getActiveEditorContent();
    if (activeContent) {
      activeContent.setFocused(focused);
    }

    if (focused && !wasFocused && this.onFocusCallback) {
      this.onFocusCallback();
    }
  }

  getFocused(): boolean {
    return this.isFocused;
  }

  // ==================== Layout ====================

  setRect(rect: Rect): void {
    debugLog(`[Pane ${this.id}] setRect(${JSON.stringify(rect)})`);
    this.rect = rect;

    this.tabBar.setRect({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: this.tabBarHeight
    });

    const editorY = rect.y + this.tabBarHeight;
    const editorHeight = rect.height - this.tabBarHeight;
    const minimapWidth = this.minimapEnabled ? 10 : 0;
    const editorWidth = rect.width - minimapWidth;

    if (this.minimapEnabled) {
      this.minimap.setRect({
        x: rect.x + editorWidth,
        y: editorY,
        width: minimapWidth,
        height: editorHeight
      });
      this.minimap.setEditorScroll(this.scrollTop, editorHeight);
    }

    const contentRect = {
      x: rect.x,
      y: editorY,
      width: editorWidth,
      height: editorHeight
    };
    for (const tab of this.tabs) {
      tab.editorContent.setRect(contentRect);
    }
  }

  getRect(): Rect {
    return this.rect;
  }

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

    const activeContent = this.getActiveEditorContent();
    if (activeContent) {
      activeContent.setScrollTop(this.scrollTop);
    }
  }

  getScrollTop(): number {
    return this.scrollTop;
  }

  setScrollLeft(value: number): void {
    this.scrollLeft = Math.max(0, value);

    const activeContent = this.getActiveEditorContent();
    if (activeContent) {
      activeContent.setScrollLeft(this.scrollLeft);
    }
  }

  getScrollLeft(): number {
    return this.scrollLeft;
  }

  getVisibleLineCount(): number {
    return this.rect.height - this.tabBarHeight;
  }

  private getVisibleColumnCount(): number {
    const minimapWidth = this.minimapEnabled ? 10 : 0;
    return Math.max(1, this.rect.width - this.gutterWidth - minimapWidth);
  }

  private isWordWrapEnabled(): boolean {
    const wrapSetting = settings.get('editor.wordWrap');
    return wrapSetting === 'on' || wrapSetting === 'wordWrapColumn' || wrapSetting === 'bounded';
  }

  private computeWrappedLines(): void {
    const doc = this.getActiveDocument();
    if (!doc) {
      this.wrappedLines = [];
      return;
    }

    const textWidth = this.getVisibleColumnCount();
    const content = doc.content;

    if (textWidth === this.lastWrapWidth && content === this.lastWrapContent && this.wrappedLines.length > 0) {
      return;
    }

    this.lastWrapWidth = textWidth;
    this.lastWrapContent = content;
    this.wrappedLines = [];

    const lineCount = doc.lineCount;

    if (!this.isWordWrapEnabled() || textWidth <= 0) {
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

    for (let bufferLine = 0; bufferLine < lineCount; bufferLine++) {
      const line = doc.getLine(bufferLine);
      const lineLen = line.length;

      if (lineLen <= textWidth) {
        this.wrappedLines.push({
          bufferLine,
          startColumn: 0,
          endColumn: lineLen,
          isFirstWrap: true
        });
      } else {
        let col = 0;
        let isFirst = true;
        while (col < lineLen) {
          let endCol = Math.min(col + textWidth, lineLen);

          if (endCol < lineLen) {
            let breakCol = endCol;
            while (breakCol > col) {
              const char = line[breakCol - 1];
              if (char === ' ' || char === '\t') break;
              if (char === '.' || char === ',' || char === ';' || char === ':' ||
                  char === ')' || char === ']' || char === '}' || char === '>' ||
                  char === '-' || char === '/' || char === '\\') {
                break;
              }
              breakCol--;
            }

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

  private bufferToScreenLine(bufferLine: number, column: number = 0): number {
    if (!this.isWordWrapEnabled()) {
      return bufferLine;
    }

    for (let i = 0; i < this.wrappedLines.length; i++) {
      const wrap = this.wrappedLines[i]!;
      if (wrap.bufferLine === bufferLine && column >= wrap.startColumn && column < wrap.endColumn) {
        return i;
      }
      if (wrap.bufferLine === bufferLine && column === wrap.endColumn &&
          (i + 1 >= this.wrappedLines.length || this.wrappedLines[i + 1]!.bufferLine !== bufferLine)) {
        return i;
      }
    }

    return bufferLine;
  }

  ensureCursorVisible(): void {
    const doc = this.getActiveDocument();
    if (!doc) return;

    const cursor = doc.primaryCursor;
    const visibleLines = this.getVisibleLineCount();

    this.computeWrappedLines();

    let scrolled = false;

    if (this.isWordWrapEnabled()) {
      const screenLine = this.bufferToScreenLine(cursor.position.line, cursor.position.column);

      if (screenLine < this.scrollTop) {
        this.scrollTop = screenLine;
        scrolled = true;
      } else if (screenLine >= this.scrollTop + visibleLines) {
        this.scrollTop = screenLine - visibleLines + 1;
        scrolled = true;
      }
      this.scrollLeft = 0;
    } else {
      if (cursor.position.line < this.scrollTop) {
        this.scrollTop = cursor.position.line;
        scrolled = true;
      } else if (cursor.position.line >= this.scrollTop + visibleLines) {
        this.scrollTop = cursor.position.line - visibleLines + 1;
        scrolled = true;
      }

      const editorWidth = this.getVisibleColumnCount();
      if (cursor.position.column < this.scrollLeft) {
        this.scrollLeft = Math.max(0, cursor.position.column - 5);
        scrolled = true;
      } else if (cursor.position.column >= this.scrollLeft + editorWidth) {
        this.scrollLeft = cursor.position.column - editorWidth + 5;
        scrolled = true;
      }
    }

    this.minimap.setEditorScroll(this.scrollTop, visibleLines);

    const activeContent = this.getActiveEditorContent();
    if (activeContent) {
      activeContent.setScrollTop(this.scrollTop);
      activeContent.setScrollLeft(this.scrollLeft);
    }

    if (scrolled && this.onScrollCallback) {
      this.onScrollCallback(0, 0);
    }
  }

  // ==================== Rendering ====================

  render(ctx: RenderContext): void {
    this.updateTheme();

    this.renderTabBar(ctx);
    this.renderEditor(ctx);

    if (this.minimapEnabled) {
      this.minimap.render(ctx);
    }

    if (this.isFocused) {
      this.renderFocusBorder(ctx);
    }
  }

  private renderTabBar(ctx: RenderContext): void {
    const tabBarTabs: Tab[] = this.tabs.map(t => ({
      id: t.id,
      fileName: t.document.fileName,
      filePath: t.document.filePath,
      isDirty: t.document.isDirty,
      isActive: t.id === this.activeTabId,
      isMissing: t.document.isMissing
    }));

    this.tabBar.setTabs(tabBarTabs);
    this.tabBar.setFocused(this.isFocused);
    this.tabBar.render(ctx);
  }

  private renderFocusBorder(ctx: RenderContext): void {
    const accentColor = themeLoader.getColor('focusBorder') || '#528bff';
    const rgb = hexToRgb(accentColor);
    if (!rgb) return;

    const fgRgb = `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m`;
    const reset = '\x1b[0m';

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
      this.gutterWidth = 6;
      return;
    }
    const lineCount = doc.lineCount;
    const digits = Math.max(3, String(lineCount).length);
    this.gutterWidth = digits + 3;
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

  private renderEditor(ctx: RenderContext): void {
    const doc = this.getActiveDocument();
    const editorRect = this.getEditorRect();

    const bgRgb = hexToRgb(this.theme.background);
    if (bgRgb) {
      const bg = `\x1b[48;2;${bgRgb.r};${bgRgb.g};${bgRgb.b}m`;
      for (let y = editorRect.y; y < editorRect.y + editorRect.height; y++) {
        ctx.buffer(`\x1b[${y};${editorRect.x}H${bg}${' '.repeat(editorRect.width)}\x1b[0m`);
      }
    }

    if (!doc) {
      this.renderEmptyState(ctx, editorRect);
      return;
    }

    this.renderContent(ctx, doc, editorRect);
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
    const content = doc.content;

    if (content !== this.lastFoldContent) {
      const lines = content.split('\n');
      this.foldManager.computeRegions(lines);
      this.lastFoldContent = content;
    }

    if (this.highlighterReady && content !== this.lastParsedContent) {
      shikiHighlighter.parse(content);
      this.lastParsedContent = content;
    }

    this.computeWrappedLines();

    const inlineDiffLine = this.inlineDiff.visible ? this.inlineDiff.line : -1;
    const inlineDiffHeight = this.inlineDiff.visible ? this.inlineDiff.height : 0;

    if (this.isWordWrapEnabled()) {
      let screenLine = 0;
      let wrapIndex = this.scrollTop;

      while (screenLine < visibleLines && wrapIndex < this.wrappedLines.length) {
        const wrap = this.wrappedLines[wrapIndex]!;

        if (this.foldManager.isHidden(wrap.bufferLine)) {
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

        if (wrap.bufferLine === inlineDiffLine &&
            (wrapIndex >= this.wrappedLines.length || this.wrappedLines[wrapIndex]!.bufferLine !== wrap.bufferLine) &&
            screenLine + inlineDiffHeight <= visibleLines) {
          this.renderInlineDiff(ctx, rect.x, rect.y + screenLine, rect.width, inlineDiffHeight);
          screenLine += inlineDiffHeight;
        }
      }
    } else {
      let screenLine = 0;
      let bufferLine = this.scrollTop;

      while (screenLine < visibleLines && bufferLine < doc.lineCount) {
        if (this.foldManager.isHidden(bufferLine)) {
          bufferLine++;
          continue;
        }

        const screenY = rect.y + screenLine;
        const lineTokens = this.highlighterReady ? shikiHighlighter.highlightLine(bufferLine) : [];
        this.renderLine(ctx, doc, bufferLine, screenY, rect, lineTokens);

        screenLine++;
        bufferLine++;

        if (bufferLine - 1 === inlineDiffLine && screenLine + inlineDiffHeight <= visibleLines) {
          this.renderInlineDiff(ctx, rect.x, rect.y + screenLine, rect.width, inlineDiffHeight);
          screenLine += inlineDiffHeight;
        }
      }
    }

    if (this.isFocused) {
      this.renderCursor(ctx, doc, rect);
    }
  }

  private renderInlineDiff(ctx: RenderContext, x: number, y: number, width: number, height: number): void {
    const theme = themeLoader.getCurrentTheme();
    if (!theme) return;
    const colors = theme.colors;

    const bgColor = colors['editor.background'] || '#1e1e1e';
    const borderColor = colors['editorWidget.border'] || '#454545';
    const fgColor = colors['editor.foreground'] || '#d4d4d4';
    const addedBg = colors['diffEditor.insertedTextBackground'] || '#23412980';
    const removedBg = colors['diffEditor.removedTextBackground'] || '#72201d80';

    const bgRgb = hexToRgb(bgColor);
    const borderRgb = hexToRgb(borderColor);
    const fgRgb = hexToRgb(fgColor);
    const addedBgRgb = hexToRgb(addedBg);
    const removedBgRgb = hexToRgb(removedBg);

    if (!bgRgb || !borderRgb || !fgRgb) return;

    const bg = `\x1b[48;2;${bgRgb.r};${bgRgb.g};${bgRgb.b}m`;
    const border = `\x1b[38;2;${borderRgb.r};${borderRgb.g};${borderRgb.b}m`;
    const fg = `\x1b[38;2;${fgRgb.r};${fgRgb.g};${fgRgb.b}m`;
    const reset = '\x1b[0m';

    const actions = ' [s]tage  [r]evert  [Esc]close ';
    const borderWidth = width - actions.length - 2;
    ctx.buffer(`\x1b[${y};${x}H${bg}${border}${'─'.repeat(Math.max(0, borderWidth))}${fg}${actions}${border}──${reset}`);

    const contentHeight = height - 2;

    for (let i = 0; i < contentHeight; i++) {
      const lineY = y + 1 + i;
      const diffIdx = this.inlineDiff.scrollTop + i;

      if (diffIdx < this.inlineDiff.diffLines.length) {
        const diffLine = this.inlineDiff.diffLines[diffIdx] || '';
        const prefix = diffLine.charAt(0);
        const lineContent = diffLine.slice(0, width - 1).padEnd(width - 1);

        let lineBg = bg;
        if (prefix === '+' && addedBgRgb) {
          lineBg = `\x1b[48;2;${addedBgRgb.r};${addedBgRgb.g};${addedBgRgb.b}m`;
        } else if (prefix === '-' && removedBgRgb) {
          lineBg = `\x1b[48;2;${removedBgRgb.r};${removedBgRgb.g};${removedBgRgb.b}m`;
        }

        ctx.buffer(`\x1b[${lineY};${x}H${lineBg}${fg}${lineContent}${reset}`);
      } else {
        ctx.buffer(`\x1b[${lineY};${x}H${bg}${' '.repeat(width)}${reset}`);
      }
    }

    const bottomY = y + height - 1;
    ctx.buffer(`\x1b[${bottomY};${x}H${bg}${border}${'─'.repeat(width)}${reset}`);
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
    const cursors = doc.cursors;
    const isCurrentLine = cursors.some(c => c.position.line === lineNum);

    const digits = Math.max(3, String(doc.lineCount).length);
    const lineNumStr = String(lineNum + 1).padStart(digits, ' ');

    const lnColor = isCurrentLine
      ? hexToRgb(this.theme.lineNumberActiveForeground)
      : hexToRgb(this.theme.lineNumberForeground);
    const gutterBg = hexToRgb(this.theme.gutterBackground);

    let output = `\x1b[${screenY};${rect.x}H`;
    if (gutterBg) output += `\x1b[48;2;${gutterBg.r};${gutterBg.g};${gutterBg.b}m`;

    const gitChange = this.gitLineChanges.get(lineNum + 1);
    if (gitChange) {
      const getGitColor = (type: string): { r: number; g: number; b: number } => {
        const colorKey = `editorGutter.${type}Background`;
        const themeColor = themeLoader.getColor(colorKey);
        return hexToRgb(themeColor) || hexToRgb(this.theme.lineNumberForeground) || { r: 171, g: 178, b: 191 };
      };

      let indicatorColor: { r: number; g: number; b: number };
      let indicator: string;

      if (gitChange === 'added') {
        indicatorColor = getGitColor('added');
        indicator = '│';
      } else if (gitChange === 'modified') {
        indicatorColor = getGitColor('modified');
        indicator = '│';
      } else {
        indicatorColor = getGitColor('deleted');
        indicator = '▼';
      }

      output += `\x1b[38;2;${indicatorColor.r};${indicatorColor.g};${indicatorColor.b}m${indicator}`;
    } else {
      output += ' ';
    }

    if (lnColor) output += `\x1b[38;2;${lnColor.r};${lnColor.g};${lnColor.b}m`;
    output += lineNumStr;

    const canFold = this.foldManager.canFold(lineNum);
    const isFolded = this.foldManager.isFolded(lineNum);

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

    output += ' \x1b[0m';

    if (isFolded) {
      const foldedCount = this.foldManager.getFoldedLineCount(lineNum);
      const foldIndicator = ` ⋯ ${foldedCount} lines `;

      const foldBgColor = themeLoader.getColor('editor.lineHighlightBackground') ||
                          themeLoader.getColor('editor.background') || '#2c313c';
      const foldBgRgb = hexToRgb(foldBgColor);
      const foldFgColor = themeLoader.getColor('editorLineNumber.foreground') ||
                          themeLoader.getColor('editor.foreground') || '#626880';
      const foldFgRgb = hexToRgb(foldFgColor);

      const contentWidth = rect.width - this.gutterWidth;
      const startCol = this.scrollLeft;
      const truncatedText = line.substring(startCol, Math.min(line.length, startCol + contentWidth - foldIndicator.length - 1));

      let lineBg: { r: number; g: number; b: number } | null = null;
      if (isCurrentLine && this.isFocused) {
        lineBg = hexToRgb(this.theme.lineHighlightBackground);
      }

      if (lineBg) {
        output += `\x1b[48;2;${lineBg.r};${lineBg.g};${lineBg.b}m`;
      }

      if (lineTokens.length > 0) {
        output += this.renderTextWithSelection(truncatedText, lineTokens, startCol, truncatedText.length, null, lineBg, null);
      } else {
        const fgColor = hexToRgb(this.theme.foreground);
        if (fgColor) output += `\x1b[38;2;${fgColor.r};${fgColor.g};${fgColor.b}m`;
        output += truncatedText;
      }

      if (foldBgRgb) output += `\x1b[48;2;${foldBgRgb.r};${foldBgRgb.g};${foldBgRgb.b}m`;
      if (foldFgRgb) output += `\x1b[38;2;${foldFgRgb.r};${foldFgRgb.g};${foldFgRgb.b}m`;
      output += foldIndicator;

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

    let lineBg: { r: number; g: number; b: number } | null = null;
    if (isCurrentLine && this.isFocused) {
      lineBg = hexToRgb(this.theme.lineHighlightBackground);
    }

    const contentWidth = rect.width - this.gutterWidth;
    const startCol = this.scrollLeft;
    const visibleText = line.substring(startCol, startCol + contentWidth);

    let selectedCols: Set<number> | null = null;
    let maxSelEnd = -1;
    for (const cursor of cursors) {
      if (hasSelection(cursor.selection)) {
        const selection = getSelectionRange(cursor.selection!);
        const { start, end } = selection;
        if (lineNum >= start.line && lineNum <= end.line) {
          let selStart = lineNum === start.line ? start.column : 0;
          let selEnd = lineNum === end.line ? end.column : line.length;
          selStart = Math.max(0, selStart - this.scrollLeft);
          selEnd = Math.max(0, selEnd - this.scrollLeft);
          if (selEnd > selStart) {
            if (!selectedCols) selectedCols = new Set();
            for (let col = selStart; col < selEnd; col++) {
              selectedCols.add(col);
            }
            if (selEnd > maxSelEnd) maxSelEnd = selEnd;
          }
        }
      }
    }

    const selBg = hexToRgb(this.theme.selectionBackground);

    output += this.renderTextWithSelection(
      visibleText,
      lineTokens,
      startCol,
      contentWidth,
      selectedCols,
      lineBg,
      selBg
    );

    const padding = contentWidth - visibleText.length;
    if (padding > 0) {
      const paddingStart = visibleText.length;

      if (selectedCols && maxSelEnd > paddingStart && selBg) {
        for (let i = 0; i < padding; i++) {
          const col = paddingStart + i;
          if (selectedCols.has(col)) {
            output += `\x1b[48;2;${selBg.r};${selBg.g};${selBg.b}m `;
          } else if (lineBg) {
            output += `\x1b[48;2;${lineBg.r};${lineBg.g};${lineBg.b}m `;
          } else {
            output += '\x1b[49m ';
          }
        }
      } else {
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
    const cursors = doc.cursors;
    const isCurrentLine = cursors.some(c => c.position.line === wrap.bufferLine);

    const digits = Math.max(3, String(doc.lineCount).length);
    const lineNumStr = wrap.isFirstWrap ? String(wrap.bufferLine + 1).padStart(digits, ' ') : ' '.repeat(digits);

    const lnColor = isCurrentLine
      ? hexToRgb(this.theme.lineNumberActiveForeground)
      : hexToRgb(this.theme.lineNumberForeground);
    const gutterBg = hexToRgb(this.theme.gutterBackground);

    let output = `\x1b[${screenY};${rect.x}H`;
    if (gutterBg) output += `\x1b[48;2;${gutterBg.r};${gutterBg.g};${gutterBg.b}m`;

    if (wrap.isFirstWrap) {
      const gitChange = this.gitLineChanges.get(wrap.bufferLine + 1);
      if (gitChange) {
        const getGitColor = (type: string): { r: number; g: number; b: number } => {
          const colorKey = `editorGutter.${type}Background`;
          const themeColor = themeLoader.getColor(colorKey);
          return hexToRgb(themeColor) || hexToRgb(this.theme.lineNumberForeground) || { r: 171, g: 178, b: 191 };
        };

        let indicatorColor: { r: number; g: number; b: number };
        let indicator: string;

        if (gitChange === 'added') {
          indicatorColor = getGitColor('added');
          indicator = '│';
        } else if (gitChange === 'modified') {
          indicatorColor = getGitColor('modified');
          indicator = '│';
        } else {
          indicatorColor = getGitColor('deleted');
          indicator = '▼';
        }

        output += `\x1b[38;2;${indicatorColor.r};${indicatorColor.g};${indicatorColor.b}m${indicator}`;
      } else {
        output += ' ';
      }
    } else {
      output += ' ';
    }

    if (lnColor) output += `\x1b[38;2;${lnColor.r};${lnColor.g};${lnColor.b}m`;
    output += lineNumStr;

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

    output += ' \x1b[0m';

    let lineBg: { r: number; g: number; b: number } | null = null;
    if (isCurrentLine && this.isFocused) {
      lineBg = hexToRgb(this.theme.lineHighlightBackground);
    }

    const contentWidth = rect.width - this.gutterWidth;
    const visibleText = line.substring(wrap.startColumn, wrap.endColumn);

    let selectedCols: Set<number> | null = null;
    for (const cursor of cursors) {
      if (hasSelection(cursor.selection)) {
        const selection = getSelectionRange(cursor.selection!);
        const { start, end } = selection;
        if (wrap.bufferLine >= start.line && wrap.bufferLine <= end.line) {
          const lineSelStart = wrap.bufferLine === start.line ? start.column : 0;
          const lineSelEnd = wrap.bufferLine === end.line ? end.column : line.length;
          if (lineSelEnd > wrap.startColumn && lineSelStart < wrap.endColumn) {
            const selStart = Math.max(0, lineSelStart - wrap.startColumn);
            const selEnd = Math.min(wrap.endColumn - wrap.startColumn, lineSelEnd - wrap.startColumn);
            if (selEnd > selStart) {
              if (!selectedCols) selectedCols = new Set();
              for (let col = selStart; col < selEnd; col++) {
                selectedCols.add(col);
              }
            }
          }
        }
      }
    }

    const selBg = hexToRgb(this.theme.selectionBackground);

    output += this.renderTextWithSelection(
      visibleText,
      lineTokens,
      wrap.startColumn,
      contentWidth,
      selectedCols,
      lineBg,
      selBg
    );

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
    selectedCols: Set<number> | null,
    lineBg: { r: number; g: number; b: number } | null,
    selBg: { r: number; g: number; b: number } | null
  ): string {
    if (text.length === 0) return '';

    let result = '';
    const defaultFg = hexToRgb(this.theme.foreground);

    const charColors: (string | null)[] = new Array(text.length).fill(null);

    for (const token of tokens) {
      const tokenStart = Math.max(0, token.start - startCol);
      const tokenEnd = Math.min(text.length, token.end - startCol);

      if (tokenEnd <= 0 || tokenStart >= text.length) continue;

      for (let i = tokenStart; i < tokenEnd; i++) {
        charColors[i] = token.color;
      }
    }

    let currentFg: string | null = null;
    let currentBg: 'line' | 'selection' | 'none' = 'none';
    let pendingText = '';

    const flushPending = () => {
      if (pendingText.length === 0) return;

      let style = '';

      if (currentBg === 'selection' && selBg) {
        style += `\x1b[48;2;${selBg.r};${selBg.g};${selBg.b}m`;
      } else if (currentBg === 'line' && lineBg) {
        style += `\x1b[48;2;${lineBg.r};${lineBg.g};${lineBg.b}m`;
      }

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
      const isSelected = selectedCols !== null && selectedCols.has(i);
      const bg: 'line' | 'selection' | 'none' = isSelected ? 'selection' : (lineBg ? 'line' : 'none');

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
    if (!this.isFocused) return;

    const cursorColor = hexToRgb(this.theme.cursorForeground);
    if (!cursorColor) return;

    for (const cursor of doc.cursors) {
      let screenLine: number;
      let screenCol: number;

      if (this.isWordWrapEnabled()) {
        screenLine = this.bufferToScreenLine(cursor.position.line, cursor.position.column) - this.scrollTop;

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

      if (screenLine < 0 || screenLine >= rect.height) continue;
      if (screenCol < 0 || screenCol >= this.getVisibleColumnCount()) continue;

      const cursorX = rect.x + this.gutterWidth + screenCol;
      const cursorY = rect.y + screenLine;

      ctx.buffer(`\x1b[${cursorY};${cursorX}H\x1b[48;2;${cursorColor.r};${cursorColor.g};${cursorColor.b}m \x1b[0m`);
    }
  }

  // ==================== Mouse Handling ====================

  containsPoint(x: number, y: number): boolean {
    return x >= this.rect.x && x < this.rect.x + this.rect.width &&
           y >= this.rect.y && y < this.rect.y + this.rect.height;
  }

  onMouseEvent(event: MouseEvent): boolean {
    if (event.y === this.rect.y) {
      return this.tabBar.onMouseEvent(event);
    }

    if (this.minimapEnabled && this.minimap.containsPoint(event.x, event.y)) {
      return this.minimap.onMouseEvent(event);
    }

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

    if (this.inlineDiff.visible) {
      const result = this.handleInlineDiffMouseEvent(event, editorRect);
      if (result) return true;
    }

    switch (event.name) {
      case 'MOUSE_LEFT_BUTTON_PRESSED': {
        const relativeX = event.x - editorRect.x;
        if (relativeX < this.gutterWidth) {
          const position = this.screenToBuffer(event.x, event.y, editorRect);
          const bufferLine = position.line;

          if (relativeX === 0) {
            const gitChange = this.gitLineChanges.get(bufferLine + 1);
            if (gitChange && this.onGitGutterClickCallback) {
              this.onGitGutterClickCallback(bufferLine + 1);
              return true;
            }
          }

          const foldCol = this.gutterWidth - 2;
          if (relativeX === foldCol || relativeX === foldCol + 1) {
            if (this.foldManager.canFold(bufferLine) || this.foldManager.isFolded(bufferLine)) {
              if (this.onFoldToggleCallback) {
                this.onFoldToggleCallback(bufferLine);
              }
              return true;
            }
          }
        }

        const position = this.screenToBuffer(event.x, event.y, editorRect);
        if (this.onClickCallback) {
          this.onClickCallback(position, 1, event);
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

      case 'MOUSE_WHEEL_UP': {
        this.setScrollTop(this.scrollTop - 3);
        if (this.onScrollCallback) this.onScrollCallback(0, -3);
        return true;
      }

      case 'MOUSE_WHEEL_DOWN': {
        this.setScrollTop(this.scrollTop + 3);
        if (this.onScrollCallback) this.onScrollCallback(0, 3);
        return true;
      }
    }

    return false;
  }

  private handleInlineDiffMouseEvent(event: MouseEvent, editorRect: Rect): boolean {
    const inlineDiffScreenY = this.bufferLineToScreenLine(this.inlineDiff.line) + 1;
    const inlineDiffY = editorRect.y + inlineDiffScreenY - this.scrollTop;

    if (event.y >= inlineDiffY && event.y < inlineDiffY + this.inlineDiff.height) {
      switch (event.name) {
        case 'MOUSE_LEFT_BUTTON_PRESSED': {
          if (event.y === inlineDiffY) {
            const relativeX = event.x - editorRect.x;
            const width = editorRect.width;
            const actionsStart = width - 32;

            if (relativeX >= actionsStart + 1 && relativeX < actionsStart + 9) {
              if (this.onInlineDiffStageCallback) {
                this.onInlineDiffStageCallback(this.inlineDiff.filePath, this.inlineDiff.line);
              }
              return true;
            } else if (relativeX >= actionsStart + 11 && relativeX < actionsStart + 20) {
              if (this.onInlineDiffRevertCallback) {
                this.onInlineDiffRevertCallback(this.inlineDiff.filePath, this.inlineDiff.line);
              }
              return true;
            } else if (relativeX >= actionsStart + 22 && relativeX < actionsStart + 32) {
              this.hideInlineDiff();
              return true;
            }
          }
          return true;
        }

        case 'MOUSE_WHEEL_UP': {
          this.inlineDiff.scrollTop = Math.max(0, this.inlineDiff.scrollTop - 3);
          if (this.onScrollCallback) this.onScrollCallback(0, -3);
          return true;
        }

        case 'MOUSE_WHEEL_DOWN': {
          const maxScroll = Math.max(0, this.inlineDiff.diffLines.length - this.inlineDiff.height + 2);
          this.inlineDiff.scrollTop = Math.min(maxScroll, this.inlineDiff.scrollTop + 3);
          if (this.onScrollCallback) this.onScrollCallback(0, 3);
          return true;
        }
      }
    }

    return false;
  }

  private bufferLineToScreenLine(bufferLine: number): number {
    if (!this.isWordWrapEnabled()) {
      return bufferLine;
    }

    for (let i = 0; i < this.wrappedLines.length; i++) {
      if (this.wrappedLines[i]!.bufferLine === bufferLine) {
        return i;
      }
    }

    return bufferLine;
  }

  private screenToBuffer(screenX: number, screenY: number, editorRect: Rect): Position {
    const relativeY = screenY - editorRect.y;
    const relativeX = screenX - editorRect.x - this.gutterWidth;
    const doc = this.getActiveDocument();

    if (this.isWordWrapEnabled()) {
      const absoluteScreenLine = this.scrollTop + relativeY;
      if (absoluteScreenLine < this.wrappedLines.length) {
        const wrap = this.wrappedLines[absoluteScreenLine]!;
        const line = wrap.bufferLine;
        const column = Math.max(0, wrap.startColumn + relativeX);
        // Clamp column to actual line length
        const lineLength = doc?.getLine(line)?.length ?? 0;
        return {
          line,
          column: Math.min(column, lineLength)
        };
      }
    }

    // Clamp line to valid range
    const maxLine = Math.max(0, (doc?.lineCount ?? 1) - 1);
    const line = Math.min(Math.max(0, this.scrollTop + relativeY), maxLine);
    const column = Math.max(0, this.scrollLeft + relativeX);
    // Clamp column to actual line length
    const lineLength = doc?.getLine(line)?.length ?? 0;
    return {
      line,
      column: Math.min(column, lineLength)
    };
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

  toggleFoldAtCursor(): boolean {
    const doc = this.getActiveDocument();
    if (!doc) return false;

    const cursorLine = doc.primaryCursor.position.line;

    if (this.foldManager.isFolded(cursorLine)) {
      this.foldManager.unfold(cursorLine);
      return true;
    } else if (this.foldManager.canFold(cursorLine)) {
      this.foldManager.fold(cursorLine);
      return true;
    }

    return false;
  }

  foldAll(): void {
    for (let i = 0; i < this.foldManager.getRegionCount(); i++) {
      const region = this.foldManager.getRegion(i);
      if (region && this.foldManager.canFold(region.startLine)) {
        this.foldManager.fold(region.startLine);
      }
    }
  }

  unfoldAll(): void {
    this.foldManager.unfoldAll();
  }

  isFoldingEnabled(): boolean {
    return this.foldingEnabled;
  }

  setFoldingEnabled(enabled: boolean): void {
    this.foldingEnabled = enabled;
    if (!enabled) {
      this.foldManager.unfoldAll();
    } else {
      const doc = this.getActiveDocument();
      if (doc) {
        this.updateFoldRegions(doc);
      }
    }
  }

  // ==================== Minimap ====================

  getMinimap(): Minimap {
    return this.minimap;
  }

  toggleMinimap(): void {
    this.minimapEnabled = !this.minimapEnabled;
    this.setRect(this.rect);
  }

  // ==================== Git Integration ====================

  setGitLineChanges(changes: GitLineChange[]): void {
    this.gitLineChanges.clear();
    for (const change of changes) {
      this.gitLineChanges.set(change.line, change.type);
    }
  }

  clearGitLineChanges(): void {
    this.gitLineChanges.clear();
  }

  getGitLineChanges(): GitLineChange[] {
    const changes: GitLineChange[] = [];
    for (const [line, type] of this.gitLineChanges) {
      changes.push({ line, type });
    }
    return changes;
  }

  // ==================== Inline Diff ====================

  showInlineDiff(line: number, diffLines: string[], filePath: string): void {
    this.inlineDiff = {
      visible: true,
      line,
      diffLines,
      scrollTop: 0,
      height: Math.min(diffLines.length + 2, 15),
      filePath
    };
  }

  hideInlineDiff(): void {
    this.inlineDiff.visible = false;
  }

  isInlineDiffVisible(): boolean {
    return this.inlineDiff.visible;
  }

  handleInlineDiffKey(key: string, ctrl: boolean, _shift: boolean): boolean {
    if (!this.inlineDiff.visible) return false;

    switch (key) {
      case 'Escape':
        this.hideInlineDiff();
        return true;

      case 's':
        if (this.onInlineDiffStageCallback) {
          this.onInlineDiffStageCallback(this.inlineDiff.filePath, this.inlineDiff.line);
        }
        return true;

      case 'r':
        if (this.onInlineDiffRevertCallback) {
          this.onInlineDiffRevertCallback(this.inlineDiff.filePath, this.inlineDiff.line);
        }
        return true;

      case 'j':
      case 'ArrowDown':
        this.inlineDiff.scrollTop = Math.min(
          this.inlineDiff.diffLines.length - this.inlineDiff.height + 2,
          this.inlineDiff.scrollTop + 1
        );
        return true;

      case 'k':
      case 'ArrowUp':
        this.inlineDiff.scrollTop = Math.max(0, this.inlineDiff.scrollTop - 1);
        return true;
    }

    return false;
  }

  onInlineDiffStage(callback: (filePath: string, line: number) => Promise<void>): () => void {
    this.onInlineDiffStageCallback = callback;
    return () => { this.onInlineDiffStageCallback = undefined; };
  }

  onInlineDiffRevert(callback: (filePath: string, line: number) => Promise<void>): () => void {
    this.onInlineDiffRevertCallback = callback;
    return () => { this.onInlineDiffRevertCallback = undefined; };
  }

  // ==================== Panel Container Access ====================

  getContainer(): PanelContainer {
    return this.container;
  }
}
