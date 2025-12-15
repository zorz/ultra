/**
 * LSP Client
 * 
 * Language Server Protocol client implementation using Bun's native subprocess.
 * Implements JSON-RPC 2.0 protocol with Content-Length headers.
 */

import type { Subprocess } from 'bun';

// LSP Types
export interface LSPPosition {
  line: number;
  character: number;
}

export interface LSPRange {
  start: LSPPosition;
  end: LSPPosition;
}

export interface LSPLocation {
  uri: string;
  range: LSPRange;
}

export interface LSPDiagnostic {
  range: LSPRange;
  message: string;
  severity?: number;  // 1=Error, 2=Warning, 3=Info, 4=Hint
  source?: string;
  code?: string | number;
}

export interface LSPCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { kind: string; value: string };
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: {
    range: LSPRange;
    newText: string;
  };
}

export interface LSPHover {
  contents: string | { kind: string; value: string } | Array<string | { kind: string; value: string }>;
  range?: LSPRange;
}

export interface LSPTextDocumentIdentifier {
  uri: string;
}

export interface LSPVersionedTextDocumentIdentifier extends LSPTextDocumentIdentifier {
  version: number;
}

export interface LSPTextDocumentItem {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

// JSON-RPC types
interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

type JSONRPCMessage = JSONRPCRequest | JSONRPCNotification | JSONRPCResponse;

export type NotificationHandler = (method: string, params: unknown) => void;

/**
 * LSP Client for a single language server
 */
import { appendFileSync } from 'fs';

// Debug log file path (same as manager)
const DEBUG_LOG_PATH = './debug.log';

export class LSPClient {
  private process: Subprocess | null = null;
  private requestId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private buffer = '';
  private initialized = false;
  private workspaceRoot: string;
  private notificationHandler: NotificationHandler | null = null;
  private serverCapabilities: Record<string, unknown> = {};
  public debugEnabled = true;  // Enable by default for debugging
  
  constructor(
    private command: string,
    private args: string[],
    workspaceRoot: string
  ) {
    this.workspaceRoot = workspaceRoot;
  }

  private debugLog(msg: string): void {
    if (this.debugEnabled) {
      const timestamp = new Date().toISOString();
      const message = `[${timestamp}] [LSPClient ${this.command}] ${msg}\n`;
      try {
        appendFileSync(DEBUG_LOG_PATH, message);
      } catch {
        // Ignore write errors
      }
    }
  }

  /**
   * Set notification handler
   */
  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  /**
   * Start the language server and initialize
   */
  async start(): Promise<boolean> {
    try {
      this.debugLog(`Starting: ${this.command} ${this.args.join(' ')}`);
      this.debugLog(`Workspace root: ${this.workspaceRoot}`);
      
      this.process = Bun.spawn([this.command, ...this.args], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });

      this.debugLog(`Process spawned, PID: ${this.process.pid}`);

      // Start reading stdout
      this.readLoop();
      
      // Also read stderr for debugging
      this.readStderr();

      // Initialize the server
      this.debugLog('Sending initialize request...');
      const result = await this.request<{
        capabilities: Record<string, unknown>;
      }>('initialize', {
        processId: process.pid,
        rootUri: `file://${this.workspaceRoot}`,
        rootPath: this.workspaceRoot,
        capabilities: {
          textDocument: {
            synchronization: {
              didOpen: true,
              didChange: true,
              didSave: true,
              didClose: true,
            },
            completion: {
              completionItem: {
                snippetSupport: false,
                documentationFormat: ['plaintext', 'markdown'],
              },
            },
            hover: {
              contentFormat: ['plaintext', 'markdown'],
            },
            definition: {},
            references: {},
            rename: {},
            publishDiagnostics: {
              relatedInformation: true,
            },
          },
          workspace: {
            workspaceFolders: true,
          },
        },
        workspaceFolders: [
          { uri: `file://${this.workspaceRoot}`, name: this.workspaceRoot.split('/').pop() || 'workspace' },
        ],
      });

      this.serverCapabilities = result.capabilities;
      this.debugLog(`Server initialized with capabilities: ${Object.keys(result.capabilities).join(', ')}`);

      // Send initialized notification
      this.notify('initialized', {});
      this.initialized = true;
      this.debugLog('Initialization complete');

      return true;
    } catch (error) {
      this.debugLog(`Failed to start: ${error}`);
      console.error('LSP: Failed to start server:', error);
      return false;
    }
  }

  /**
   * Read stderr for debugging
   */
  private async readStderr(): Promise<void> {
    if (!this.process?.stderr) return;

    const stderr = this.process.stderr;
    if (typeof stderr === 'number') return;
    
    const reader = (stderr as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        if (text.trim()) {
          this.debugLog(`stderr: ${text.trim()}`);
        }
      }
    } catch (error) {
      // Server closed or error
    }
  }

  /**
   * Check if server is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get server capabilities
   */
  getCapabilities(): Record<string, unknown> {
    return this.serverCapabilities;
  }

  /**
   * Read loop for stdout
   */
  private async readLoop(): Promise<void> {
    if (!this.process?.stdout) return;

    const stdout = this.process.stdout;
    if (typeof stdout === 'number') return;  // Not a readable stream
    
    const reader = (stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        this.buffer += decoder.decode(value, { stream: true });
        this.processBuffer();
      }
    } catch (error) {
      // Server closed or error
      console.error('LSP: Read error:', error);
    }
  }

  /**
   * Process the buffer for complete messages
   */
  private processBuffer(): void {
    while (true) {
      // Look for Content-Length header
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const header = this.buffer.substring(0, headerEnd);
      const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!contentLengthMatch) {
        // Invalid header, skip to next potential message
        this.buffer = this.buffer.substring(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1]!, 10);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;

      if (this.buffer.length < messageEnd) {
        // Not enough data yet
        return;
      }

      const messageStr = this.buffer.substring(messageStart, messageEnd);
      this.buffer = this.buffer.substring(messageEnd);

      try {
        const message = JSON.parse(messageStr) as JSONRPCMessage;
        this.handleMessage(message);
      } catch (error) {
        console.error('LSP: Failed to parse message:', error);
      }
    }
  }

  /**
   * Handle incoming message
   */
  private handleMessage(msg: JSONRPCMessage): void {
    this.debugLog(`handleMessage: ${JSON.stringify(msg).substring(0, 200)}`);
    
    if ('id' in msg && msg.id !== undefined) {
      if ('method' in msg) {
        // Server request (we need to respond)
        this.handleServerRequest(msg as JSONRPCRequest);
      } else {
        // Response to our request
        const pending = this.pending.get(msg.id);
        if (pending) {
          this.pending.delete(msg.id);
          const response = msg as JSONRPCResponse;
          if (response.error) {
            pending.reject(new Error(`${response.error.message} (${response.error.code})`));
          } else {
            pending.resolve(response.result);
          }
        }
      }
    } else if ('method' in msg) {
      // Server notification
      if (this.notificationHandler) {
        this.notificationHandler(msg.method, msg.params);
      }
    }
  }

  /**
   * Handle server request (respond to it)
   */
  private handleServerRequest(request: JSONRPCRequest): void {
    // Handle common server requests
    let result: unknown = null;

    switch (request.method) {
      case 'window/workDoneProgress/create':
        result = null;
        break;
      case 'client/registerCapability':
        result = null;
        break;
      case 'workspace/configuration':
        result = [];
        break;
      default:
        // Unknown request, send empty result
        result = null;
    }

    this.sendResponse(request.id, result);
  }

  /**
   * Send response to server request
   */
  private sendResponse(id: number, result: unknown, error?: { code: number; message: string }): void {
    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id,
    };
    
    if (error) {
      response.error = error;
    } else {
      response.result = result;
    }

    this.send(response);
  }

  /**
   * Send a request (expects response)
   */
  async request<T>(method: string, params?: unknown): Promise<T> {
    const id = ++this.requestId;
    this.debugLog(`request[${id}]: ${method}`);
    
    return new Promise((resolve, reject) => {
      this.pending.set(id, { 
        resolve: resolve as (value: unknown) => void, 
        reject 
      });

      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.send(request);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          this.debugLog(`request[${id}]: TIMEOUT after 30s`);
          reject(new Error(`LSP request '${method}' timed out`));
        }
      }, 30000);
    });
  }

  /**
   * Send a notification (no response)
   */
  notify(method: string, params?: unknown): void {
    const notification: JSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.send(notification);
  }

  /**
   * Send message to server
   */
  private send(message: JSONRPCMessage): void {
    if (!this.process?.stdin) return;

    const stdin = this.process.stdin;
    if (typeof stdin === 'number') return;  // Not a writable stream

    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
    
    // Write directly to the stdin
    const data = new TextEncoder().encode(header + content);
    (stdin as { write: (data: Uint8Array) => void }).write(data);
  }

  /**
   * Shutdown the server
   */
  async shutdown(): Promise<void> {
    if (!this.process || !this.initialized) return;

    try {
      await this.request('shutdown', null);
      this.notify('exit', null);
    } catch {
      // Ignore errors during shutdown
    }

    this.process.kill();
    this.process = null;
    this.initialized = false;
  }

  // ============ Document Sync Methods ============

  /**
   * Notify server that a document was opened
   */
  didOpen(uri: string, languageId: string, version: number, text: string): void {
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId,
        version,
        text,
      },
    });
  }

  /**
   * Notify server that a document changed
   */
  didChange(uri: string, version: number, text: string): void {
    this.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  /**
   * Notify server that a document was saved
   */
  didSave(uri: string, text?: string): void {
    const params: { textDocument: LSPTextDocumentIdentifier; text?: string } = {
      textDocument: { uri },
    };
    if (text !== undefined) {
      params.text = text;
    }
    this.notify('textDocument/didSave', params);
  }

  /**
   * Notify server that a document was closed
   */
  didClose(uri: string): void {
    this.notify('textDocument/didClose', {
      textDocument: { uri },
    });
  }

  // ============ Feature Methods ============

  /**
   * Get completions at position
   */
  async getCompletions(uri: string, position: LSPPosition): Promise<LSPCompletionItem[]> {
    try {
      const result = await this.request<{ items: LSPCompletionItem[] } | LSPCompletionItem[] | null>(
        'textDocument/completion',
        {
          textDocument: { uri },
          position,
        }
      );

      if (!result) return [];
      if (Array.isArray(result)) return result;
      return result.items || [];
    } catch {
      return [];
    }
  }

  /**
   * Get hover info at position
   */
  async getHover(uri: string, position: LSPPosition): Promise<LSPHover | null> {
    try {
      return await this.request<LSPHover | null>('textDocument/hover', {
        textDocument: { uri },
        position,
      });
    } catch {
      return null;
    }
  }

  /**
   * Get definition location
   */
  async getDefinition(uri: string, position: LSPPosition): Promise<LSPLocation | LSPLocation[] | null> {
    try {
      return await this.request<LSPLocation | LSPLocation[] | null>('textDocument/definition', {
        textDocument: { uri },
        position,
      });
    } catch {
      return null;
    }
  }

  /**
   * Get references
   */
  async getReferences(uri: string, position: LSPPosition, includeDeclaration = true): Promise<LSPLocation[]> {
    try {
      const result = await this.request<LSPLocation[] | null>('textDocument/references', {
        textDocument: { uri },
        position,
        context: { includeDeclaration },
      });
      return result || [];
    } catch {
      return [];
    }
  }

  /**
   * Rename symbol
   */
  async rename(uri: string, position: LSPPosition, newName: string): Promise<Record<string, unknown> | null> {
    try {
      return await this.request<Record<string, unknown> | null>('textDocument/rename', {
        textDocument: { uri },
        position,
        newName,
      });
    } catch {
      return null;
    }
  }
}

export default LSPClient;
