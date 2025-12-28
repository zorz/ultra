/**
 * ECP Server
 *
 * The Editor Command Protocol server that routes requests to service adapters.
 */

import { debugLog as globalDebugLog } from '../debug.ts';

// Services
import { LocalDocumentService } from '../services/document/local.ts';
import { DocumentServiceAdapter } from '../services/document/adapter.ts';
import { FileServiceImpl } from '../services/file/service.ts';
import { FileServiceAdapter } from '../services/file/adapter.ts';
import { GitCliService } from '../services/git/cli.ts';
import { GitServiceAdapter } from '../services/git/adapter.ts';
import { LocalSessionService } from '../services/session/local.ts';
import { SessionServiceAdapter } from '../services/session/adapter.ts';
import { LocalLSPService } from '../services/lsp/service.ts';
import { LSPServiceAdapter } from '../services/lsp/adapter.ts';
import { LocalSyntaxService } from '../services/syntax/service.ts';
import { SyntaxServiceAdapter } from '../services/syntax/adapter.ts';
import { LocalTerminalService } from '../services/terminal/service.ts';
import { TerminalServiceAdapter } from '../services/terminal/adapter.ts';
import { LocalSecretService } from '../services/secret/local.ts';
import { SecretServiceAdapter } from '../services/secret/adapter.ts';
import { LocalDatabaseService } from '../services/database/local.ts';
import { DatabaseServiceAdapter } from '../services/database/adapter.ts';

// Types
import {
  type ECPServerOptions,
  type ECPServerState,
  type ECPResponse,
  type ECPNotification,
  type NotificationListener,
  type Unsubscribe,
  type HandlerResult,
  ECPErrorCodes,
  createErrorResponse,
  createSuccessResponse,
} from './types.ts';

/**
 * ECP Server.
 *
 * Routes JSON-RPC requests to the appropriate service adapters.
 * Provides a simple `request(method, params)` API for clients.
 */
export class ECPServer {
  private _debugName = 'ECPServer';
  private _state: ECPServerState = 'uninitialized';
  private workspaceRoot: string;

  // Services
  private documentService: LocalDocumentService;
  private fileService: FileServiceImpl;
  private gitService: GitCliService;
  private sessionService: LocalSessionService;
  private lspService: LocalLSPService;
  private syntaxService: LocalSyntaxService;
  private terminalService: LocalTerminalService;
  private secretService: LocalSecretService;
  private databaseService: LocalDatabaseService;

  // Adapters
  private documentAdapter: DocumentServiceAdapter;
  private fileAdapter: FileServiceAdapter;
  private gitAdapter: GitServiceAdapter;
  private sessionAdapter: SessionServiceAdapter;
  private lspAdapter: LSPServiceAdapter;
  private syntaxAdapter: SyntaxServiceAdapter;
  private terminalAdapter: TerminalServiceAdapter;
  private secretAdapter: SecretServiceAdapter;
  private databaseAdapter: DatabaseServiceAdapter;

  // Notification listeners
  private notificationListeners: Set<NotificationListener> = new Set();

  // Request ID counter for internal requests
  private requestIdCounter = 0;

  constructor(options: ECPServerOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();

    // Initialize services
    this.documentService = new LocalDocumentService();
    this.fileService = new FileServiceImpl();
    this.gitService = new GitCliService();
    this.sessionService = new LocalSessionService();

    // Configure session paths for persistence
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const sessionsDir = options.sessionsDir || `${homeDir}/.ultra/sessions`;
    this.sessionService.setSessionPaths({
      sessionsDir,
      workspaceSessionsDir: `${sessionsDir}/workspaces`,
      namedSessionsDir: `${sessionsDir}/named`,
      lastSessionFile: `${sessionsDir}/last-session.json`,
    });

    this.lspService = new LocalLSPService();
    this.lspService.setWorkspaceRoot(this.workspaceRoot);
    this.syntaxService = new LocalSyntaxService();
    this.terminalService = new LocalTerminalService();
    this.secretService = new LocalSecretService();
    this.databaseService = new LocalDatabaseService();

    // Initialize adapters
    this.documentAdapter = new DocumentServiceAdapter(this.documentService);
    this.fileAdapter = new FileServiceAdapter(this.fileService);
    this.gitAdapter = new GitServiceAdapter(this.gitService);
    this.sessionAdapter = new SessionServiceAdapter(this.sessionService);
    this.lspAdapter = new LSPServiceAdapter(this.lspService);
    this.syntaxAdapter = new SyntaxServiceAdapter(this.syntaxService);
    this.terminalAdapter = new TerminalServiceAdapter(this.terminalService);
    this.secretAdapter = new SecretServiceAdapter(this.secretService);
    this.databaseAdapter = new DatabaseServiceAdapter(this.databaseService);

    // Set up notification forwarding
    this.setupNotificationHandlers();

    this._state = 'running';
    this.debugLog('Initialized');
  }

  protected debugLog(msg: string): void {
    globalDebugLog(`[${this._debugName}] ${msg}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the current server state.
   */
  get state(): ECPServerState {
    return this._state;
  }

  /**
   * Send a request and get the result.
   *
   * @param method The method name (e.g., "document/open")
   * @param params The request parameters
   * @returns The result
   * @throws Error if the request fails
   */
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const response = await this.requestRaw(method, params);

    if ('error' in response) {
      throw new Error(`ECP Error [${response.error.code}]: ${response.error.message}`);
    }

    return response.result as T;
  }

  /**
   * Send a request and get the full response (including errors).
   *
   * @param method The method name
   * @param params The request parameters
   * @returns The full response
   */
  async requestRaw(method: string, params?: unknown): Promise<ECPResponse> {
    if (this._state === 'shutdown') {
      return createErrorResponse(
        null,
        ECPErrorCodes.ServerShuttingDown,
        'Server is shutting down'
      );
    }

    if (this._state === 'uninitialized') {
      return createErrorResponse(
        null,
        ECPErrorCodes.ServerNotInitialized,
        'Server is not initialized'
      );
    }

    const id = ++this.requestIdCounter;

    try {
      const result = await this.routeRequest(method, params);

      if ('error' in result) {
        return {
          jsonrpc: '2.0',
          id,
          error: result.error,
        };
      }

      return createSuccessResponse(id, result.result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createErrorResponse(id, ECPErrorCodes.InternalError, message);
    }
  }

  /**
   * Subscribe to notifications.
   *
   * @param listener Notification callback
   * @returns Unsubscribe function
   */
  onNotification(listener: NotificationListener): Unsubscribe {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  /**
   * Initialize async services.
   * Call this before using session-related methods.
   */
  async initialize(): Promise<void> {
    await this.sessionService.init(this.workspaceRoot);
    await this.secretService.init();
    await this.databaseService.init(this.workspaceRoot);
    this.debugLog('Async initialization complete');
  }

  /**
   * Shutdown the server and clean up resources.
   */
  async shutdown(): Promise<void> {
    if (this._state === 'shutdown') {
      return;
    }

    this._state = 'shutdown';
    this.debugLog('Shutting down...');

    // Close all open documents
    const documents = this.documentService.listOpen();
    for (const doc of documents) {
      await this.documentService.close(doc.documentId);
    }

    // Dispose file service resources
    this.fileService.dispose();
    this.fileAdapter.dispose();

    // Shutdown LSP service
    await this.lspService.shutdown();

    // Close all terminals
    this.terminalService.closeAll();

    // Shutdown secret and database services
    await this.secretService.shutdown();
    await this.databaseService.shutdown();

    // Clear listeners
    this.notificationListeners.clear();

    this.debugLog('Shutdown complete');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Service Access (for advanced use cases)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a service directly.
   * Use this sparingly - prefer using request() for most operations.
   */
  getService<T>(
    name: 'document' | 'file' | 'git' | 'session' | 'lsp' | 'syntax' | 'terminal' | 'secret' | 'database'
  ): T {
    switch (name) {
      case 'document':
        return this.documentService as unknown as T;
      case 'file':
        return this.fileService as unknown as T;
      case 'git':
        return this.gitService as unknown as T;
      case 'session':
        return this.sessionService as unknown as T;
      case 'lsp':
        return this.lspService as unknown as T;
      case 'syntax':
        return this.syntaxService as unknown as T;
      case 'terminal':
        return this.terminalService as unknown as T;
      case 'secret':
        return this.secretService as unknown as T;
      case 'database':
        return this.databaseService as unknown as T;
      default:
        throw new Error(`Unknown service: ${name}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal Methods
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Route a request to the appropriate adapter.
   */
  private async routeRequest(
    method: string,
    params: unknown
  ): Promise<HandlerResult> {
    // Document service
    if (method.startsWith('document/')) {
      return this.handleDocumentRequest(method, params);
    }

    // File service
    if (method.startsWith('file/')) {
      return this.handleFileRequest(method, params);
    }

    // Git service
    if (method.startsWith('git/')) {
      return this.gitAdapter.handleRequest(method, params);
    }

    // Session service (includes config/, session/, keybindings/, theme/)
    if (
      method.startsWith('config/') ||
      method.startsWith('session/') ||
      method.startsWith('keybindings/') ||
      method.startsWith('theme/')
    ) {
      return this.sessionAdapter.handleRequest(method, params);
    }

    // LSP service
    if (method.startsWith('lsp/')) {
      return this.lspAdapter.handleRequest(method, params);
    }

    // Syntax service
    if (method.startsWith('syntax/')) {
      return this.syntaxAdapter.handleRequest(method, params);
    }

    // Terminal service
    if (method.startsWith('terminal/')) {
      return this.terminalAdapter.handleRequest(method, params);
    }

    // Secret service
    if (method.startsWith('secret/')) {
      return { result: await this.secretAdapter.handleRequest(method, params) };
    }

    // Database service
    if (method.startsWith('database/')) {
      return { result: await this.databaseAdapter.handleRequest(method, params) };
    }

    // Method not found
    return {
      error: {
        code: ECPErrorCodes.MethodNotFound,
        message: `Method not found: ${method}`,
      },
    };
  }

  /**
   * Handle document service requests.
   * DocumentServiceAdapter has a different interface (takes full ECPRequest).
   */
  private async handleDocumentRequest(
    method: string,
    params: unknown
  ): Promise<HandlerResult> {
    const request = {
      jsonrpc: '2.0' as const,
      id: this.requestIdCounter,
      method,
      params,
    };

    const response = await this.documentAdapter.handleRequest(request);

    if ('error' in response && response.error) {
      return { error: response.error };
    }

    return { result: (response as { result: unknown }).result };
  }

  /**
   * Handle file service requests.
   * FileServiceAdapter has a different interface (takes full ECPRequest).
   */
  private async handleFileRequest(
    method: string,
    params: unknown
  ): Promise<HandlerResult> {
    const request = {
      jsonrpc: '2.0' as const,
      id: this.requestIdCounter,
      method,
      params,
    };

    const response = await this.fileAdapter.handleRequest(request);

    if ('error' in response && response.error) {
      return { error: response.error };
    }

    return { result: (response as { result: unknown }).result };
  }

  /**
   * Set up notification handlers for all adapters.
   */
  private setupNotificationHandlers(): void {
    const forwardNotification = (notification: ECPNotification | { method: string; params: unknown }) => {
      for (const listener of this.notificationListeners) {
        try {
          listener(notification.method, notification.params);
        } catch (error) {
          this.debugLog(`Notification listener error: ${error}`);
        }
      }
    };

    // Document adapter
    this.documentAdapter.setNotificationHandler(forwardNotification);

    // File adapter
    this.fileAdapter.setNotificationHandler(forwardNotification);

    // LSP adapter
    this.lspAdapter.setNotificationHandler(forwardNotification);

    // Terminal adapter
    this.terminalAdapter.setNotificationHandler(forwardNotification);
  }
}

/**
 * Create an ECP server instance.
 */
export function createECPServer(options?: ECPServerOptions): ECPServer {
  return new ECPServer(options);
}
