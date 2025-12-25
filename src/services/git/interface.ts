/**
 * Git Service Interface
 *
 * Defines the contract for git operations.
 */

import type {
  GitStatus,
  GitBranchInfo,
  GitBranch,
  GitCommit,
  GitRemote,
  GitStash,
  GitBlame,
  GitDiffHunk,
  GitLineChange,
  CommitResult,
  PushResult,
  PullResult,
  MergeResult,
  PushOptions,
  GitChangeCallback,
  Unsubscribe,
} from './types.ts';

/**
 * Git Service interface.
 *
 * Provides version control operations for a repository.
 * All methods take a URI that identifies the repository
 * (typically the workspace root).
 */
export interface GitService {
  // ─────────────────────────────────────────────────────────────────────────
  // Repository
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check if path is inside a git repository.
   */
  isRepo(uri: string): Promise<boolean>;

  /**
   * Get the repository root for a path.
   * Returns null if not in a git repository.
   */
  getRoot(uri: string): Promise<string | null>;

  /**
   * Get repository status.
   * @param uri Repository URI
   * @param forceRefresh Skip cache and fetch fresh status
   */
  status(uri: string, forceRefresh?: boolean): Promise<GitStatus>;

  /**
   * Get current branch information.
   */
  branch(uri: string): Promise<GitBranchInfo>;

  /**
   * Invalidate cached status for a repository.
   */
  invalidateCache(uri: string): void;

  // ─────────────────────────────────────────────────────────────────────────
  // Staging
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Stage files for commit.
   * @param uri Repository URI
   * @param paths Paths to stage (relative to repo root)
   */
  stage(uri: string, paths: string[]): Promise<void>;

  /**
   * Stage all changes.
   */
  stageAll(uri: string): Promise<void>;

  /**
   * Unstage files.
   * @param uri Repository URI
   * @param paths Paths to unstage (relative to repo root)
   */
  unstage(uri: string, paths: string[]): Promise<void>;

  /**
   * Discard changes to files.
   * @param uri Repository URI
   * @param paths Paths to discard (relative to repo root)
   */
  discard(uri: string, paths: string[]): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────
  // Diff
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get diff hunks for a file.
   * @param uri Repository URI
   * @param path File path (relative to repo root)
   * @param staged Whether to diff staged changes
   */
  diff(uri: string, path: string, staged?: boolean): Promise<GitDiffHunk[]>;

  /**
   * Get line-level changes for gutter indicators.
   * @param uri Repository URI
   * @param path File path (relative to repo root)
   */
  diffLines(uri: string, path: string): Promise<GitLineChange[]>;

  /**
   * Compare buffer content against HEAD.
   * @param uri Repository URI
   * @param path File path (relative to repo root)
   * @param content Current buffer content
   */
  diffBuffer(uri: string, path: string, content: string): Promise<GitLineChange[]>;

  // ─────────────────────────────────────────────────────────────────────────
  // Commit
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a commit.
   * @param uri Repository URI
   * @param message Commit message
   */
  commit(uri: string, message: string): Promise<CommitResult>;

  /**
   * Amend the last commit.
   * @param uri Repository URI
   * @param message New message (uses previous if not provided)
   */
  amend(uri: string, message?: string): Promise<CommitResult>;

  /**
   * Get commit history.
   * @param uri Repository URI
   * @param count Number of commits to retrieve (default 50)
   */
  log(uri: string, count?: number): Promise<GitCommit[]>;

  /**
   * Get commit history for a specific file.
   * @param uri Repository URI
   * @param path File path (relative to repo root)
   * @param count Number of commits to retrieve (default 50)
   */
  fileLog(uri: string, path: string, count?: number): Promise<GitCommit[]>;

  // ─────────────────────────────────────────────────────────────────────────
  // Branches
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * List branches.
   */
  branches(uri: string): Promise<{ branches: GitBranch[]; current: string }>;

  /**
   * Create a new branch.
   * @param uri Repository URI
   * @param name Branch name
   * @param checkout Whether to checkout the new branch
   */
  createBranch(uri: string, name: string, checkout?: boolean): Promise<void>;

  /**
   * Switch to a branch.
   */
  switchBranch(uri: string, name: string): Promise<void>;

  /**
   * Delete a branch.
   * @param uri Repository URI
   * @param name Branch name
   * @param force Force delete even if not merged
   */
  deleteBranch(uri: string, name: string, force?: boolean): Promise<void>;

  /**
   * Rename the current branch.
   */
  renameBranch(uri: string, newName: string): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────
  // Remote
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Push commits to remote.
   */
  push(uri: string, remote?: string, options?: PushOptions): Promise<PushResult>;

  /**
   * Pull changes from remote.
   */
  pull(uri: string, remote?: string): Promise<PullResult>;

  /**
   * Fetch from remote.
   */
  fetch(uri: string, remote?: string): Promise<void>;

  /**
   * List remotes.
   */
  remotes(uri: string): Promise<GitRemote[]>;

  /**
   * Set upstream tracking branch.
   */
  setUpstream(uri: string, remote: string, branch: string): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────
  // Merge
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Merge a branch.
   */
  merge(uri: string, branch: string): Promise<MergeResult>;

  /**
   * Abort an in-progress merge.
   */
  abortMerge(uri: string): Promise<void>;

  /**
   * Get list of files with merge conflicts.
   */
  getConflicts(uri: string): Promise<string[]>;

  /**
   * Check if a merge is in progress.
   */
  isMerging(uri: string): Promise<boolean>;

  // ─────────────────────────────────────────────────────────────────────────
  // Stash
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Stash changes.
   * @returns Stash ID (e.g., "stash@{0}")
   */
  stash(uri: string, message?: string): Promise<string>;

  /**
   * Pop a stash.
   * @param stashId Stash to pop (defaults to latest)
   */
  stashPop(uri: string, stashId?: string): Promise<void>;

  /**
   * List stashes.
   */
  stashList(uri: string): Promise<GitStash[]>;

  /**
   * Drop a stash.
   */
  stashDrop(uri: string, stashId: string): Promise<void>;

  /**
   * Apply a stash without removing it.
   */
  stashApply(uri: string, stashId?: string): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────
  // Blame
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get blame information for a file.
   */
  blame(uri: string, path: string): Promise<GitBlame[]>;

  // ─────────────────────────────────────────────────────────────────────────
  // Content
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get file content at a specific ref.
   * @param uri Repository URI
   * @param path File path (relative to repo root)
   * @param ref Git ref (commit, tag, branch, "HEAD", etc.)
   */
  show(uri: string, path: string, ref: string): Promise<string>;

  // ─────────────────────────────────────────────────────────────────────────
  // Events
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Subscribe to git changes.
   * Called when repository status, branches, or commits change.
   */
  onChange(callback: GitChangeCallback): Unsubscribe;
}
