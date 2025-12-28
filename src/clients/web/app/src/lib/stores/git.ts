/**
 * Git Store
 *
 * Manages git repository state and operations.
 */

import { writable, derived, get } from 'svelte/store';
import { ecpClient } from '../ecp/client';

export type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'ignored' | 'conflict';

export interface GitFileChange {
  path: string;
  status: FileStatus;
  staged: boolean;
  originalPath?: string; // For renamed files
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  untracked: GitFileChange[];
  conflicts: GitFileChange[];
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

function createGitStore() {
  const isRepo = writable<boolean>(false);
  const status = writable<GitStatus | null>(null);
  const isLoading = writable<boolean>(false);
  const error = writable<string | null>(null);

  // Subscribe to git status updates from server
  ecpClient.subscribe('git/statusChanged', async () => {
    await refreshStatus();
  });

  async function refreshStatus(): Promise<void> {
    if (!get(isRepo)) return;

    try {
      isLoading.set(true);
      error.set(null);

      const result = await ecpClient.request<GitStatus>('git/status', {});
      status.set(result);
    } catch (err) {
      error.set(err instanceof Error ? err.message : String(err));
      status.set(null);
    } finally {
      isLoading.set(false);
    }
  }

  return {
    subscribe: status.subscribe,
    isRepo,
    isLoading,
    error,

    /**
     * Initialize git tracking for a repository.
     */
    async init(workspaceRoot: string): Promise<boolean> {
      try {
        const result = await ecpClient.request<{ isRepo: boolean }>('git/isRepo', {
          path: workspaceRoot,
        });

        isRepo.set(result.isRepo);

        if (result.isRepo) {
          await refreshStatus();
        }

        return result.isRepo;
      } catch (err) {
        error.set(err instanceof Error ? err.message : String(err));
        isRepo.set(false);
        return false;
      }
    },

    /**
     * Refresh the git status.
     */
    refresh: refreshStatus,

    /**
     * Stage a file.
     */
    async stage(path: string): Promise<void> {
      await ecpClient.request('git/stage', { paths: [path] });
      await refreshStatus();
    },

    /**
     * Stage all files.
     */
    async stageAll(): Promise<void> {
      await ecpClient.request('git/stageAll', {});
      await refreshStatus();
    },

    /**
     * Unstage a file.
     */
    async unstage(path: string): Promise<void> {
      await ecpClient.request('git/unstage', { paths: [path] });
      await refreshStatus();
    },

    /**
     * Discard changes to a file.
     */
    async discard(path: string): Promise<void> {
      await ecpClient.request('git/discard', { paths: [path] });
      await refreshStatus();
    },

    /**
     * Commit staged changes.
     */
    async commit(message: string): Promise<void> {
      await ecpClient.request('git/commit', { message });
      await refreshStatus();
    },

    /**
     * Amend the last commit.
     */
    async amend(message?: string): Promise<void> {
      await ecpClient.request('git/amend', { message });
      await refreshStatus();
    },

    /**
     * Get diff for a file.
     */
    async diff(path: string, staged: boolean = false): Promise<string> {
      const result = await ecpClient.request<{ diff: string }>('git/diff', {
        path,
        staged,
      });
      return result.diff;
    },

    /**
     * Get commit log.
     */
    async log(limit: number = 50): Promise<GitCommit[]> {
      const result = await ecpClient.request<{ commits: GitCommit[] }>('git/log', {
        limit,
      });
      return result.commits;
    },

    /**
     * Get list of branches.
     */
    async branches(): Promise<{ current: string; branches: string[] }> {
      const result = await ecpClient.request<{ current: string; branches: string[] }>('git/branches', {});
      return result;
    },

    /**
     * Switch to a branch.
     */
    async switchBranch(branch: string): Promise<void> {
      await ecpClient.request('git/switchBranch', { branch });
      await refreshStatus();
    },

    /**
     * Create a new branch.
     */
    async createBranch(name: string, checkout: boolean = true): Promise<void> {
      await ecpClient.request('git/createBranch', { name, checkout });
      if (checkout) {
        await refreshStatus();
      }
    },

    /**
     * Pull from remote.
     */
    async pull(): Promise<void> {
      await ecpClient.request('git/pull', {});
      await refreshStatus();
    },

    /**
     * Push to remote.
     */
    async push(): Promise<void> {
      await ecpClient.request('git/push', {});
      await refreshStatus();
    },

    /**
     * Fetch from remote.
     */
    async fetch(): Promise<void> {
      await ecpClient.request('git/fetch', {});
      await refreshStatus();
    },
  };
}

export const gitStore = createGitStore();

/**
 * Derived store for all changed files.
 */
export const changedFiles = derived(gitStore, ($status) => {
  if (!$status) return [];
  return [...$status.staged, ...$status.unstaged, ...$status.untracked, ...$status.conflicts];
});

/**
 * Derived store for whether there are uncommitted changes.
 */
export const hasChanges = derived(changedFiles, ($files) => $files.length > 0);

/**
 * Derived store for staged file count.
 */
export const stagedCount = derived(gitStore, ($status) => $status?.staged.length ?? 0);

export default gitStore;
