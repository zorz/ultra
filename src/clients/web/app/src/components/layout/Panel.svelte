<script lang="ts">
  import { panel, layoutStore } from '../../lib/stores/layout';
  import Terminal from '../terminal/Terminal.svelte';

  interface PanelTab {
    id: string;
    title: string;
    icon: string;
  }

  const tabs: PanelTab[] = [
    { id: 'terminal', title: 'Terminal', icon: '⌨️' },
    { id: 'output', title: 'Output', icon: '📝' },
    { id: 'problems', title: 'Problems', icon: '⚠️' },
  ];

  let terminalIds = $state<string[]>([]);
  let activeTerminalId = $state<string | null>(null);

  function setTab(tabId: string) {
    layoutStore.setPanelTab(tabId);
  }

  async function createTerminal() {
    // Terminal creation will be handled by the Terminal component
    // This is just a placeholder for the UI
  }
</script>

<div class="panel-container">
  <!-- Panel header -->
  <div class="panel-header">
    <div class="panel-tabs">
      {#each tabs as tab}
        <button
          class="panel-tab"
          class:active={$panel.activeTab === tab.id}
          onclick={() => setTab(tab.id)}
        >
          <span class="tab-icon">{tab.icon}</span>
          <span class="tab-title">{tab.title}</span>
        </button>
      {/each}
    </div>

    <div class="panel-actions">
      {#if $panel.activeTab === 'terminal'}
        <button class="action-btn" onclick={createTerminal} title="New Terminal">
          +
        </button>
      {/if}
      <button class="action-btn" onclick={() => layoutStore.togglePanel()} title="Close Panel">
        ×
      </button>
    </div>
  </div>

  <!-- Panel content -->
  <div class="panel-content">
    {#if $panel.activeTab === 'terminal'}
      <Terminal />
    {:else if $panel.activeTab === 'output'}
      <div class="placeholder">Output (coming soon)</div>
    {:else if $panel.activeTab === 'problems'}
      <div class="placeholder">Problems (coming soon)</div>
    {/if}
  </div>
</div>

<style>
  .panel-container {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 35px;
    padding: 0 8px;
    background-color: var(--tabs-container-bg, #252526);
    border-bottom: 1px solid var(--panel-border, #3c3c3c);
    flex-shrink: 0;
  }

  .panel-tabs {
    display: flex;
    gap: 4px;
  }

  .panel-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    font-size: 12px;
    background: none;
    border: none;
    color: var(--panel-title-inactive, #969696);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }

  .panel-tab:hover {
    color: var(--panel-title-active, #e7e7e7);
  }

  .panel-tab.active {
    color: var(--panel-title-active, #e7e7e7);
    border-bottom-color: var(--panel-title-border, #007acc);
  }

  .tab-icon {
    font-size: 14px;
  }

  .panel-actions {
    display: flex;
    gap: 4px;
  }

  .action-btn {
    width: 22px;
    height: 22px;
    padding: 0;
    font-size: 16px;
    background: none;
    border: none;
    color: var(--sidebar-fg, #cccccc);
    cursor: pointer;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .action-btn:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }

  .panel-content {
    flex: 1;
    overflow: hidden;
  }

  .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--sidebar-fg, #cccccc);
    opacity: 0.5;
    font-size: 12px;
  }
</style>
