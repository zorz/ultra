/**
 * Search Result Artifact Types
 *
 * Artifact types for displaying search results in the content browser.
 */

import type { Artifact, ArtifactNode } from './types.ts';

/**
 * A single match within a file.
 */
export interface SearchMatch {
  /** Line number (1-based) */
  line: number;
  /** Column offset (0-based) */
  column: number;
  /** Length of the match */
  length: number;
  /** Full line text */
  lineText: string;
  /** The matched text */
  matchText: string;
  /** Context lines before this match */
  contextBefore?: string[];
  /** Context lines after this match */
  contextAfter?: string[];
}

/**
 * A search result artifact representing matches in a file.
 */
export interface SearchResultArtifact extends Artifact {
  type: 'search-result';
  /** The search query */
  query: string;
  /** Whether the query is a regex */
  isRegex: boolean;
  /** Whether the search is case-sensitive */
  caseSensitive: boolean;
  /** File path relative to workspace root */
  filePath: string;
  /** Matches in this file */
  matches: SearchMatch[];
  /** Replacement text (for find/replace) */
  replacement?: string;
}

/**
 * Create a search result artifact.
 */
export function createSearchResultArtifact(
  filePath: string,
  query: string,
  matches: SearchMatch[],
  options: {
    isRegex?: boolean;
    caseSensitive?: boolean;
    replacement?: string;
  } = {}
): SearchResultArtifact {
  return {
    type: 'search-result',
    id: `search-result:${filePath}`,
    title: filePath.split('/').pop() ?? filePath,
    description: filePath,
    query,
    isRegex: options.isRegex ?? false,
    caseSensitive: options.caseSensitive ?? false,
    filePath,
    matches,
    replacement: options.replacement,
  };
}

/**
 * Node representing a file in the search results tree.
 */
export interface SearchResultFileNode extends ArtifactNode<SearchResultArtifact> {
  nodeType: 'file';
  /** Total match count in this file */
  matchCount: number;
}

/**
 * Node representing a single match in the search results tree.
 */
export interface SearchResultMatchNode extends ArtifactNode<SearchResultArtifact> {
  nodeType: 'match';
  /** The match data */
  match: SearchMatch;
  /** Index of this match in the file's matches array */
  matchIndex: number;
  /** Whether inline editing is active for this match */
  isEditing: boolean;
  /** Edited replacement text (may differ from artifact.replacement) */
  editedReplacement?: string;
}

/**
 * Union of all search result node types.
 */
export type SearchResultNode = SearchResultFileNode | SearchResultMatchNode;

/**
 * Check if a node is a file node.
 */
export function isSearchFileNode(
  node: ArtifactNode<SearchResultArtifact>
): node is SearchResultFileNode {
  return node.nodeType === 'file';
}

/**
 * Check if a node is a match node.
 */
export function isSearchMatchNode(
  node: ArtifactNode<SearchResultArtifact>
): node is SearchResultMatchNode {
  return node.nodeType === 'match';
}

/**
 * Summary of all search results.
 */
export interface SearchResultSummary {
  /** Total number of files with matches */
  fileCount: number;
  /** Total number of matches across all files */
  matchCount: number;
  /** Whether results were truncated due to limit */
  truncated: boolean;
  /** The search query */
  query: string;
}

/**
 * Create a summary from a list of search result artifacts.
 */
export function createSearchResultSummary(
  artifacts: SearchResultArtifact[],
  truncated: boolean = false
): SearchResultSummary {
  return {
    fileCount: artifacts.length,
    matchCount: artifacts.reduce((sum, a) => sum + a.matches.length, 0),
    truncated,
    query: artifacts[0]?.query ?? '',
  };
}

/**
 * Highlight match text within a line.
 * Returns segments with their highlight status.
 */
export interface HighlightSegment {
  text: string;
  isMatch: boolean;
}

/**
 * Get highlighted segments for a match line.
 */
export function getHighlightedSegments(match: SearchMatch): HighlightSegment[] {
  const { column, length, lineText } = match;
  const segments: HighlightSegment[] = [];

  if (column > 0) {
    segments.push({
      text: lineText.substring(0, column),
      isMatch: false,
    });
  }

  segments.push({
    text: lineText.substring(column, column + length),
    isMatch: true,
  });

  if (column + length < lineText.length) {
    segments.push({
      text: lineText.substring(column + length),
      isMatch: false,
    });
  }

  return segments;
}

/**
 * Format a match location string.
 */
export function formatMatchLocation(match: SearchMatch): string {
  return `${match.line}:${match.column + 1}`;
}
