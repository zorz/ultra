/**
 * Pane Component
 *
 * A tabbed editor pane that delegates rendering to EditorContent.
 * Each tab contains an EditorContent instance that wraps a Document.
 * Pane manages tab state and coordinates which EditorContent is active.
 */

import { Document } from '../../core/document.ts';
import { TabBar, type Tab } from './tab-bar.ts';
import type { RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import type { MouseHandler, MouseEvent } from '../mouse.ts';
import type { Position } from '../../core/buffer.ts';
import type { GitLineChange } from '../../features/git/git-integration.ts';
import { EditorContent } from '../panels/editor-content.ts';
import { themeLoader } from '../themes/theme-loader.ts';
import { hexToRgb } from '../colors.ts';
import { debugLog, isDebugEnabled } from '../../debug.ts';

// ==================== Types ====================

interface PaneTab {
  id: string;
  documentId: string;
  document: Document;
  filePath: string | null;
  editorContent: EditorContent;
}

// ==================== Pane ====================

/**
 * A tabbed editor pane using the EditorContent abstraction.
 *
 * Pane handles:
 * - Tab management (open, close, switch tabs)
 * - Tab bar rendering
 * - Focus border rendering
 * - Coordinating which EditorContent is active
 *
 * EditorContent handles:
 * - All editor rendering (content, cursor, syntax highlighting, minimap)
 * - Mouse event handling with proper bounds checking
 * - Scroll state, word wrap, folding
 * - Inline diff display
 * - Git line changes
 */
export class Pane implements MouseHandler {
  readonly id: string;

  // Tab management
  private tabs: PaneTab[] = [];
  private activeTabId: string | null = null;
  private tabIdCounter: number = 0;

  // Layout
  private rect: Rect = { x: 1, y: 1, width: 80, height: 24 };
  private tabBarHeight: number = 1;

  // State
  private isFocused: boolean = false;

  // Sub-components
  private tabBar: TabBar;

  // Callbacks
  private onClickCallback?: (position: Position, clickCount: number, event: MouseEvent) => void;
  private onDragCallback?: (position: Position, event: MouseEvent) => void;
  private onScrollCallback?: (deltaX: number, deltaY: number) => void;
  private onFocusCallback?: () => void;
  private onTabSelectCallback?: (document: Document) => void;
  private onTabCloseCallback?: (document: Document, tabId: string) => void;
  private onFoldToggleCallback?: (line: number) => void;
  private onGitGutterClickCallback?: (line: number) => void;
  private onInlineDiffStageCallback?: (filePath: string, line: number) => Promise<void>;
  private onInlineDiffRevertCallback?: (filePath: string, line: number) => Promise<void>;

  constructor(id: string) {
    this.id = id;
    this.tabBar = new TabBar();
    this.setupTabBarCallbacks();
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

  // ==================== Tab Management ====================

  private generateTabId(): string {
    return `${this.id}-tab-${++this.tabIdCounter}`;
  }

  private getActiveEditorContent(): EditorContent | null {
    if (!this.activeTabId) return null;
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    return tab?.editorContent || null;
  }

  private createEditorContent(document: Document, documentId: string): EditorContent {
    const contentId = `${this.id}-editor-${documentId}`;
    const editorContent = new EditorContent(contentId, document, documentId);

    this.setupEditorContentCallbacks(editorContent);
    return editorContent;
  }

  private setupEditorContentCallbacks(editorContent: EditorContent): void {
    editorContent.onClick((position, clickCount, event) => {
      if (this.onClickCallback) {
        this.onClickCallback(position, clickCount, event);
      }
    });

    editorContent.onDrag((position, event) => {
      if (this.onDragCallback) {
        this.onDragCallback(position, event);
      }
    });

    editorContent.onScroll((deltaX, deltaY) => {
      if (this.onScrollCallback) {
        this.onScrollCallback(deltaX, deltaY);
      }
    });

    editorContent.onFoldToggle((line) => {
      // Directly toggle the fold on the clicked line
      const foldManager = editorContent.getFoldManager();
      if (foldManager.isFolded(line)) {
        foldManager.unfold(line);
      } else if (foldManager.canFold(line)) {
        foldManager.fold(line);
      }
      // Also call external callback if registered
      if (this.onFoldToggleCallback) {
        this.onFoldToggleCallback(line);
      }
    });

    editorContent.onGitGutterClick((line) => {
      if (this.onGitGutterClickCallback) {
        this.onGitGutterClickCallback(line);
      }
    });

    editorContent.onInlineDiffStage((filePath, line) => {
      if (this.onInlineDiffStageCallback) {
        return this.onInlineDiffStageCallback(filePath, line);
      }
      return Promise.resolve();
    });

    editorContent.onInlineDiffRevert((filePath, line) => {
      if (this.onInlineDiffRevertCallback) {
        return this.onInlineDiffRevertCallback(filePath, line);
      }
      return Promise.resolve();
    });
  }

  /**
   * Open a document in this pane (creates a new tab or activates existing)
   */
  openDocument(document: Document, documentId?: string): string {
    // Check if document is already open
    const existingTab = this.tabs.find(t => t.document === document);
    if (existingTab) {
      this.activateTab(existingTab.id);
      return existingTab.id;
    }

    const tabId = this.generateTabId();
    const docId = documentId || tabId;

    const editorContent = this.createEditorContent(document, docId);

    // Set initial rect for the editor content
    editorContent.setRect(this.getEditorRect());

    const tab: PaneTab = {
      id: tabId,
      documentId: docId,
      document,
      filePath: document.filePath,
      editorContent,
    };

    this.tabs.push(tab);
    this.activateTab(tabId);

    return tabId;
  }

  closeTab(tabId: string): void {
    const index = this.tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;

    const tab = this.tabs[index]!;
    tab.editorContent.dispose();
    this.tabs.splice(index, 1);

    if (this.activeTabId === tabId) {
      if (this.tabs.length > 0) {
        const newIndex = Math.min(index, this.tabs.length - 1);
        this.activateTab(this.tabs[newIndex]!.id);
      } else {
        this.activeTabId = null;
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

    // Deactivate previous tab
    if (this.activeTabId && this.activeTabId !== tabId) {
      const prevTab = this.tabs.find(t => t.id === this.activeTabId);
      if (prevTab) {
        prevTab.editorContent.onDeactivated();
        prevTab.editorContent.setVisible(false);
        prevTab.editorContent.setFocused(false);
      }
    }

    this.activeTabId = tabId;

    // Activate new tab
    tab.editorContent.setVisible(true);
    tab.editorContent.setFocused(this.isFocused);
    tab.editorContent.onActivated();

    if (this.onTabSelectCallback) {
      this.onTabSelectCallback(tab.document);
    }
  }

  getActiveDocument(): Document | null {
    if (!this.activeTabId) return null;
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    return tab?.document || null;
  }

  getActiveEditorContentPublic(): EditorContent | null {
    return this.getActiveEditorContent();
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
    editorContent.setRect(this.getEditorRect());

    const tab: PaneTab = {
      id: tabId,
      documentId: id,
      document,
      filePath: document.filePath,
      editorContent,
    };

    this.tabs.push(tab);
  }

  setActiveDocument(id: string, document: Document): void {
    let tab = this.tabs.find(t => t.documentId === id);
    if (!tab) {
      this.addDocument(id, document);
      tab = this.tabs.find(t => t.documentId === id);
    }
    if (tab) {
      this.activateTab(tab.id);
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
      tabOrder: index,
    }));
  }

  getDocumentIds(): string[] {
    return this.tabs.map(t => t.documentId);
  }

  removeDocument(id: string): void {
    const tab = this.tabs.find(t => t.documentId === id);
    if (tab) {
      this.closeTab(tab.id);
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
    this.debugLog(`setRect(${JSON.stringify(rect)})`);
    this.rect = rect;

    // Update tab bar rect
    this.tabBar.setRect({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: this.tabBarHeight,
    });

    // Update all EditorContent rects
    const editorRect = this.getEditorRect();
    for (const tab of this.tabs) {
      tab.editorContent.setRect(editorRect);
    }
  }

  getRect(): Rect {
    return this.rect;
  }

  private getEditorRect(): Rect {
    return {
      x: this.rect.x,
      y: this.rect.y + this.tabBarHeight,
      width: this.rect.width,
      height: this.rect.height - this.tabBarHeight,
    };
  }

  // ==================== Scrolling (delegated to EditorContent) ====================

  setScrollTop(value: number): void {
    const activeContent = this.getActiveEditorContent();
    if (activeContent) {
      activeContent.setScrollTop(value);
    }
  }

  getScrollTop(): number {
    const activeContent = this.getActiveEditorContent();
    return activeContent?.getScrollTop() ?? 0;
  }

  setScrollLeft(value: number): void {
    const activeContent = this.getActiveEditorContent();
    if (activeContent) {
      activeContent.setScrollLeft(value);
    }
  }

  getScrollLeft(): number {
    const activeContent = this.getActiveEditorContent();
    return activeContent?.getScrollLeft() ?? 0;
  }

  getVisibleLineCount(): number {
    const activeContent = this.getActiveEditorContent();
    return activeContent?.getVisibleLineCount() ?? (this.rect.height - this.tabBarHeight);
  }

  ensureCursorVisible(): void {
    const activeContent = this.getActiveEditorContent();
    if (activeContent) {
      activeContent.ensureCursorVisible();
    }
  }

  // ==================== Rendering ====================

  render(ctx: RenderContext): void {
    // Render tab bar
    this.renderTabBar(ctx);

    // Render active editor content (handles editor, minimap, cursor, etc.)
    const activeContent = this.getActiveEditorContent();
    if (activeContent) {
      activeContent.render(ctx);
    } else {
      this.renderEmptyState(ctx);
    }

    // Render focus border
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
      isMissing: t.document.isMissing,
    }));

    this.tabBar.setTabs(tabBarTabs);
    this.tabBar.setFocused(this.isFocused);
    this.tabBar.render(ctx);
  }

  private renderEmptyState(ctx: RenderContext): void {
    const editorRect = this.getEditorRect();
    const bgColor = themeLoader.getColor('editor.background') || '#282c34';
    const fgColor = themeLoader.getColor('editorLineNumber.foreground') || '#495162';

    const bgRgb = hexToRgb(bgColor);
    const fgRgb = hexToRgb(fgColor);

    // Fill background
    if (bgRgb) {
      const bg = `\x1b[48;2;${bgRgb.r};${bgRgb.g};${bgRgb.b}m`;
      for (let y = editorRect.y; y < editorRect.y + editorRect.height; y++) {
        ctx.buffer(`\x1b[${y};${editorRect.x}H${bg}${' '.repeat(editorRect.width)}\x1b[0m`);
      }
    }

    // Center message
    const message = 'No file open';
    const x = editorRect.x + Math.floor((editorRect.width - message.length) / 2);
    const y = editorRect.y + Math.floor(editorRect.height / 2);

    const fg = fgRgb ? `\x1b[38;2;${fgRgb.r};${fgRgb.g};${fgRgb.b}m` : '';
    ctx.buffer(`\x1b[${y};${x}H${fg}${message}\x1b[0m`);
  }

  private renderFocusBorder(ctx: RenderContext): void {
    const accentColor = themeLoader.getColor('focusBorder') || '#528bff';
    const rgb = hexToRgb(accentColor);
    if (!rgb) return;

    const fg = `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m`;
    ctx.buffer(`\x1b[${this.rect.y};${this.rect.x}H${fg}▎\x1b[0m`);
  }

  // ==================== Mouse Handling ====================

  containsPoint(x: number, y: number): boolean {
    return (
      x >= this.rect.x &&
      x < this.rect.x + this.rect.width &&
      y >= this.rect.y &&
      y < this.rect.y + this.rect.height
    );
  }

  onMouseEvent(event: MouseEvent): boolean {
    // Tab bar handles its own row
    if (event.y === this.rect.y) {
      return this.tabBar.onMouseEvent(event);
    }

    // Delegate to active EditorContent
    const activeContent = this.getActiveEditorContent();
    if (activeContent && activeContent.containsPoint(event.x, event.y)) {
      return activeContent.handleMouse(event);
    }

    return false;
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

  onInlineDiffStage(callback: (filePath: string, line: number) => Promise<void>): () => void {
    this.onInlineDiffStageCallback = callback;
    return () => { this.onInlineDiffStageCallback = undefined; };
  }

  onInlineDiffRevert(callback: (filePath: string, line: number) => Promise<void>): () => void {
    this.onInlineDiffRevertCallback = callback;
    return () => { this.onInlineDiffRevertCallback = undefined; };
  }

  // ==================== Folding (delegated to EditorContent) ====================

  toggleFoldAtCursor(): boolean {
    const activeContent = this.getActiveEditorContent();
    if (!activeContent) return false;

    const doc = activeContent.getDocument();
    if (!doc) return false;

    const foldManager = activeContent.getFoldManager();
    const cursorLine = doc.primaryCursor.position.line;

    if (foldManager.isFolded(cursorLine)) {
      foldManager.unfold(cursorLine);
      return true;
    } else if (foldManager.canFold(cursorLine)) {
      foldManager.fold(cursorLine);
      return true;
    }

    return false;
  }

  foldAll(): void {
    const activeContent = this.getActiveEditorContent();
    if (!activeContent) return;

    activeContent.getFoldManager().foldAll();
  }

  unfoldAll(): void {
    const activeContent = this.getActiveEditorContent();
    if (activeContent) {
      activeContent.getFoldManager().unfoldAll();
    }
  }

  // ==================== Git Integration (delegated to EditorContent) ====================

  setGitLineChanges(changes: GitLineChange[]): void {
    const activeContent = this.getActiveEditorContent();
    if (activeContent) {
      const map = new Map<number, GitLineChange['type']>();
      for (const change of changes) {
        map.set(change.line, change.type);
      }
      activeContent.setGitLineChanges(map);
    }
  }

  clearGitLineChanges(): void {
    const activeContent = this.getActiveEditorContent();
    if (activeContent) {
      activeContent.setGitLineChanges(new Map());
    }
  }

  getGitLineChanges(): GitLineChange[] {
    const activeContent = this.getActiveEditorContent();
    if (!activeContent) return [];

    const map = activeContent.getGitLineChanges();
    const changes: GitLineChange[] = [];
    for (const [line, type] of map) {
      changes.push({ line, type });
    }
    return changes;
  }

  // ==================== Minimap ====================

  toggleMinimap(): void {
    const activeContent = this.getActiveEditorContent();
    if (activeContent) {
      activeContent.toggleMinimap();
    }
  }

  // ==================== Inline Diff (delegated to EditorContent) ====================

  showInlineDiff(line: number, diffLines: string[], filePath: string): void {
    const activeContent = this.getActiveEditorContent();
    if (activeContent) {
      activeContent.showInlineDiff(line, diffLines, filePath);
    }
  }

  hideInlineDiff(): void {
    const activeContent = this.getActiveEditorContent();
    if (activeContent) {
      activeContent.hideInlineDiff();
    }
  }

  isInlineDiffVisible(): boolean {
    const activeContent = this.getActiveEditorContent();
    return activeContent?.isInlineDiffVisible() ?? false;
  }

  handleInlineDiffKey(key: string, _ctrl: boolean, _shift: boolean): boolean {
    const activeContent = this.getActiveEditorContent();
    if (!activeContent || !activeContent.isInlineDiffVisible()) return false;

    const state = activeContent.getInlineDiffState();
    const upperKey = key.toUpperCase();

    switch (upperKey) {
      case 'ESCAPE':
      case 'C':
        this.hideInlineDiff();
        return true;
      case 'S':
        if (this.onInlineDiffStageCallback && state) {
          this.onInlineDiffStageCallback(state.filePath, state.line);
        }
        return true;
      case 'R':
        if (this.onInlineDiffRevertCallback && state) {
          this.onInlineDiffRevertCallback(state.filePath, state.line);
        }
        return true;
      case 'J':
      case 'DOWN':
        activeContent.scrollInlineDiff(1);
        return true;
      case 'K':
      case 'UP':
        activeContent.scrollInlineDiff(-1);
        return true;
      default:
        // Capture all keys while inline diff is visible to prevent editor input
        return true;
    }
  }

  // ==================== Gutter Width (delegated to EditorContent) ====================

  getGutterWidth(): number {
    const activeContent = this.getActiveEditorContent();
    return activeContent?.getGutterWidth() ?? 6;
  }

  // ==================== Debug ====================

  private debugLog(message: string): void {
    if (isDebugEnabled()) {
      debugLog(`[Pane:${this.id}] ${message}`);
    }
  }
}
