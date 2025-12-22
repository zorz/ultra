/**
 * Base artifact types for the content browser system.
 *
 * Artifacts represent structured content that can be displayed in tabs,
 * such as git diffs, search results, diagnostics, etc.
 */

/**
 * Supported artifact types.
 */
export type ArtifactType = 'git-diff' | 'search-result' | 'diagnostic' | 'custom';

/**
 * Base interface for all artifacts.
 */
export interface Artifact {
  /** Type discriminator */
  readonly type: ArtifactType;
  /** Unique identifier */
  readonly id: string;
  /** Display title */
  readonly title: string;
  /** Optional description */
  readonly description?: string;
}

/**
 * An action that can be performed on an artifact or node.
 */
export interface ArtifactAction {
  /** Action identifier */
  id: string;
  /** Display label */
  label: string;
  /** Keyboard shortcut (single key, e.g., 's' for stage) */
  shortcut?: string;
  /** Icon character */
  icon?: string;
  /** Whether the action is currently available */
  enabled: boolean;
  /** Execute the action */
  execute: () => void | Promise<void>;
}

/**
 * Node type discriminator for specialized rendering.
 */
export type NodeType = 'file' | 'hunk' | 'line' | 'match' | 'group' | 'item';

/**
 * A node in the artifact tree structure.
 */
export interface ArtifactNode<T extends Artifact = Artifact> {
  /** The artifact this node belongs to */
  artifact: T;
  /** Node type for specialized rendering */
  nodeType: NodeType;
  /** Unique node identifier */
  nodeId: string;
  /** Depth in the tree (0 = root) */
  depth: number;
  /** Whether this node is expanded (for parent nodes) */
  expanded: boolean;
  /** Child nodes */
  children: ArtifactNode<T>[];
  /** Available actions for this node */
  actions: ArtifactAction[];
  /** Whether this node is currently selected */
  selected: boolean;
  /** Display label for this node */
  label: string;
  /** Secondary label (e.g., match count, line number) */
  secondaryLabel?: string;
  /** Icon character */
  icon?: string;
  /** Foreground color override */
  foreground?: string;
  /** Background color override */
  background?: string;
  /** Custom metadata for specialized rendering */
  metadata?: Record<string, unknown>;
}

/**
 * View mode for the content browser.
 */
export type ViewMode = 'tree' | 'flat';

/**
 * Callbacks for content browser interactions.
 */
export interface ContentBrowserCallbacks<T extends Artifact = Artifact> {
  /** Open a file at the given path and optional position */
  onOpenFile?: (path: string, line?: number, column?: number) => void;
  /** Execute an artifact action */
  onAction?: (artifact: T, action: ArtifactAction, node: ArtifactNode<T>) => void;
  /** Selection changed */
  onSelectionChange?: (node: ArtifactNode<T> | null) => void;
  /** Request content refresh */
  onRefresh?: () => void;
}

/**
 * State for content browser serialization.
 */
export interface ContentBrowserState {
  /** Scroll position */
  scrollTop: number;
  /** Selected node index */
  selectedIndex: number;
  /** IDs of expanded nodes */
  expandedNodeIds: string[];
  /** Current view mode */
  viewMode: ViewMode;
}

/**
 * Provider interface for building artifact nodes.
 * Implemented by specialized browsers (GitDiffBrowser, SearchResultBrowser).
 */
export interface ArtifactNodeProvider<T extends Artifact> {
  /** Build the tree structure from artifacts */
  buildNodes(artifacts: T[]): ArtifactNode<T>[];
  /** Get actions available for a node */
  getNodeActions(node: ArtifactNode<T>): ArtifactAction[];
  /** Get the height of a node in rows (for variable-height rendering) */
  getNodeHeight?(node: ArtifactNode<T>): number;
}
