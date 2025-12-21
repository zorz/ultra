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

// ============================================
// Element Registration
// ============================================

import { registerElement } from './factory.ts';
import { DocumentEditor } from './document-editor.ts';
import { FileTree } from './file-tree.ts';
import { TerminalSession } from './terminal-session.ts';
import { GitPanel } from './git-panel.ts';

/**
 * Register all built-in elements with the factory.
 * Call this once at application startup.
 */
export function registerBuiltinElements(): void {
  registerElement('DocumentEditor', (id, title, ctx, state) => {
    const editor = new DocumentEditor(id, title, ctx);
    if (state && typeof state === 'object') {
      editor.setState(state as import('./document-editor.ts').DocumentEditorState);
    }
    return editor;
  });

  registerElement('FileTree', (id, title, ctx, state) => {
    const tree = new FileTree(id, title, ctx);
    if (state && typeof state === 'object') {
      tree.setState(state as import('./file-tree.ts').FileTreeState);
    }
    return tree;
  });

  registerElement('TerminalSession', (id, title, ctx, state) => {
    const terminal = new TerminalSession(id, title, ctx);
    if (state && typeof state === 'object') {
      terminal.setState(state as import('./terminal-session.ts').TerminalSessionState);
    }
    return terminal;
  });

  registerElement('GitPanel', (id, title, ctx) => {
    return new GitPanel(id, title, ctx);
  });
}
