/**
 * MCP (Model Context Protocol) Types
 *
 * TypeScript definitions for the MCP protocol.
 * MCP uses JSON-RPC 2.0 as its base protocol.
 *
 * @see https://modelcontextprotocol.io/
 */

// ==================== JSON-RPC 2.0 Base ====================

export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: JSONRPCError;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

// Standard JSON-RPC error codes
export const JSONRPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

// ==================== MCP Protocol Types ====================

/**
 * MCP Server Information
 */
export interface MCPServerInfo {
  name: string;
  version: string;
  protocolVersion: string;
}

/**
 * MCP Client Information
 */
export interface MCPClientInfo {
  name: string;
  version: string;
}

/**
 * MCP Capabilities
 */
export interface MCPCapabilities {
  tools?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
  prompts?: {
    listChanged?: boolean;
  };
  logging?: {};
}

// ==================== MCP Initialize ====================

export interface InitializeParams {
  protocolVersion: string;
  capabilities: MCPCapabilities;
  clientInfo: MCPClientInfo;
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: MCPCapabilities;
  serverInfo: MCPServerInfo;
}

// ==================== MCP Tools ====================

/**
 * Tool definition
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, MCPToolProperty>;
    required?: string[];
  };
}

export interface MCPToolProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  items?: MCPToolProperty;
  default?: unknown;
}

/**
 * Tool call request
 */
export interface CallToolParams {
  name: string;
  arguments?: Record<string, unknown>;
}

/**
 * Tool call result
 */
export interface CallToolResult {
  content: MCPContent[];
  isError?: boolean;
}

// ==================== MCP Content ====================

export type MCPContent = MCPTextContent | MCPImageContent | MCPResourceContent;

export interface MCPTextContent {
  type: 'text';
  text: string;
}

export interface MCPImageContent {
  type: 'image';
  data: string; // base64
  mimeType: string;
}

export interface MCPResourceContent {
  type: 'resource';
  resource: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string; // base64
  };
}

// ==================== MCP Resources ====================

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ReadResourceParams {
  uri: string;
}

export interface ReadResourceResult {
  contents: MCPResourceContent[];
}

// ==================== MCP Prompts ====================

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: MCPPromptArgument[];
}

export interface MCPPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface GetPromptParams {
  name: string;
  arguments?: Record<string, string>;
}

export interface GetPromptResult {
  description?: string;
  messages: MCPPromptMessage[];
}

export interface MCPPromptMessage {
  role: 'user' | 'assistant';
  content: MCPTextContent | MCPImageContent | MCPResourceContent;
}

// ==================== MCP Logging ====================

export type MCPLogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';

export interface MCPLogMessage {
  level: MCPLogLevel;
  logger?: string;
  data?: unknown;
}

// ==================== Tool Request/Response with Approval ====================

/**
 * Extended tool call with approval tracking
 */
export interface PendingToolCall {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  requestedAt: number;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  approvedAt?: number;
  deniedAt?: number;
  result?: CallToolResult;
}

/**
 * Approval persistence entry
 */
export interface ApprovalEntry {
  toolName: string;
  argumentPattern?: Record<string, unknown>; // For pattern-based approval
  approvedAt: number;
  expiresAt?: number;
  scope: 'once' | 'session' | 'always';
}

// ==================== Ultra-specific Extensions ====================

/**
 * Ultra editor context for AI
 */
export interface UltraContext {
  activeFile?: {
    path: string;
    language: string;
    content: string;
    cursorLine: number;
    cursorColumn: number;
    selection?: {
      startLine: number;
      startColumn: number;
      endLine: number;
      endColumn: number;
      text: string;
    };
  };
  openFiles: Array<{
    path: string;
    language: string;
    isDirty: boolean;
  }>;
  projectRoot: string;
  gitBranch?: string;
  gitStatus?: {
    modified: string[];
    staged: string[];
    untracked: string[];
  };
  diagnostics?: Array<{
    file: string;
    line: number;
    column: number;
    message: string;
    severity: 'error' | 'warning' | 'info' | 'hint';
  }>;
}

// ==================== MCP Method Names ====================

export const MCP_METHODS = {
  // Lifecycle
  INITIALIZE: 'initialize',
  INITIALIZED: 'notifications/initialized',
  SHUTDOWN: 'shutdown',

  // Tools
  TOOLS_LIST: 'tools/list',
  TOOLS_CALL: 'tools/call',

  // Resources
  RESOURCES_LIST: 'resources/list',
  RESOURCES_READ: 'resources/read',
  RESOURCES_SUBSCRIBE: 'resources/subscribe',
  RESOURCES_UNSUBSCRIBE: 'resources/unsubscribe',

  // Prompts
  PROMPTS_LIST: 'prompts/list',
  PROMPTS_GET: 'prompts/get',

  // Logging
  LOGGING_SET_LEVEL: 'logging/setLevel',

  // Notifications
  CANCELLED: 'notifications/cancelled',
  PROGRESS: 'notifications/progress',
  MESSAGE: 'notifications/message',
  RESOURCES_UPDATED: 'notifications/resources/updated',
  RESOURCES_LIST_CHANGED: 'notifications/resources/list_changed',
  TOOLS_LIST_CHANGED: 'notifications/tools/list_changed',
  PROMPTS_LIST_CHANGED: 'notifications/prompts/list_changed',
} as const;

export type MCPMethod = (typeof MCP_METHODS)[keyof typeof MCP_METHODS];
