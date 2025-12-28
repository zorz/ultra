/**
 * Documents Store
 *
 * Manages open documents and their state.
 */

import { writable, derived, get } from 'svelte/store';
import { ecpClient } from '../ecp/client';

export interface Position {
  line: number;
  column: number;
}

export interface Cursor {
  position: Position;
  anchor?: Position;
}

export interface DocumentState {
  id: string;
  uri: string;
  content: string;
  version: number;
  isDirty: boolean;
  language: string;
  cursors: Cursor[];
}

function createDocumentsStore() {
  const documents = writable<Map<string, DocumentState>>(new Map());
  const activeDocumentId = writable<string | null>(null);

  // Subscribe to document notifications from server
  ecpClient.subscribe('document/didChange', (params: unknown) => {
    const { documentId, version } = params as { documentId: string; version: number };
    documents.update((docs) => {
      const doc = docs.get(documentId);
      if (doc) {
        doc.version = version;
        doc.isDirty = true;
      }
      return docs;
    });
  });

  ecpClient.subscribe('document/didSave', (params: unknown) => {
    const { documentId } = params as { documentId: string };
    documents.update((docs) => {
      const doc = docs.get(documentId);
      if (doc) {
        doc.isDirty = false;
      }
      return docs;
    });
  });

  return {
    subscribe: documents.subscribe,
    activeDocumentId,

    /**
     * Open a document.
     */
    async open(uri: string): Promise<string> {
      const result = await ecpClient.request<{
        documentId: string;
        content: string;
        version: number;
        language: string;
      }>('document/open', { uri });

      const docState: DocumentState = {
        id: result.documentId,
        uri,
        content: result.content,
        version: result.version,
        isDirty: false,
        language: result.language,
        cursors: [{ position: { line: 0, column: 0 } }],
      };

      documents.update((docs) => {
        docs.set(result.documentId, docState);
        return docs;
      });

      activeDocumentId.set(result.documentId);
      return result.documentId;
    },

    /**
     * Close a document.
     */
    async close(documentId: string): Promise<void> {
      await ecpClient.request('document/close', { documentId });

      documents.update((docs) => {
        docs.delete(documentId);
        return docs;
      });

      // If this was the active document, clear it
      if (get(activeDocumentId) === documentId) {
        const docs = get(documents);
        const remaining = Array.from(docs.keys());
        activeDocumentId.set(remaining[0] ?? null);
      }
    },

    /**
     * Get document content.
     */
    async getContent(documentId: string): Promise<string> {
      const result = await ecpClient.request<{ content: string }>('document/content', { documentId });
      return result.content;
    },

    /**
     * Insert text at a position.
     */
    async insert(documentId: string, position: Position, text: string): Promise<void> {
      await ecpClient.request('document/insert', { documentId, position, text });
    },

    /**
     * Delete text in a range.
     */
    async delete(documentId: string, start: Position, end: Position): Promise<void> {
      await ecpClient.request('document/delete', { documentId, start, end });
    },

    /**
     * Save a document.
     */
    async save(documentId: string): Promise<void> {
      await ecpClient.request('document/save', { documentId });
    },

    /**
     * Undo last change.
     */
    async undo(documentId: string): Promise<void> {
      await ecpClient.request('document/undo', { documentId });
    },

    /**
     * Redo last undone change.
     */
    async redo(documentId: string): Promise<void> {
      await ecpClient.request('document/redo', { documentId });
    },

    /**
     * Set the active document.
     */
    setActive(documentId: string | null): void {
      activeDocumentId.set(documentId);
    },

    /**
     * Get a document by ID.
     */
    get(documentId: string): DocumentState | undefined {
      return get(documents).get(documentId);
    },

    /**
     * Get all open documents.
     */
    getAll(): DocumentState[] {
      return Array.from(get(documents).values());
    },
  };
}

export const documentsStore = createDocumentsStore();

/**
 * Derived store for the active document.
 */
export const activeDocument = derived(
  [documentsStore, documentsStore.activeDocumentId],
  ([$documents, $activeId]) => ($activeId ? $documents.get($activeId) ?? null : null)
);

/**
 * Derived store for list of open documents.
 */
export const openDocuments = derived(documentsStore, ($documents) => Array.from($documents.values()));

export default documentsStore;
