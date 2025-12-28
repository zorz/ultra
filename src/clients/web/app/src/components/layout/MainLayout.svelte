<script lang="ts">
  import { layoutStore, sidebar, panel } from '../../lib/stores/layout';
  import Sidebar from '../sidebar/Sidebar.svelte';
  import EditorArea from './EditorArea.svelte';
  import Panel from './Panel.svelte';
  import StatusBar from './StatusBar.svelte';
  import CommandPalette from '../overlays/CommandPalette.svelte';

  let showCommandPalette = false;
  let sidebarResizing = false;
  let panelResizing = false;

  // Handle keyboard shortcuts
  function handleKeydown(event: KeyboardEvent) {
    // Command palette: Ctrl+Shift+P or Cmd+Shift+P
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'P') {
      event.preventDefault();
      showCommandPalette = true;
      return;
    }

    // Quick open: Ctrl+P or Cmd+P
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === 'p') {
      event.preventDefault();
      showCommandPalette = true;
      return;
    }

    // Toggle sidebar: Ctrl+B or Cmd+B
    if ((event.ctrlKey || event.metaKey) && event.key === 'b') {
      event.preventDefault();
      layoutStore.toggleSidebar();
      return;
    }

    // Toggle panel: Ctrl+J or Cmd+J
    if ((event.ctrlKey || event.metaKey) && event.key === 'j') {
      event.preventDefault();
      layoutStore.togglePanel();
      return;
    }
  }

  function handleSidebarResize(event: MouseEvent) {
    if (!sidebarResizing) return;
    layoutStore.setSidebarWidth(event.clientX);
  }

  function handlePanelResize(event: MouseEvent) {
    if (!panelResizing) return;
    const height = window.innerHeight - event.clientY;
    layoutStore.setPanelHeight(height);
  }

  function stopResize() {
    sidebarResizing = false;
    panelResizing = false;
  }
</script>

<svelte:window
  onkeydown={handleKeydown}
  onmousemove={(e) => { handleSidebarResize(e); handlePanelResize(e); }}
  onmouseup={stopResize}
/>

<div class="layout">
  <!-- Sidebar -->
  {#if $sidebar.visible}
    <aside class="sidebar" style="width: {$sidebar.width}px">
      <Sidebar />
      <div
        class="resize-handle vertical"
        onmousedown={() => (sidebarResizing = true)}
        role="separator"
        aria-orientation="vertical"
        tabindex="-1"
      ></div>
    </aside>
  {/if}

  <!-- Main content area -->
  <div class="main-content">
    <!-- Editor area -->
    <div class="editor-area" style="flex: 1">
      <EditorArea />
    </div>

    <!-- Panel (terminal, etc) -->
    {#if $panel.visible}
      <div
        class="resize-handle horizontal"
        onmousedown={() => (panelResizing = true)}
        role="separator"
        aria-orientation="horizontal"
        tabindex="-1"
      ></div>
      <div class="panel" style="height: {$panel.height}px">
        <Panel />
      </div>
    {/if}
  </div>
</div>

<!-- Status bar -->
<StatusBar />

<!-- Overlays -->
{#if showCommandPalette}
  <CommandPalette onclose={() => (showCommandPalette = false)} />
{/if}

<style>
  .layout {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .sidebar {
    display: flex;
    position: relative;
    background-color: var(--sidebar-bg, #252526);
    border-right: 1px solid var(--panel-border, #3c3c3c);
    flex-shrink: 0;
  }

  .main-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .editor-area {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .panel {
    background-color: var(--panel-bg, #1e1e1e);
    border-top: 1px solid var(--panel-border, #3c3c3c);
    flex-shrink: 0;
    overflow: hidden;
  }

  .resize-handle {
    position: absolute;
    background: transparent;
    z-index: 10;
  }

  .resize-handle.vertical {
    right: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    cursor: col-resize;
  }

  .resize-handle.horizontal {
    position: relative;
    height: 4px;
    cursor: row-resize;
    margin: -2px 0;
  }

  .resize-handle:hover {
    background-color: var(--focus-border, #007acc);
  }
</style>
