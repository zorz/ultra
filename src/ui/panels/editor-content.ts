/**
 * Editor Content
 *
 * PanelContent implementation for code/text editing.
 * Wraps a Document and provides editor-specific rendering.
 */

import { renderer, type RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import type { KeyEvent } from '../../terminal/input.ts';
import type { MouseEvent } from '../mouse.ts';
import type { Document } from '../../core/document.ts';
import type { Position } from '../../core/buffer.ts';
import type {
  PanelContent,
  ScrollablePanelContent,
  FocusablePanelContent,
  ContentState,
} from './panel-content.interface.ts';
import { Minimap } from '../components/minimap.ts';
import { FoldManager } from '../../core/fold.ts';
import { highlighter as shikiHighlighter, type HighlightToken } from '../../features/syntax/shiki-highlighter.ts';
import { themeLoader } from '../themes/theme-loader.ts';
import { hexToRgb, blendColors } from '../colors.ts';
import { settings } from '../../config/settings.ts';
import { inFileSearch, type SearchMatch } from '../../features/search/in-file-search.ts';
import { findMatchingBracket, type BracketMatch } from '../../core/bracket-match.ts';
import { hasSelection, getSelectionRange } from '../../core/cursor.ts';
import { debugLog, isDebugEnabled } from '../../debug.ts';
import type { GitLineChange } from '../../features/git/git-integration.ts';

// ==================== Types ====================

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
  lineHighlightBackground: '#2c313c',
};

interface WrappedLine {
  bufferLine: number;
  startColumn: number;
  endColumn: number;
  isFirstWrap: boolean;
}

interface InlineDiffState {
  visible: boolean;
  line: number;
  diffLines: string[];
  scrollTop: number;
  height: number;
  filePath: string;
}

/**
 * Editor-specific content state for serialization.
 */
export interface EditorContentState extends ContentState {
  contentType: 'editor';
  data: {
    filePath: string | null;
    scrollTop: number;
    scrollLeft: number;
    cursorLine: number;
    cursorColumn: number;
    foldedRegions: number[];
  };
}

// ==================== Editor Content ====================

/**
 * Editor content for displaying and editing code/text documents.
 *
 * This is a PanelContent implementation that wraps a Document and provides
 * all the editor rendering functionality (syntax highlighting, line numbers,
 * selections, cursors, minimap, etc.).
 */
export class EditorContent implements ScrollablePanelContent, FocusablePanelContent {
  readonly contentType = 'editor' as const;
  readonly contentId: string;

  // Document reference
  private _document: Document | null = null;
  private documentId: string | null = null;

  // Layout
  private rect: Rect = { x: 1, y: 1, width: 80, height: 24 };
  private visible: boolean = true;
  private focused: boolean = false;

  // Scroll state
  private scrollTop: number = 0;
  private scrollLeft: number = 0;

  // Sub-components
  private minimap: Minimap;
  private foldManager: FoldManager;

  // Settings
  private minimapEnabled: boolean = true;
  private foldingEnabled: boolean = true;
  private gutterWidth: number = 6;

  // Theme
  private theme: EditorTheme = defaultTheme;

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

  // Fold state
  private lastFoldContent: string = '';

  // Git line changes for gutter indicators
  private gitLineChanges: Map<number, GitLineChange['type']> = new Map();

  // Inline diff widget
  private inlineDiff: InlineDiffState = {
    visible: false,
    line: 0,
    diffLines: [],
    scrollTop: 0,
    height: 10,
    filePath: '',
  };

  // Callbacks
  private onClickCallback?: (position: Position, clickCount: number, event: MouseEvent) => void;
  private onDragCallback?: (position: Position, event: MouseEvent) => void;
  private onScrollCallback?: (deltaX: number, deltaY: number) => void;
  private onFocusCallbacks: (() => void)[] = [];
  private onBlurCallbacks: (() => void)[] = [];
  private onFoldToggleCallback?: (line: number) => void;
  private onGitGutterClickCallback?: (line: number) => void;
  private onInlineDiffStageCallback?: (filePath: string, line: number) => Promise<void>;
  private onInlineDiffRevertCallback?: (filePath: string, line: number) => Promise<void>;

  constructor(contentId: string, document?: Document, documentId?: string) {
    this.contentId = contentId;
    this.minimap = new Minimap();
    this.foldManager = new FoldManager();

    if (document) {
      this.setDocument(document, documentId);
    }

    this.loadSettings();
    this.setupMinimapCallbacks();
  }

  // ==================== Setup ====================

  private loadSettings(): void {
    this.minimapEnabled = settings.get('editor.minimap.enabled') ?? true;
    this.foldingEnabled = settings.get('editor.folding') ?? true;
  }

  private setupMinimapCallbacks(): void {
    this.minimap.onScroll((line) => {
      this.setScrollTop(line);
      if (this.onScrollCallback) {
        this.onScrollCallback(0, 0);
      }
    });
  }

  // ==================== Document Management ====================

  /**
   * Set the document to display.
   */
  setDocument(document: Document | null, documentId?: string): void {
    this._document = document;
    this.documentId = documentId || null;

    if (document) {
      this.scrollTop = 0;
      this.scrollLeft = 0;
      this.updateGutterWidth();
      this.minimap.setDocument(document);
      this.setupHighlighting(document);

      if (this.foldingEnabled) {
        this.updateFoldRegions(document);
      }
    } else {
      this.minimap.setDocument(null);
    }
  }

  /**
   * Get the current document.
   */
  getDocument(): Document | null {
    return this._document;
  }

  /**
   * Get the document ID.
   */
  getDocumentId(): string | null {
    return this.documentId;
  }

  // ==================== PanelContent Implementation ====================

  getTitle(): string {
    if (this._document) {
      return this._document.fileName;
    }
    return 'Untitled';
  }

  getIcon(): string {
    // Could be enhanced to return file-type specific icons
    return '📄';
  }

  isDirty(): boolean {
    return this._document?.isDirty ?? false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
  }

  getRect(): Rect {
    return this.rect;
  }

  setRect(rect: Rect): void {
    this.rect = rect;

    // Minimap on right side
    const minimapWidth = this.minimapEnabled ? 10 : 0;

    if (this.minimapEnabled) {
      this.minimap.setRect({
        x: rect.x + rect.width - minimapWidth,
        y: rect.y,
        width: minimapWidth,
        height: rect.height,
      });
      this.minimap.setEditorScroll(this.scrollTop, rect.height);
    }
  }

  // ==================== Focusable Implementation ====================

  isFocused(): boolean {
    return this.focused;
  }

  setFocused(focused: boolean): void {
    const wasFocused = this.focused;
    this.focused = focused;

    if (focused && !wasFocused) {
      for (const cb of this.onFocusCallbacks) cb();
    }
    if (!focused && wasFocused) {
      for (const cb of this.onBlurCallbacks) cb();
    }
  }

  onFocus(callback: () => void): () => void {
    this.onFocusCallbacks.push(callback);
    return () => {
      this.onFocusCallbacks = this.onFocusCallbacks.filter(cb => cb !== callback);
    };
  }

  onBlur(callback: () => void): () => void {
    this.onBlurCallbacks.push(callback);
    return () => {
      this.onBlurCallbacks = this.onBlurCallbacks.filter(cb => cb !== callback);
    };
  }

  // ==================== Scrollable Implementation ====================

  getScrollTop(): number {
    return this.scrollTop;
  }

  setScrollTop(value: number): void {
    if (!this._document) return;

    const maxScroll = Math.max(0, this._document.lineCount - 1);
    this.scrollTop = Math.max(0, Math.min(value, maxScroll));
    this.minimap.setEditorScroll(this.scrollTop, this.getVisibleLineCount());
  }

  getScrollLeft(): number {
    return this.scrollLeft;
  }

  setScrollLeft(value: number): void {
    this.scrollLeft = Math.max(0, value);
  }

  getContentHeight(): number {
    return this._document?.lineCount ?? 0;
  }

  getContentWidth(): number {
    if (!this._document) return 0;
    let maxWidth = 0;
    for (let i = 0; i < this._document.lineCount; i++) {
      maxWidth = Math.max(maxWidth, this._document.getLine(i).length);
    }
    return maxWidth;
  }

  scrollBy(deltaX: number, deltaY: number): void {
    this.setScrollLeft(this.scrollLeft + deltaX);
    this.setScrollTop(this.scrollTop + deltaY);
  }

  getVisibleLineCount(): number {
    return this.rect.height;
  }

  // ==================== Editor-specific Methods ====================

  /**
   * Get visible column count (text width).
   */
  private getVisibleColumnCount(): number {
    const minimapWidth = this.minimapEnabled ? 10 : 0;
    return Math.max(1, this.rect.width - this.gutterWidth - minimapWidth);
  }

  /**
   * Ensure cursor is visible.
   */
  ensureCursorVisible(): void {
    const doc = this._document;
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

    if (scrolled && this.onScrollCallback) {
      this.onScrollCallback(0, 0);
    }
  }

  /**
   * Get gutter width.
   */
  getGutterWidth(): number {
    return this.gutterWidth;
  }

  /**
   * Update gutter width based on line count.
   */
  private updateGutterWidth(): void {
    const doc = this._document;
    if (!doc) {
      this.gutterWidth = 6;
      return;
    }
    const lineCount = doc.lineCount;
    const digits = Math.max(3, String(lineCount).length);
    this.gutterWidth = digits + 3; // 1 git indicator + digits + fold indicator + space
  }

  /**
   * Set git line changes for gutter display.
   */
  setGitLineChanges(changes: Map<number, GitLineChange['type']>): void {
    this.gitLineChanges = changes;
  }

  /**
   * Get git line changes.
   */
  getGitLineChanges(): Map<number, GitLineChange['type']> {
    return this.gitLineChanges;
  }

  /**
   * Toggle minimap visibility.
   */
  toggleMinimap(): void {
    this.minimapEnabled = !this.minimapEnabled;
    // Re-apply rect to update minimap positioning
    this.setRect(this.rect);
  }

  /**
   * Check if minimap is enabled.
   */
  isMinimapEnabled(): boolean {
    return this.minimapEnabled;
  }

  /**
   * Get fold manager.
   */
  getFoldManager(): FoldManager {
    return this.foldManager;
  }

  // ==================== Word Wrap ====================

  private isWordWrapEnabled(): boolean {
    const wrapSetting = settings.get('editor.wordWrap');
    return wrapSetting === 'on' || wrapSetting === 'wordWrapColumn' || wrapSetting === 'bounded';
  }

  private computeWrappedLines(): void {
    const doc = this._document;
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
          isFirstWrap: true,
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
          isFirstWrap: true,
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
            isFirstWrap: isFirst,
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

  // ==================== Syntax Highlighting ====================

  private setupHighlighting(doc: Document): void {
    const language = doc.language;
    if (language && language !== 'plaintext') {
      shikiHighlighter.setLanguage(language).then(() => {
        this.highlighterReady = true;
        this.lastLanguage = language;
        // Schedule a re-render to apply syntax highlighting
        renderer.scheduleRender();
      }).catch(() => {
        this.highlighterReady = false;
      });
    } else {
      this.highlighterReady = false;
    }
  }

  // ==================== Folding ====================

  private updateFoldRegions(doc: Document): void {
    const lines: string[] = [];
    for (let i = 0; i < doc.lineCount; i++) {
      lines.push(doc.getLine(i));
    }
    this.foldManager.computeRegions(lines);
  }

  // ==================== Theme ====================

  private updateTheme(): void {
    this.theme = {
      background: themeLoader.getColor('editor.background') || defaultTheme.background,
      foreground: themeLoader.getColor('editor.foreground') || defaultTheme.foreground,
      lineNumberForeground: themeLoader.getColor('editorLineNumber.foreground') || defaultTheme.lineNumberForeground,
      lineNumberActiveForeground: themeLoader.getColor('editorLineNumber.activeForeground') || defaultTheme.lineNumberActiveForeground,
      gutterBackground: themeLoader.getColor('editorGutter.background') || themeLoader.getColor('editor.background') || defaultTheme.gutterBackground,
      selectionBackground: themeLoader.getColor('editor.selectionBackground') || defaultTheme.selectionBackground,
      cursorForeground: themeLoader.getColor('editorCursor.foreground') || defaultTheme.cursorForeground,
      lineHighlightBackground: themeLoader.getColor('editor.lineHighlightBackground') || defaultTheme.lineHighlightBackground,
    };
  }

  // ==================== Inline Diff ====================

  /**
   * Show inline diff widget.
   */
  showInlineDiff(line: number, diffLines: string[], filePath: string): void {
    this.inlineDiff = {
      visible: true,
      line,
      diffLines,
      scrollTop: 0,
      height: Math.min(diffLines.length + 2, 15),
      filePath,
    };
  }

  /**
   * Hide inline diff widget.
   */
  hideInlineDiff(): void {
    this.inlineDiff.visible = false;
  }

  /**
   * Check if inline diff is visible.
   */
  isInlineDiffVisible(): boolean {
    return this.inlineDiff.visible;
  }

  /**
   * Get inline diff state (filePath and line).
   */
  getInlineDiffState(): { filePath: string; line: number } | null {
    if (!this.inlineDiff.visible) return null;
    return { filePath: this.inlineDiff.filePath, line: this.inlineDiff.line };
  }

  /**
   * Scroll inline diff by delta lines.
   */
  scrollInlineDiff(delta: number): void {
    if (!this.inlineDiff.visible) return;
    const maxScroll = Math.max(0, this.inlineDiff.diffLines.length - this.inlineDiff.height + 2);
    this.inlineDiff.scrollTop = Math.max(0, Math.min(this.inlineDiff.scrollTop + delta, maxScroll));
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

  // ==================== Lifecycle ====================

  onActivated(): void {
    if (this._document) {
      // Reset parsed content to force re-parse since the singleton highlighter
      // may have tokens from a different document
      this.lastParsedContent = '';
      this.setupHighlighting(this._document);
    }
  }

  onDeactivated(): void {
    // Could pause syntax highlighting updates, etc.
  }

  // ==================== Serialization ====================

  serialize(): EditorContentState {
    const cursor = this._document?.primaryCursor;
    return {
      contentType: 'editor',
      contentId: this.contentId,
      title: this.getTitle(),
      data: {
        filePath: this._document?.filePath ?? null,
        scrollTop: this.scrollTop,
        scrollLeft: this.scrollLeft,
        cursorLine: cursor?.position.line ?? 0,
        cursorColumn: cursor?.position.column ?? 0,
        foldedRegions: this.foldManager.getFoldedLines(),
      },
    };
  }

  restore(state: ContentState): void {
    if (state.contentType !== 'editor') return;

    const data = state.data as EditorContentState['data'];
    this.scrollTop = data.scrollTop ?? 0;
    this.scrollLeft = data.scrollLeft ?? 0;

    // Restore folded regions
    if (data.foldedRegions && this.foldManager) {
      for (const line of data.foldedRegions) {
        this.foldManager.fold(line);
      }
    }
  }

  // ==================== Rendering ====================

  render(ctx: RenderContext): void {
    if (!this.visible) return;

    this.updateTheme();
    this.renderEditor(ctx);

    if (this.minimapEnabled) {
      this.minimap.render(ctx);
    }
  }

  private renderEditor(ctx: RenderContext): void {
    const doc = this._document;

    // Background
    const bgRgb = hexToRgb(this.theme.background);
    if (bgRgb) {
      const bg = `\x1b[48;2;${bgRgb.r};${bgRgb.g};${bgRgb.b}m`;
      for (let y = this.rect.y; y < this.rect.y + this.rect.height; y++) {
        ctx.buffer(`\x1b[${y};${this.rect.x}H${bg}${' '.repeat(this.rect.width)}\x1b[0m`);
      }
    }

    if (!doc) {
      this.renderEmptyState(ctx);
      return;
    }

    this.renderContent(ctx, doc);
  }

  private renderEmptyState(ctx: RenderContext): void {
    const message = 'No file open';
    const x = this.rect.x + Math.floor((this.rect.width - message.length) / 2);
    const y = this.rect.y + Math.floor(this.rect.height / 2);

    const fgRgb = hexToRgb(this.theme.lineNumberForeground);
    const fg = fgRgb ? `\x1b[38;2;${fgRgb.r};${fgRgb.g};${fgRgb.b}m` : '';

    ctx.buffer(`\x1b[${y};${x}H${fg}${message}\x1b[0m`);
  }

  private renderContent(ctx: RenderContext, doc: Document): void {
    const visibleLines = this.rect.height;

    // Recompute fold regions if content changed
    const content = doc.content;
    if (content !== this.lastFoldContent) {
      const lines = content.split('\n');
      this.foldManager.computeRegions(lines);
      this.lastFoldContent = content;
    }

    // Parse content for syntax highlighting
    if (this.highlighterReady && content !== this.lastParsedContent) {
      shikiHighlighter.parse(content);
      this.lastParsedContent = content;
    }

    // Compute wrapped lines
    this.computeWrappedLines();

    // Inline diff state
    const inlineDiffLine = this.inlineDiff.visible ? this.inlineDiff.line : -1;
    const inlineDiffHeight = this.inlineDiff.visible ? this.inlineDiff.height : 0;

    if (this.isWordWrapEnabled()) {
      this.renderWrappedContent(ctx, doc, visibleLines, inlineDiffLine, inlineDiffHeight);
    } else {
      this.renderUnwrappedContent(ctx, doc, visibleLines, inlineDiffLine, inlineDiffHeight);
    }

    // Render cursor if focused
    if (this.focused) {
      this.renderCursor(ctx, doc);
    }
  }

  private renderWrappedContent(
    ctx: RenderContext,
    doc: Document,
    visibleLines: number,
    inlineDiffLine: number,
    inlineDiffHeight: number
  ): void {
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

      const screenY = this.rect.y + screenLine;
      const lineTokens = this.highlighterReady ? shikiHighlighter.highlightLine(wrap.bufferLine) : [];
      this.renderWrappedLine(ctx, doc, wrap, screenY, lineTokens);

      screenLine++;
      wrapIndex++;

      if (wrap.bufferLine === inlineDiffLine &&
          (wrapIndex >= this.wrappedLines.length || this.wrappedLines[wrapIndex]!.bufferLine !== wrap.bufferLine) &&
          screenLine + inlineDiffHeight <= visibleLines) {
        this.renderInlineDiff(ctx, this.rect.x, this.rect.y + screenLine, this.rect.width, inlineDiffHeight);
        screenLine += inlineDiffHeight;
      }
    }
  }

  private renderUnwrappedContent(
    ctx: RenderContext,
    doc: Document,
    visibleLines: number,
    inlineDiffLine: number,
    inlineDiffHeight: number
  ): void {
    let screenLine = 0;
    let bufferLine = this.scrollTop;

    while (screenLine < visibleLines && bufferLine < doc.lineCount) {
      if (this.foldManager.isHidden(bufferLine)) {
        bufferLine++;
        continue;
      }

      const screenY = this.rect.y + screenLine;
      const lineTokens = this.highlighterReady ? shikiHighlighter.highlightLine(bufferLine) : [];
      this.renderLine(ctx, doc, bufferLine, screenY, lineTokens);

      screenLine++;
      bufferLine++;

      if (bufferLine - 1 === inlineDiffLine && screenLine + inlineDiffHeight <= visibleLines) {
        this.renderInlineDiff(ctx, this.rect.x, this.rect.y + screenLine, this.rect.width, inlineDiffHeight);
        screenLine += inlineDiffHeight;
      }
    }
  }

  private renderLine(
    ctx: RenderContext,
    doc: Document,
    bufferLine: number,
    screenY: number,
    tokens: HighlightToken[]
  ): void {
    const line = doc.getLine(bufferLine);
    const cursor = doc.primaryCursor;
    const isCurrentLine = cursor.position.line === bufferLine;

    // Get colors
    const lineNumColor = isCurrentLine && this.focused
      ? hexToRgb(this.theme.lineNumberActiveForeground)
      : hexToRgb(this.theme.lineNumberForeground);
    const gutterBg = hexToRgb(this.theme.gutterBackground);
    const lineBg = isCurrentLine && this.focused ? hexToRgb(this.theme.lineHighlightBackground) : null;
    const selBg = hexToRgb(this.theme.selectionBackground);

    const gutterBgStr = gutterBg ? `\x1b[48;2;${gutterBg.r};${gutterBg.g};${gutterBg.b}m` : '';
    const lineNumFg = lineNumColor ? `\x1b[38;2;${lineNumColor.r};${lineNumColor.g};${lineNumColor.b}m` : '';
    const reset = '\x1b[0m';

    // Render gutter (git indicator + line number + fold indicator)
    const gitIndicator = this.getGitIndicator(bufferLine + 1);  // Git uses 1-based line numbers
    const lineNumStr = String(bufferLine + 1).padStart(this.gutterWidth - 3, ' ');
    const foldIndicator = this.getFoldIndicator(bufferLine);

    ctx.buffer(`\x1b[${screenY};${this.rect.x}H${gutterBgStr}${gitIndicator}${lineNumFg}${lineNumStr}${foldIndicator} ${reset}`);

    // Content dimensions
    const textX = this.rect.x + this.gutterWidth;
    const textWidth = this.getVisibleColumnCount();
    const visibleText = line.slice(this.scrollLeft, this.scrollLeft + textWidth);

    // Get selection ranges for this line
    const { selectedCols, maxSelEnd } = this.getSelectedColumnsForLine(doc, bufferLine, line.length, this.scrollLeft);

    // Render line content with selection
    let output = `\x1b[${screenY};${textX}H`;
    output += this.renderTextWithSelection(
      visibleText,
      tokens,
      this.scrollLeft,
      textWidth,
      selectedCols,
      lineBg,
      selBg
    );

    // Pad rest of line (with selection bg if selection extends past text)
    const padding = textWidth - visibleText.length;
    if (padding > 0) {
      const paddingStart = visibleText.length;

      // Check if any selection extends into padding area
      if (selectedCols && maxSelEnd > paddingStart && selBg) {
        // Render padding character by character based on selection
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
        // No selection in padding
        if (lineBg) {
          output += `\x1b[48;2;${lineBg.r};${lineBg.g};${lineBg.b}m`;
        }
        output += ' '.repeat(padding);
      }
    }

    output += reset;
    ctx.buffer(output);
  }

  private renderWrappedLine(
    ctx: RenderContext,
    doc: Document,
    wrap: WrappedLine,
    screenY: number,
    tokens: HighlightToken[]
  ): void {
    const line = doc.getLine(wrap.bufferLine);
    const cursor = doc.primaryCursor;
    const isCurrentLine = cursor.position.line === wrap.bufferLine;

    const lineNumColor = isCurrentLine && this.focused
      ? hexToRgb(this.theme.lineNumberActiveForeground)
      : hexToRgb(this.theme.lineNumberForeground);
    const gutterBg = hexToRgb(this.theme.gutterBackground);
    const lineBg = isCurrentLine && this.focused ? hexToRgb(this.theme.lineHighlightBackground) : null;
    const selBg = hexToRgb(this.theme.selectionBackground);

    const gutterBgStr = gutterBg ? `\x1b[48;2;${gutterBg.r};${gutterBg.g};${gutterBg.b}m` : '';
    const lineNumFg = lineNumColor ? `\x1b[38;2;${lineNumColor.r};${lineNumColor.g};${lineNumColor.b}m` : '';
    const reset = '\x1b[0m';

    // Gutter only shows line number on first wrap
    if (wrap.isFirstWrap) {
      const gitIndicator = this.getGitIndicator(wrap.bufferLine + 1);  // Git uses 1-based line numbers
      const lineNumStr = String(wrap.bufferLine + 1).padStart(this.gutterWidth - 3, ' ');
      const foldIndicator = this.getFoldIndicator(wrap.bufferLine);
      ctx.buffer(`\x1b[${screenY};${this.rect.x}H${gutterBgStr}${gitIndicator}${lineNumFg}${lineNumStr}${foldIndicator} ${reset}`);
    } else {
      // Continuation line - empty gutter
      ctx.buffer(`\x1b[${screenY};${this.rect.x}H${gutterBgStr}${' '.repeat(this.gutterWidth)}${reset}`);
    }

    // Content dimensions
    const textX = this.rect.x + this.gutterWidth;
    const textWidth = this.getVisibleColumnCount();
    const segmentText = line.slice(wrap.startColumn, wrap.endColumn);

    // Get selection ranges for this wrapped segment
    // For wrapped lines, we need to adjust selection relative to the wrap segment
    const { selectedCols: fullLineSelectedCols } = this.getSelectedColumnsForLine(doc, wrap.bufferLine, line.length, 0);

    // Convert full-line selection to segment-relative selection
    let selectedCols: Set<number> | null = null;
    if (fullLineSelectedCols) {
      for (let col = wrap.startColumn; col < wrap.endColumn; col++) {
        if (fullLineSelectedCols.has(col)) {
          if (!selectedCols) selectedCols = new Set();
          selectedCols.add(col - wrap.startColumn);
        }
      }
    }

    // Render wrapped text segment with selection
    let output = `\x1b[${screenY};${textX}H`;
    output += this.renderTextWithSelection(
      segmentText,
      tokens,
      wrap.startColumn,
      textWidth,
      selectedCols,
      lineBg,
      selBg
    );

    // Pad to end of line
    const padding = textWidth - segmentText.length;
    if (padding > 0) {
      if (lineBg) {
        output += `\x1b[48;2;${lineBg.r};${lineBg.g};${lineBg.b}m`;
      }
      output += ' '.repeat(padding);
    }

    output += reset;
    ctx.buffer(output);
  }

  private getGitIndicator(line: number): string {
    const changeType = this.gitLineChanges.get(line);
    if (!changeType) return ' ';

    const colors: Record<string, string> = {
      added: themeLoader.getColor('editorGutter.addedBackground') || '#89b4fa',
      modified: themeLoader.getColor('editorGutter.modifiedBackground') || '#f9e2af',
      deleted: themeLoader.getColor('editorGutter.deletedBackground') || '#f38ba8',
    };

    const color = colors[changeType];
    if (!color) return ' ';

    const rgb = hexToRgb(color);
    if (!rgb) return ' ';

    return `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m▎\x1b[0m`;
  }

  private getFoldIndicator(line: number): string {
    if (!this.foldingEnabled) return ' ';

    if (this.foldManager.isFolded(line)) {
      return '▸';
    } else if (this.foldManager.canFold(line)) {
      return '▾';
    }
    return ' ';
  }

  private renderCursor(ctx: RenderContext, doc: Document): void {
    const cursor = doc.primaryCursor;
    const cursorLine = cursor.position.line;
    const cursorCol = cursor.position.column;

    // Check if cursor is visible
    if (this.isWordWrapEnabled()) {
      const screenLine = this.bufferToScreenLine(cursorLine, cursorCol);
      if (screenLine < this.scrollTop || screenLine >= this.scrollTop + this.rect.height) {
        return;
      }

      const wrap = this.wrappedLines[screenLine];
      if (!wrap) return;

      const screenY = this.rect.y + (screenLine - this.scrollTop);
      const screenX = this.rect.x + this.gutterWidth + (cursorCol - wrap.startColumn);

      const cursorRgb = hexToRgb(this.theme.cursorForeground);
      if (cursorRgb) {
        ctx.buffer(`\x1b[${screenY};${screenX}H\x1b[48;2;${cursorRgb.r};${cursorRgb.g};${cursorRgb.b}m \x1b[0m`);
      }
    } else {
      if (cursorLine < this.scrollTop || cursorLine >= this.scrollTop + this.rect.height) {
        return;
      }

      const screenY = this.rect.y + (cursorLine - this.scrollTop);
      const screenX = this.rect.x + this.gutterWidth + (cursorCol - this.scrollLeft);

      if (screenX >= this.rect.x + this.gutterWidth && screenX < this.rect.x + this.rect.width) {
        const cursorRgb = hexToRgb(this.theme.cursorForeground);
        if (cursorRgb) {
          ctx.buffer(`\x1b[${screenY};${screenX}H\x1b[48;2;${cursorRgb.r};${cursorRgb.g};${cursorRgb.b}m \x1b[0m`);
        }
      }
    }
  }

  private renderInlineDiff(ctx: RenderContext, x: number, y: number, width: number, height: number): void {
    const theme = themeLoader.getCurrentTheme();
    if (!theme) return;

    const colors = theme.colors;
    const bgColor = colors['editor.background'] || '#1e1e1e';
    const borderColor = colors['editorWidget.border'] || '#454545';
    const fgColor = colors['editor.foreground'] || '#d4d4d4';
    const headerBg = colors['editorWidget.background'] || '#252526';

    // Diff line colors with subtle background highlighting
    const addedGutterColor = colors['editorGutter.addedBackground'] || '#a6e3a1';
    const deletedGutterColor = colors['editorGutter.deletedBackground'] || '#f38ba8';
    const addedBg = blendColors(bgColor, addedGutterColor, 0.15);
    const deletedBg = blendColors(bgColor, deletedGutterColor, 0.15);
    const addedFg = colors['gitDecoration.addedResourceForeground'] || addedGutterColor;
    const deletedFg = colors['gitDecoration.deletedResourceForeground'] || deletedGutterColor;

    const reset = '\x1b[0m';

    // Helper to create ANSI color codes
    const bgAnsi = (color: string) => {
      const rgb = hexToRgb(color);
      return rgb ? `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m` : '';
    };
    const fgAnsi = (color: string) => {
      const rgb = hexToRgb(color);
      return rgb ? `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m` : '';
    };

    // Draw header with title and action hints
    const fileName = this.inlineDiff.filePath.split('/').pop() || 'diff';
    const headerText = ` ${fileName} - Line ${this.inlineDiff.line + 1} `;
    const buttons = ' s:stage  r:revert  Esc:close ';
    const headerPadding = ' '.repeat(Math.max(0, width - headerText.length - buttons.length));
    ctx.buffer(`\x1b[${y};${x}H${bgAnsi(headerBg)}${fgAnsi(fgColor)}${headerText}${headerPadding}${buttons}${reset}`);

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

        const displayLine = (prefix + line.substring(1)).substring(0, width - 1).padEnd(width - 1);
        ctx.buffer(`\x1b[${screenY};${x}H${bgAnsi(bgColor)}${fgAnsi(borderColor)}│${bgAnsi(lineBg)}${fgAnsi(lineFg)}${displayLine}${reset}`);
      } else {
        ctx.buffer(`\x1b[${screenY};${x}H${bgAnsi(bgColor)}${fgAnsi(borderColor)}│${' '.repeat(width - 1)}${reset}`);
      }
    }

    // Draw footer with keybindings
    const footerText = ' j/k:scroll ';
    const footerY = y + height - 1;
    const footerPadding = ' '.repeat(Math.max(0, width - footerText.length));
    const descColor = colors['descriptionForeground'] || '#858585';
    ctx.buffer(`\x1b[${footerY};${x}H${bgAnsi(headerBg)}${fgAnsi(descColor)}${footerPadding}${footerText}${reset}`);
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

  handleMouse(event: MouseEvent): boolean {
    if (!this._document) return false;

    // Check if click is in the minimap area - let minimap handle it
    const minimapWidth = this.minimapEnabled ? 10 : 0;
    const contentRightEdge = this.rect.x + this.rect.width - minimapWidth;

    if (this.minimapEnabled && event.x >= contentRightEdge) {
      // Minimap handles its own events via its onMouseEvent
      return this.minimap.onMouseEvent(event);
    }

    // Check if click is outside the content area
    if (event.y < this.rect.y || event.y >= this.rect.y + this.rect.height) {
      return false;
    }
    if (event.x < this.rect.x || event.x >= contentRightEdge) {
      return false;
    }

    // Convert screen position to buffer position
    const position = this.screenToBufferPosition(event.x, event.y);

    // Handle left button clicks (single, double, triple)
    const isLeftClick = event.name === 'MOUSE_LEFT_BUTTON_PRESSED' ||
                        event.name === 'MOUSE_LEFT_BUTTON_PRESSED_DOUBLE' ||
                        event.name === 'MOUSE_LEFT_BUTTON_PRESSED_TRIPLE';

    if (isLeftClick) {
      // Derive click count from event name
      let clickCount = 1;
      if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED_DOUBLE') {
        clickCount = 2;
      } else if (event.name === 'MOUSE_LEFT_BUTTON_PRESSED_TRIPLE') {
        clickCount = 3;
      }

      // Check for gutter clicks (only on single click)
      if (clickCount === 1 && event.x < this.rect.x + this.gutterWidth) {
        const gutterCol = event.x - this.rect.x;

        // Git indicator column (first column) - Git uses 1-based line numbers
        if (gutterCol === 0 && this.gitLineChanges.has(position.line + 1)) {
          if (this.onGitGutterClickCallback) {
            this.onGitGutterClickCallback(position.line + 1);  // Pass 1-based line number
          }
          return true;
        }

        // Fold indicator column (last column before content)
        if (gutterCol === this.gutterWidth - 2) {
          if (this.foldManager.canFold(position.line) || this.foldManager.isFolded(position.line)) {
            if (this.onFoldToggleCallback) {
              this.onFoldToggleCallback(position.line);
            }
          }
          return true;
        }
      }

      // Regular click in content area
      if (this.onClickCallback) {
        this.onClickCallback(position, clickCount, event);
      }
      return true;
    }

    if (event.name === 'MOUSE_DRAG') {
      if (this.onDragCallback) {
        this.onDragCallback(position, event);
      }
      return true;
    }

    if (event.name === 'MOUSE_WHEEL_UP' || event.name === 'MOUSE_WHEEL_DOWN') {
      const delta = event.name === 'MOUSE_WHEEL_UP' ? -3 : 3;
      this.setScrollTop(this.scrollTop + delta);
      if (this.onScrollCallback) {
        this.onScrollCallback(0, delta);
      }
      return true;
    }

    return false;
  }

  private screenToBufferPosition(screenX: number, screenY: number): Position {
    const relativeY = screenY - this.rect.y;
    const relativeX = screenX - this.rect.x - this.gutterWidth;

    if (this.isWordWrapEnabled()) {
      const wrapIndex = this.scrollTop + relativeY;
      if (wrapIndex >= 0 && wrapIndex < this.wrappedLines.length) {
        const wrap = this.wrappedLines[wrapIndex]!;
        const line = wrap.bufferLine;
        const column = Math.max(0, wrap.startColumn + relativeX);
        // Clamp column to actual line length
        const lineLength = this._document?.getLine(line)?.length ?? 0;
        return {
          line,
          column: Math.min(column, lineLength),
        };
      }
    }

    // Clamp line to valid range
    const maxLine = Math.max(0, (this._document?.lineCount ?? 1) - 1);
    const line = Math.min(Math.max(0, this.scrollTop + relativeY), maxLine);
    const column = Math.max(0, this.scrollLeft + relativeX);
    // Clamp column to actual line length
    const lineLength = this._document?.getLine(line)?.length ?? 0;
    return {
      line,
      column: Math.min(column, lineLength),
    };
  }

  // ==================== Selection Rendering ====================

  /**
   * Render text with selection highlighting
   */
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

    // Build a color map for each character position
    const charColors: (string | null)[] = new Array<string | null>(text.length).fill(null);

    // Apply syntax highlighting colors
    for (const token of tokens) {
      const tokenStart = Math.max(0, token.start - startCol);
      const tokenEnd = Math.min(text.length, token.end - startCol);

      if (tokenEnd <= 0 || tokenStart >= text.length) continue;

      for (let i = tokenStart; i < tokenEnd; i++) {
        charColors[i] = token.color ?? null;
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
      const fg = charColors[i] ?? null;
      const isSelected = selectedCols !== null && selectedCols.has(i);
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

  /**
   * Get selected columns for a line from all cursors
   */
  private getSelectedColumnsForLine(
    doc: Document,
    lineNum: number,
    lineLength: number,
    scrollLeft: number
  ): { selectedCols: Set<number> | null; maxSelEnd: number } {
    let selectedCols: Set<number> | null = null;
    let maxSelEnd = -1;

    for (const cursor of doc.cursors) {
      if (hasSelection(cursor.selection)) {
        const selection = getSelectionRange(cursor.selection!);
        const { start, end } = selection;
        if (lineNum >= start.line && lineNum <= end.line) {
          let selStart = lineNum === start.line ? start.column : 0;
          let selEnd = lineNum === end.line ? end.column : lineLength;
          // Adjust for scroll
          selStart = Math.max(0, selStart - scrollLeft);
          selEnd = Math.max(0, selEnd - scrollLeft);
          // Add all columns in this range to the set
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

    return { selectedCols, maxSelEnd };
  }

  // ==================== Cleanup ====================

  dispose(): void {
    this._document = null;
    this.onFocusCallbacks = [];
    this.onBlurCallbacks = [];
  }

  // ==================== Debug ====================

  private debugLog(message: string): void {
    if (isDebugEnabled()) {
      debugLog(`[EditorContent:${this.contentId}] ${message}`);
    }
  }
}

export default EditorContent;
