<script lang="ts">
  import { filesStore, selectedFile, type FileEntry } from '../../lib/stores/files';
  import { documentsStore } from '../../lib/stores/documents';
  import { layoutStore } from '../../lib/stores/layout';

  let tree = $state<FileEntry[]>([]);

  // Subscribe to file tree updates
  filesStore.subscribe((value) => {
    tree = value;
  });

  async function handleClick(entry: FileEntry) {
    filesStore.select(entry.path);

    if (entry.type === 'directory') {
      await filesStore.toggleDirectory(entry.path);
    } else {
      // Open file in editor
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

  function getIndent(depth: number): string {
    return `${depth * 16 + 8}px`;
  }
</script>

<div class="file-tree">
  {#each tree as entry}
    <TreeNode {entry} depth={0} onselect={handleClick} selectedPath={$selectedFile?.path} />
  {/each}
</div>

{#snippet TreeNode(props: { entry: FileEntry; depth: number; onselect: (e: FileEntry) => void; selectedPath: string | undefined })}
  {@const { entry, depth, onselect, selectedPath } = props}
  <div
    class="tree-item"
    class:selected={entry.path === selectedPath}
    class:directory={entry.type === 'directory'}
    style="padding-left: {getIndent(depth)}"
    onclick={() => onselect(entry)}
    onkeydown={(e) => e.key === 'Enter' && onselect(entry)}
    role="treeitem"
    tabindex="0"
    aria-expanded={entry.type === 'directory' ? entry.isExpanded : undefined}
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
    {#each entry.children as child}
      {@render TreeNode({ entry: child, depth: depth + 1, onselect, selectedPath })}
    {/each}
  {/if}
{/snippet}

<style>
  .file-tree {
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
