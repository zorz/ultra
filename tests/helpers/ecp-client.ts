/**
 * Test ECP Client
 *
 * A testing utility that provides a clean interface for testing ECP
 * services without terminal I/O. Sends JSON-RPC requests directly
 * to service adapters and collects notifications.
 */

import { LocalDocumentService } from '../../src/services/document/local.ts';
import {
  DocumentServiceAdapter,
  type ECPRequest,
  type ECPResponse,
  type ECPNotification,
} from '../../src/services/document/adapter.ts';
import { FileServiceImpl } from '../../src/services/file/service.ts';
import { FileServiceAdapter } from '../../src/services/file/adapter.ts';
import { GitCliService } from '../../src/services/git/cli.ts';
import { GitServiceAdapter } from '../../src/services/git/adapter.ts';
import { LocalSessionService } from '../../src/services/session/local.ts';
import { SessionServiceAdapter } from '../../src/services/session/adapter.ts';

/**
 * Options for creating a TestECPClient.
 */
export interface TestECPClientOptions {
  /** Workspace root for file operations */
  workspaceRoot?: string;

  /** Whether to capture notifications */
  captureNotifications?: boolean;
}

/**
 * Test ECP Client for integration testing.
 *
 * @example
 * ```typescript
 * const client = new TestECPClient();
 *
 * // Open a document
 * const { documentId } = await client.request('document/open', {
 *   uri: 'memory://test.txt',
 *   content: 'hello'
 * });
 *
 * // Insert text
 * await client.request('document/insert', {
 *   documentId,
 *   position: { line: 0, column: 5 },
 *   text: ' world'
 * });
 *
 * // Verify content
 * const { content } = await client.request('document/content', { documentId });
 * expect(content).toBe('hello world');
 *
 * await client.shutdown();
 * ```
 */
export class TestECPClient {
  private documentService: LocalDocumentService;
  private documentAdapter: DocumentServiceAdapter;
  private fileService: FileServiceImpl;
  private fileAdapter: FileServiceAdapter;
  private gitService: GitCliService;
  private gitAdapter: GitServiceAdapter;
  private sessionService: LocalSessionService;
  private sessionAdapter: SessionServiceAdapter;
  private notifications: ECPNotification[] = [];
  private requestId = 0;
  private captureNotifications: boolean;
  private workspaceRoot: string;
  private initialized = false;

  constructor(options: TestECPClientOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.captureNotifications = options.captureNotifications ?? true;

    // Initialize services
    this.documentService = new LocalDocumentService();
    this.fileService = new FileServiceImpl();
    this.gitService = new GitCliService();
    this.sessionService = new LocalSessionService();

    // Initialize adapters
    this.documentAdapter = new DocumentServiceAdapter(this.documentService);
    this.fileAdapter = new FileServiceAdapter(this.fileService);
    this.gitAdapter = new GitServiceAdapter(this.gitService);
    this.sessionAdapter = new SessionServiceAdapter(this.sessionService);

    // Capture notifications
    if (this.captureNotifications) {
      this.documentAdapter.setNotificationHandler((notification) => {
        this.notifications.push(notification);
      });
      this.fileAdapter.setNotificationHandler((notification) => {
        this.notifications.push(notification);
      });
    }
  }

  /**
   * Initialize async services (call before using session methods).
   */
  async initSession(): Promise<void> {
    if (!this.initialized) {
      await this.sessionService.init(this.workspaceRoot);
      this.initialized = true;
    }
  }

  /**
   * Send a request and get the result.
   * Throws an error if the request fails.
   */
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const response = await this.requestRaw<T>(method, params);

    if (response.error) {
      throw new Error(`ECP Error [${response.error.code}]: ${response.error.message}`);
    }

    return response.result as T;
  }

  /**
   * Send a request and get the full response (including errors).
   */
  async requestRaw<T = unknown>(method: string, params?: unknown): Promise<ECPResponse> {
    const request: ECPRequest = {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method,
      params,
    };

    // Route to appropriate adapter
    const adapter = this.getAdapterForMethod(method);
    if (!adapter) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
    }

    // GitServiceAdapter and SessionServiceAdapter have a different response format
    if (adapter instanceof GitServiceAdapter || adapter instanceof SessionServiceAdapter) {
      const result = await adapter.handleRequest(method, params);
      if ('error' in result) {
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: result.error,
        };
      }
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: result.result,
      };
    }

    return adapter.handleRequest(request);
  }

  /**
   * Send a notification (no response expected).
   */
  notify(method: string, params?: unknown): void {
    // Notifications are fire-and-forget
    // For testing, we might want to handle them differently
  }

  /**
   * Get collected notifications.
   */
  getNotifications(methodPattern?: string | RegExp): ECPNotification[] {
    if (!methodPattern) {
      return [...this.notifications];
    }

    if (typeof methodPattern === 'string') {
      return this.notifications.filter((n) => n.method === methodPattern);
    }

    return this.notifications.filter((n) => methodPattern.test(n.method));
  }

  /**
   * Wait for a notification matching the pattern.
   */
  async waitForNotification(
    methodPattern: string | RegExp,
    timeout = 5000
  ): Promise<ECPNotification> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const matching = this.getNotifications(methodPattern);
      if (matching.length > 0) {
        return matching[matching.length - 1];
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    throw new Error(`Timeout waiting for notification: ${methodPattern}`);
  }

  /**
   * Clear collected notifications.
   */
  clearNotifications(): void {
    this.notifications = [];
  }

  /**
   * Get a service directly (for unit testing).
   */
  getService<T>(name: 'document' | 'file' | 'git' | 'session'): T {
    switch (name) {
      case 'document':
        return this.documentService as unknown as T;
      case 'file':
        return this.fileService as unknown as T;
      case 'git':
        return this.gitService as unknown as T;
      case 'session':
        return this.sessionService as unknown as T;
      default:
        throw new Error(`Unknown service: ${name}`);
    }
  }

  /**
   * Shutdown the client and clean up resources.
   */
  async shutdown(): Promise<void> {
    // Close all open documents
    const documents = this.documentService.listOpen();
    for (const doc of documents) {
      await this.documentService.close(doc.documentId);
    }

    // Dispose file service resources
    this.fileService.dispose();
    this.fileAdapter.dispose();

    // Clear notifications
    this.notifications = [];
  }

  /**
   * Route method to appropriate adapter.
   */
  private getAdapterForMethod(method: string): DocumentServiceAdapter | FileServiceAdapter | GitServiceAdapter | SessionServiceAdapter | null {
    if (method.startsWith('document/')) {
      return this.documentAdapter;
    }

    if (method.startsWith('file/')) {
      return this.fileAdapter;
    }

    if (method.startsWith('git/')) {
      return this.gitAdapter;
    }

    if (method.startsWith('config/') || method.startsWith('session/') ||
        method.startsWith('keybindings/') || method.startsWith('theme/')) {
      return this.sessionAdapter;
    }

    return null;
  }
}

/**
 * Create a TestECPClient for a test.
 * Convenience function that handles cleanup.
 */
export function createTestClient(options?: TestECPClientOptions): TestECPClient {
  return new TestECPClient(options);
}
