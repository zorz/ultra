/**
 * TUI Client
 *
 * Terminal User Interface for Ultra editor.
 * This module provides all the building blocks for a terminal-based client.
 */

// ============================================
// Core Types
// ============================================

export type {
  Rect,
  Size,
  Position,
  Cell,
  DirtyRegion,
  KeyEvent,
  MouseEvent,
  InputEvent,
  ElementType,
  ElementConfig,
  ContainerMode,
  SplitDirection,
  PaneConfig,
  SplitConfig,
  LayoutConfig,
  ElementLifecycle,
} from './types.ts';

export {
  isKeyEvent,
  isMouseEvent,
  isSplitConfig,
  isPaneConfig,
  containsPoint,
  rectsIntersect,
  rectIntersection,
  createEmptyCell,
  cloneCell,
  cellsEqual,
} from './types.ts';

// ============================================
// Rendering
// ============================================

export {
  ScreenBuffer,
  createScreenBuffer,
} from './rendering/buffer.ts';

export {
  Renderer,
  createRenderer,
  createTestRenderer,
  type RendererOptions,
} from './rendering/renderer.ts';

// ============================================
// Elements
// ============================================

export {
  BaseElement,
  createTestContext,
  type ElementContext,
} from './elements/base.ts';

export {
  registerElement,
  isElementRegistered,
  getRegisteredTypes,
  unregisterElement,
  clearRegistry,
  createElement,
  createElementOrThrow,
  generateElementId,
  resetIdCounter,
  PlaceholderElement,
  createPlaceholder,
  createElementWithFallback,
  type ElementCreator,
} from './elements/factory.ts';

export {
  DocumentEditor,
  createDocumentEditor,
  type DocumentLine,
  type SyntaxToken,
  type CursorPosition,
  type Selection,
  type DocumentEditorState,
  type DocumentEditorCallbacks,
} from './elements/document-editor.ts';

export {
  FileTree,
  createFileTree,
  type FileNode,
  type FileTreeState,
  type FileTreeCallbacks,
} from './elements/file-tree.ts';

export {
  TerminalSession,
  createTerminalSession,
  type TerminalLine,
  type TerminalSessionState,
  type TerminalSessionCallbacks,
} from './elements/terminal-session.ts';

export {
  GitPanel,
  createGitPanel,
  type GitFileStatus,
  type GitChange,
  type GitState,
  type GitPanelCallbacks,
} from './elements/git-panel.ts';

// ============================================
// Layout
// ============================================

export {
  Pane,
  createPane,
  type PaneCallbacks,
  type PaneThemeColors,
} from './layout/pane.ts';

export {
  PaneContainer,
  createPaneContainer,
  type PaneContainerCallbacks,
} from './layout/pane-container.ts';

// ============================================
// Status Bar
// ============================================

export {
  StatusBar,
  createStatusBar,
  type StatusBarCallbacks,
  type StatusItem,
  type HistoryEntry,
} from './status-bar/status-bar.ts';

// ============================================
// Overlays
// ============================================

export {
  OverlayManager,
  BaseDialog,
  createOverlayManager,
  type Overlay,
  type OverlayManagerCallbacks,
  type NotificationType,
  type Notification,
} from './overlays/overlay-manager.ts';

// ============================================
// Input
// ============================================

export {
  FocusManager,
  createFocusManager,
  type FocusChangeCallback,
  type FocusResolver,
} from './input/focus-manager.ts';

export {
  TUIInputHandler,
  createInputHandler,
  type KeyEventCallback,
  type MouseEventCallback,
  type ResizeCallback,
  type InputEventCallback,
} from './input/input-handler.ts';

// ============================================
// Window
// ============================================

export {
  Window,
  createWindow,
  type WindowConfig,
  type WindowState,
  type KeyBinding,
  type ThemeColorProvider,
} from './window.ts';
