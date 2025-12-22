/**
 * Search Service Interface
 *
 * Abstract interface for project-wide search operations.
 */

import type {
  SearchOptions,
  SearchResult,
  ReplaceResult,
  SearchProgressCallback,
  Unsubscribe,
} from './types.ts';

/**
 * Search service interface.
 *
 * Provides project-wide search and replace capabilities.
 */
export interface SearchService {
  /**
   * Set the workspace root directory.
   */
  setWorkspaceRoot(root: string): void;

  /**
   * Get the current workspace root.
   */
  getWorkspaceRoot(): string;

  /**
   * Search for a query across all files.
   *
   * @param query Search query (string or regex)
   * @param options Search options
   * @returns Search results
   */
  search(query: string, options?: SearchOptions): Promise<SearchResult>;

  /**
   * Replace all matches of a query with replacement text.
   *
   * @param query Search query (string or regex)
   * @param replacement Replacement text (supports $1, $2 for regex groups)
   * @param options Search options
   * @returns Replace results
   */
  replace(query: string, replacement: string, options?: SearchOptions): Promise<ReplaceResult>;

  /**
   * Replace matches in specific files only.
   *
   * @param files Array of file paths with specific matches to replace
   * @param query Original search query
   * @param replacement Replacement text
   * @param options Search options (for regex mode)
   * @returns Replace results
   */
  replaceInFiles(
    files: { path: string; matches: { line: number; column: number; length: number }[] }[],
    query: string,
    replacement: string,
    options?: SearchOptions
  ): Promise<ReplaceResult>;

  /**
   * Cancel any ongoing search operation.
   */
  cancel(): void;

  /**
   * Subscribe to search progress updates.
   *
   * @param callback Progress callback
   * @returns Unsubscribe function
   */
  onProgress(callback: SearchProgressCallback): Unsubscribe;
}
