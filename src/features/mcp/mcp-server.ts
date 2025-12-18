/**
 * MCP Server
 *
 * Model Context Protocol server for Ultra editor.
 * Exposes Ultra's functionality as tools that AI can use.
 *
 * Uses stdio transport for communication with Claude Code.
 */

import { debugLog, isDebugEnabled } from '../../debug.ts';
import {
  type JSONRPCRequest,
  type JSONRPCResponse,
  type JSONRPCError,
  type MCPTool,
  type MCPServerInfo,
  type MCPCapabilities,
  type InitializeParams,
  type InitializeResult,
  type CallToolParams,
  type CallToolResult,
  type PendingToolCall,
  type ApprovalEntry,
  type MCPContent,
  MCP_METHODS,
  JSONRPC_ERRORS,
} from './mcp-types.ts';

// ==================== Types ====================

export interface MCPServerOptions {
  name?: string;
  version?: string;
  onApprovalRequired?: (call: PendingToolCall) => Promise<boolean>;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<CallToolResult>;

interface RegisteredTool {
  definition: MCPTool;
  handler: ToolHandler;
  requiresApproval: boolean;
}

// ==================== MCP Server Class ====================

/**
 * MCP Server for Ultra editor
 *
 * Handles JSON-RPC communication and tool execution.
 */
export class MCPServer {
  private _debugName = 'MCPServer';
  private _initialized = false;
  private _tools: Map<string, RegisteredTool> = new Map();
  private _pendingCalls: Map<string, PendingToolCall> = new Map();
  private _approvals: ApprovalEntry[] = [];
  private _callIdCounter = 0;

  private _serverInfo: MCPServerInfo;
  private _capabilities: MCPCapabilities;
  private _onApprovalRequired?: (call: PendingToolCall) => Promise<boolean>;

  // Callbacks
  private _onMessageCallback?: (message: string) => void;

  constructor(options: MCPServerOptions = {}) {
    this._serverInfo = {
      name: options.name || 'ultra-editor',
      version: options.version || '1.0.0',
      protocolVersion: '2024-11-05',
    };

    this._capabilities = {
      tools: {
        listChanged: true,
      },
      resources: {
        subscribe: false,
        listChanged: true,
      },
      prompts: {
        listChanged: false,
      },
      logging: {},
    };

    this._onApprovalRequired = options.onApprovalRequired;
    this.debugLog('Server created');
  }

  // ==================== Debug ====================

  protected debugLog(msg: string): void {
    if (isDebugEnabled()) {
      debugLog(`[${this._debugName}] ${msg}`);
    }
  }

  // ==================== Tool Registration ====================

  /**
   * Register a tool with the MCP server
   */
  registerTool(
    definition: MCPTool,
    handler: ToolHandler,
    requiresApproval: boolean = true
  ): void {
    this._tools.set(definition.name, {
      definition,
      handler,
      requiresApproval,
    });
    this.debugLog(`Registered tool: ${definition.name}`);
  }

  /**
   * Unregister a tool
   */
  unregisterTool(name: string): void {
    this._tools.delete(name);
    this.debugLog(`Unregistered tool: ${name}`);
  }

  /**
   * Get all registered tools
   */
  getTools(): MCPTool[] {
    return Array.from(this._tools.values()).map((t) => t.definition);
  }

  // ==================== Approval System ====================

  /**
   * Check if a tool call is approved
   */
  private isApproved(toolName: string, args: Record<string, unknown>): boolean {
    const now = Date.now();

    for (const approval of this._approvals) {
      if (approval.toolName !== toolName) continue;

      // Check expiration
      if (approval.expiresAt && approval.expiresAt < now) continue;

      // For 'once' approvals, they're consumed when used
      if (approval.scope === 'once') {
        this._approvals = this._approvals.filter((a) => a !== approval);
        return true;
      }

      // For 'always' or 'session' approvals with no pattern, approve
      if (!approval.argumentPattern) {
        return true;
      }

      // Check if arguments match the pattern
      if (this.matchesPattern(args, approval.argumentPattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if arguments match an approval pattern
   */
  private matchesPattern(
    args: Record<string, unknown>,
    pattern: Record<string, unknown>
  ): boolean {
    for (const [key, value] of Object.entries(pattern)) {
      if (args[key] !== value) {
        return false;
      }
    }
    return true;
  }

  /**
   * Add an approval entry
   */
  addApproval(entry: ApprovalEntry): void {
    this._approvals.push(entry);
    this.debugLog(`Added approval for: ${entry.toolName} (${entry.scope})`);
  }

  /**
   * Get all approvals (for session persistence)
   */
  getApprovals(): ApprovalEntry[] {
    return [...this._approvals];
  }

  /**
   * Restore approvals from session
   */
  restoreApprovals(approvals: ApprovalEntry[]): void {
    // Only restore session and always scoped approvals
    this._approvals = approvals.filter(
      (a) => a.scope === 'session' || a.scope === 'always'
    );
    this.debugLog(`Restored ${this._approvals.length} approvals`);
  }

  /**
   * Clear all approvals
   */
  clearApprovals(): void {
    this._approvals = [];
    this.debugLog('Cleared all approvals');
  }

  // ==================== Message Handling ====================

  /**
   * Process an incoming JSON-RPC message
   */
  async handleMessage(message: string): Promise<string | null> {
    try {
      const request = JSON.parse(message) as JSONRPCRequest;
      this.debugLog(`Received: ${request.method}`);

      const response = await this.handleRequest(request);

      if (response) {
        const responseStr = JSON.stringify(response);
        this.debugLog(`Sending response for: ${request.method}`);
        return responseStr;
      }

      return null;
    } catch (error) {
      const errorResponse: JSONRPCResponse = {
        jsonrpc: '2.0',
        id: 0,
        error: {
          code: JSONRPC_ERRORS.PARSE_ERROR,
          message: 'Parse error',
          data: String(error),
        },
      };
      return JSON.stringify(errorResponse);
    }
  }

  /**
   * Handle a parsed JSON-RPC request
   */
  private async handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse | null> {
    const { id, method, params } = request;

    try {
      let result: unknown;

      switch (method) {
        case MCP_METHODS.INITIALIZE:
          result = this.handleInitialize(params as InitializeParams);
          break;

        case MCP_METHODS.INITIALIZED:
          // Notification, no response needed
          this._initialized = true;
          this.debugLog('Client initialized');
          return null;

        case MCP_METHODS.SHUTDOWN:
          result = this.handleShutdown();
          break;

        case MCP_METHODS.TOOLS_LIST:
          result = this.handleToolsList();
          break;

        case MCP_METHODS.TOOLS_CALL:
          result = await this.handleToolCall(params as CallToolParams);
          break;

        case MCP_METHODS.RESOURCES_LIST:
          result = { resources: [] }; // Not implemented yet
          break;

        case MCP_METHODS.PROMPTS_LIST:
          result = { prompts: [] }; // Not implemented yet
          break;

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: JSONRPC_ERRORS.METHOD_NOT_FOUND,
              message: `Method not found: ${method}`,
            },
          };
      }

      return {
        jsonrpc: '2.0',
        id,
        result,
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: JSONRPC_ERRORS.INTERNAL_ERROR,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  // ==================== Method Handlers ====================

  private handleInitialize(params: InitializeParams): InitializeResult {
    this.debugLog(`Client: ${params.clientInfo.name} v${params.clientInfo.version}`);

    return {
      protocolVersion: this._serverInfo.protocolVersion,
      capabilities: this._capabilities,
      serverInfo: this._serverInfo,
    };
  }

  private handleShutdown(): {} {
    this.debugLog('Shutdown requested');
    this._initialized = false;
    return {};
  }

  private handleToolsList(): { tools: MCPTool[] } {
    return {
      tools: this.getTools(),
    };
  }

  private async handleToolCall(params: CallToolParams): Promise<CallToolResult> {
    const { name, arguments: args = {} } = params;

    const tool = this._tools.get(name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    // Check if approval is required
    if (tool.requiresApproval && !this.isApproved(name, args)) {
      // Create pending call
      const callId = `call-${++this._callIdCounter}`;
      const pendingCall: PendingToolCall = {
        id: callId,
        toolName: name,
        arguments: args,
        requestedAt: Date.now(),
        status: 'pending',
      };

      this._pendingCalls.set(callId, pendingCall);

      // Request approval
      if (this._onApprovalRequired) {
        const approved = await this._onApprovalRequired(pendingCall);

        if (approved) {
          pendingCall.status = 'approved';
          pendingCall.approvedAt = Date.now();
        } else {
          pendingCall.status = 'denied';
          pendingCall.deniedAt = Date.now();
          return {
            content: [{ type: 'text', text: 'Tool call was denied by user' }],
            isError: true,
          };
        }
      } else {
        // No approval handler, deny by default
        return {
          content: [{ type: 'text', text: 'Tool requires approval but no handler is configured' }],
          isError: true,
        };
      }
    }

    // Execute the tool
    try {
      this.debugLog(`Executing tool: ${name}`);
      const result = await tool.handler(args);
      return result;
    } catch (error) {
      this.debugLog(`Tool error: ${error}`);
      return {
        content: [
          {
            type: 'text',
            text: `Tool execution error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  // ==================== Notifications ====================

  /**
   * Send a notification to the client
   */
  sendNotification(method: string, params?: unknown): void {
    if (!this._onMessageCallback) return;

    const notification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this._onMessageCallback(JSON.stringify(notification));
  }

  /**
   * Notify that tools list has changed
   */
  notifyToolsChanged(): void {
    this.sendNotification(MCP_METHODS.TOOLS_LIST_CHANGED);
  }

  // ==================== Lifecycle ====================

  /**
   * Register callback for outgoing messages
   */
  onMessage(callback: (message: string) => void): () => void {
    this._onMessageCallback = callback;
    return () => {
      this._onMessageCallback = undefined;
    };
  }

  /**
   * Check if server is initialized
   */
  isInitialized(): boolean {
    return this._initialized;
  }

  /**
   * Get pending tool calls
   */
  getPendingCalls(): PendingToolCall[] {
    return Array.from(this._pendingCalls.values()).filter(
      (c) => c.status === 'pending'
    );
  }

  /**
   * Dispose of the server
   */
  dispose(): void {
    this.debugLog('Disposing');
    this._tools.clear();
    this._pendingCalls.clear();
    this._approvals = [];
    this._initialized = false;
    this._onMessageCallback = undefined;
  }
}

// ==================== Helper Functions ====================

/**
 * Create a text content response
 */
export function textContent(text: string): MCPContent {
  return { type: 'text', text };
}

/**
 * Create a successful tool result
 */
export function successResult(text: string): CallToolResult {
  return {
    content: [textContent(text)],
    isError: false,
  };
}

/**
 * Create an error tool result
 */
export function errorResult(message: string): CallToolResult {
  return {
    content: [textContent(message)],
    isError: true,
  };
}

// ==================== Singleton ====================

export const mcpServer = new MCPServer();
export default mcpServer;
