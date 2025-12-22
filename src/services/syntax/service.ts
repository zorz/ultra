/**
 * Local Syntax Service Implementation
 *
 * Implements SyntaxService using the Shiki-based highlighter.
 */

import { debugLog as globalDebugLog } from '../../debug.ts';
import { Highlighter } from './highlighter.ts';
import type { SyntaxService } from './interface.ts';
import { SyntaxError } from './errors.ts';
import {
  type HighlightToken,
  type HighlightResult,
  type SyntaxSession,
  type SyntaxMetrics,
  SYNTAX_THEMES,
  LANGUAGE_MAP,
  EXTENSION_TO_LANGUAGE,
} from './types.ts';

/**
 * Internal session state.
 */
interface SessionState extends SyntaxSession {
  /** Highlighter instance for this session */
  highlighter: Highlighter;

  /** Cached content */
  content: string;

  /** Cached tokenized lines */
  tokenizedLines: HighlightToken[][];
}

/**
 * Local Syntax Service.
 *
 * Provides syntax highlighting using Shiki.
 */
export class LocalSyntaxService implements SyntaxService {
  private _debugName = 'LocalSyntaxService';
  private highlighter: Highlighter;
  private currentTheme: string = 'catppuccin-frappe';
  private sessions = new Map<string, SessionState>();
  private sessionCounter = 0;

  // Metrics
  private metrics: SyntaxMetrics = {
    parseCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    averageParseTime: 0,
  };
  private totalParseTime = 0;

  constructor() {
    this.highlighter = new Highlighter();
    this.debugLog('Initialized');
  }

  protected debugLog(msg: string): void {
    globalDebugLog(`[${this._debugName}] ${msg}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Initialization
  // ─────────────────────────────────────────────────────────────────────────

  isReady(): boolean {
    return this.highlighter.isReady();
  }

  async waitForReady(): Promise<boolean> {
    return this.highlighter.waitForReady();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Highlighting
  // ─────────────────────────────────────────────────────────────────────────

  async highlight(content: string, languageId: string): Promise<HighlightResult> {
    await this.waitForReady();

    const startTime = performance.now();

    // Set language
    const success = await this.highlighter.setLanguage(languageId);
    if (!success) {
      return {
        lines: [],
        languageId: 'plaintext',
        timing: 0,
      };
    }

    // Parse content
    this.highlighter.parse(content);

    // Get all tokens
    const lines = content.split('\n');
    const tokenizedLines: HighlightToken[][] = [];

    for (let i = 0; i < lines.length; i++) {
      tokenizedLines.push(this.highlighter.highlightLine(i));
    }

    const timing = performance.now() - startTime;

    // Update metrics
    this.metrics.parseCount++;
    this.totalParseTime += timing;
    this.metrics.averageParseTime = this.totalParseTime / this.metrics.parseCount;

    return {
      lines: tokenizedLines,
      languageId,
      timing,
    };
  }

  async highlightLine(
    content: string,
    languageId: string,
    lineNumber: number
  ): Promise<HighlightToken[]> {
    await this.waitForReady();

    // Set language
    const success = await this.highlighter.setLanguage(languageId);
    if (!success) {
      return [];
    }

    // Parse content
    this.highlighter.parse(content);

    // Get tokens for the line
    return this.highlighter.highlightLine(lineNumber);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Sessions
  // ─────────────────────────────────────────────────────────────────────────

  async createSession(
    documentId: string,
    languageId: string,
    content: string
  ): Promise<SyntaxSession> {
    const sessionId = `syntax-${++this.sessionCounter}-${Date.now()}`;

    // Create a new highlighter for this session
    const highlighter = new Highlighter();
    await highlighter.waitForReady();
    highlighter.setTheme(this.currentTheme);
    await highlighter.setLanguage(languageId);

    // Parse content
    const startTime = performance.now();
    highlighter.parse(content);

    // Get all tokens
    const lines = content.split('\n');
    const tokenizedLines: HighlightToken[][] = [];
    for (let i = 0; i < lines.length; i++) {
      tokenizedLines.push(highlighter.highlightLine(i));
    }

    const timing = performance.now() - startTime;
    this.metrics.parseCount++;
    this.totalParseTime += timing;
    this.metrics.averageParseTime = this.totalParseTime / this.metrics.parseCount;

    const session: SessionState = {
      sessionId,
      documentId,
      languageId,
      version: 1,
      highlighter,
      content,
      tokenizedLines,
    };

    this.sessions.set(sessionId, session);
    this.debugLog(`Created session ${sessionId} for ${documentId}`);

    return {
      sessionId,
      documentId,
      languageId,
      version: 1,
    };
  }

  async updateSession(sessionId: string, content: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw SyntaxError.sessionNotFound(sessionId);
    }

    // Re-parse content
    const startTime = performance.now();
    session.highlighter.parse(content);
    session.content = content;
    session.version++;

    // Get all tokens
    const lines = content.split('\n');
    session.tokenizedLines = [];
    for (let i = 0; i < lines.length; i++) {
      session.tokenizedLines.push(session.highlighter.highlightLine(i));
    }

    const timing = performance.now() - startTime;
    this.metrics.parseCount++;
    this.totalParseTime += timing;
    this.metrics.averageParseTime = this.totalParseTime / this.metrics.parseCount;

    this.debugLog(`Updated session ${sessionId} to version ${session.version}`);
  }

  getSessionTokens(sessionId: string, lineNumber: number): HighlightToken[] {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return [];
    }

    if (lineNumber >= 0 && lineNumber < session.tokenizedLines.length) {
      this.metrics.cacheHits++;
      return session.tokenizedLines[lineNumber] || [];
    }

    this.metrics.cacheMisses++;
    return [];
  }

  getSessionAllTokens(sessionId: string): HighlightToken[][] {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return [];
    }

    this.metrics.cacheHits++;
    return session.tokenizedLines;
  }

  disposeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.highlighter.clearCache();
      this.sessions.delete(sessionId);
      this.debugLog(`Disposed session ${sessionId}`);
    }
  }

  getSession(sessionId: string): SyntaxSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      sessionId: session.sessionId,
      documentId: session.documentId,
      languageId: session.languageId,
      version: session.version,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Language Support
  // ─────────────────────────────────────────────────────────────────────────

  getSupportedLanguages(): string[] {
    return Object.keys(LANGUAGE_MAP);
  }

  isLanguageSupported(languageId: string): boolean {
    return languageId in LANGUAGE_MAP || this.highlighter.isLanguageSupported(languageId);
  }

  detectLanguage(filePath: string): string | null {
    const ext = filePath.substring(filePath.lastIndexOf('.'));
    return EXTENSION_TO_LANGUAGE[ext] || null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Themes
  // ─────────────────────────────────────────────────────────────────────────

  getAvailableThemes(): string[] {
    return [...SYNTAX_THEMES];
  }

  setTheme(theme: string): void {
    if (!SYNTAX_THEMES.includes(theme as any)) {
      throw SyntaxError.themeNotFound(theme);
    }

    this.currentTheme = theme;
    this.highlighter.setTheme(theme);

    // Update all sessions
    for (const session of this.sessions.values()) {
      session.highlighter.setTheme(theme);
      // Re-parse to get new colors
      session.highlighter.parse(session.content);
      const lines = session.content.split('\n');
      session.tokenizedLines = [];
      for (let i = 0; i < lines.length; i++) {
        session.tokenizedLines.push(session.highlighter.highlightLine(i));
      }
    }

    this.debugLog(`Theme set to: ${theme}`);
  }

  getTheme(): string {
    return this.currentTheme;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Metrics
  // ─────────────────────────────────────────────────────────────────────────

  getMetrics(): SyntaxMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      parseCount: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageParseTime: 0,
    };
    this.totalParseTime = 0;
  }
}

export const localSyntaxService = new LocalSyntaxService();
export default localSyntaxService;
