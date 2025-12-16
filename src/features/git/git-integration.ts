/**
 * Git Integration
 * 
 * Git status, diff, blame, and file operations using CLI commands via Bun.$.
 */

import { $ } from 'bun';

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: string[];
}

export interface GitFileStatus {
  path: string;
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'U' | '?';
  oldPath?: string;  // For renames
}

export interface GitLineChange {
  line: number;
  type: 'added' | 'modified' | 'deleted';
}

export interface GitDiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'context' | 'added' | 'deleted';
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

export interface GitBlame {
  commit: string;
  author: string;
  date: string;
  line: number;
  content: string;
}

export class GitIntegration {
  private workspaceRoot: string = '';
  private statusCache: GitStatus | null = null;
  private statusCacheTime: number = 0;
  private readonly CACHE_TTL = 5000;  // 5 seconds
  private lineChangesCache: Map<string, { changes: GitLineChange[], time: number }> = new Map();

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
    this.invalidateCache();
  }

  /**
   * Invalidate all caches
   */
  invalidateCache(): void {
    this.statusCache = null;
    this.statusCacheTime = 0;
    this.lineChangesCache.clear();
  }

  /**
   * Check if the workspace is a git repository
   */
  async isRepo(): Promise<boolean> {
    if (!this.workspaceRoot) return false;
    try {
      const result = await $`git -C ${this.workspaceRoot} rev-parse --is-inside-work-tree`.quiet();
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * Get current branch name
   */
  async branch(): Promise<string | null> {
    if (!this.workspaceRoot) return null;
    try {
      const result = await $`git -C ${this.workspaceRoot} branch --show-current`.quiet();
      if (result.exitCode === 0) {
        const branch = result.text().trim();
        return branch || 'HEAD';  // Detached HEAD
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get git status (cached)
   */
  async status(forceRefresh: boolean = false): Promise<GitStatus | null> {
    if (!this.workspaceRoot) return null;
    
    // Check cache
    if (!forceRefresh && this.statusCache && Date.now() - this.statusCacheTime < this.CACHE_TTL) {
      return this.statusCache;
    }

    try {
      // Get branch info
      const branchResult = await $`git -C ${this.workspaceRoot} branch --show-current`.quiet();
      const branch = branchResult.exitCode === 0 ? branchResult.text().trim() || 'HEAD' : 'unknown';

      // Get ahead/behind
      let ahead = 0;
      let behind = 0;
      try {
        const trackingResult = await $`git -C ${this.workspaceRoot} rev-list --left-right --count HEAD...@{upstream}`.quiet();
        if (trackingResult.exitCode === 0) {
          const [a, b] = trackingResult.text().trim().split('\t').map(n => parseInt(n, 10));
          ahead = a || 0;
          behind = b || 0;
        }
      } catch {
        // No upstream tracking
      }

      // Get status (porcelain format)
      const statusResult = await $`git -C ${this.workspaceRoot} status --porcelain -uall`.quiet();
      if (statusResult.exitCode !== 0) {
        return null;
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

      this.statusCache = { branch, ahead, behind, staged, unstaged, untracked };
      this.statusCacheTime = Date.now();
      return this.statusCache;
    } catch {
      return null;
    }
  }

  /**
   * Get diff for a file (parsed hunks)
   */
  async diff(filePath: string, staged: boolean = false): Promise<GitDiffHunk[]> {
    if (!this.workspaceRoot) return [];
    try {
      const args = staged ? ['--cached'] : [];
      const result = await $`git -C ${this.workspaceRoot} diff ${args} -- ${filePath}`.quiet();
      if (result.exitCode !== 0) return [];
      return this.parseDiff(result.text());
    } catch {
      return [];
    }
  }

  /**
   * Get line changes for gutter indicators
   */
  async diffLines(filePath: string): Promise<GitLineChange[]> {
    if (!this.workspaceRoot) return [];
    
    // Check cache
    const cached = this.lineChangesCache.get(filePath);
    if (cached && Date.now() - cached.time < this.CACHE_TTL) {
      return cached.changes;
    }

    try {
      // Use unified=0 for compact output showing only changed line ranges
      const result = await $`git -C ${this.workspaceRoot} diff --unified=0 -- ${filePath}`.quiet();
      if (result.exitCode !== 0) return [];

      const changes: GitLineChange[] = [];
      const lines = result.text().split('\n');

      for (const line of lines) {
        // Parse @@ -oldStart,oldCount +newStart,newCount @@ headers
        const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (!match) continue;

        const oldStart = parseInt(match[1]!, 10);
        const oldCount = parseInt(match[2] || '1', 10);
        const newStart = parseInt(match[3]!, 10);
        const newCount = parseInt(match[4] || '1', 10);

        if (oldCount === 0) {
          // Pure addition
          for (let i = 0; i < newCount; i++) {
            changes.push({ line: newStart + i, type: 'added' });
          }
        } else if (newCount === 0) {
          // Pure deletion - show at the line before
          changes.push({ line: Math.max(1, newStart), type: 'deleted' });
        } else {
          // Modification
          for (let i = 0; i < newCount; i++) {
            changes.push({ line: newStart + i, type: 'modified' });
          }
        }
      }

      this.lineChangesCache.set(filePath, { changes, time: Date.now() });
      return changes;
    } catch {
      return [];
    }
  }

  /**
   * Get file content at HEAD
   */
  async show(filePath: string, ref: string = 'HEAD'): Promise<string | null> {
    if (!this.workspaceRoot) return null;
    try {
      // Make path relative to workspace root
      const relativePath = filePath.startsWith(this.workspaceRoot)
        ? filePath.substring(this.workspaceRoot.length + 1)
        : filePath;
      const result = await $`git -C ${this.workspaceRoot} show ${ref}:${relativePath}`.quiet();
      if (result.exitCode === 0) {
        return result.text();
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get blame information for a file
   */
  async blame(filePath: string): Promise<GitBlame[]> {
    if (!this.workspaceRoot) return [];
    try {
      const result = await $`git -C ${this.workspaceRoot} blame --line-porcelain -- ${filePath}`.quiet();
      if (result.exitCode !== 0) return [];

      const blames: GitBlame[] = [];
      const lines = result.text().split('\n');
      
      let currentCommit = '';
      let currentAuthor = '';
      let currentDate = '';
      let currentLine = 0;
      let expectContent = false;

      for (const line of lines) {
        if (expectContent) {
          // Line content starts with \t
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

        // First line of each block is: commit origLine finalLine [numLines]
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

  /**
   * Stage a file
   */
  async add(filePath: string): Promise<boolean> {
    if (!this.workspaceRoot) return false;
    try {
      const result = await $`git -C ${this.workspaceRoot} add -- ${filePath}`.quiet();
      if (result.exitCode === 0) {
        this.invalidateCache();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Stage all files
   */
  async addAll(): Promise<boolean> {
    if (!this.workspaceRoot) return false;
    try {
      const result = await $`git -C ${this.workspaceRoot} add -A`.quiet();
      if (result.exitCode === 0) {
        this.invalidateCache();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Unstage a file
   */
  async reset(filePath: string): Promise<boolean> {
    if (!this.workspaceRoot) return false;
    try {
      const result = await $`git -C ${this.workspaceRoot} reset HEAD -- ${filePath}`.quiet();
      if (result.exitCode === 0) {
        this.invalidateCache();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Discard changes in working directory
   */
  async checkout(filePath: string): Promise<boolean> {
    if (!this.workspaceRoot) return false;
    try {
      const result = await $`git -C ${this.workspaceRoot} checkout -- ${filePath}`.quiet();
      if (result.exitCode === 0) {
        this.invalidateCache();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Commit staged changes
   */
  async commit(message: string): Promise<boolean> {
    if (!this.workspaceRoot || !message.trim()) return false;
    try {
      const result = await $`git -C ${this.workspaceRoot} commit -m ${message}`.quiet();
      if (result.exitCode === 0) {
        this.invalidateCache();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get recent commits
   */
  async log(count: number = 10): Promise<{ hash: string; message: string; author: string; date: string }[]> {
    if (!this.workspaceRoot) return [];
    try {
      const result = await $`git -C ${this.workspaceRoot} log --oneline -n ${count} --format=%H%x00%s%x00%an%x00%ai`.quiet();
      if (result.exitCode !== 0) return [];

      return result.text().trim().split('\n').filter(l => l).map(line => {
        const [hash, message, author, date] = line.split('\x00');
        return {
          hash: hash?.substring(0, 8) || '',
          message: message || '',
          author: author || '',
          date: date?.split(' ')[0] || ''
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Parse diff output into structured hunks
   */
  private parseDiff(diffText: string): GitDiffHunk[] {
    const hunks: GitDiffHunk[] = [];
    const lines = diffText.split('\n');
    
    let currentHunk: GitDiffHunk | null = null;
    let oldLineNum = 0;
    let newLineNum = 0;

    for (const line of lines) {
      // Parse hunk header
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

  // Legacy API compatibility
  async getStatus(): Promise<GitStatus | null> {
    return this.status();
  }

  async getBranch(): Promise<string | null> {
    return this.branch();
  }

  async getLineChanges(filePath: string): Promise<GitLineChange[]> {
    return this.diffLines(filePath);
  }

  async getDiff(filePath: string): Promise<GitDiffHunk[]> {
    return this.diff(filePath);
  }

  async stageFile(filePath: string): Promise<boolean> {
    return this.add(filePath);
  }

  async unstageFile(filePath: string): Promise<boolean> {
    return this.reset(filePath);
  }

  async revertFile(filePath: string): Promise<boolean> {
    return this.checkout(filePath);
  }
}

export const gitIntegration = new GitIntegration();

export default gitIntegration;
