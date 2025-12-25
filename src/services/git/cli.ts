/**
 * Git CLI Service
 *
 * GitService implementation using Git CLI via Bun.$.
 */

import { $ } from 'bun';
import { debugLog } from '../../debug.ts';
import { CACHE } from '../../constants.ts';
import { GitError, GitErrorCode } from './errors.ts';
import type { GitService } from './interface.ts';
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
  DiffLine,
  CommitResult,
  PushResult,
  PullResult,
  MergeResult,
  PushOptions,
  GitChangeCallback,
  GitChangeEvent,
  Unsubscribe,
  GitFileStatus,
} from './types.ts';

// Set environment to prevent git from opening editors
process.env.GIT_EDITOR = 'true';
process.env.GIT_TERMINAL_PROMPT = '0';

/**
 * Cache entry with TTL.
 */
interface CacheEntry<T> {
  value: T;
  time: number;
}

/**
 * Git service using CLI commands.
 */
export class GitCliService implements GitService {
  private readonly CACHE_TTL = CACHE.GIT_STATUS_TTL;

  // Cache per repository
  private statusCache = new Map<string, CacheEntry<GitStatus>>();
  private lineChangesCache = new Map<string, CacheEntry<GitLineChange[]>>();

  // Change event subscribers
  private changeCallbacks = new Set<GitChangeCallback>();

  // ─────────────────────────────────────────────────────────────────────────
  // Repository
  // ─────────────────────────────────────────────────────────────────────────

  async isRepo(uri: string): Promise<boolean> {
    const path = this.uriToPath(uri);
    try {
      const result = await $`git -C ${path} rev-parse --is-inside-work-tree`.quiet();
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async getRoot(uri: string): Promise<string | null> {
    const path = this.uriToPath(uri);
    try {
      const result = await $`git -C ${path} rev-parse --show-toplevel`.quiet();
      if (result.exitCode === 0) {
        return result.text().trim();
      }
      return null;
    } catch {
      return null;
    }
  }

  async status(uri: string, forceRefresh = false): Promise<GitStatus> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    // Check cache
    if (!forceRefresh) {
      const cached = this.statusCache.get(root);
      if (cached && Date.now() - cached.time < this.CACHE_TTL) {
        return cached.value;
      }
    }

    try {
      // Get branch info
      const branchResult = await $`git -C ${root} branch --show-current`.quiet();
      const branch = branchResult.exitCode === 0 ? branchResult.text().trim() || 'HEAD' : 'unknown';

      // Get ahead/behind
      let ahead = 0;
      let behind = 0;
      try {
        const trackingResult = await $`git -C ${root} rev-list --left-right --count HEAD...@{upstream}`.quiet();
        if (trackingResult.exitCode === 0) {
          const [a, b] = trackingResult.text().trim().split('\t').map(n => parseInt(n, 10));
          ahead = a || 0;
          behind = b || 0;
        }
      } catch {
        // No upstream tracking
      }

      // Get status (porcelain format)
      const statusResult = await $`git -C ${root} status --porcelain -uall`.quiet();
      if (statusResult.exitCode !== 0) {
        throw GitError.commandFailed(uri, 'status', statusResult.stderr.toString());
      }

      const staged: GitFileStatus[] = [];
      const unstaged: GitFileStatus[] = [];
      const untracked: string[] = [];

      const lines = statusResult.text().split('\n').filter(l => l.length > 0);
      for (const line of lines) {
        const indexStatus = line[0];
        const workTreeStatus = line[1];
        let path = line.substring(3);
        let oldPath: string | undefined;

        // Handle renames (R100 old -> new)
        if (path.includes(' -> ')) {
          const parts = path.split(' -> ');
          oldPath = parts[0];
          path = parts[1] || path;
        }

        // Untracked files
        if (indexStatus === '?' && workTreeStatus === '?') {
          untracked.push(path);
          continue;
        }

        // Staged changes
        if (indexStatus !== ' ' && indexStatus !== '?') {
          staged.push({
            path,
            status: indexStatus as GitFileStatus['status'],
            oldPath
          });
        }

        // Unstaged changes
        if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
          unstaged.push({
            path,
            status: workTreeStatus as GitFileStatus['status']
          });
        }
      }

      const status: GitStatus = { branch, ahead, behind, staged, unstaged, untracked };
      this.statusCache.set(root, { value: status, time: Date.now() });
      return status;
    } catch (error) {
      throw GitError.wrap(uri, error);
    }
  }

  async branch(uri: string): Promise<GitBranchInfo> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      // Get branch name
      const branchResult = await $`git -C ${root} branch --show-current`.quiet();
      const name = branchResult.exitCode === 0 ? branchResult.text().trim() || 'HEAD' : 'HEAD';

      // Get tracking info
      let tracking: string | undefined;
      let ahead = 0;
      let behind = 0;

      try {
        const trackResult = await $`git -C ${root} rev-parse --abbrev-ref --symbolic-full-name @{upstream}`.quiet();
        if (trackResult.exitCode === 0) {
          tracking = trackResult.text().trim();
        }

        const countResult = await $`git -C ${root} rev-list --left-right --count HEAD...@{upstream}`.quiet();
        if (countResult.exitCode === 0) {
          const [a, b] = countResult.text().trim().split('\t').map(n => parseInt(n, 10));
          ahead = a || 0;
          behind = b || 0;
        }
      } catch {
        // No upstream
      }

      return { name, tracking, ahead, behind };
    } catch (error) {
      throw GitError.wrap(uri, error);
    }
  }

  invalidateCache(uri: string): void {
    const path = this.uriToPath(uri);
    // Clear all caches that might be related to this path
    for (const key of this.statusCache.keys()) {
      if (path.startsWith(key) || key.startsWith(path)) {
        this.statusCache.delete(key);
      }
    }
    for (const key of this.lineChangesCache.keys()) {
      if (key.startsWith(path)) {
        this.lineChangesCache.delete(key);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Staging
  // ─────────────────────────────────────────────────────────────────────────

  async stage(uri: string, paths: string[]): Promise<void> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const result = await $`git -C ${root} add -- ${paths}`.quiet();
      if (result.exitCode !== 0) {
        throw GitError.commandFailed(uri, 'add', result.stderr.toString());
      }
      this.invalidateCache(uri);
      this.emitChange(uri, 'status');
    } catch (error) {
      throw GitError.wrap(uri, error);
    }
  }

  async stageAll(uri: string): Promise<void> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const result = await $`git -C ${root} add -A`.quiet();
      if (result.exitCode !== 0) {
        throw GitError.commandFailed(uri, 'add -A', result.stderr.toString());
      }
      this.invalidateCache(uri);
      this.emitChange(uri, 'status');
    } catch (error) {
      throw GitError.wrap(uri, error);
    }
  }

  async unstage(uri: string, paths: string[]): Promise<void> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const result = await $`git -C ${root} reset HEAD -- ${paths}`.quiet();
      if (result.exitCode !== 0) {
        throw GitError.commandFailed(uri, 'reset', result.stderr.toString());
      }
      this.invalidateCache(uri);
      this.emitChange(uri, 'status');
    } catch (error) {
      throw GitError.wrap(uri, error);
    }
  }

  async discard(uri: string, paths: string[]): Promise<void> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      // First unstage (ignoring errors for files not staged)
      await $`git -C ${root} reset HEAD -- ${paths}`.quiet();
      // Then checkout to discard changes
      const result = await $`git -C ${root} checkout -- ${paths}`.quiet();
      if (result.exitCode !== 0) {
        throw GitError.commandFailed(uri, 'checkout', result.stderr.toString());
      }
      this.invalidateCache(uri);
      this.emitChange(uri, 'status');
    } catch (error) {
      throw GitError.wrap(uri, error);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Diff
  // ─────────────────────────────────────────────────────────────────────────

  async diff(uri: string, path: string, staged = false): Promise<GitDiffHunk[]> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const args = staged ? ['--cached'] : [];
      const result = await $`git -C ${root} diff ${args} -- ${path}`.quiet();
      if (result.exitCode !== 0) {
        return [];
      }
      return this.parseDiff(result.text());
    } catch {
      return [];
    }
  }

  async diffLines(uri: string, path: string): Promise<GitLineChange[]> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    const cacheKey = `${root}:${path}`;
    const cached = this.lineChangesCache.get(cacheKey);
    if (cached && Date.now() - cached.time < this.CACHE_TTL) {
      return cached.value;
    }

    try {
      const result = await $`git -C ${root} diff --unified=0 -- ${path}`.quiet();
      if (result.exitCode !== 0) {
        return [];
      }

      const changes: GitLineChange[] = [];
      const lines = result.text().split('\n');

      for (const line of lines) {
        const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (!match) continue;

        const oldCount = parseInt(match[2] || '1', 10);
        const newStart = parseInt(match[3]!, 10);
        const newCount = parseInt(match[4] || '1', 10);

        if (oldCount === 0) {
          for (let i = 0; i < newCount; i++) {
            changes.push({ line: newStart + i, type: 'added' });
          }
        } else if (newCount === 0) {
          changes.push({ line: Math.max(1, newStart), type: 'deleted' });
        } else {
          for (let i = 0; i < newCount; i++) {
            changes.push({ line: newStart + i, type: 'modified' });
          }
        }
      }

      this.lineChangesCache.set(cacheKey, { value: changes, time: Date.now() });
      return changes;
    } catch {
      return [];
    }
  }

  async diffBuffer(uri: string, path: string, content: string): Promise<GitLineChange[]> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const headContent = await this.show(uri, path, 'HEAD');

      // File is not tracked - all lines are "added"
      const lineCount = content.split('\n').length;
      const changes: GitLineChange[] = [];

      if (!headContent) {
        for (let i = 1; i <= lineCount; i++) {
          changes.push({ line: i, type: 'added' });
        }
        return changes;
      }

      // Compare using LCS-based diff
      const oldLines = headContent.split('\n');
      const newLines = content.split('\n');
      return this.computeLineDiff(oldLines, newLines);
    } catch {
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Commit
  // ─────────────────────────────────────────────────────────────────────────

  async commit(uri: string, message: string): Promise<CommitResult> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    if (!message.trim()) {
      return { success: false, error: 'Commit message cannot be empty' };
    }

    try {
      const result = await $`git -C ${root} commit -m ${message}`.quiet();
      if (result.exitCode !== 0) {
        const stderr = result.stderr.toString();
        if (stderr.includes('nothing to commit')) {
          return { success: false, error: 'Nothing to commit' };
        }
        return { success: false, error: stderr };
      }

      // Get the commit hash
      const hashResult = await $`git -C ${root} rev-parse HEAD`.quiet();
      const hash = hashResult.exitCode === 0 ? hashResult.text().trim().substring(0, 8) : undefined;

      this.invalidateCache(uri);
      this.emitChange(uri, 'commit');
      return { success: true, hash };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async amend(uri: string, message?: string): Promise<CommitResult> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      let result;
      if (message) {
        result = await $`git -C ${root} commit --amend -m ${message}`.quiet();
      } else {
        result = await $`git -C ${root} commit --amend --no-edit`.quiet();
      }

      if (result.exitCode !== 0) {
        return { success: false, error: result.stderr.toString() };
      }

      const hashResult = await $`git -C ${root} rev-parse HEAD`.quiet();
      const hash = hashResult.exitCode === 0 ? hashResult.text().trim().substring(0, 8) : undefined;

      this.invalidateCache(uri);
      this.emitChange(uri, 'commit');
      return { success: true, hash };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async log(uri: string, count = 50): Promise<GitCommit[]> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const result = await $`git -C ${root} log --oneline -n ${count} --format=%H%x00%s%x00%an%x00%ae%x00%ai`.quiet();
      if (result.exitCode !== 0) {
        return [];
      }

      return result.text().trim().split('\n').filter(l => l).map(line => {
        const [hash, message, author, email, date] = line.split('\x00');
        return {
          hash: hash || '',
          shortHash: hash?.substring(0, 8) || '',
          message: message || '',
          author: author || '',
          email: email || '',
          date: date?.split(' ')[0] || ''
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Get commit history for a specific file.
   * Uses --follow to track file renames.
   */
  async fileLog(uri: string, path: string, count = 50): Promise<GitCommit[]> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      // --follow tracks file across renames, -- path specifies the file
      const result = await $`git -C ${root} log --oneline -n ${count} --follow --format=%H%x00%s%x00%an%x00%ae%x00%ai -- ${path}`.quiet();
      if (result.exitCode !== 0) {
        return [];
      }

      return result.text().trim().split('\n').filter(l => l).map(line => {
        const [hash, message, author, email, date] = line.split('\x00');
        return {
          hash: hash || '',
          shortHash: hash?.substring(0, 8) || '',
          message: message || '',
          author: author || '',
          email: email || '',
          date: date?.split(' ')[0] || ''
        };
      });
    } catch {
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Branches
  // ─────────────────────────────────────────────────────────────────────────

  async branches(uri: string): Promise<{ branches: GitBranch[]; current: string }> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const result = await $`git -C ${root} branch -vv`.quiet();
      if (result.exitCode !== 0) {
        return { branches: [], current: '' };
      }

      const branches: GitBranch[] = [];
      let current = '';

      const lines = result.text().trim().split('\n');
      for (const line of lines) {
        const isCurrent = line.startsWith('*');
        const name = line.replace('*', '').trim().split(/\s+/)[0] || '';

        if (isCurrent) {
          current = name;
        }

        // Parse tracking info from [origin/main] format
        const trackingMatch = line.match(/\[([^\]]+)\]/);
        const tracking = trackingMatch?.[1]?.split(':')[0];

        // Parse commit hash
        const parts = line.replace('*', '').trim().split(/\s+/);
        const commit = parts[1];

        branches.push({
          name,
          current: isCurrent,
          tracking,
          commit
        });
      }

      return { branches, current };
    } catch {
      return { branches: [], current: '' };
    }
  }

  async createBranch(uri: string, name: string, checkout = true): Promise<void> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      let result;
      if (checkout) {
        result = await $`git -C ${root} checkout -b ${name}`.quiet();
      } else {
        result = await $`git -C ${root} branch ${name}`.quiet();
      }

      if (result.exitCode !== 0) {
        const stderr = result.stderr.toString();
        if (stderr.includes('already exists')) {
          throw GitError.branchExists(uri, name);
        }
        throw GitError.commandFailed(uri, 'branch', stderr);
      }

      this.invalidateCache(uri);
      this.emitChange(uri, 'branch');
    } catch (error) {
      throw GitError.wrap(uri, error);
    }
  }

  async switchBranch(uri: string, name: string): Promise<void> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const result = await $`git -C ${root} checkout ${name}`.quiet();
      if (result.exitCode !== 0) {
        const stderr = result.stderr.toString();
        if (stderr.includes('did not match any')) {
          throw GitError.branchNotFound(uri, name);
        }
        if (stderr.includes('uncommitted changes')) {
          throw new GitError(GitErrorCode.UNCOMMITTED_CHANGES, uri, 'Cannot switch branches with uncommitted changes');
        }
        throw GitError.commandFailed(uri, 'checkout', stderr);
      }

      this.invalidateCache(uri);
      this.emitChange(uri, 'branch');
    } catch (error) {
      throw GitError.wrap(uri, error);
    }
  }

  async deleteBranch(uri: string, name: string, force = false): Promise<void> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const flag = force ? '-D' : '-d';
      const result = await $`git -C ${root} branch ${flag} ${name}`.quiet();
      if (result.exitCode !== 0) {
        const stderr = result.stderr.toString();
        if (stderr.includes('not found')) {
          throw GitError.branchNotFound(uri, name);
        }
        throw GitError.commandFailed(uri, 'branch -d', stderr);
      }

      this.invalidateCache(uri);
      this.emitChange(uri, 'branch');
    } catch (error) {
      throw GitError.wrap(uri, error);
    }
  }

  async renameBranch(uri: string, newName: string): Promise<void> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const result = await $`git -C ${root} branch -m ${newName}`.quiet();
      if (result.exitCode !== 0) {
        throw GitError.commandFailed(uri, 'branch -m', result.stderr.toString());
      }

      this.invalidateCache(uri);
      this.emitChange(uri, 'branch');
    } catch (error) {
      throw GitError.wrap(uri, error);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Remote
  // ─────────────────────────────────────────────────────────────────────────

  async push(uri: string, remote = 'origin', options?: PushOptions): Promise<PushResult> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const branchInfo = await this.branch(uri);
      const args: string[] = [];

      if (options?.forceWithLease) {
        args.push('--force-with-lease');
      }
      if (options?.setUpstream) {
        args.push('-u');
      }

      const result = await $`git -C ${root} push ${args} ${remote} ${branchInfo.name}`.quiet();
      if (result.exitCode !== 0) {
        const stderr = result.stderr.toString();
        if (stderr.includes('rejected')) {
          return { success: false, error: 'Push rejected - pull changes first' };
        }
        if (stderr.includes('Authentication') || stderr.includes('Permission denied')) {
          return { success: false, error: 'Authentication failed' };
        }
        return { success: false, error: stderr };
      }

      this.invalidateCache(uri);
      this.emitChange(uri, 'status');
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async pull(uri: string, remote = 'origin'): Promise<PullResult> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const branchInfo = await this.branch(uri);
      const result = await $`git -C ${root} pull ${remote} ${branchInfo.name}`.quiet();

      if (result.exitCode !== 0) {
        const conflicts = await this.getConflicts(uri);
        if (conflicts.length > 0) {
          return { success: false, conflicts: true, conflictFiles: conflicts };
        }
        return { success: false, error: result.stderr.toString() };
      }

      this.invalidateCache(uri);
      this.emitChange(uri, 'status');
      return { success: true, changed: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async fetch(uri: string, remote = 'origin'): Promise<void> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const result = await $`git -C ${root} fetch ${remote}`.quiet();
      if (result.exitCode !== 0) {
        throw GitError.commandFailed(uri, 'fetch', result.stderr.toString());
      }
      this.invalidateCache(uri);
    } catch (error) {
      throw GitError.wrap(uri, error);
    }
  }

  async remotes(uri: string): Promise<GitRemote[]> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const result = await $`git -C ${root} remote -v`.quiet();
      if (result.exitCode !== 0) {
        return [];
      }

      const remoteMap = new Map<string, GitRemote>();
      const lines = result.text().trim().split('\n');

      for (const line of lines) {
        const match = line.match(/^(\S+)\s+(\S+)\s+\((\w+)\)$/);
        if (!match) continue;

        const [, name, url, type] = match;
        if (!name || !url) continue;

        if (!remoteMap.has(name)) {
          remoteMap.set(name, { name, fetchUrl: '', pushUrl: '' });
        }

        const remote = remoteMap.get(name)!;
        if (type === 'fetch') {
          remote.fetchUrl = url;
        } else if (type === 'push') {
          remote.pushUrl = url;
        }
      }

      return Array.from(remoteMap.values());
    } catch {
      return [];
    }
  }

  async setUpstream(uri: string, remote: string, branch: string): Promise<void> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const result = await $`git -C ${root} branch --set-upstream-to=${remote}/${branch}`.quiet();
      if (result.exitCode !== 0) {
        throw GitError.commandFailed(uri, 'branch --set-upstream-to', result.stderr.toString());
      }
      this.invalidateCache(uri);
    } catch (error) {
      throw GitError.wrap(uri, error);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Merge
  // ─────────────────────────────────────────────────────────────────────────

  async merge(uri: string, branch: string): Promise<MergeResult> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const result = await $`git -C ${root} merge ${branch}`.quiet();

      if (result.exitCode === 0) {
        this.invalidateCache(uri);
        this.emitChange(uri, 'commit');
        return { success: true, conflicts: [], message: 'Merge completed successfully' };
      }

      // Check for conflicts
      const conflicts = await this.getConflicts(uri);
      if (conflicts.length > 0) {
        return {
          success: false,
          conflicts,
          message: `Merge conflicts in ${conflicts.length} file(s)`
        };
      }

      return { success: false, conflicts: [], message: 'Merge failed' };
    } catch (error) {
      const conflicts = await this.getConflicts(uri);
      if (conflicts.length > 0) {
        return {
          success: false,
          conflicts,
          message: `Merge conflicts in ${conflicts.length} file(s)`
        };
      }
      return { success: false, conflicts: [], message: String(error) };
    }
  }

  async abortMerge(uri: string): Promise<void> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const result = await $`git -C ${root} merge --abort`.quiet();
      if (result.exitCode !== 0) {
        throw GitError.commandFailed(uri, 'merge --abort', result.stderr.toString());
      }
      this.invalidateCache(uri);
      this.emitChange(uri, 'status');
    } catch (error) {
      throw GitError.wrap(uri, error);
    }
  }

  async getConflicts(uri: string): Promise<string[]> {
    const root = await this.getRoot(uri);
    if (!root) {
      return [];
    }

    try {
      const result = await $`git -C ${root} diff --name-only --diff-filter=U`.quiet();
      if (result.exitCode !== 0) {
        return [];
      }
      return result.text().trim().split('\n').filter(f => f);
    } catch {
      return [];
    }
  }

  async isMerging(uri: string): Promise<boolean> {
    const root = await this.getRoot(uri);
    if (!root) {
      return false;
    }

    try {
      const result = await $`git -C ${root} rev-parse -q --verify MERGE_HEAD`.quiet();
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Stash
  // ─────────────────────────────────────────────────────────────────────────

  async stash(uri: string, message?: string): Promise<string> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      let result;
      if (message) {
        result = await $`git -C ${root} stash push -m ${message}`.quiet();
      } else {
        result = await $`git -C ${root} stash push`.quiet();
      }

      if (result.exitCode !== 0) {
        const stderr = result.stderr.toString();
        if (stderr.includes('No local changes')) {
          throw new GitError(GitErrorCode.NOTHING_TO_COMMIT, uri, 'No changes to stash');
        }
        throw GitError.commandFailed(uri, 'stash push', stderr);
      }

      this.invalidateCache(uri);
      this.emitChange(uri, 'stash');
      return 'stash@{0}';
    } catch (error) {
      throw GitError.wrap(uri, error);
    }
  }

  async stashPop(uri: string, stashId?: string): Promise<void> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const args = stashId ? [stashId] : [];
      const result = await $`git -C ${root} stash pop ${args}`.quiet();

      if (result.exitCode !== 0) {
        const stderr = result.stderr.toString();
        if (stderr.includes('No stash entries')) {
          throw GitError.noStash(uri);
        }
        throw GitError.commandFailed(uri, 'stash pop', stderr);
      }

      this.invalidateCache(uri);
      this.emitChange(uri, 'stash');
    } catch (error) {
      throw GitError.wrap(uri, error);
    }
  }

  async stashList(uri: string): Promise<GitStash[]> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const result = await $`git -C ${root} stash list --format=%gd%x00%gs`.quiet();
      if (result.exitCode !== 0 || !result.text().trim()) {
        return [];
      }

      return result.text().trim().split('\n').map((line, index) => {
        const [id, rest] = line.split('\x00');
        // Parse "On branch: message" format
        const match = rest?.match(/^On (\S+): (.+)$/);
        return {
          id: id || `stash@{${index}}`,
          index,
          branch: match?.[1] || 'unknown',
          message: match?.[2] || rest || ''
        };
      });
    } catch {
      return [];
    }
  }

  async stashDrop(uri: string, stashId: string): Promise<void> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const result = await $`git -C ${root} stash drop ${stashId}`.quiet();
      if (result.exitCode !== 0) {
        throw GitError.stashNotFound(uri, stashId);
      }

      this.emitChange(uri, 'stash');
    } catch (error) {
      throw GitError.wrap(uri, error);
    }
  }

  async stashApply(uri: string, stashId?: string): Promise<void> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const args = stashId ? [stashId] : [];
      const result = await $`git -C ${root} stash apply ${args}`.quiet();

      if (result.exitCode !== 0) {
        const stderr = result.stderr.toString();
        if (stderr.includes('No stash entries')) {
          throw GitError.noStash(uri);
        }
        throw GitError.commandFailed(uri, 'stash apply', stderr);
      }

      this.invalidateCache(uri);
      this.emitChange(uri, 'status');
    } catch (error) {
      throw GitError.wrap(uri, error);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Blame
  // ─────────────────────────────────────────────────────────────────────────

  async blame(uri: string, path: string): Promise<GitBlame[]> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      const result = await $`git -C ${root} blame --line-porcelain -- ${path}`.quiet();
      if (result.exitCode !== 0) {
        return [];
      }

      const blames: GitBlame[] = [];
      const lines = result.text().split('\n');

      let currentCommit = '';
      let currentAuthor = '';
      let currentDate = '';
      let currentLine = 0;
      let expectContent = false;

      for (const line of lines) {
        if (expectContent) {
          const content = line.startsWith('\t') ? line.substring(1) : line;
          blames.push({
            commit: currentCommit.substring(0, 8),
            author: currentAuthor,
            date: currentDate,
            line: currentLine,
            content
          });
          expectContent = false;
          continue;
        }

        const commitMatch = line.match(/^([a-f0-9]{40}) \d+ (\d+)/);
        if (commitMatch) {
          currentCommit = commitMatch[1]!;
          currentLine = parseInt(commitMatch[2]!, 10);
          continue;
        }

        if (line.startsWith('author ')) {
          currentAuthor = line.substring(7);
        } else if (line.startsWith('author-time ')) {
          const timestamp = parseInt(line.substring(12), 10);
          currentDate = new Date(timestamp * 1000).toISOString().split('T')[0]!;
        } else if (line.startsWith('filename ')) {
          expectContent = true;
        }
      }

      return blames;
    } catch {
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Content
  // ─────────────────────────────────────────────────────────────────────────

  async show(uri: string, path: string, ref: string): Promise<string> {
    const root = await this.getRoot(uri);
    if (!root) {
      throw GitError.notARepo(uri);
    }

    try {
      // Make path relative to repo root
      const relativePath = path.startsWith(root) ? path.substring(root.length + 1) : path;
      const result = await $`git -C ${root} show ${ref}:${relativePath}`.quiet();

      if (result.exitCode !== 0) {
        throw GitError.invalidRef(uri, `${ref}:${relativePath}`);
      }

      return result.text();
    } catch (error) {
      if (error instanceof GitError) throw error;
      throw GitError.wrap(uri, error);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Events
  // ─────────────────────────────────────────────────────────────────────────

  onChange(callback: GitChangeCallback): Unsubscribe {
    this.changeCallbacks.add(callback);
    return () => {
      this.changeCallbacks.delete(callback);
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private uriToPath(uri: string): string {
    if (uri.startsWith('file://')) {
      return uri.substring(7);
    }
    return uri;
  }

  private emitChange(uri: string, type: GitChangeEvent['type']): void {
    const event: GitChangeEvent = { uri, type };
    for (const callback of this.changeCallbacks) {
      try {
        callback(event);
      } catch (error) {
        debugLog(`[GitCliService] Change callback error: ${error}`);
      }
    }
  }

  private parseDiff(diffText: string): GitDiffHunk[] {
    const hunks: GitDiffHunk[] = [];
    const lines = diffText.split('\n');

    let currentHunk: GitDiffHunk | null = null;
    let oldLineNum = 0;
    let newLineNum = 0;

    for (const line of lines) {
      const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (hunkMatch) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }
        currentHunk = {
          oldStart: parseInt(hunkMatch[1]!, 10),
          oldCount: parseInt(hunkMatch[2] || '1', 10),
          newStart: parseInt(hunkMatch[3]!, 10),
          newCount: parseInt(hunkMatch[4] || '1', 10),
          lines: []
        };
        oldLineNum = currentHunk.oldStart;
        newLineNum = currentHunk.newStart;
        continue;
      }

      if (!currentHunk) continue;

      if (line.startsWith('+') && !line.startsWith('+++')) {
        currentHunk.lines.push({
          type: 'added',
          content: line.substring(1),
          newLineNum: newLineNum++
        });
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        currentHunk.lines.push({
          type: 'deleted',
          content: line.substring(1),
          oldLineNum: oldLineNum++
        });
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({
          type: 'context',
          content: line.substring(1),
          oldLineNum: oldLineNum++,
          newLineNum: newLineNum++
        });
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    return hunks;
  }

  private computeLineDiff(oldLines: string[], newLines: string[]): GitLineChange[] {
    const changes: GitLineChange[] = [];

    const m = oldLines.length;
    const n = newLines.length;

    // Build LCS table
    const lcs: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          lcs[i]![j] = lcs[i - 1]![j - 1]! + 1;
        } else {
          lcs[i]![j] = Math.max(lcs[i - 1]![j]!, lcs[i]![j - 1]!);
        }
      }
    }

    // Backtrack to find matches
    const matchedOld = new Set<number>();
    const matchedNew = new Set<number>();
    const oldToNewMapping = new Map<number, number>();

    let i = m, j = n;
    while (i > 0 && j > 0) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        matchedOld.add(i - 1);
        matchedNew.add(j - 1);
        oldToNewMapping.set(i - 1, j - 1);
        i--;
        j--;
      } else if (lcs[i - 1]![j]! > lcs[i]![j - 1]!) {
        i--;
      } else {
        j--;
      }
    }

    // Find deleted and added lines
    const deletedOldIndices: number[] = [];
    for (let k = 0; k < m; k++) {
      if (!matchedOld.has(k)) {
        deletedOldIndices.push(k);
      }
    }

    const addedNewIndices: number[] = [];
    for (let k = 0; k < n; k++) {
      if (!matchedNew.has(k)) {
        addedNewIndices.push(k);
      }
    }

    // Map new lines to old regions
    const newLineToOldRegion = new Map<number, { prevOld: number; nextOld: number }>();

    for (const newIdx of addedNewIndices) {
      let prevMatchedNewIdx = -1;
      let nextMatchedNewIdx = n;

      for (let k = newIdx - 1; k >= 0; k--) {
        if (matchedNew.has(k)) {
          prevMatchedNewIdx = k;
          break;
        }
      }
      for (let k = newIdx + 1; k < n; k++) {
        if (matchedNew.has(k)) {
          nextMatchedNewIdx = k;
          break;
        }
      }

      let prevOldIdx = -1;
      let nextOldIdx = m;

      for (const [oldK, newK] of oldToNewMapping) {
        if (newK === prevMatchedNewIdx) prevOldIdx = oldK;
        if (newK === nextMatchedNewIdx) nextOldIdx = oldK;
      }

      newLineToOldRegion.set(newIdx, { prevOld: prevOldIdx, nextOld: nextOldIdx });
    }

    // Mark changes
    for (const newIdx of addedNewIndices) {
      const region = newLineToOldRegion.get(newIdx)!;
      const hasDeletedInRegion = deletedOldIndices.some(oldIdx =>
        oldIdx > region.prevOld && oldIdx < region.nextOld
      );

      changes.push({
        line: newIdx + 1,
        type: hasDeletedInRegion ? 'modified' : 'added'
      });
    }

    // Add delete markers
    for (const oldIdx of deletedOldIndices) {
      let insertionPoint = 0;
      for (let k = oldIdx - 1; k >= 0; k--) {
        if (oldToNewMapping.has(k)) {
          insertionPoint = oldToNewMapping.get(k)! + 1;
          break;
        }
      }

      const deletionLine = insertionPoint + 1;
      if (!changes.some(c => c.line === deletionLine)) {
        changes.push({ line: Math.max(1, deletionLine), type: 'deleted' });
      }
    }

    changes.sort((a, b) => a.line - b.line);
    return changes;
  }
}

export const gitCliService = new GitCliService();
export default gitCliService;
