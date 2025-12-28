/**
 * Files Store
 *
 * Manages file tree state and file operations.
 */

import { writable, derived, get } from 'svelte/store';
import { ecpClient } from '../ecp/client';

export interface FileEntry {
  name: string;
  path: string;
  uri: string;
  type: 'file' | 'directory';
  children?: FileEntry[];
  isExpanded?: boolean;
  isLoading?: boolean;
}

export interface FileStat {
  type: 'file' | 'directory' | 'symlink';
  size: number;
  mtime: number;
  isReadOnly: boolean;
}

function createFilesStore() {
  const rootPath = writable<string>('');
  const fileTree = writable<FileEntry[]>([]);
  const selectedPath = writable<string | null>(null);

  // Subscribe to file change notifications
  ecpClient.subscribe('file/didChange', (params: unknown) => {
    const { uri, type } = params as { uri: string; type: 'created' | 'changed' | 'deleted' };

    // Refresh the parent directory
    const path = uriToPath(uri);
    const parentPath = getParentPath(path);
    if (parentPath) {
      refreshDirectory(parentPath);
    }
  });

  async function refreshDirectory(dirPath: string): Promise<void> {
    try {
      const uri = pathToUri(dirPath);
      const result = await ecpClient.request<{ entries: Array<{ name: string; type: 'file' | 'directory' }> }>(
        'file/readDir',
        { uri }
      );

      fileTree.update((tree) => {
        updateTreeEntry(tree, dirPath, (entry) => {
          entry.children = result.entries.map((e) => ({
            name: e.name,
            path: `${dirPath}/${e.name}`,
            uri: pathToUri(`${dirPath}/${e.name}`),
            type: e.type,
            children: e.type === 'directory' ? undefined : undefined,
            isExpanded: false,
          }));
          entry.isLoading = false;
          return entry;
        });
        return tree;
      });
    } catch (error) {
      console.error(`Failed to refresh directory ${dirPath}:`, error);
    }
  }

  function updateTreeEntry(
    tree: FileEntry[],
    path: string,
    updater: (entry: FileEntry) => FileEntry
  ): boolean {
    for (let i = 0; i < tree.length; i++) {
      if (tree[i].path === path) {
        tree[i] = updater(tree[i]);
        return true;
      }
      if (tree[i].children) {
        if (updateTreeEntry(tree[i].children!, path, updater)) {
          return true;
        }
      }
    }
    return false;
  }

  return {
    subscribe: fileTree.subscribe,
    rootPath,
    selectedPath,

    /**
     * Initialize the file tree with a root directory.
     */
    async init(root: string): Promise<void> {
      rootPath.set(root);
      await this.loadDirectory(root);
    },

    /**
     * Load a directory's contents.
     */
    async loadDirectory(dirPath: string): Promise<FileEntry[]> {
      const uri = pathToUri(dirPath);

      // Mark as loading
      fileTree.update((tree) => {
        if (dirPath === get(rootPath)) {
          // Root directory
          return [
            {
              name: getBasename(dirPath),
              path: dirPath,
              uri,
              type: 'directory',
              isExpanded: true,
              isLoading: true,
            },
          ];
        }
        updateTreeEntry(tree, dirPath, (entry) => {
          entry.isLoading = true;
          return entry;
        });
        return tree;
      });

      try {
        const result = await ecpClient.request<{
          entries: Array<{ name: string; type: 'file' | 'directory' }>;
        }>('file/readDir', { uri });

        const children: FileEntry[] = result.entries
          .sort((a, b) => {
            // Directories first, then alphabetically
            if (a.type !== b.type) {
              return a.type === 'directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
          })
          .map((entry) => ({
            name: entry.name,
            path: `${dirPath}/${entry.name}`,
            uri: pathToUri(`${dirPath}/${entry.name}`),
            type: entry.type,
            isExpanded: false,
          }));

        // Update tree
        fileTree.update((tree) => {
          if (dirPath === get(rootPath)) {
            if (tree.length > 0) {
              tree[0].children = children;
              tree[0].isLoading = false;
              tree[0].isExpanded = true;
            }
          } else {
            updateTreeEntry(tree, dirPath, (entry) => {
              entry.children = children;
              entry.isLoading = false;
              entry.isExpanded = true;
              return entry;
            });
          }
          return tree;
        });

        return children;
      } catch (error) {
        console.error(`Failed to load directory ${dirPath}:`, error);

        // Clear loading state
        fileTree.update((tree) => {
          updateTreeEntry(tree, dirPath, (entry) => {
            entry.isLoading = false;
            return entry;
          });
          return tree;
        });

        return [];
      }
    },

    /**
     * Toggle a directory's expanded state.
     */
    async toggleDirectory(dirPath: string): Promise<void> {
      const tree = get(fileTree);
      let entry: FileEntry | undefined;

      function findEntry(entries: FileEntry[]): FileEntry | undefined {
        for (const e of entries) {
          if (e.path === dirPath) return e;
          if (e.children) {
            const found = findEntry(e.children);
            if (found) return found;
          }
        }
        return undefined;
      }

      entry = findEntry(tree);

      if (!entry || entry.type !== 'directory') return;

      if (entry.isExpanded) {
        // Collapse
        fileTree.update((t) => {
          updateTreeEntry(t, dirPath, (e) => {
            e.isExpanded = false;
            return e;
          });
          return t;
        });
      } else {
        // Expand - load if not loaded
        if (!entry.children) {
          await this.loadDirectory(dirPath);
        } else {
          fileTree.update((t) => {
            updateTreeEntry(t, dirPath, (e) => {
              e.isExpanded = true;
              return e;
            });
            return t;
          });
        }
      }
    },

    /**
     * Select a file or directory.
     */
    select(path: string): void {
      selectedPath.set(path);
    },

    /**
     * Read file content.
     */
    async readFile(path: string): Promise<string> {
      const uri = pathToUri(path);
      const result = await ecpClient.request<{ content: string }>('file/read', { uri });
      return result.content;
    },

    /**
     * Write file content.
     */
    async writeFile(path: string, content: string): Promise<void> {
      const uri = pathToUri(path);
      await ecpClient.request('file/write', { uri, content });
    },

    /**
     * Create a new file.
     */
    async createFile(path: string, content: string = ''): Promise<void> {
      const uri = pathToUri(path);
      await ecpClient.request('file/write', { uri, content });
    },

    /**
     * Create a new directory.
     */
    async createDirectory(path: string): Promise<void> {
      const uri = pathToUri(path);
      await ecpClient.request('file/createDir', { uri });
    },

    /**
     * Delete a file or directory.
     */
    async delete(path: string): Promise<void> {
      const uri = pathToUri(path);
      const stat = await this.stat(path);

      if (stat.type === 'directory') {
        await ecpClient.request('file/deleteDir', { uri, recursive: true });
      } else {
        await ecpClient.request('file/delete', { uri });
      }
    },

    /**
     * Rename a file or directory.
     */
    async rename(oldPath: string, newPath: string): Promise<void> {
      const oldUri = pathToUri(oldPath);
      const newUri = pathToUri(newPath);
      await ecpClient.request('file/rename', { oldUri, newUri });
    },

    /**
     * Get file stats.
     */
    async stat(path: string): Promise<FileStat> {
      const uri = pathToUri(path);
      const result = await ecpClient.request<FileStat>('file/stat', { uri });
      return result;
    },

    /**
     * Check if a file exists.
     */
    async exists(path: string): Promise<boolean> {
      const uri = pathToUri(path);
      const result = await ecpClient.request<{ exists: boolean }>('file/exists', { uri });
      return result.exists;
    },
  };
}

// Helper functions
function pathToUri(path: string): string {
  return `file://${path}`;
}

function uriToPath(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

function getBasename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

function getParentPath(path: string): string | null {
  const parts = path.split('/');
  if (parts.length <= 1) return null;
  parts.pop();
  return parts.join('/');
}

export const filesStore = createFilesStore();

/**
 * Derived store for the selected file entry.
 */
export const selectedFile = derived([filesStore, filesStore.selectedPath], ([$tree, $selectedPath]) => {
  if (!$selectedPath) return null;

  function findEntry(entries: FileEntry[]): FileEntry | null {
    for (const entry of entries) {
      if (entry.path === $selectedPath) return entry;
      if (entry.children) {
        const found = findEntry(entry.children);
        if (found) return found;
      }
    }
    return null;
  }

  return findEntry($tree);
});

export default filesStore;
