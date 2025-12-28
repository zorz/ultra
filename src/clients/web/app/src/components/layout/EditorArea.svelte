<script lang="ts">
  import { panes, activePane, layoutStore } from '../../lib/stores/layout';
  import Editor from '../editor/Editor.svelte';

  function handleTabClick(paneId: string) {
    layoutStore.setActivePane(paneId);
  }

  function handleTabClose(event: Event, paneId: string) {
    event.stopPropagation();
    layoutStore.removePane(paneId);
  }
</script>

<div class="editor-area">
  <!-- Tab bar -->
  {#if $panes.length > 0}
    <div class="tab-bar">
      {#each $panes as pane}
        <div
          class="tab"
          class:active={pane.isActive}
          onclick={() => handleTabClick(pane.id)}
          onkeydown={(e) => e.key === 'Enter' && handleTabClick(pane.id)}
          role="tab"
          tabindex="0"
          aria-selected={pane.isActive}
        >
          <span class="tab-icon">📄</span>
          <span class="tab-title">{pane.title}</span>
          <button
            class="tab-close"
            onclick={(e) => handleTabClose(e, pane.id)}
            aria-label="Close tab"
          >
            ×
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Editor content -->
  <div class="editor-content">
    {#if $activePane}
      {#if $activePane.type === 'editor' && $activePane.documentId}
        <Editor documentId={$activePane.documentId} />
      {:else}
        <div class="placeholder">
          <span>Unknown pane type</span>
        </div>
      {/if}
    {:else}
      <div class="placeholder">
        <div class="welcome">
          <h2>Ultra Editor</h2>
          <p>Open a file from the sidebar to get started</p>
          <p class="shortcuts">
            <kbd>Ctrl+P</kbd> Quick Open<br />
            <kbd>Ctrl+Shift+P</kbd> Command Palette<br />
            <kbd>Ctrl+B</kbd> Toggle Sidebar
          </p>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .editor-area {
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: var(--editor-bg, #1e1e1e);
  }

  .tab-bar {
    display: flex;
    height: 35px;
    background-color: var(--tabs-container-bg, #252526);
    overflow-x: auto;
    flex-shrink: 0;
  }

  .tab-bar::-webkit-scrollbar {
    height: 3px;
  }

  .tab-bar::-webkit-scrollbar-thumb {
    background-color: var(--scrollbar-bg, #424242);
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    min-width: 120px;
    max-width: 200px;
    background-color: var(--tab-inactive-bg, #2d2d2d);
    color: var(--tab-inactive-fg, #969696);
    border-right: 1px solid var(--tab-border, #252526);
    cursor: pointer;
    flex-shrink: 0;
  }

  .tab:hover {
    background-color: var(--tab-active-bg, #1e1e1e);
  }

  .tab.active {
    background-color: var(--tab-active-bg, #1e1e1e);
    color: var(--tab-active-fg, #ffffff);
  }

  .tab-icon {
    font-size: 14px;
    flex-shrink: 0;
  }

  .tab-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }

  .tab-close {
    display: none;
    width: 18px;
    height: 18px;
    margin-left: auto;
    padding: 0;
    font-size: 16px;
    line-height: 1;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .tab:hover .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .tab-close:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }

  .editor-content {
    flex: 1;
    overflow: hidden;
  }

  .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--editor-fg, #d4d4d4);
  }

  .welcome {
    text-align: center;
    opacity: 0.6;
  }

  .welcome h2 {
    margin: 0 0 8px;
    font-size: 20px;
    font-weight: 400;
  }

  .welcome p {
    margin: 0 0 16px;
    font-size: 13px;
  }

  .shortcuts {
    font-size: 12px;
    line-height: 1.8;
  }

  .shortcuts kbd {
    display: inline-block;
    padding: 2px 6px;
    margin-right: 8px;
    font-family: monospace;
    font-size: 11px;
    background-color: var(--input-bg, #3c3c3c);
    border: 1px solid var(--input-border, #555);
    border-radius: 3px;
  }
</style>
