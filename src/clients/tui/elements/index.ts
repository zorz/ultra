/**
 * TUI Elements
 *
 * Base classes and factory for TUI content elements.
 */

export {
  BaseElement,
  type ElementContext,
  createTestContext,
} from './base.ts';

export {
  type ElementCreator,
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
} from './factory.ts';

export {
  DocumentEditor,
  createDocumentEditor,
  type DocumentLine,
  type SyntaxToken,
  type CursorPosition,
  type Selection,
  type DocumentEditorState,
  type DocumentEditorCallbacks,
} from './document-editor.ts';

export {
  FileTree,
  createFileTree,
  type FileNode,
  type FileTreeState,
  type FileTreeCallbacks,
} from './file-tree.ts';

export {
  TerminalSession,
  createTerminalSession,
  type TerminalLine,
  type TerminalSessionState,
  type TerminalSessionCallbacks,
} from './terminal-session.ts';

export {
  GitPanel,
  createGitPanel,
  type GitFileStatus,
  type GitChange,
  type GitState,
  type GitPanelCallbacks,
} from './git-panel.ts';
