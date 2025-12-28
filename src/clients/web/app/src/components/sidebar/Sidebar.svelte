<script lang="ts">
  import { sidebar, layoutStore, type SidebarSection } from '../../lib/stores/layout';
  import FileTree from './FileTree.svelte';
  import GitPanel from './GitPanel.svelte';

  interface SidebarTab {
    id: SidebarSection;
    icon: string;
    title: string;
  }

  const tabs: SidebarTab[] = [
    { id: 'files', icon: '📁', title: 'Explorer' },
    { id: 'git', icon: '🔀', title: 'Source Control' },
    { id: 'search', icon: '🔍', title: 'Search' },
  ];

  function setSection(section: SidebarSection) {
    layoutStore.setSidebarSection(section);
  }
</script>

<div class="sidebar-container">
  <!-- Activity bar -->
  <div class="activity-bar">
    {#each tabs as tab}
      <button
        class="activity-item"
        class:active={$sidebar.activeSection === tab.id}
        onclick={() => setSection(tab.id)}
        title={tab.title}
      >
        <span class="icon">{tab.icon}</span>
      </button>
    {/each}
  </div>

  <!-- Sidebar content -->
  <div class="sidebar-content">
    <div class="sidebar-header">
      <span class="sidebar-title">
        {tabs.find((t) => t.id === $sidebar.activeSection)?.title ?? 'Explorer'}
      </span>
    </div>

    <div class="sidebar-body">
      {#if $sidebar.activeSection === 'files'}
        <FileTree />
      {:else if $sidebar.activeSection === 'git'}
        <GitPanel />
      {:else if $sidebar.activeSection === 'search'}
        <div class="placeholder">Search (coming soon)</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .sidebar-container {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .activity-bar {
    display: flex;
    flex-direction: column;
    width: 48px;
    background-color: var(--activity-bg, #333333);
    flex-shrink: 0;
  }

  .activity-item {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    background: none;
    border: none;
    cursor: pointer;
    opacity: 0.6;
    transition: opacity 0.15s;
    border-left: 2px solid transparent;
  }

  .activity-item:hover {
    opacity: 1;
  }

  .activity-item.active {
    opacity: 1;
    border-left-color: var(--focus-border, #007acc);
    background-color: var(--sidebar-bg, #252526);
  }

  .activity-item .icon {
    font-size: 20px;
  }

  .sidebar-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    height: 35px;
    padding: 0 16px;
    border-bottom: 1px solid var(--panel-border, #3c3c3c);
    flex-shrink: 0;
  }

  .sidebar-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--sidebar-header-fg, #bbbbbb);
  }

  .sidebar-body {
    flex: 1;
    overflow: auto;
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
