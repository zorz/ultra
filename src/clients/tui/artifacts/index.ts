/**
 * Artifacts Module
 *
 * Exports all artifact types and utilities for the content browser system.
 */

// Base types
export type {
  ArtifactType,
  Artifact,
  ArtifactAction,
  NodeType,
  ArtifactNode,
  ViewMode,
  ContentBrowserCallbacks,
  ContentBrowserState,
  ArtifactNodeProvider,
} from './types.ts';

// Git diff artifacts
export type {
  DiffChangeType,
  GitDiffArtifact,
  GitDiffFileNode,
  GitDiffHunkNode,
  GitDiffLineNode,
  GitDiffNode,
} from './git-diff-artifact.ts';

export {
  statusCodeToChangeType,
  createGitDiffArtifact,
  isFileNode,
  isHunkNode,
  isLineNode,
  getChangeTypeIcon,
  getChangeTypeColorKey,
  getDiffLineColorKey,
  getDiffLineBgColorKey,
  formatHunkHeader,
} from './git-diff-artifact.ts';

// Search result artifacts
export type {
  SearchMatch,
  SearchResultArtifact,
  SearchResultFileNode,
  SearchResultMatchNode,
  SearchResultNode,
  SearchResultSummary,
  HighlightSegment,
} from './search-result-artifact.ts';

export {
  createSearchResultArtifact,
  isSearchFileNode,
  isSearchMatchNode,
  createSearchResultSummary,
  getHighlightedSegments,
  formatMatchLocation,
} from './search-result-artifact.ts';
