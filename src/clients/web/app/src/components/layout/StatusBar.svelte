<script lang="ts">
  import { activeDocument } from '../../lib/stores/documents';
  import { gitStore } from '../../lib/stores/git';
  import { ecpClient } from '../../lib/ecp/client';

  let gitStatus = $state<{ branch: string; ahead: number; behind: number } | null>(null);
  let isConnected = $state(true);

  // Subscribe to git status
  gitStore.subscribe((status) => {
    if (status) {
      gitStatus = {
        branch: status.branch,
        ahead: status.ahead,
        behind: status.behind,
      };
    } else {
      gitStatus = null;
    }
  });

  // Track connection state
  $effect(() => {
    const unsubConnect = ecpClient.onConnect(() => {
      isConnected = true;
    });

    const unsubDisconnect = ecpClient.onDisconnect(() => {
      isConnected = false;
    });

    return () => {
      unsubConnect();
      unsubDisconnect();
    };
  });

  function getLanguageLabel(language: string): string {
    const labels: Record<string, string> = {
      typescript: 'TypeScript',
      javascript: 'JavaScript',
      python: 'Python',
      rust: 'Rust',
      go: 'Go',
      html: 'HTML',
      css: 'CSS',
      json: 'JSON',
      markdown: 'Markdown',
      plaintext: 'Plain Text',
    };
    return labels[language] || language;
  }
</script>

<footer class="status-bar">
  <div class="status-left">
    <!-- Git branch -->
    {#if gitStatus}
      <div class="status-item">
        <span class="icon">🔀</span>
        <span>{gitStatus.branch}</span>
        {#if gitStatus.ahead > 0}
          <span class="sync">↑{gitStatus.ahead}</span>
        {/if}
        {#if gitStatus.behind > 0}
          <span class="sync">↓{gitStatus.behind}</span>
        {/if}
      </div>
    {/if}

    <!-- Connection status -->
    <div class="status-item" class:error={!isConnected}>
      <span class="icon">{isConnected ? '🟢' : '🔴'}</span>
      <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
    </div>
  </div>

  <div class="status-right">
    <!-- Document info -->
    {#if $activeDocument}
      <div class="status-item">
        <span>Ln {$activeDocument.cursors[0]?.position.line ?? 0 + 1}, Col {$activeDocument.cursors[0]?.position.column ?? 0 + 1}</span>
      </div>
      <div class="status-item">
        <span>{getLanguageLabel($activeDocument.language)}</span>
      </div>
      <div class="status-item">
        <span>UTF-8</span>
      </div>
    {/if}
  </div>
</footer>

<style>
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 22px;
    padding: 0 8px;
    background-color: var(--status-bg, #007acc);
    color: var(--status-fg, #ffffff);
    font-size: 12px;
    flex-shrink: 0;
  }

  .status-left,
  .status-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .status-item {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: default;
  }

  .status-item:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }

  .status-item.error {
    color: #ff6b6b;
  }

  .icon {
    font-size: 10px;
  }

  .sync {
    font-size: 11px;
    opacity: 0.8;
  }
</style>
