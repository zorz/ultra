<script lang="ts">
  import { onMount } from 'svelte';
  import { filesStore } from '../../lib/stores/files';
  import { documentsStore } from '../../lib/stores/documents';
  import { layoutStore } from '../../lib/stores/layout';
  import { ecpClient } from '../../lib/ecp/client';

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();

  interface CommandItem {
    id: string;
    label: string;
    description?: string;
    category?: string;
    action: () => void | Promise<void>;
  }

  interface FileItem {
    path: string;
    name: string;
    uri: string;
  }

  let inputElement: HTMLInputElement;
  let query = $state('');
  let selectedIndex = $state(0);
  let mode = $state<'commands' | 'files'>('files');
  let items = $state<(CommandItem | FileItem)[]>([]);
  let isLoading = $state(false);

  // Commands list
  const commands: CommandItem[] = [
    {
      id: 'file.new',
      label: 'New File',
      category: 'File',
      action: () => {
        // TODO: Implement new file dialog
        console.log('New file');
      },
    },
    {
      id: 'file.save',
      label: 'Save',
      category: 'File',
      action: async () => {
        const activeDoc = documentsStore.activeDocumentId;
        if (activeDoc) {
          await documentsStore.save(activeDoc.toString());
        }
      },
    },
    {
      id: 'view.toggleSidebar',
      label: 'Toggle Sidebar',
      category: 'View',
      action: () => layoutStore.toggleSidebar(),
    },
    {
      id: 'view.togglePanel',
      label: 'Toggle Panel',
      category: 'View',
      action: () => layoutStore.togglePanel(),
    },
    {
      id: 'terminal.new',
      label: 'New Terminal',
      category: 'Terminal',
      action: () => layoutStore.setPanelTab('terminal'),
    },
  ];

  onMount(() => {
    inputElement?.focus();

    // Determine initial mode based on query
    if (query.startsWith('>')) {
      mode = 'commands';
    } else {
      mode = 'files';
      searchFiles('');
    }
  });

  function handleInput() {
    selectedIndex = 0;

    if (query.startsWith('>')) {
      mode = 'commands';
      filterCommands(query.slice(1).trim());
    } else {
      mode = 'files';
      searchFiles(query);
    }
  }

  function filterCommands(search: string) {
    const searchLower = search.toLowerCase();
    items = commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(searchLower) ||
        (cmd.category?.toLowerCase().includes(searchLower) ?? false)
    );
  }

  async function searchFiles(search: string) {
    if (!search) {
      items = [];
      return;
    }

    isLoading = true;
    try {
      const result = await ecpClient.request<{ files: Array<{ path: string; name: string }> }>(
        'file/search',
        { pattern: `**/*${search}*`, limit: 20 }
      );

      items = result.files.map((f) => ({
        path: f.path,
        name: f.name,
        uri: `file://${f.path}`,
      }));
    } catch (error) {
      console.error('File search failed:', error);
      items = [];
    } finally {
      isLoading = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        onclose();
        break;

      case 'ArrowDown':
        event.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        break;

      case 'ArrowUp':
        event.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        break;

      case 'Enter':
        event.preventDefault();
        selectItem(selectedIndex);
        break;
    }
  }

  async function selectItem(index: number) {
    const item = items[index];
    if (!item) return;

    if ('action' in item) {
      // Command
      await item.action();
    } else {
      // File
      try {
        const documentId = await documentsStore.open(item.uri);
        layoutStore.addPane({
          type: 'editor',
          documentId,
          title: item.name,
        });
      } catch (error) {
        console.error('Failed to open file:', error);
      }
    }

    onclose();
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      onclose();
    }
  }

  function isCommand(item: CommandItem | FileItem): item is CommandItem {
    return 'action' in item;
  }
</script>

<div
  class="command-palette-backdrop"
  onclick={handleBackdropClick}
  onkeydown={(e) => e.key === 'Escape' && onclose()}
  role="dialog"
  aria-modal="true"
  tabindex="-1"
>
  <div class="command-palette">
    <div class="input-container">
      <input
        type="text"
        class="search-input"
        placeholder={mode === 'commands' ? 'Type a command...' : 'Search files by name...'}
        bind:this={inputElement}
        bind:value={query}
        oninput={handleInput}
        onkeydown={handleKeydown}
      />
      {#if isLoading}
        <span class="loading-indicator">...</span>
      {/if}
    </div>

    <div class="results-list">
      {#if items.length === 0}
        <div class="no-results">
          {#if mode === 'files' && !query}
            Type to search for files
          {:else if mode === 'files'}
            No files found
          {:else}
            No commands found
          {/if}
        </div>
      {:else}
        {#each items as item, index}
          <div
            class="result-item"
            class:selected={index === selectedIndex}
            onclick={() => selectItem(index)}
            onmouseenter={() => (selectedIndex = index)}
            role="option"
            aria-selected={index === selectedIndex}
          >
            {#if isCommand(item)}
              <span class="item-icon">⚡</span>
              <span class="item-label">{item.label}</span>
              {#if item.category}
                <span class="item-category">{item.category}</span>
              {/if}
            {:else}
              <span class="item-icon">📄</span>
              <span class="item-label">{item.name}</span>
              <span class="item-path">{item.path}</span>
            {/if}
          </div>
        {/each}
      {/if}
    </div>

    <div class="hints">
      <span><kbd>↑↓</kbd> Navigate</span>
      <span><kbd>Enter</kbd> Select</span>
      <span><kbd>Esc</kbd> Close</span>
      <span><kbd>{'>'}</kbd> Commands</span>
    </div>
  </div>
</div>

<style>
  .command-palette-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.4);
    display: flex;
    justify-content: center;
    padding-top: 15vh;
    z-index: 1000;
  }

  .command-palette {
    width: 600px;
    max-width: 90vw;
    max-height: 400px;
    background-color: var(--editor-bg, #1e1e1e);
    border: 1px solid var(--panel-border, #454545);
    border-radius: 6px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .input-container {
    display: flex;
    align-items: center;
    padding: 12px;
    border-bottom: 1px solid var(--panel-border, #454545);
  }

  .search-input {
    flex: 1;
    padding: 8px 12px;
    font-size: 14px;
    font-family: inherit;
    background-color: var(--input-bg, #3c3c3c);
    color: var(--input-fg, #cccccc);
    border: 1px solid var(--input-border, #3c3c3c);
    border-radius: 4px;
    outline: none;
  }

  .search-input:focus {
    border-color: var(--focus-border, #007acc);
  }

  .loading-indicator {
    margin-left: 8px;
    color: var(--editor-fg, #cccccc);
    opacity: 0.5;
  }

  .results-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px;
  }

  .no-results {
    padding: 16px;
    text-align: center;
    color: var(--editor-fg, #cccccc);
    opacity: 0.5;
  }

  .result-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
  }

  .result-item:hover,
  .result-item.selected {
    background-color: var(--list-active-bg, #094771);
  }

  .item-icon {
    flex-shrink: 0;
    font-size: 14px;
  }

  .item-label {
    flex-shrink: 0;
    color: var(--editor-fg, #cccccc);
  }

  .item-category,
  .item-path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--editor-fg, #cccccc);
    opacity: 0.5;
    font-size: 12px;
    text-align: right;
  }

  .hints {
    display: flex;
    gap: 16px;
    padding: 8px 12px;
    border-top: 1px solid var(--panel-border, #454545);
    font-size: 11px;
    color: var(--editor-fg, #cccccc);
    opacity: 0.6;
  }

  .hints kbd {
    display: inline-block;
    padding: 1px 4px;
    margin-right: 4px;
    font-family: inherit;
    font-size: 10px;
    background-color: var(--input-bg, #3c3c3c);
    border: 1px solid var(--input-border, #555);
    border-radius: 2px;
  }
</style>
