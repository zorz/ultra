<script lang="ts">
  import { onMount } from 'svelte';
  import MainLayout from './components/layout/MainLayout.svelte';
  import { filesStore } from './lib/stores/files';
  import { gitStore } from './lib/stores/git';
  import { ecpClient } from './lib/ecp/client';

  let isConnected = true;
  let workspaceRoot = '';

  onMount(() => {
    // Track connection state
    const unsubConnect = ecpClient.onConnect(() => {
      isConnected = true;
    });

    const unsubDisconnect = ecpClient.onDisconnect(() => {
      isConnected = false;
    });

    // Initialize workspace
    initWorkspace();

    return () => {
      unsubConnect();
      unsubDisconnect();
    };
  });

  async function initWorkspace() {
    try {
      // Get workspace root from server
      const result = await ecpClient.request<{ root: string }>('workspace/root', {});

      // Use workspace root from server, fallback to root
      workspaceRoot = result.root || '/';

      // Initialize file tree
      await filesStore.init(workspaceRoot);

      // Initialize git
      await gitStore.init(workspaceRoot);
    } catch (error) {
      console.error('Failed to initialize workspace:', error);
      // Use a sensible default
      workspaceRoot = '/';
    }
  }
</script>

<div class="app" class:disconnected={!isConnected}>
  {#if !isConnected}
    <div class="connection-banner">
      Reconnecting to server...
    </div>
  {/if}

  <MainLayout />
</div>

<style>
  .app {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background-color: var(--editor-bg, #1e1e1e);
    color: var(--editor-fg, #d4d4d4);
  }

  .app.disconnected {
    opacity: 0.7;
    pointer-events: none;
  }

  .connection-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 9999;
    padding: 8px 16px;
    background-color: var(--editor-warning, #cca700);
    color: #000;
    text-align: center;
    font-size: 12px;
    font-weight: 500;
  }
</style>
