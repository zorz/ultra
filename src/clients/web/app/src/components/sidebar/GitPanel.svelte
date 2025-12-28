<script lang="ts">
  import { gitStore, changedFiles, stagedCount, type GitFileChange } from '../../lib/stores/git';

  let status: {
    branch: string;
    ahead: number;
    behind: number;
    staged: GitFileChange[];
    unstaged: GitFileChange[];
    untracked: GitFileChange[];
    conflicts: GitFileChange[];
  } | null = null;

  let commitMessage = '';
  let isCommitting = false;

  // Subscribe to git status
  gitStore.subscribe((value) => {
    status = value;
  });

  function getStatusIcon(change: GitFileChange): string {
    switch (change.status) {
      case 'modified':
        return 'M';
      case 'added':
        return 'A';
      case 'deleted':
        return 'D';
      case 'renamed':
        return 'R';
      case 'untracked':
        return 'U';
      case 'conflict':
        return '!';
      default:
        return '?';
    }
  }

  function getStatusColor(change: GitFileChange): string {
    switch (change.status) {
      case 'modified':
        return 'var(--git-modified, #e2c08d)';
      case 'added':
      case 'untracked':
        return 'var(--git-added, #89d185)';
      case 'deleted':
        return 'var(--git-deleted, #f14c4c)';
      case 'conflict':
        return 'var(--git-conflict, #ff7b72)';
      default:
        return 'var(--sidebar-fg, #cccccc)';
    }
  }

  async function handleStage(change: GitFileChange) {
    await gitStore.stage(change.path);
  }

  async function handleUnstage(change: GitFileChange) {
    await gitStore.unstage(change.path);
  }

  async function handleDiscard(change: GitFileChange) {
    if (confirm(`Discard changes to ${change.path}?`)) {
      await gitStore.discard(change.path);
    }
  }

  async function handleCommit() {
    if (!commitMessage.trim()) return;

    isCommitting = true;
    try {
      await gitStore.commit(commitMessage);
      commitMessage = '';
    } catch (error) {
      console.error('Commit failed:', error);
    } finally {
      isCommitting = false;
    }
  }

  async function handleStageAll() {
    await gitStore.stageAll();
  }
</script>

<div class="git-panel">
  {#if status}
    <!-- Branch info -->
    <div class="branch-info">
      <span class="branch-icon">🔀</span>
      <span class="branch-name">{status.branch}</span>
      {#if status.ahead > 0}
        <span class="sync-status">↑{status.ahead}</span>
      {/if}
      {#if status.behind > 0}
        <span class="sync-status">↓{status.behind}</span>
      {/if}
    </div>

    <!-- Commit input -->
    <div class="commit-section">
      <textarea
        class="commit-input"
        placeholder="Commit message"
        bind:value={commitMessage}
        rows="3"
      ></textarea>
      <button
        class="commit-button"
        onclick={handleCommit}
        disabled={isCommitting || !commitMessage.trim() || $stagedCount === 0}
      >
        {isCommitting ? 'Committing...' : `Commit (${$stagedCount})`}
      </button>
    </div>

    <!-- Staged changes -->
    {#if status.staged.length > 0}
      <div class="section">
        <div class="section-header">
          <span class="section-title">Staged Changes</span>
          <span class="section-count">{status.staged.length}</span>
        </div>
        <div class="file-list">
          {#each status.staged as change}
            <div class="file-item">
              <span class="status-icon" style="color: {getStatusColor(change)}">
                {getStatusIcon(change)}
              </span>
              <span class="file-name">{change.path}</span>
              <button class="action-btn" onclick={() => handleUnstage(change)} title="Unstage">
                −
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Unstaged changes -->
    {#if status.unstaged.length > 0 || status.untracked.length > 0}
      <div class="section">
        <div class="section-header">
          <span class="section-title">Changes</span>
          <span class="section-count">{status.unstaged.length + status.untracked.length}</span>
          <button class="action-btn stage-all" onclick={handleStageAll} title="Stage All">
            +
          </button>
        </div>
        <div class="file-list">
          {#each [...status.unstaged, ...status.untracked] as change}
            <div class="file-item">
              <span class="status-icon" style="color: {getStatusColor(change)}">
                {getStatusIcon(change)}
              </span>
              <span class="file-name">{change.path}</span>
              <button class="action-btn" onclick={() => handleDiscard(change)} title="Discard">
                ↩
              </button>
              <button class="action-btn" onclick={() => handleStage(change)} title="Stage">
                +
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Conflicts -->
    {#if status.conflicts.length > 0}
      <div class="section conflicts">
        <div class="section-header">
          <span class="section-title">Merge Conflicts</span>
          <span class="section-count">{status.conflicts.length}</span>
        </div>
        <div class="file-list">
          {#each status.conflicts as change}
            <div class="file-item">
              <span class="status-icon" style="color: {getStatusColor(change)}">!</span>
              <span class="file-name">{change.path}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Empty state -->
    {#if $changedFiles.length === 0}
      <div class="empty-state">No changes detected</div>
    {/if}
  {:else}
    <div class="empty-state">Not a git repository</div>
  {/if}
</div>

<style>
  .git-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-size: 12px;
  }

  .branch-info {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    gap: 6px;
    border-bottom: 1px solid var(--panel-border, #3c3c3c);
  }

  .branch-icon {
    font-size: 14px;
  }

  .branch-name {
    font-weight: 500;
  }

  .sync-status {
    font-size: 11px;
    color: var(--sidebar-fg, #cccccc);
    opacity: 0.7;
  }

  .commit-section {
    padding: 8px;
    border-bottom: 1px solid var(--panel-border, #3c3c3c);
  }

  .commit-input {
    width: 100%;
    padding: 6px 8px;
    font-size: 12px;
    font-family: inherit;
    background-color: var(--input-bg, #3c3c3c);
    color: var(--input-fg, #cccccc);
    border: 1px solid var(--input-border, #3c3c3c);
    border-radius: 2px;
    resize: vertical;
    box-sizing: border-box;
  }

  .commit-input:focus {
    outline: none;
    border-color: var(--focus-border, #007acc);
  }

  .commit-button {
    width: 100%;
    margin-top: 6px;
    padding: 6px 12px;
    font-size: 12px;
    background-color: var(--button-bg, #0e639c);
    color: var(--button-fg, #ffffff);
    border: none;
    border-radius: 2px;
    cursor: pointer;
  }

  .commit-button:hover:not(:disabled) {
    background-color: var(--button-hover-bg, #1177bb);
  }

  .commit-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .section {
    border-bottom: 1px solid var(--panel-border, #3c3c3c);
  }

  .section-header {
    display: flex;
    align-items: center;
    padding: 6px 12px;
    gap: 6px;
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--sidebar-header-fg, #bbbbbb);
  }

  .section-count {
    font-size: 10px;
    padding: 1px 5px;
    background-color: var(--activity-badge-bg, #007acc);
    color: var(--activity-badge-fg, #ffffff);
    border-radius: 8px;
  }

  .file-list {
    padding: 0 4px 4px;
  }

  .file-item {
    display: flex;
    align-items: center;
    padding: 2px 8px;
    gap: 6px;
    border-radius: 3px;
  }

  .file-item:hover {
    background-color: var(--list-hover-bg, #2a2d2e);
  }

  .status-icon {
    font-family: monospace;
    font-size: 11px;
    font-weight: bold;
    width: 12px;
    text-align: center;
  }

  .file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--sidebar-fg, #cccccc);
  }

  .action-btn {
    display: none;
    width: 18px;
    height: 18px;
    padding: 0;
    font-size: 14px;
    line-height: 1;
    background: none;
    border: none;
    color: var(--sidebar-fg, #cccccc);
    cursor: pointer;
    border-radius: 3px;
  }

  .action-btn:hover {
    background-color: var(--list-hover-bg, #3c3c3c);
  }

  .file-item:hover .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .stage-all {
    display: flex;
    margin-left: auto;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    color: var(--sidebar-fg, #cccccc);
    opacity: 0.5;
  }

  .conflicts .section-header {
    color: var(--git-conflict, #ff7b72);
  }
</style>
