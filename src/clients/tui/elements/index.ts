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

export {
  TerminalPanel,
  createTerminalPanel,
  type TerminalTabDropdownInfo,
} from './terminal-panel.ts';

export {
  AITerminalChat,
  ClaudeTerminalChat,
  CodexTerminalChat,
  GeminiTerminalChat,
  createAITerminalChat,
  createClaudeTerminalChat,
  createCodexTerminalChat,
  createGeminiTerminalChat,
  type AIProvider,
  type AITerminalChatState,
  type AITerminalChatCallbacks,
} from './ai-terminal-chat.ts';

export {
  ContentBrowser,
} from './content-browser.ts';

export {
  GitDiffBrowser,
  createGitDiffBrowser,
  type GitDiffBrowserCallbacks,
  type DiagnosticsProvider,
} from './git-diff-browser.ts';

export {
  SearchResultBrowser,
  createSearchResultBrowser,
  type SearchResultBrowserCallbacks,
} from './search-result-browser.ts';

export {
  OutlinePanel,
  createOutlinePanel,
  type OutlineSymbol,
  type OutlinePanelState,
  type OutlinePanelCallbacks,
} from './outline-panel.ts';

export {
  GitTimelinePanel,
  createGitTimelinePanel,
  type TimelineMode,
  type GitTimelinePanelState,
  type GitTimelinePanelCallbacks,
} from './git-timeline-panel.ts';

export {
  parseTypeScriptSymbols,
  parseMarkdownSymbols,
  getSymbolParser,
  hasSymbolParser,
} from './outline-parsers.ts';

// ============================================
// Element Registration
// ============================================

import { registerElement } from './factory.ts';
import { DocumentEditor } from './document-editor.ts';
import { FileTree } from './file-tree.ts';
import { TerminalSession } from './terminal-session.ts';
import { GitPanel } from './git-panel.ts';
import { TerminalPanel } from './terminal-panel.ts';
import { createAITerminalChat } from './ai-terminal-chat.ts';
import { GitDiffBrowser } from './git-diff-browser.ts';
import { SearchResultBrowser } from './search-result-browser.ts';
import { OutlinePanel } from './outline-panel.ts';
import { GitTimelinePanel } from './git-timeline-panel.ts';

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

  registerElement('AgentChat', (id, title, ctx, state) => {
    const aiState = state as import('./ai-terminal-chat.ts').AITerminalChatState | undefined;
    const chat = createAITerminalChat(id, title, ctx, {
      provider: aiState?.provider,
      sessionId: aiState?.sessionId,
      cwd: aiState?.cwd,
    });
    return chat;
  });

  registerElement('GitDiffBrowser', (id, title, ctx) => {
    return new GitDiffBrowser(id, title, ctx);
  });

  registerElement('SearchResultBrowser', (id, title, ctx) => {
    return new SearchResultBrowser(id, title, ctx);
  });

  registerElement('OutlinePanel', (id, title, ctx, state) => {
    const panel = new OutlinePanel(id, title, ctx);
    if (state && typeof state === 'object') {
      panel.setState(state as import('./outline-panel.ts').OutlinePanelState);
    }
    return panel;
  });

  registerElement('GitTimelinePanel', (id, title, ctx, state) => {
    const panel = new GitTimelinePanel(id, title, ctx);
    if (state && typeof state === 'object') {
      panel.setState(state as import('./git-timeline-panel.ts').GitTimelinePanelState);
    }
    return panel;
  });
}
