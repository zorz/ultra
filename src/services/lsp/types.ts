/**
 * LSP Service Types
 *
 * Type definitions for the LSP Service.
 * Re-exports core LSP types and adds service-specific types.
 */

// Re-export core LSP types from client
export type {
  LSPPosition,
  LSPRange,
  LSPLocation,
  LSPDiagnostic,
  LSPCompletionItem,
  LSPHover,
  LSPSignatureHelp,
  LSPSignatureInformation,
  LSPParameterInformation,
  LSPDocumentSymbol,
  LSPSymbolInformation,
  LSPTextDocumentIdentifier,
  LSPVersionedTextDocumentIdentifier,
  LSPTextDocumentItem,
  NotificationHandler,
} from './client.ts';

export { SymbolKind } from './client.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Server Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration for a language server.
 */
export interface ServerConfig {
  /** Command to start the server */
  command: string;

  /** Arguments to pass to the command */
  args: string[];

  /** Initialization options to send during initialize */
  initializationOptions?: Record<string, unknown>;

  /** Settings to send to the server */
  settings?: Record<string, unknown>;

  /** Environment variables to set */
  env?: Record<string, string>;
}

/**
 * Server status states.
 */
export type ServerStatusState = 'starting' | 'ready' | 'error' | 'stopped';

/**
 * Status of a language server.
 */
export interface ServerStatus {
  /** Language ID this server handles */
  languageId: string;

  /** Current status */
  status: ServerStatusState;

  /** Server capabilities (if ready) */
  capabilities?: Record<string, unknown>;

  /** Error message (if error) */
  error?: string;

  /** Process ID (if running) */
  pid?: number;
}

/**
 * Information about a running server.
 */
export interface ServerInfo {
  /** Language ID */
  languageId: string;

  /** Whether the server is initialized and ready */
  ready: boolean;

  /** Server capabilities */
  capabilities: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace Edit Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A text edit to apply to a document.
 */
export interface TextEdit {
  /** Range to replace */
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };

  /** New text to insert */
  newText: string;
}

/**
 * Edits to apply to a single document.
 */
export interface TextDocumentEdit {
  /** Document to edit */
  textDocument: {
    uri: string;
    version?: number | null;
  };

  /** Edits to apply */
  edits: TextEdit[];
}

/**
 * A workspace edit represents changes to many resources.
 */
export interface WorkspaceEdit {
  /** Map of document URI to edits */
  changes?: Record<string, TextEdit[]>;

  /** Versioned document edits */
  documentChanges?: TextDocumentEdit[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Completion Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Completion item kinds (LSP spec).
 */
export const CompletionItemKind = {
  Text: 1,
  Method: 2,
  Function: 3,
  Constructor: 4,
  Field: 5,
  Variable: 6,
  Class: 7,
  Interface: 8,
  Module: 9,
  Property: 10,
  Unit: 11,
  Value: 12,
  Enum: 13,
  Keyword: 14,
  Snippet: 15,
  Color: 16,
  File: 17,
  Reference: 18,
  Folder: 19,
  EnumMember: 20,
  Constant: 21,
  Struct: 22,
  Event: 23,
  Operator: 24,
  TypeParameter: 25,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostic Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Diagnostic severity levels (LSP spec).
 */
export const DiagnosticSeverity = {
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Language Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * File extension to language ID mapping.
 */
export const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.rs': 'rust',
  '.py': 'python',
  '.go': 'go',
  '.rb': 'ruby',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  '.json': 'json',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
};

/**
 * Default server configurations by language.
 */
export const DEFAULT_SERVERS: Record<string, ServerConfig> = {
  typescript: { command: 'typescript-language-server', args: ['--stdio'] },
  javascript: { command: 'typescript-language-server', args: ['--stdio'] },
  typescriptreact: { command: 'typescript-language-server', args: ['--stdio'] },
  javascriptreact: { command: 'typescript-language-server', args: ['--stdio'] },
  rust: { command: 'rust-analyzer', args: [] },
  python: { command: 'pylsp', args: [] },
  go: { command: 'gopls', args: [] },
  ruby: { command: 'solargraph', args: ['stdio'] },
  c: { command: 'clangd', args: [] },
  cpp: { command: 'clangd', args: [] },
  json: { command: 'vscode-json-language-server', args: ['--stdio'] },
  html: { command: 'vscode-html-language-server', args: ['--stdio'] },
  css: { command: 'vscode-css-language-server', args: ['--stdio'] },
};

// ─────────────────────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Diagnostics callback for receiving diagnostic updates.
 */
export type DiagnosticsCallback = (uri: string, diagnostics: import('./client.ts').LSPDiagnostic[]) => void;

/**
 * Server status change callback.
 */
export type ServerStatusCallback = (status: ServerStatus) => void;

/**
 * Unsubscribe function returned by event subscriptions.
 */
export type Unsubscribe = () => void;
