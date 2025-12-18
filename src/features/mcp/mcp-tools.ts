/**
 * MCP Tools for Ultra Editor
 *
 * Defines the tools that AI can use to interact with Ultra.
 * Each tool is registered with the MCP server and can be called by connected AI clients.
 */

import type { MCPTool, CallToolResult, UltraContext } from './mcp-types.ts';
import { MCPServer, successResult, errorResult, textContent } from './mcp-server.ts';
import { debugLog, isDebugEnabled } from '../../debug.ts';

// ==================== Tool Definitions ====================

/**
 * Get current editor context
 */
export const getContextTool: MCPTool = {
  name: 'ultra_get_context',
  description: 'Get the current editor context including active file, cursor position, selection, open files, and project information',
  inputSchema: {
    type: 'object',
    properties: {
      includeContent: {
        type: 'boolean',
        description: 'Whether to include file content in the response',
        default: true,
      },
      includeGitStatus: {
        type: 'boolean',
        description: 'Whether to include git status information',
        default: true,
      },
      includeDiagnostics: {
        type: 'boolean',
        description: 'Whether to include LSP diagnostics',
        default: false,
      },
    },
  },
};

/**
 * Open a file in the editor
 */
export const openFileTool: MCPTool = {
  name: 'ultra_open_file',
  description: 'Open a file in the Ultra editor',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path to open (absolute or relative to project root)',
      },
      line: {
        type: 'number',
        description: 'Optional line number to navigate to (1-indexed)',
      },
      column: {
        type: 'number',
        description: 'Optional column number to navigate to (1-indexed)',
      },
    },
    required: ['path'],
  },
};

/**
 * Read file content
 */
export const readFileTool: MCPTool = {
  name: 'ultra_read_file',
  description: 'Read the content of a file',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path to read',
      },
      startLine: {
        type: 'number',
        description: 'Optional start line (1-indexed)',
      },
      endLine: {
        type: 'number',
        description: 'Optional end line (1-indexed)',
      },
    },
    required: ['path'],
  },
};

/**
 * Edit file content
 */
export const editFileTool: MCPTool = {
  name: 'ultra_edit_file',
  description: 'Edit file content by replacing text at specified location',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path to edit (or "active" for current file)',
      },
      startLine: {
        type: 'number',
        description: 'Start line of the edit range (1-indexed)',
      },
      startColumn: {
        type: 'number',
        description: 'Start column of the edit range (1-indexed)',
      },
      endLine: {
        type: 'number',
        description: 'End line of the edit range (1-indexed)',
      },
      endColumn: {
        type: 'number',
        description: 'End column of the edit range (1-indexed)',
      },
      newText: {
        type: 'string',
        description: 'The new text to insert',
      },
    },
    required: ['path', 'startLine', 'startColumn', 'endLine', 'endColumn', 'newText'],
  },
};

/**
 * Insert text at cursor
 */
export const insertTextTool: MCPTool = {
  name: 'ultra_insert_text',
  description: 'Insert text at the current cursor position in the active file',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to insert',
      },
    },
    required: ['text'],
  },
};

/**
 * Navigate to location
 */
export const navigateTool: MCPTool = {
  name: 'ultra_navigate',
  description: 'Navigate the cursor to a specific location',
  inputSchema: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'File to navigate to (or "active" for current file)',
      },
      line: {
        type: 'number',
        description: 'Line number (1-indexed)',
      },
      column: {
        type: 'number',
        description: 'Column number (1-indexed)',
      },
    },
    required: ['line'],
  },
};

/**
 * Execute a command
 */
export const executeCommandTool: MCPTool = {
  name: 'ultra_execute_command',
  description: 'Execute an Ultra editor command by ID',
  inputSchema: {
    type: 'object',
    properties: {
      commandId: {
        type: 'string',
        description: 'The command ID to execute (e.g., "editor.save", "editor.formatDocument")',
      },
      args: {
        type: 'object',
        description: 'Optional arguments for the command',
      },
    },
    required: ['commandId'],
  },
};

/**
 * Search in files
 */
export const searchTool: MCPTool = {
  name: 'ultra_search',
  description: 'Search for text across files in the project',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query (supports regex)',
      },
      regex: {
        type: 'boolean',
        description: 'Whether the query is a regular expression',
        default: false,
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Whether the search is case-sensitive',
        default: false,
      },
      includePattern: {
        type: 'string',
        description: 'Glob pattern for files to include',
      },
      excludePattern: {
        type: 'string',
        description: 'Glob pattern for files to exclude',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results to return',
        default: 100,
      },
    },
    required: ['query'],
  },
};

/**
 * Save file
 */
export const saveFileTool: MCPTool = {
  name: 'ultra_save_file',
  description: 'Save a file',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path to save (or "active" for current file, or "all" for all files)',
      },
    },
    required: ['path'],
  },
};

/**
 * Create a new file
 */
export const createFileTool: MCPTool = {
  name: 'ultra_create_file',
  description: 'Create a new file with optional initial content',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path for the new file',
      },
      content: {
        type: 'string',
        description: 'Initial content for the file',
        default: '',
      },
      openAfterCreate: {
        type: 'boolean',
        description: 'Whether to open the file after creating it',
        default: true,
      },
    },
    required: ['path'],
  },
};

/**
 * Run terminal command
 */
export const runTerminalCommandTool: MCPTool = {
  name: 'ultra_run_terminal',
  description: 'Run a command in the integrated terminal',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command to run',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the command',
      },
      waitForCompletion: {
        type: 'boolean',
        description: 'Whether to wait for the command to complete before returning',
        default: false,
      },
    },
    required: ['command'],
  },
};

/**
 * Get list of available commands
 */
export const listCommandsTool: MCPTool = {
  name: 'ultra_list_commands',
  description: 'Get a list of available Ultra editor commands',
  inputSchema: {
    type: 'object',
    properties: {
      filter: {
        type: 'string',
        description: 'Optional filter to search commands by name or category',
      },
    },
  },
};

/**
 * Show notification to user
 */
export const showNotificationTool: MCPTool = {
  name: 'ultra_show_notification',
  description: 'Show a notification message to the user',
  inputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The message to display',
      },
      type: {
        type: 'string',
        description: 'Type of notification',
        enum: ['info', 'warning', 'error'],
        default: 'info',
      },
      duration: {
        type: 'number',
        description: 'Duration in milliseconds (0 for persistent)',
        default: 5000,
      },
    },
    required: ['message'],
  },
};

// ==================== All Tools ====================

export const ALL_TOOLS: MCPTool[] = [
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
];

// ==================== Tool Registration ====================

/**
 * Tool handler registry
 * Maps tool names to their implementation functions
 */
export interface ToolHandlers {
  getContext: (args: {
    includeContent?: boolean;
    includeGitStatus?: boolean;
    includeDiagnostics?: boolean;
  }) => Promise<UltraContext>;

  openFile: (args: { path: string; line?: number; column?: number }) => Promise<void>;

  readFile: (args: {
    path: string;
    startLine?: number;
    endLine?: number;
  }) => Promise<string>;

  editFile: (args: {
    path: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    newText: string;
  }) => Promise<void>;

  insertText: (args: { text: string }) => Promise<void>;

  navigate: (args: { file?: string; line: number; column?: number }) => Promise<void>;

  executeCommand: (args: { commandId: string; args?: Record<string, unknown> }) => Promise<void>;

  search: (args: {
    query: string;
    regex?: boolean;
    caseSensitive?: boolean;
    includePattern?: string;
    excludePattern?: string;
    maxResults?: number;
  }) => Promise<Array<{ file: string; line: number; column: number; text: string }>>;

  saveFile: (args: { path: string }) => Promise<void>;

  createFile: (args: {
    path: string;
    content?: string;
    openAfterCreate?: boolean;
  }) => Promise<void>;

  runTerminalCommand: (args: {
    command: string;
    cwd?: string;
    waitForCompletion?: boolean;
  }) => Promise<{ output?: string; exitCode?: number }>;

  listCommands: (args: { filter?: string }) => Promise<
    Array<{ id: string; title: string; category?: string }>
  >;

  showNotification: (args: {
    message: string;
    type?: 'info' | 'warning' | 'error';
    duration?: number;
  }) => Promise<void>;
}

/**
 * Register all Ultra tools with an MCP server
 */
export function registerUltraTools(server: MCPServer, handlers: ToolHandlers): void {
  const log = (msg: string) => {
    if (isDebugEnabled()) {
      debugLog(`[MCPTools] ${msg}`);
    }
  };

  // Get context - no approval required (read-only)
  server.registerTool(
    getContextTool,
    async (args) => {
      try {
        const context = await handlers.getContext(args as Parameters<typeof handlers.getContext>[0]);
        return successResult(JSON.stringify(context, null, 2));
      } catch (e) {
        return errorResult(`Failed to get context: ${e}`);
      }
    },
    false // No approval required
  );

  // Open file - requires approval
  server.registerTool(
    openFileTool,
    async (args) => {
      try {
        await handlers.openFile(args as Parameters<typeof handlers.openFile>[0]);
        return successResult(`Opened file: ${args.path}`);
      } catch (e) {
        return errorResult(`Failed to open file: ${e}`);
      }
    },
    true
  );

  // Read file - no approval required (read-only)
  server.registerTool(
    readFileTool,
    async (args) => {
      try {
        const content = await handlers.readFile(args as Parameters<typeof handlers.readFile>[0]);
        return successResult(content);
      } catch (e) {
        return errorResult(`Failed to read file: ${e}`);
      }
    },
    false
  );

  // Edit file - requires approval
  server.registerTool(
    editFileTool,
    async (args) => {
      try {
        await handlers.editFile(args as Parameters<typeof handlers.editFile>[0]);
        return successResult(`Edited file: ${args.path}`);
      } catch (e) {
        return errorResult(`Failed to edit file: ${e}`);
      }
    },
    true
  );

  // Insert text - requires approval
  server.registerTool(
    insertTextTool,
    async (args) => {
      try {
        await handlers.insertText(args as Parameters<typeof handlers.insertText>[0]);
        return successResult('Text inserted');
      } catch (e) {
        return errorResult(`Failed to insert text: ${e}`);
      }
    },
    true
  );

  // Navigate - requires approval (changes user view)
  server.registerTool(
    navigateTool,
    async (args) => {
      try {
        await handlers.navigate(args as Parameters<typeof handlers.navigate>[0]);
        return successResult(`Navigated to line ${args.line}`);
      } catch (e) {
        return errorResult(`Failed to navigate: ${e}`);
      }
    },
    true
  );

  // Execute command - requires approval
  server.registerTool(
    executeCommandTool,
    async (args) => {
      try {
        await handlers.executeCommand(args as Parameters<typeof handlers.executeCommand>[0]);
        return successResult(`Executed command: ${args.commandId}`);
      } catch (e) {
        return errorResult(`Failed to execute command: ${e}`);
      }
    },
    true
  );

  // Search - no approval required (read-only)
  server.registerTool(
    searchTool,
    async (args) => {
      try {
        const results = await handlers.search(args as Parameters<typeof handlers.search>[0]);
        return successResult(JSON.stringify(results, null, 2));
      } catch (e) {
        return errorResult(`Search failed: ${e}`);
      }
    },
    false
  );

  // Save file - requires approval
  server.registerTool(
    saveFileTool,
    async (args) => {
      try {
        await handlers.saveFile(args as Parameters<typeof handlers.saveFile>[0]);
        return successResult(`Saved: ${args.path}`);
      } catch (e) {
        return errorResult(`Failed to save: ${e}`);
      }
    },
    true
  );

  // Create file - requires approval
  server.registerTool(
    createFileTool,
    async (args) => {
      try {
        await handlers.createFile(args as Parameters<typeof handlers.createFile>[0]);
        return successResult(`Created file: ${args.path}`);
      } catch (e) {
        return errorResult(`Failed to create file: ${e}`);
      }
    },
    true
  );

  // Run terminal command - requires approval
  server.registerTool(
    runTerminalCommandTool,
    async (args) => {
      try {
        const result = await handlers.runTerminalCommand(
          args as Parameters<typeof handlers.runTerminalCommand>[0]
        );
        if (result.output !== undefined) {
          return successResult(result.output);
        }
        return successResult('Command started');
      } catch (e) {
        return errorResult(`Failed to run command: ${e}`);
      }
    },
    true
  );

  // List commands - no approval required (read-only)
  server.registerTool(
    listCommandsTool,
    async (args) => {
      try {
        const commands = await handlers.listCommands(
          args as Parameters<typeof handlers.listCommands>[0]
        );
        return successResult(JSON.stringify(commands, null, 2));
      } catch (e) {
        return errorResult(`Failed to list commands: ${e}`);
      }
    },
    false
  );

  // Show notification - no approval required (informational)
  server.registerTool(
    showNotificationTool,
    async (args) => {
      try {
        await handlers.showNotification(
          args as Parameters<typeof handlers.showNotification>[0]
        );
        return successResult('Notification shown');
      } catch (e) {
        return errorResult(`Failed to show notification: ${e}`);
      }
    },
    false
  );

  log(`Registered ${ALL_TOOLS.length} tools`);
}
