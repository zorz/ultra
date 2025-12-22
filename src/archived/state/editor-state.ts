/**
 * Editor State Manager
 *
 * Centralized state management for the Ultra editor.
 * Provides a single source of truth for editor state with change notifications.
 *
 * This replaces the scattered state that was previously spread across
 * App, Pane, Document, and various managers.
 *
 * @example
 * // Subscribe to active document changes
 * const unsubscribe = editorState.on('activeDocumentChange', ({ id }) => {
 *   console.log('Active document changed to:', id);
 * });
 *
 * // Update state
 * editorState.setActiveDocument('doc-1');
 *
 * // Clean up
 * unsubscribe();
 */

import { EventEmitter, type Unsubscribe } from '../core/event-emitter.ts';
import type { Document } from '../core/document.ts';

/**
 * State for a single document
 */
export interface DocumentState {
  /** The document instance */
  document: Document;
  /** ID of the pane containing this document */
  paneId: string;
  /** Current scroll position (line) */
  scrollTop: number;
  /** Current horizontal scroll position (column) */
  scrollLeft: number;
  /** Lines that are currently folded */
  foldedRegions: number[];
}

/**
 * State for the pane layout
 */
export interface PaneLayoutState {
  /** Layout type */
  layout: 'single' | 'split-horizontal' | 'split-vertical';
  /** ID of the active pane */
  activePaneId: string;
  /** Pane IDs in order */
  paneIds: string[];
  /** Split ratios (for split layouts) */
  splitRatios?: number[];
}

/**
 * UI visibility states
 */
export interface UIState {
  /** Whether the sidebar (file tree) is visible */
  sidebarVisible: boolean;
  /** Width of the sidebar in characters */
  sidebarWidth: number;
  /** Whether the terminal panel is visible */
  terminalVisible: boolean;
  /** Height of the terminal in lines */
  terminalHeight: number;
  /** Whether the git panel is visible */
  gitPanelVisible: boolean;
  /** Width of the git panel */
  gitPanelWidth: number;
  /** ID of currently active dialog, if any */
  activeDialog: string | null;
  /** Active sidebar panel ('files' | 'git' | 'search') */
  activeSidebarPanel: 'files' | 'git' | 'search';
}

/**
 * Complete editor state
 */
export interface EditorState {
  /** Map of document ID to document state */
  documents: Map<string, DocumentState>;
  /** ID of the active document, if any */
  activeDocumentId: string | null;
  /** Pane layout configuration */
  paneLayout: PaneLayoutState;
  /** UI visibility states */
  ui: UIState;
  /** Whether the editor is in read-only mode */
  readOnly: boolean;
  /** Current workspace root path */
  workspaceRoot: string | null;
}

/**
 * Events emitted by the state manager
 */
type EditorStateEvents = {
  /** Fired when a document is added */
  'documentAdd': { id: string; document: Document };
  /** Fired when a document is removed */
  'documentRemove': { id: string };
  /** Fired when a document's state changes */
  'documentChange': { id: string; changes: Partial<DocumentState> };
  /** Fired when the active document changes */
  'activeDocumentChange': { id: string | null; previousId: string | null };
  /** Fired when the pane layout changes */
  'paneLayoutChange': { layout: PaneLayoutState };
  /** Fired when a UI state property changes */
  'uiChange': { key: keyof UIState; value: unknown; previousValue: unknown };
  /** Fired when workspace root changes */
  'workspaceChange': { root: string | null };
  /** Fired when any state changes (for general subscribers) */
  'stateChange': { type: string; payload: unknown };
} & Record<string, unknown>;

/**
 * Default UI state
 */
const DEFAULT_UI_STATE: UIState = {
  sidebarVisible: true,
  sidebarWidth: 30,
  terminalVisible: false,
  terminalHeight: 10,
  gitPanelVisible: false,
  gitPanelWidth: 30,
  activeDialog: null,
  activeSidebarPanel: 'files',
};

/**
 * Default pane layout
 */
const DEFAULT_PANE_LAYOUT: PaneLayoutState = {
  layout: 'single',
  activePaneId: 'pane-1',
  paneIds: ['pane-1'],
};

/**
 * Editor State Manager
 *
 * Centralized state management with event-based change notifications.
 */
export class EditorStateManager extends EventEmitter<EditorStateEvents> {
  private state: EditorState;

  constructor() {
    super();
    this.state = {
      documents: new Map(),
      activeDocumentId: null,
      paneLayout: { ...DEFAULT_PANE_LAYOUT },
      ui: { ...DEFAULT_UI_STATE },
      readOnly: false,
      workspaceRoot: null,
    };
  }

  // ==================== Document State ====================

  /**
   * Add a document to the state
   */
  addDocument(id: string, document: Document, paneId: string): void {
    const docState: DocumentState = {
      document,
      paneId,
      scrollTop: 0,
      scrollLeft: 0,
      foldedRegions: [],
    };
    this.state.documents.set(id, docState);
    this.emit('documentAdd', { id, document });
    this.emit('stateChange', { type: 'documentAdd', payload: { id, document } });
  }

  /**
   * Remove a document from the state
   */
  removeDocument(id: string): void {
    if (this.state.documents.has(id)) {
      this.state.documents.delete(id);
      this.emit('documentRemove', { id });
      this.emit('stateChange', { type: 'documentRemove', payload: { id } });

      // If this was the active document, clear it
      if (this.state.activeDocumentId === id) {
        this.setActiveDocument(null);
      }
    }
  }

  /**
   * Get document state by ID
   */
  getDocument(id: string): DocumentState | undefined {
    return this.state.documents.get(id);
  }

  /**
   * Get all document states
   */
  getAllDocuments(): Map<string, DocumentState> {
    return new Map(this.state.documents);
  }

  /**
   * Update document state
   */
  updateDocument(id: string, changes: Partial<DocumentState>): void {
    const docState = this.state.documents.get(id);
    if (docState) {
      Object.assign(docState, changes);
      this.emit('documentChange', { id, changes });
      this.emit('stateChange', { type: 'documentChange', payload: { id, changes } });
    }
  }

  /**
   * Get the active document state
   */
  getActiveDocument(): DocumentState | undefined {
    if (this.state.activeDocumentId) {
      return this.state.documents.get(this.state.activeDocumentId);
    }
    return undefined;
  }

  /**
   * Get the active document ID
   */
  getActiveDocumentId(): string | null {
    return this.state.activeDocumentId;
  }

  /**
   * Set the active document
   */
  setActiveDocument(id: string | null): void {
    const previousId = this.state.activeDocumentId;
    if (previousId !== id) {
      this.state.activeDocumentId = id;
      this.emit('activeDocumentChange', { id, previousId });
      this.emit('stateChange', { type: 'activeDocumentChange', payload: { id, previousId } });
    }
  }

  // ==================== Pane Layout State ====================

  /**
   * Get current pane layout
   */
  getPaneLayout(): PaneLayoutState {
    return { ...this.state.paneLayout };
  }

  /**
   * Update pane layout
   */
  setPaneLayout(layout: Partial<PaneLayoutState>): void {
    this.state.paneLayout = { ...this.state.paneLayout, ...layout };
    this.emit('paneLayoutChange', { layout: this.state.paneLayout });
    this.emit('stateChange', { type: 'paneLayoutChange', payload: { layout: this.state.paneLayout } });
  }

  /**
   * Set the active pane
   */
  setActivePane(paneId: string): void {
    if (this.state.paneLayout.activePaneId !== paneId) {
      this.state.paneLayout.activePaneId = paneId;
      this.emit('paneLayoutChange', { layout: this.state.paneLayout });
      this.emit('stateChange', { type: 'paneLayoutChange', payload: { layout: this.state.paneLayout } });
    }
  }

  /**
   * Add a pane
   */
  addPane(paneId: string): void {
    if (!this.state.paneLayout.paneIds.includes(paneId)) {
      this.state.paneLayout.paneIds.push(paneId);
      this.emit('paneLayoutChange', { layout: this.state.paneLayout });
      this.emit('stateChange', { type: 'paneLayoutChange', payload: { layout: this.state.paneLayout } });
    }
  }

  /**
   * Remove a pane
   */
  removePane(paneId: string): void {
    const index = this.state.paneLayout.paneIds.indexOf(paneId);
    if (index !== -1) {
      this.state.paneLayout.paneIds.splice(index, 1);
      this.emit('paneLayoutChange', { layout: this.state.paneLayout });
      this.emit('stateChange', { type: 'paneLayoutChange', payload: { layout: this.state.paneLayout } });
    }
  }

  // ==================== UI State ====================

  /**
   * Get current UI state
   */
  getUIState(): UIState {
    return { ...this.state.ui };
  }

  /**
   * Update a UI state property
   */
  setUI<K extends keyof UIState>(key: K, value: UIState[K]): void {
    const previousValue = this.state.ui[key];
    if (previousValue !== value) {
      this.state.ui[key] = value;
      this.emit('uiChange', { key, value, previousValue });
      this.emit('stateChange', { type: 'uiChange', payload: { key, value, previousValue } });
    }
  }

  /**
   * Toggle sidebar visibility
   */
  toggleSidebar(): void {
    this.setUI('sidebarVisible', !this.state.ui.sidebarVisible);
  }

  /**
   * Toggle terminal visibility
   */
  toggleTerminal(): void {
    this.setUI('terminalVisible', !this.state.ui.terminalVisible);
  }

  /**
   * Toggle git panel visibility
   */
  toggleGitPanel(): void {
    this.setUI('gitPanelVisible', !this.state.ui.gitPanelVisible);
  }

  /**
   * Set active dialog
   */
  setActiveDialog(dialogId: string | null): void {
    this.setUI('activeDialog', dialogId);
  }

  /**
   * Set active sidebar panel
   */
  setActiveSidebarPanel(panel: UIState['activeSidebarPanel']): void {
    this.setUI('activeSidebarPanel', panel);
  }

  // ==================== Workspace State ====================

  /**
   * Get workspace root
   */
  getWorkspaceRoot(): string | null {
    return this.state.workspaceRoot;
  }

  /**
   * Set workspace root
   */
  setWorkspaceRoot(root: string | null): void {
    if (this.state.workspaceRoot !== root) {
      this.state.workspaceRoot = root;
      this.emit('workspaceChange', { root });
      this.emit('stateChange', { type: 'workspaceChange', payload: { root } });
    }
  }

  // ==================== Read-Only Mode ====================

  /**
   * Check if in read-only mode
   */
  isReadOnly(): boolean {
    return this.state.readOnly;
  }

  /**
   * Set read-only mode
   */
  setReadOnly(readOnly: boolean): void {
    this.state.readOnly = readOnly;
    this.emit('stateChange', { type: 'readOnlyChange', payload: { readOnly } });
  }

  // ==================== State Snapshot ====================

  /**
   * Get a snapshot of the current state (for debugging/serialization)
   */
  getSnapshot(): Readonly<EditorState> {
    return {
      documents: new Map(this.state.documents),
      activeDocumentId: this.state.activeDocumentId,
      paneLayout: { ...this.state.paneLayout },
      ui: { ...this.state.ui },
      readOnly: this.state.readOnly,
      workspaceRoot: this.state.workspaceRoot,
    };
  }

  /**
   * Reset state to defaults
   */
  reset(): void {
    this.state = {
      documents: new Map(),
      activeDocumentId: null,
      paneLayout: { ...DEFAULT_PANE_LAYOUT },
      ui: { ...DEFAULT_UI_STATE },
      readOnly: false,
      workspaceRoot: null,
    };
    this.emit('stateChange', { type: 'reset', payload: null });
  }
}

/**
 * Singleton instance of the editor state manager
 */
export const editorState = new EditorStateManager();

export default editorState;
