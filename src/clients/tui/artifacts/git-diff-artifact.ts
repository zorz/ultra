/**
 * Git Diff Artifact Types
 *
 * Artifact types for displaying git diffs in the content browser.
 */

import type { Artifact, ArtifactNode } from './types.ts';
import type { GitDiffHunk, DiffLine, GitFileStatusCode } from '../../../services/git/types.ts';

/**
 * Change type for a file in a diff.
 */
export type DiffChangeType = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';

/**
 * Convert git status code to diff change type.
 */
export function statusCodeToChangeType(code: GitFileStatusCode): DiffChangeType {
  switch (code) {
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    default:
      return 'modified';
  }
}

/**
 * A git diff artifact representing changes to a file.
 */
export interface GitDiffArtifact extends Artifact {
  type: 'git-diff';
  /** File path relative to repository root */
  filePath: string;
  /** Whether this is a staged diff */
  staged: boolean;
  /** Diff hunks for this file */
  hunks: GitDiffHunk[];
  /** Overall change type */
  changeType: DiffChangeType;
  /** Original path (for renames/copies) */
  originalPath?: string;
  /** Number of lines added */
  additions: number;
  /** Number of lines deleted */
  deletions: number;
}

/**
 * Create a git diff artifact.
 */
export function createGitDiffArtifact(
  filePath: string,
  hunks: GitDiffHunk[],
  options: {
    staged?: boolean;
    changeType?: DiffChangeType;
    originalPath?: string;
  } = {}
): GitDiffArtifact {
  // Count additions and deletions
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'added') additions++;
      else if (line.type === 'deleted') deletions++;
    }
  }

  return {
    type: 'git-diff',
    id: `git-diff:${options.staged ? 'staged' : 'unstaged'}:${filePath}`,
    title: filePath.split('/').pop() ?? filePath,
    description: filePath,
    filePath,
    staged: options.staged ?? false,
    hunks,
    changeType: options.changeType ?? 'modified',
    originalPath: options.originalPath,
    additions,
    deletions,
  };
}

/**
 * Node representing a file in the diff tree.
 */
export interface GitDiffFileNode extends ArtifactNode<GitDiffArtifact> {
  nodeType: 'file';
}

/**
 * Node representing a hunk in the diff tree.
 */
export interface GitDiffHunkNode extends ArtifactNode<GitDiffArtifact> {
  nodeType: 'hunk';
  /** Index of this hunk in the file's hunks array */
  hunkIndex: number;
  /** The hunk data */
  hunk: GitDiffHunk;
}

/**
 * Node representing a line in the diff tree.
 */
export interface GitDiffLineNode extends ArtifactNode<GitDiffArtifact> {
  nodeType: 'line';
  /** Index of the parent hunk */
  hunkIndex: number;
  /** Index of this line in the hunk's lines array */
  lineIndex: number;
  /** The line data */
  line: DiffLine;
}

/**
 * Union of all git diff node types.
 */
export type GitDiffNode = GitDiffFileNode | GitDiffHunkNode | GitDiffLineNode;

/**
 * Check if a node is a file node.
 */
export function isFileNode(node: ArtifactNode<GitDiffArtifact>): node is GitDiffFileNode {
  return node.nodeType === 'file';
}

/**
 * Check if a node is a hunk node.
 */
export function isHunkNode(node: ArtifactNode<GitDiffArtifact>): node is GitDiffHunkNode {
  return node.nodeType === 'hunk';
}

/**
 * Check if a node is a line node.
 */
export function isLineNode(node: ArtifactNode<GitDiffArtifact>): node is GitDiffLineNode {
  return node.nodeType === 'line';
}

/**
 * Get the icon for a change type.
 */
export function getChangeTypeIcon(changeType: DiffChangeType): string {
  switch (changeType) {
    case 'added':
      return '+';
    case 'deleted':
      return '-';
    case 'modified':
      return '~';
    case 'renamed':
      return 'R';
    case 'copied':
      return 'C';
  }
}

/**
 * Get the theme color key for a change type.
 */
export function getChangeTypeColorKey(changeType: DiffChangeType): string {
  switch (changeType) {
    case 'added':
      return 'gitDecoration.addedResourceForeground';
    case 'deleted':
      return 'gitDecoration.deletedResourceForeground';
    case 'modified':
      return 'gitDecoration.modifiedResourceForeground';
    case 'renamed':
      return 'gitDecoration.renamedResourceForeground';
    case 'copied':
      return 'gitDecoration.addedResourceForeground';
  }
}

/**
 * Get the theme color key for a diff line type.
 */
export function getDiffLineColorKey(type: DiffLine['type']): string {
  switch (type) {
    case 'added':
      return 'gitDecoration.addedResourceForeground';
    case 'deleted':
      return 'gitDecoration.deletedResourceForeground';
    case 'context':
      return 'foreground';
  }
}

/**
 * Get the background color key for a diff line type.
 */
export function getDiffLineBgColorKey(type: DiffLine['type']): string {
  switch (type) {
    case 'added':
      return 'diffEditor.insertedLineBackground';
    case 'deleted':
      return 'diffEditor.removedLineBackground';
    case 'context':
      return 'editor.background';
  }
}

/**
 * Format a hunk header string.
 */
export function formatHunkHeader(hunk: GitDiffHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
}
