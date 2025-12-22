/**
 * Panel Content Interface
 *
 * Defines the contract for any content that can be displayed in a panel container.
 * This abstraction allows different content types (editor, AI chat, file tree, etc.)
 * to be placed in any container (editor panes, sidebars, bottom panel).
 */

import type { RenderContext } from '../renderer.ts';
import type { Rect } from '../layout.ts';
import type { KeyEvent } from '../../terminal/input.ts';
import type { MouseEvent } from '../mouse.ts';

// ==================== Content Types ====================

/**
 * Available content types that can be displayed in panels.
 * Extensible - add new types as needed.
 */
export type ContentType =
  | 'editor'         // Code/text editor (documents)
  | 'ai-chat'        // AI conversation
  | 'file-tree'      // File explorer
  | 'git-panel'      // Git status/staging
  | 'git-timeline'   // Git commit history
  | 'terminal'       // Terminal emulator
  | 'diff-viewer'    // Side-by-side diff
  | 'preview'        // Markdown/HTML preview
  | 'search-results' // Search results view
  | 'problems'       // Diagnostics/errors list
  | 'output';        // Output channel

/**
 * Content types that can only be displayed in the editor area (not sidebars).
 */
export const EDITOR_AREA_ONLY_TYPES: ContentType[] = ['editor', 'diff-viewer', 'preview'];

/**
 * Check if a content type can be displayed in sidebars.
 */
export function canDisplayInSidebar(contentType: ContentType): boolean {
  return !EDITOR_AREA_ONLY_TYPES.includes(contentType);
}

/**
 * Check if a content type can be displayed in the editor area.
 */
export function canDisplayInEditorArea(contentType: ContentType): boolean {
  // All content types can be displayed in editor area
  return true;
}

// ==================== Content State ====================

/**
 * Serializable state for panel content.
 * Used for session persistence.
 */
export interface ContentState {
  contentType: ContentType;
  contentId: string;
  title: string;
  /** Content-specific state (scroll position, cursor, etc.) */
  data: Record<string, unknown>;
}

// ==================== Panel Content Interface ====================

/**
 * Base interface for all panel content types.
 *
 * Any content that can be displayed in a panel container must implement this interface.
 * The content is responsible for its own rendering and input handling, but knows
 * nothing about where it's displayed (sidebar, editor tab, bottom panel, etc.).
 *
 * @example
 * class AIChatContent implements PanelContent {
 *   readonly contentType = 'ai-chat';
 *   readonly contentId = 'ai-chat-1';
 *
 *   getTitle(): string { return 'AI Chat'; }
 *   getIcon(): string { return '🤖'; }
 *   render(ctx: RenderContext): void { ... }
 * }
 */
export interface PanelContent {
  /**
   * The type of content (editor, ai-chat, file-tree, etc.).
   * Used for content restrictions and icon/behavior defaults.
   */
  readonly contentType: ContentType;

  /**
   * Unique identifier for this content instance.
   * Used for tab tracking, session persistence, and event routing.
   */
  readonly contentId: string;

  /**
   * Get the display title for this content.
   * Shown in tabs and panel headers.
   *
   * @example "main.ts", "AI Chat", "Files", "Git"
   */
  getTitle(): string;

  /**
   * Get the icon for this content (emoji or nerd font character).
   * Shown in tabs when icon display is enabled.
   *
   * @example "📄", "", "🤖"
   */
  getIcon(): string;

  /**
   * Get the content's bounding rectangle.
   */
  getRect(): Rect;

  /**
   * Set the content's bounding rectangle.
   * Called by container when layout changes.
   */
  setRect(rect: Rect): void;

  /**
   * Check if this content has unsaved changes.
   * Used for dirty indicator in tabs.
   *
   * @returns true if content has unsaved changes, false otherwise
   */
  isDirty(): boolean;

  /**
   * Check if this content is currently visible/active.
   */
  isVisible(): boolean;

  /**
   * Set visibility state.
   */
  setVisible(visible: boolean): void;

  /**
   * Render the content to the given context.
   *
   * @param ctx - Render context with drawing methods
   */
  render(ctx: RenderContext): void;

  /**
   * Handle keyboard input.
   *
   * @param event - Keyboard event to handle
   * @returns true if handled, false to propagate
   */
  handleKey?(event: KeyEvent): boolean;

  /**
   * Handle mouse input.
   *
   * @param event - Mouse event to handle
   * @returns true if handled, false to propagate
   */
  handleMouse?(event: MouseEvent): boolean;

  /**
   * Check if a point is within this content's bounds.
   *
   * @param x - X coordinate (1-indexed)
   * @param y - Y coordinate (1-indexed)
   */
  containsPoint?(x: number, y: number): boolean;

  /**
   * Called when this content becomes the active/focused content.
   * Use this to restore state, start animations, etc.
   */
  onActivated?(): void;

  /**
   * Called when this content is no longer active/focused.
   * Use this to pause updates, save state, etc.
   */
  onDeactivated?(): void;

  /**
   * Serialize content state for session persistence.
   *
   * @returns Serializable state object
   */
  serialize?(): ContentState;

  /**
   * Restore content state from serialized data.
   *
   * @param state - Previously serialized state
   */
  restore?(state: ContentState): void;

  /**
   * Clean up resources when content is destroyed.
   */
  dispose?(): void;
}

// ==================== Scrollable Panel Content ====================

/**
 * Extended interface for content with scrollable areas.
 */
export interface ScrollablePanelContent extends PanelContent {
  /**
   * Get current vertical scroll position.
   */
  getScrollTop(): number;

  /**
   * Set vertical scroll position.
   */
  setScrollTop(top: number): void;

  /**
   * Get current horizontal scroll position.
   */
  getScrollLeft(): number;

  /**
   * Set horizontal scroll position.
   */
  setScrollLeft(left: number): void;

  /**
   * Get total content height (for scroll calculations).
   */
  getContentHeight(): number;

  /**
   * Get total content width (for horizontal scroll).
   */
  getContentWidth(): number;

  /**
   * Scroll by a relative amount.
   */
  scrollBy(deltaX: number, deltaY: number): void;
}

// ==================== Focusable Panel Content ====================

/**
 * Extended interface for content that can receive keyboard focus.
 */
export interface FocusablePanelContent extends PanelContent {
  /**
   * Check if this content currently has keyboard focus.
   */
  isFocused(): boolean;

  /**
   * Set the focus state.
   */
  setFocused(focused: boolean): void;

  /**
   * Register callback for focus gained.
   * @returns Unsubscribe function
   */
  onFocus?(callback: () => void): () => void;

  /**
   * Register callback for focus lost.
   * @returns Unsubscribe function
   */
  onBlur?(callback: () => void): () => void;
}

// ==================== Type Guards ====================

/**
 * Check if content is scrollable.
 */
export function isScrollableContent(content: PanelContent): content is ScrollablePanelContent {
  return 'getScrollTop' in content && 'setScrollTop' in content;
}

/**
 * Check if content is focusable.
 */
export function isFocusableContent(content: PanelContent): content is FocusablePanelContent {
  return 'isFocused' in content && 'setFocused' in content;
}

/**
 * Check if content can be saved (has isDirty returning non-false).
 */
export function isSaveableContent(content: PanelContent): boolean {
  return content.contentType === 'editor';
}

// ==================== Content Metadata ====================

/**
 * Metadata about a content type.
 * Used by content registry for defaults and restrictions.
 */
export interface ContentTypeMetadata {
  /** Content type identifier */
  type: ContentType;
  /** Human-readable name */
  displayName: string;
  /** Default icon */
  defaultIcon: string;
  /** Whether this content can appear in sidebars */
  allowInSidebar: boolean;
  /** Whether this content can appear in editor area */
  allowInEditorArea: boolean;
  /** Whether this content can appear in bottom panel */
  allowInBottomPanel: boolean;
  /** Whether multiple instances can exist */
  allowMultiple: boolean;
  /** Default region when opening */
  defaultRegion: 'sidebar-left' | 'sidebar-right' | 'panel-bottom' | 'editor-area';
}

/**
 * Default metadata for built-in content types.
 */
export const CONTENT_TYPE_METADATA: Record<ContentType, ContentTypeMetadata> = {
  'editor': {
    type: 'editor',
    displayName: 'Editor',
    defaultIcon: '📄',
    allowInSidebar: false,
    allowInEditorArea: true,
    allowInBottomPanel: false,
    allowMultiple: true,
    defaultRegion: 'editor-area',
  },
  'ai-chat': {
    type: 'ai-chat',
    displayName: 'AI Chat',
    defaultIcon: '🤖',
    allowInSidebar: true,
    allowInEditorArea: true,
    allowInBottomPanel: true,
    allowMultiple: true,
    defaultRegion: 'sidebar-right',
  },
  'file-tree': {
    type: 'file-tree',
    displayName: 'Files',
    defaultIcon: '📁',
    allowInSidebar: true,
    allowInEditorArea: true,
    allowInBottomPanel: false,
    allowMultiple: false,
    defaultRegion: 'sidebar-left',
  },
  'git-panel': {
    type: 'git-panel',
    displayName: 'Source Control',
    defaultIcon: '🔀',
    allowInSidebar: true,
    allowInEditorArea: true,
    allowInBottomPanel: false,
    allowMultiple: false,
    defaultRegion: 'sidebar-left',
  },
  'git-timeline': {
    type: 'git-timeline',
    displayName: 'Timeline',
    defaultIcon: '📅',
    allowInSidebar: true,
    allowInEditorArea: true,
    allowInBottomPanel: true,
    allowMultiple: false,
    defaultRegion: 'sidebar-left',
  },
  'terminal': {
    type: 'terminal',
    displayName: 'Terminal',
    defaultIcon: '💻',
    allowInSidebar: false,
    allowInEditorArea: true,
    allowInBottomPanel: true,
    allowMultiple: true,
    defaultRegion: 'panel-bottom',
  },
  'diff-viewer': {
    type: 'diff-viewer',
    displayName: 'Diff',
    defaultIcon: '📊',
    allowInSidebar: false,
    allowInEditorArea: true,
    allowInBottomPanel: false,
    allowMultiple: true,
    defaultRegion: 'editor-area',
  },
  'preview': {
    type: 'preview',
    displayName: 'Preview',
    defaultIcon: '👁',
    allowInSidebar: false,
    allowInEditorArea: true,
    allowInBottomPanel: false,
    allowMultiple: true,
    defaultRegion: 'editor-area',
  },
  'search-results': {
    type: 'search-results',
    displayName: 'Search Results',
    defaultIcon: '🔍',
    allowInSidebar: true,
    allowInEditorArea: true,
    allowInBottomPanel: true,
    allowMultiple: false,
    defaultRegion: 'sidebar-left',
  },
  'problems': {
    type: 'problems',
    displayName: 'Problems',
    defaultIcon: '⚠️',
    allowInSidebar: true,
    allowInEditorArea: false,
    allowInBottomPanel: true,
    allowMultiple: false,
    defaultRegion: 'panel-bottom',
  },
  'output': {
    type: 'output',
    displayName: 'Output',
    defaultIcon: '📋',
    allowInSidebar: false,
    allowInEditorArea: false,
    allowInBottomPanel: true,
    allowMultiple: true,
    defaultRegion: 'panel-bottom',
  },
};

/**
 * Get metadata for a content type.
 */
export function getContentTypeMetadata(type: ContentType): ContentTypeMetadata {
  return CONTENT_TYPE_METADATA[type];
}
