/**
 * MCP (Model Context Protocol) Module
 *
 * Provides MCP server functionality for Ultra editor,
 * allowing AI tools like Claude Code to interact with Ultra.
 */

// Types
export type {
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCError,
  MCPServerInfo,
  MCPClientInfo,
  MCPCapabilities,
  MCPTool,
  MCPToolProperty,
  MCPContent,
  MCPTextContent,
  MCPImageContent,
  MCPResourceContent,
  MCPResource,
  MCPPrompt,
  MCPLogLevel,
  MCPLogMessage,
  CallToolParams,
  CallToolResult,
  PendingToolCall,
  ApprovalEntry,
  UltraContext,
  InitializeParams,
  InitializeResult,
} from './mcp-types.ts';

export { MCP_METHODS, JSONRPC_ERRORS } from './mcp-types.ts';

// Server
export {
  MCPServer,
  textContent,
  successResult,
  errorResult,
  mcpServer,
  type MCPServerOptions,
  type ToolHandler,
} from './mcp-server.ts';

// Tools
export {
  ALL_TOOLS,
  registerUltraTools,
  getContextTool,
  openFileTool,
  readFileTool,
  editFileTool,
  insertTextTool,
  navigateTool,
  executeCommandTool,
  searchTool,
  saveFileTool,
  createFileTool,
  runTerminalCommandTool,
  listCommandsTool,
  showNotificationTool,
  type ToolHandlers,
} from './mcp-tools.ts';

// Transport
export {
  StdioTransport,
  HttpTransport,
  generateMCPConfig,
  getMCPConfigPath,
  writeMCPConfig,
} from './mcp-transport.ts';
