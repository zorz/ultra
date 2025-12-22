/**
 * Search Service Types
 *
 * Type definitions for project-wide search operations.
 */

/**
 * Options for search operations.
 */
export interface SearchOptions {
  /** Case-sensitive search (default: false) */
  caseSensitive?: boolean;
  /** Treat query as regex (default: false) */
  regex?: boolean;
  /** Match whole words only (default: false) */
  wholeWord?: boolean;
  /** Include glob pattern (e.g., "*.ts") */
  includeGlob?: string;
  /** Exclude glob pattern (e.g., "node_modules/**") */
  excludeGlob?: string;
  /** Maximum number of results (default: 1000) */
  maxResults?: number;
  /** Number of context lines before/after matches (default: 0) */
  contextLines?: number;
}

/**
 * A single match within a file.
 */
export interface SearchMatchResult {
  /** Line number (1-based) */
  line: number;
  /** Column offset (0-based) */
  column: number;
  /** Length of the match */
  length: number;
  /** Full line text */
  lineText: string;
  /** Context lines before the match */
  contextBefore?: string[];
  /** Context lines after the match */
  contextAfter?: string[];
}

/**
 * Search results for a single file.
 */
export interface SearchFileResult {
  /** File path relative to workspace */
  path: string;
  /** Matches in this file */
  matches: SearchMatchResult[];
}

/**
 * Complete search result.
 */
export interface SearchResult {
  /** The search query */
  query: string;
  /** Results by file */
  files: SearchFileResult[];
  /** Total number of matches */
  totalMatches: number;
  /** Whether results were truncated due to limit */
  truncated: boolean;
  /** Search duration in milliseconds */
  durationMs?: number;
}

/**
 * Result of a replace operation.
 */
export interface ReplaceResult {
  /** Number of files modified */
  filesModified: number;
  /** Number of matches replaced */
  matchesReplaced: number;
  /** Errors encountered during replacement */
  errors: { path: string; error: string }[];
}

/**
 * Progress update during search.
 */
export interface SearchProgress {
  /** Number of files searched so far */
  filesSearched: number;
  /** Number of matches found so far */
  matchesFound: number;
  /** Current file being searched */
  currentFile?: string;
  /** Whether search is complete */
  complete: boolean;
}

/**
 * Callback for search progress updates.
 */
export type SearchProgressCallback = (progress: SearchProgress) => void;

/**
 * Unsubscribe function.
 */
export type Unsubscribe = () => void;
