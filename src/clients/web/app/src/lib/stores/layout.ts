/**
 * Layout Store
 *
 * Manages the application layout state (panes, splits, panels).
 */

import { writable, derived, get } from 'svelte/store';

export type SplitDirection = 'horizontal' | 'vertical';
export type PanelPosition = 'bottom' | 'left' | 'right';
export type SidebarSection = 'files' | 'git' | 'search' | 'extensions';

export interface PaneState {
  id: string;
  type: 'editor' | 'terminal' | 'preview';
  documentId?: string;
  terminalId?: string;
  title: string;
  isActive: boolean;
}

export interface PaneGroupState {
  id: string;
  panes: PaneState[];
  activePane: string | null;
  size: number; // Percentage of parent
}

export interface SplitState {
  id: string;
  direction: SplitDirection;
  children: (SplitState | PaneGroupState)[];
  sizes: number[]; // Percentages
}

export interface LayoutState {
  sidebar: {
    visible: boolean;
    width: number;
    activeSection: SidebarSection;
  };
  panel: {
    visible: boolean;
    height: number;
    position: PanelPosition;
    activeTab: string;
  };
  mainArea: SplitState | PaneGroupState;
  statusBar: {
    visible: boolean;
  };
}

const DEFAULT_LAYOUT: LayoutState = {
  sidebar: {
    visible: true,
    width: 250,
    activeSection: 'files',
  },
  panel: {
    visible: true,
    height: 200,
    position: 'bottom',
    activeTab: 'terminal',
  },
  mainArea: {
    id: 'main-group',
    panes: [],
    activePane: null,
    size: 100,
  },
  statusBar: {
    visible: true,
  },
};

function createLayoutStore() {
  const layout = writable<LayoutState>(structuredClone(DEFAULT_LAYOUT));
  let paneIdCounter = 0;

  return {
    subscribe: layout.subscribe,

    /**
     * Toggle sidebar visibility.
     */
    toggleSidebar(): void {
      layout.update((l) => {
        l.sidebar.visible = !l.sidebar.visible;
        return l;
      });
    },

    /**
     * Set sidebar width.
     */
    setSidebarWidth(width: number): void {
      layout.update((l) => {
        l.sidebar.width = Math.max(150, Math.min(500, width));
        return l;
      });
    },

    /**
     * Set active sidebar section.
     */
    setSidebarSection(section: SidebarSection): void {
      layout.update((l) => {
        l.sidebar.activeSection = section;
        if (!l.sidebar.visible) {
          l.sidebar.visible = true;
        }
        return l;
      });
    },

    /**
     * Toggle panel visibility.
     */
    togglePanel(): void {
      layout.update((l) => {
        l.panel.visible = !l.panel.visible;
        return l;
      });
    },

    /**
     * Set panel height.
     */
    setPanelHeight(height: number): void {
      layout.update((l) => {
        l.panel.height = Math.max(100, Math.min(600, height));
        return l;
      });
    },

    /**
     * Set panel active tab.
     */
    setPanelTab(tab: string): void {
      layout.update((l) => {
        l.panel.activeTab = tab;
        if (!l.panel.visible) {
          l.panel.visible = true;
        }
        return l;
      });
    },

    /**
     * Add a new pane.
     */
    addPane(pane: Omit<PaneState, 'id' | 'isActive'>): string {
      const id = `pane-${++paneIdCounter}`;

      layout.update((l) => {
        const mainGroup = l.mainArea as PaneGroupState;
        // Deactivate other panes
        for (const p of mainGroup.panes) {
          p.isActive = false;
        }
        // Add new pane as active
        mainGroup.panes.push({
          ...pane,
          id,
          isActive: true,
        });
        mainGroup.activePane = id;
        return l;
      });

      return id;
    },

    /**
     * Remove a pane.
     */
    removePane(paneId: string): void {
      layout.update((l) => {
        const mainGroup = l.mainArea as PaneGroupState;
        const index = mainGroup.panes.findIndex((p) => p.id === paneId);

        if (index >= 0) {
          mainGroup.panes.splice(index, 1);

          // If this was the active pane, activate another
          if (mainGroup.activePane === paneId) {
            const newActive = mainGroup.panes[Math.max(0, index - 1)];
            if (newActive) {
              newActive.isActive = true;
              mainGroup.activePane = newActive.id;
            } else {
              mainGroup.activePane = null;
            }
          }
        }

        return l;
      });
    },

    /**
     * Set the active pane.
     */
    setActivePane(paneId: string): void {
      layout.update((l) => {
        const mainGroup = l.mainArea as PaneGroupState;

        for (const pane of mainGroup.panes) {
          pane.isActive = pane.id === paneId;
        }
        mainGroup.activePane = paneId;

        return l;
      });
    },

    /**
     * Update a pane's properties.
     */
    updatePane(paneId: string, updates: Partial<PaneState>): void {
      layout.update((l) => {
        const mainGroup = l.mainArea as PaneGroupState;
        const pane = mainGroup.panes.find((p) => p.id === paneId);

        if (pane) {
          Object.assign(pane, updates);
        }

        return l;
      });
    },

    /**
     * Find a pane by document ID.
     */
    findPaneByDocument(documentId: string): PaneState | null {
      const l = get(layout);
      const mainGroup = l.mainArea as PaneGroupState;
      return mainGroup.panes.find((p) => p.documentId === documentId) ?? null;
    },

    /**
     * Get all panes.
     */
    getPanes(): PaneState[] {
      const l = get(layout);
      const mainGroup = l.mainArea as PaneGroupState;
      return mainGroup.panes;
    },

    /**
     * Reset to default layout.
     */
    reset(): void {
      paneIdCounter = 0;
      layout.set(structuredClone(DEFAULT_LAYOUT));
    },
  };
}

export const layoutStore = createLayoutStore();

/**
 * Derived store for sidebar state.
 */
export const sidebar = derived(layoutStore, ($layout) => $layout.sidebar);

/**
 * Derived store for panel state.
 */
export const panel = derived(layoutStore, ($layout) => $layout.panel);

/**
 * Derived store for panes.
 */
export const panes = derived(layoutStore, ($layout) => {
  const mainGroup = $layout.mainArea as PaneGroupState;
  return mainGroup.panes;
});

/**
 * Derived store for active pane.
 */
export const activePane = derived(layoutStore, ($layout) => {
  const mainGroup = $layout.mainArea as PaneGroupState;
  return mainGroup.panes.find((p) => p.isActive) ?? null;
});

export default layoutStore;
