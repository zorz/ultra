<script lang="ts">
  import { filesStore, selectedFile, type FileEntry } from '../../lib/stores/files';
  import { documentsStore } from '../../lib/stores/documents';
  import { layoutStore } from '../../lib/stores/layout';

  export let entries: FileEntry[] | null = null;
  export let depth: number = 0;

  let tree: FileEntry[] = [];

  // Subscribe to file tree updates (only at root level)
  if (depth === 0) {
    filesStore.subscribe((value) => {
      tree = value;
    });
  }

  // Use entries prop if provided (for recursive calls), otherwise use tree
  $: displayEntries = entries ?? tree;

  function handleClick(entry: FileEntry) {
    filesStore.select(entry.path);

    // Single click on directory toggles it
    if (entry.type === 'directory') {
      filesStore.toggleDirectory(entry.path);
    }
  }

  async function handleDoubleClick(entry: FileEntry) {
    if (entry.type === 'file') {
      await openFile(entry);
    }
  }

  async function openFile(entry: FileEntry) {
    try {
      // Check if already open
      const existingPane = layoutStore.findPaneByDocument(entry.uri);
      if (existingPane) {
        layoutStore.setActivePane(existingPane.id);
        return;
      }

      // Open document
      const documentId = await documentsStore.open(entry.uri);

      // Add pane
      layoutStore.addPane({
        type: 'editor',
        documentId,
        title: entry.name,
      });
    } catch (error) {
      console.error('Failed to open file:', error);
    }
  }

  function getIndent(d: number): string {
    return `${d * 16 + 8}px`;
  }
</script>

<div class="file-tree" class:root={depth === 0}>
  {#each displayEntries as entry}
    <div
      class="tree-item"
      class:selected={entry.path === $selectedFile?.path}
      class:directory={entry.type === 'directory'}
      style="padding-left: {getIndent(depth)}"
      on:click={() => handleClick(entry)}
      on:dblclick={() => handleDoubleClick(entry)}
      on:keydown={(e) => e.key === 'Enter' && handleDoubleClick(entry)}
      role="treeitem"
      tabindex="0"
      aria-expanded={entry.type === 'directory' ? entry.isExpanded : undefined}
      aria-selected={entry.path === $selectedFile?.path}
    >
      <span class="icon">
        {#if entry.type === 'directory'}
          {entry.isExpanded ? '📂' : '📁'}
        {:else}
          📄
        {/if}
      </span>
      <span class="name">{entry.name}</span>
      {#if entry.isLoading}
        <span class="loading">...</span>
      {/if}
    </div>

    {#if entry.type === 'directory' && entry.isExpanded && entry.children}
      <svelte:self entries={entry.children} depth={depth + 1} />
    {/if}
  {/each}
</div>

<style>
  .file-tree.root {
    padding: 4px 0;
  }

  .tree-item {
    display: flex;
    align-items: center;
    height: 22px;
    padding-right: 8px;
    cursor: pointer;
    font-size: 13px;
    color: var(--sidebar-fg, #cccccc);
    white-space: nowrap;
    overflow: hidden;
  }

  .tree-item:hover {
    background-color: var(--list-hover-bg, #2a2d2e);
  }

  .tree-item.selected {
    background-color: var(--list-active-bg, #094771);
    color: var(--list-active-fg, #ffffff);
  }

  .tree-item:focus {
    outline: 1px solid var(--focus-border, #007acc);
    outline-offset: -1px;
  }

  .icon {
    margin-right: 6px;
    font-size: 14px;
    flex-shrink: 0;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .loading {
    margin-left: auto;
    opacity: 0.5;
    font-size: 11px;
  }
</style>
