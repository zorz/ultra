# Git Service

The Git Service provides version control operations, currently wrapping the Git CLI.

## Current State

### Location
- `src/features/git/git-integration.ts` - Single 1,126-line file with all git operations

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      GitIntegration                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Bun.$ shell interface                                    │  │
│  │  git -C ${workspaceRoot} <command>                        │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Caches:                                                         │
│  - statusCache (5s TTL)                                          │
│  - lineChangesCache per file (5s TTL)                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                        Git CLI binary
```

### Data Types

```typescript
interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: string[];
}

interface GitFileStatus {
  path: string;
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'U' | '?';
  oldPath?: string;  // For renames
}

interface GitDiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

interface DiffLine {
  type: 'context' | 'added' | 'deleted';
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

interface GitLineChange {
  line: number;
  type: 'added' | 'modified' | 'deleted';
}

interface GitBlame {
  commit: string;
  author: string;
  date: string;
  line: number;
  content: string;
}
```

### Public API (37 methods)

```typescript
class GitIntegration {
  // Repository
  async isRepo(): Promise<boolean>
  async branch(): Promise<string | null>
  async status(forceRefresh?: boolean): Promise<GitStatus | null>
  invalidateCache(): void

  // Staging
  async add(filePath: string): Promise<boolean>
  async addAll(): Promise<boolean>
  async reset(filePath: string): Promise<boolean>

  // Diff
  async diff(filePath: string, staged?: boolean): Promise<GitDiffHunk[]>
  async diffLines(filePath: string): Promise<GitLineChange[]>
  async diffBufferLines(filePath: string, bufferContent: string): Promise<GitLineChange[]>
  async getLineDiff(filePath: string, line: number, contextLines?: number): Promise<string | null>

  // Commit
  async commit(message: string): Promise<boolean>
  async amendCommit(message?: string): Promise<boolean>
  async log(count?: number): Promise<GitCommit[]>

  // Remote
  async push(remote?: string, forceLease?: boolean): Promise<boolean>
  async pull(remote?: string): Promise<boolean>
  async fetch(remote?: string): Promise<boolean>
  async getRemotes(): Promise<string[]>
  async setUpstream(remote: string, branch: string): Promise<boolean>

  // Branches
  async getBranches(): Promise<GitBranch[]>
  async createBranch(branchName: string): Promise<boolean>
  async switchBranch(branchName: string): Promise<boolean>
  async deleteBranch(branchName: string, force?: boolean): Promise<boolean>
  async renameBranch(newName: string): Promise<boolean>

  // Merge
  async merge(branchName: string): Promise<MergeResult>
  async isMergeInProgress(): Promise<boolean>
  async getMergeConflicts(): Promise<string[]>
  async abortMerge(): Promise<boolean>

  // Blame
  async blame(filePath: string): Promise<GitBlame[]>

  // Content
  async show(filePath: string, ref: string): Promise<string | null>
}
```

### Diff Algorithm

The `computeLineDiff()` method (lines 316-450) uses Longest Common Subsequence (LCS):

1. Compares old content (from HEAD) vs current buffer
2. Builds LCS table (O(mn) complexity)
3. Backtracks to find matching lines
4. Pairs nearby deletions with additions as "modified"
5. Standalone additions/deletions marked accordingly

### Current Issues

| Issue | Location | Description |
|-------|----------|-------------|
| Silent failures | All methods | Returns `false`/`null` with no error context |
| No GIT_EDITOR | Nowhere | CLAUDE.md says it's set but it isn't |
| Path edge cases | Path conversion | May fail on Windows or special paths |
| Race condition | merge() | Time gap between merge and conflict check |
| Missing features | N/A | No stash, rebase, cherry-pick, tags |
| Incomplete conflict UI | N/A | Detects conflicts but no resolution UI |
| No progress feedback | Long ops | Clone, fetch appear frozen |
| Blame data loss | blame() | Time portion discarded |

### Missing Git Operations

| Feature | Status |
|---------|--------|
| Stash | ❌ Not implemented |
| Rebase | ❌ Not implemented |
| Cherry-pick | ❌ Not implemented |
| Tags | ❌ Not implemented |
| Reflog | ❌ Not implemented |
| Worktrees | ❌ Not implemented |
| GPG signing | ❌ Not implemented |
| Interactive staging | ⚠️ File-level only |

---

## Target State

### ECP Interface

```typescript
// Repository status
"git/isRepo": { uri: string } => { isRepo: boolean, rootUri?: string }
"git/status": { uri: string, forceRefresh?: boolean } => GitStatus
"git/branch": { uri: string } => { branch: string, tracking?: string, ahead: number, behind: number }

// Staging
"git/stage": { uri: string, paths: string[] } => { success: boolean }
"git/stageAll": { uri: string } => { success: boolean }
"git/unstage": { uri: string, paths: string[] } => { success: boolean }
"git/discard": { uri: string, paths: string[] } => { success: boolean }

// Diff
"git/diff": { uri: string, path: string, staged?: boolean } => { hunks: GitDiffHunk[] }
"git/diffLines": { uri: string, path: string } => { changes: GitLineChange[] }
"git/diffBuffer": { uri: string, path: string, content: string } => { changes: GitLineChange[] }

// Commit
"git/commit": { uri: string, message: string } => CommitResult
"git/amend": { uri: string, message?: string } => CommitResult
"git/log": { uri: string, count?: number } => { commits: GitCommit[] }

// Branches
"git/branches": { uri: string } => { branches: GitBranch[], current: string }
"git/createBranch": { uri: string, name: string, checkout?: boolean } => { success: boolean }
"git/switchBranch": { uri: string, name: string } => { success: boolean }
"git/deleteBranch": { uri: string, name: string, force?: boolean } => { success: boolean }
"git/renameBranch": { uri: string, newName: string } => { success: boolean }

// Remote
"git/push": { uri: string, remote?: string, force?: boolean } => PushResult
"git/pull": { uri: string, remote?: string } => PullResult
"git/fetch": { uri: string, remote?: string } => { success: boolean }
"git/remotes": { uri: string } => { remotes: GitRemote[] }

// Merge
"git/merge": { uri: string, branch: string } => MergeResult
"git/mergeAbort": { uri: string } => { success: boolean }
"git/conflicts": { uri: string } => { files: string[] }

// Stash (NEW)
"git/stash": { uri: string, message?: string } => { success: boolean, stashId: string }
"git/stashPop": { uri: string, stashId?: string } => { success: boolean }
"git/stashList": { uri: string } => { stashes: GitStash[] }
"git/stashDrop": { uri: string, stashId: string } => { success: boolean }

// Blame
"git/blame": { uri: string, path: string } => { lines: GitBlame[] }

// Content at ref
"git/show": { uri: string, path: string, ref: string } => { content: string }

// Notifications
"git/didChange": { uri: string, type: 'status' | 'branch' | 'commit' }
```

### Service Architecture

```typescript
// services/git/interface.ts
interface GitService {
  // Repository
  isRepo(uri: string): Promise<boolean>
  getRoot(uri: string): Promise<string | null>
  status(uri: string, forceRefresh?: boolean): Promise<GitStatus>
  branch(uri: string): Promise<GitBranchInfo>

  // Staging
  stage(uri: string, paths: string[]): Promise<void>
  stageAll(uri: string): Promise<void>
  unstage(uri: string, paths: string[]): Promise<void>
  discard(uri: string, paths: string[]): Promise<void>

  // Diff
  diff(uri: string, path: string, staged?: boolean): Promise<GitDiffHunk[]>
  diffLines(uri: string, path: string): Promise<GitLineChange[]>
  diffBuffer(uri: string, path: string, content: string): Promise<GitLineChange[]>

  // Commit
  commit(uri: string, message: string): Promise<CommitResult>
  amend(uri: string, message?: string): Promise<CommitResult>
  log(uri: string, count?: number): Promise<GitCommit[]>

  // Branches
  branches(uri: string): Promise<{ branches: GitBranch[], current: string }>
  createBranch(uri: string, name: string, checkout?: boolean): Promise<void>
  switchBranch(uri: string, name: string): Promise<void>
  deleteBranch(uri: string, name: string, force?: boolean): Promise<void>

  // Remote
  push(uri: string, remote?: string, options?: PushOptions): Promise<PushResult>
  pull(uri: string, remote?: string): Promise<PullResult>
  fetch(uri: string, remote?: string): Promise<void>

  // Merge
  merge(uri: string, branch: string): Promise<MergeResult>
  abortMerge(uri: string): Promise<void>
  getConflicts(uri: string): Promise<string[]>

  // Stash
  stash(uri: string, message?: string): Promise<string>  // Returns stash ID
  stashPop(uri: string, stashId?: string): Promise<void>
  stashList(uri: string): Promise<GitStash[]>
  stashDrop(uri: string, stashId: string): Promise<void>

  // Blame
  blame(uri: string, path: string): Promise<GitBlame[]>

  // Content
  show(uri: string, path: string, ref: string): Promise<string>

  // Events
  onChange(callback: GitChangeCallback): Unsubscribe
}

// services/git/cli.ts
class GitCliService implements GitService {
  // Implementation using Bun.$ to call git CLI
}

// services/git/adapter.ts
class GitServiceAdapter {
  // Maps ECP JSON-RPC calls to GitService methods
}
```

### Provider Pattern (Future)

```typescript
// For GitHub API, GitLab API, etc.
interface GitProvider {
  readonly type: 'cli' | 'github' | 'gitlab';
  // Same methods as GitService
}

class GitHubProvider implements GitProvider {
  readonly type = 'github';
  // Use GitHub API for remote operations
}
```

---

## Migration Steps

### Phase 1: Interface Extraction

1. **Create GitService interface**
   - Define all methods with proper return types
   - Add error types for common failures
   - Add event emission

2. **Create GitCliService**
   - Move existing GitIntegration code
   - Add proper error handling (not silent failures)
   - Add GIT_EDITOR=true to environment

3. **Fix immediate issues**
   - Set GIT_EDITOR=true
   - Add error messages to all operations
   - Fix path normalization

### Phase 2: Add Missing Features

1. **Stash operations**
   - `stash`, `stashPop`, `stashList`, `stashDrop`

2. **Conflict resolution helpers**
   - `resolveConflict(path, resolution: 'ours' | 'theirs' | 'merge')`

3. **Progress callbacks**
   - Add progress reporting for long operations
   - Use git's progress output

### Phase 3: ECP Adapter

1. **Create GitServiceAdapter**
   - Map JSON-RPC methods
   - Handle errors properly
   - Emit change notifications

### Migration Checklist

```markdown
- [ ] Create services/git/ directory
- [ ] Define GitService interface
- [ ] Define error types
- [ ] Create GitCliService from existing code
- [ ] Add GIT_EDITOR=true to environment
- [ ] Add proper error messages to all operations
- [ ] Fix path normalization for Windows
- [ ] Implement stash operations
- [ ] Add progress callbacks for long operations
- [ ] Add conflict resolution helpers
- [ ] Create GitServiceAdapter for ECP
- [ ] Add tests
- [ ] Update git-panel.ts to use service
- [ ] Update app.ts git commands to use service
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/features/git/git-integration.ts` | Rename to cli.ts, implement interface |
| `src/ui/components/git-panel.ts` | Use GitService instead of gitIntegration |
| `src/ui/components/git-diff-popup.ts` | Use GitService |
| `src/app.ts` | Use GitService for all git commands |

### New Files to Create

```
src/services/git/
├── interface.ts      # GitService interface
├── types.ts          # GitStatus, GitCommit, etc.
├── errors.ts         # GitError types
├── cli.ts            # GitCliService (from git-integration.ts)
├── adapter.ts        # ECP adapter
└── index.ts          # Public exports
```

### Error Handling

```typescript
// services/git/errors.ts
class GitError extends Error {
  constructor(
    public readonly code: GitErrorCode,
    public readonly uri: string,
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
  }
}

enum GitErrorCode {
  NOT_A_REPO = 'NOT_A_REPO',
  UNCOMMITTED_CHANGES = 'UNCOMMITTED_CHANGES',
  MERGE_CONFLICT = 'MERGE_CONFLICT',
  PUSH_REJECTED = 'PUSH_REJECTED',
  AUTHENTICATION_FAILED = 'AUTH_FAILED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  COMMAND_FAILED = 'COMMAND_FAILED'
}

// Example usage
async stage(uri: string, paths: string[]): Promise<void> {
  const result = await $`git -C ${root} add -- ${paths}`.quiet();
  if (result.exitCode !== 0) {
    throw new GitError(
      GitErrorCode.COMMAND_FAILED,
      uri,
      `Failed to stage files: ${result.stderr.toString()}`,
    );
  }
}
```

### Environment Setup

```typescript
// In GitCliService constructor
constructor() {
  // Prevent git from opening editors for interactive commands
  process.env.GIT_EDITOR = 'true';
  process.env.GIT_TERMINAL_PROMPT = '0';
}
```
