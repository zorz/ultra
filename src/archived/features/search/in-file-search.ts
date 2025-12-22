/**
 * In-File Search System
 * 
 * Extensible search framework for finding content within documents.
 * Supports text search, regex, and can be extended for other search types.
 */

import type { Position, Range } from '../../core/buffer.ts';
import type { Document } from '../../core/document.ts';

/**
 * Search match result
 */
export interface SearchMatch {
  range: Range;
  text: string;
  index: number;  // Match index (0-based)
}

/**
 * Search options for text-based search
 */
export interface TextSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

/**
 * Base search query interface - extensible for different search types
 */
export interface SearchQuery {
  type: string;
  pattern: string;
}

/**
 * Text search query
 */
export interface TextSearchQuery extends SearchQuery {
  type: 'text';
  options: TextSearchOptions;
}

/**
 * Future: Syntax-based search query (e.g., find all function declarations)
 */
export interface SyntaxSearchQuery extends SearchQuery {
  type: 'syntax';
  syntaxType: string;  // e.g., 'function', 'class', 'variable', 'import'
}

/**
 * Future: Semantic search query
 */
export interface SemanticSearchQuery extends SearchQuery {
  type: 'semantic';
  context?: string;
}

/**
 * Union type for all search queries
 */
export type AnySearchQuery = TextSearchQuery | SyntaxSearchQuery | SemanticSearchQuery;

/**
 * Search provider interface - implement for custom search types
 */
export interface SearchProvider<T extends SearchQuery = SearchQuery> {
  readonly type: string;
  search(document: Document, query: T): SearchMatch[];
  validate(query: T): { valid: boolean; error?: string };
}

/**
 * Text search provider - handles string and regex searches
 */
export class TextSearchProvider implements SearchProvider<TextSearchQuery> {
  readonly type = 'text';

  search(document: Document, query: TextSearchQuery): SearchMatch[] {
    const { pattern, options } = query;
    if (!pattern) return [];

    const content = document.content;
    const matches: SearchMatch[] = [];

    if (options.useRegex) {
      return this.searchRegex(document, pattern, options);
    } else {
      return this.searchText(document, pattern, options);
    }
  }

  validate(query: TextSearchQuery): { valid: boolean; error?: string } {
    if (!query.pattern) {
      return { valid: false, error: 'Search pattern is empty' };
    }

    if (query.options.useRegex) {
      try {
        new RegExp(query.pattern);
        return { valid: true };
      } catch (e) {
        return { valid: false, error: `Invalid regex: ${(e as Error).message}` };
      }
    }

    return { valid: true };
  }

  private searchText(document: Document, pattern: string, options: TextSearchOptions): SearchMatch[] {
    const content = document.content;
    const matches: SearchMatch[] = [];
    
    const searchPattern = options.caseSensitive ? pattern : pattern.toLowerCase();
    const searchContent = options.caseSensitive ? content : content.toLowerCase();

    let offset = 0;
    let matchIndex = 0;

    while (offset < searchContent.length) {
      const index = searchContent.indexOf(searchPattern, offset);
      if (index === -1) break;

      // Check whole word if required
      if (options.wholeWord && !this.isWholeWord(content, index, pattern.length)) {
        offset = index + 1;
        continue;
      }

      const startPos = this.offsetToPosition(document, index);
      const endPos = this.offsetToPosition(document, index + pattern.length);

      matches.push({
        range: { start: startPos, end: endPos },
        text: content.slice(index, index + pattern.length),
        index: matchIndex++
      });

      offset = index + 1;  // Allow overlapping matches
    }

    return matches;
  }

  private searchRegex(document: Document, pattern: string, options: TextSearchOptions): SearchMatch[] {
    const content = document.content;
    const matches: SearchMatch[] = [];

    try {
      const flags = options.caseSensitive ? 'g' : 'gi';
      const regex = new RegExp(pattern, flags);

      let match: RegExpExecArray | null;
      let matchIndex = 0;
      let lastIndex = -1;

      while ((match = regex.exec(content)) !== null) {
        // Prevent infinite loop on zero-length matches
        if (match.index === lastIndex) {
          regex.lastIndex++;
          continue;
        }
        lastIndex = match.index;

        const matchText = match[0];
        
        // Check whole word if required
        if (options.wholeWord && !this.isWholeWord(content, match.index, matchText.length)) {
          continue;
        }

        const startPos = this.offsetToPosition(document, match.index);
        const endPos = this.offsetToPosition(document, match.index + matchText.length);

        matches.push({
          range: { start: startPos, end: endPos },
          text: matchText,
          index: matchIndex++
        });

        // Prevent infinite loop
        if (matchText.length === 0) {
          regex.lastIndex++;
        }
      }
    } catch {
      // Invalid regex - return empty
    }

    return matches;
  }

  private isWholeWord(content: string, index: number, length: number): boolean {
    const before = index > 0 ? content[index - 1]! : ' ';
    const after = index + length < content.length ? content[index + length]! : ' ';
    
    const isWordBoundaryBefore = !this.isWordChar(before);
    const isWordBoundaryAfter = !this.isWordChar(after);
    
    return isWordBoundaryBefore && isWordBoundaryAfter;
  }

  private isWordChar(char: string): boolean {
    return /\w/.test(char);
  }

  private offsetToPosition(document: Document, offset: number): Position {
    return document.buffer.offsetToPosition(offset);
  }
}

/**
 * Search state for a document
 */
export interface SearchState {
  query: AnySearchQuery | null;
  matches: SearchMatch[];
  currentMatchIndex: number;
  isActive: boolean;
}

/**
 * In-file search manager
 */
export class InFileSearchManager {
  private providers: Map<string, SearchProvider<any>> = new Map();
  private documentStates: WeakMap<Document, SearchState> = new WeakMap();
  private onUpdateCallbacks: Set<(doc: Document, state: SearchState) => void> = new Set();

  constructor() {
    // Register built-in providers
    this.registerProvider(new TextSearchProvider());
  }

  /**
   * Register a search provider
   */
  registerProvider<T extends SearchQuery>(provider: SearchProvider<T>): void {
    this.providers.set(provider.type, provider);
  }

  /**
   * Get a search provider by type
   */
  getProvider<T extends SearchQuery>(type: string): SearchProvider<T> | undefined {
    return this.providers.get(type) as SearchProvider<T> | undefined;
  }

  /**
   * Get or create search state for a document
   */
  getState(document: Document): SearchState {
    let state = this.documentStates.get(document);
    if (!state) {
      state = {
        query: null,
        matches: [],
        currentMatchIndex: -1,
        isActive: false
      };
      this.documentStates.set(document, state);
    }
    return state;
  }

  /**
   * Execute a search on a document
   */
  search(document: Document, query: AnySearchQuery): SearchMatch[] {
    const provider = this.providers.get(query.type);
    if (!provider) {
      console.error(`No search provider registered for type: ${query.type}`);
      return [];
    }

    const validation = provider.validate(query);
    if (!validation.valid) {
      return [];
    }

    const matches = provider.search(document, query);
    
    const state = this.getState(document);
    state.query = query;
    state.matches = matches;
    state.currentMatchIndex = matches.length > 0 ? 0 : -1;
    state.isActive = true;

    this.notifyUpdate(document, state);
    return matches;
  }

  /**
   * Clear search for a document
   */
  clearSearch(document: Document): void {
    const state = this.getState(document);
    state.query = null;
    state.matches = [];
    state.currentMatchIndex = -1;
    state.isActive = false;
    
    this.notifyUpdate(document, state);
  }

  /**
   * Navigate to next match
   */
  nextMatch(document: Document): SearchMatch | null {
    const state = this.getState(document);
    if (state.matches.length === 0) return null;

    state.currentMatchIndex = (state.currentMatchIndex + 1) % state.matches.length;
    this.notifyUpdate(document, state);
    
    return state.matches[state.currentMatchIndex] || null;
  }

  /**
   * Navigate to previous match
   */
  previousMatch(document: Document): SearchMatch | null {
    const state = this.getState(document);
    if (state.matches.length === 0) return null;

    state.currentMatchIndex = state.currentMatchIndex <= 0 
      ? state.matches.length - 1 
      : state.currentMatchIndex - 1;
    this.notifyUpdate(document, state);
    
    return state.matches[state.currentMatchIndex] || null;
  }

  /**
   * Go to specific match by index
   */
  goToMatch(document: Document, index: number): SearchMatch | null {
    const state = this.getState(document);
    if (index < 0 || index >= state.matches.length) return null;

    state.currentMatchIndex = index;
    this.notifyUpdate(document, state);
    
    return state.matches[index] || null;
  }

  /**
   * Find match at or near a position
   */
  findMatchAtPosition(document: Document, position: Position): SearchMatch | null {
    const state = this.getState(document);
    
    for (const match of state.matches) {
      const { start, end } = match.range;
      if (position.line >= start.line && position.line <= end.line) {
        if (position.line === start.line && position.column < start.column) continue;
        if (position.line === end.line && position.column > end.column) continue;
        return match;
      }
    }
    
    return null;
  }

  /**
   * Get current match
   */
  getCurrentMatch(document: Document): SearchMatch | null {
    const state = this.getState(document);
    if (state.currentMatchIndex < 0 || state.currentMatchIndex >= state.matches.length) {
      return null;
    }
    return state.matches[state.currentMatchIndex] || null;
  }

  /**
   * Replace current match
   */
  replaceCurrentMatch(document: Document, replacement: string): boolean {
    const state = this.getState(document);
    const match = this.getCurrentMatch(document);
    if (!match) return false;

    // Use document's buffer to replace
    const { start, end } = match.range;
    document.buffer.replaceRange(start, end, replacement);

    // Re-run search to update matches
    if (state.query) {
      this.search(document, state.query);
    }

    return true;
  }

  /**
   * Replace all matches
   */
  replaceAll(document: Document, replacement: string): number {
    const state = this.getState(document);
    if (state.matches.length === 0) return 0;

    // Replace from end to start to preserve positions
    const sortedMatches = [...state.matches].sort((a, b) => {
      const aOffset = document.buffer.positionToOffset(a.range.start);
      const bOffset = document.buffer.positionToOffset(b.range.start);
      return bOffset - aOffset;  // Reverse order
    });

    let count = 0;
    for (const match of sortedMatches) {
      const { start, end } = match.range;
      document.buffer.replaceRange(start, end, replacement);
      count++;
    }

    // Clear search after replace all
    this.clearSearch(document);
    
    return count;
  }

  /**
   * Register for update notifications
   */
  onUpdate(callback: (doc: Document, state: SearchState) => void): () => void {
    this.onUpdateCallbacks.add(callback);
    return () => this.onUpdateCallbacks.delete(callback);
  }

  private notifyUpdate(document: Document, state: SearchState): void {
    for (const callback of this.onUpdateCallbacks) {
      callback(document, state);
    }
  }
}

// Singleton instance
export const inFileSearch = new InFileSearchManager();

// Helper to create text search query
export function createTextSearchQuery(
  pattern: string,
  options?: Partial<TextSearchOptions>
): TextSearchQuery {
  return {
    type: 'text',
    pattern,
    options: {
      caseSensitive: options?.caseSensitive ?? false,
      wholeWord: options?.wholeWord ?? false,
      useRegex: options?.useRegex ?? false
    }
  };
}

export default inFileSearch;
