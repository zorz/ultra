/**
 * AI Integration Module
 *
 * Orchestrates AI features in Ultra:
 * - MCP server for tool exposure
 * - AI chat pane management
 * - Approval system
 * - Command registration
 */

import { debugLog, isDebugEnabled } from '../../debug.ts';
import { commandRegistry } from '../../input/commands.ts';
import { MCPServer, registerUltraTools, HttpTransport, writeMCPConfig } from '../mcp/index.ts';
import type { ToolHandlers, PendingToolCall, ApprovalEntry, UltraContext } from '../mcp/index.ts';
import { AIChatContent, type AIChatContentOptions, type AIProvider } from '../../ui/panels/index.ts';
import { aiApprovalDialog, type ApprovalResult, type ApprovalScope } from '../../ui/components/ai-approval-dialog.ts';
import type { RenderContext } from '../../ui/renderer.ts';

// ==================== Types ====================

export interface AIIntegrationConfig {
  /** Callback to get current editor context */
  getContext: () => Promise<UltraContext>;
  /** Callback to open a file */
  openFile: (path: string, line?: number, column?: number) => Promise<void>;
  /** Callback to read a file */
  readFile: (path: string, startLine?: number, endLine?: number) => Promise<string>;
  /** Callback to edit a file */
  editFile: (
    path: string,
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number,
    newText: string
  ) => Promise<void>;
  /** Callback to insert text at cursor */
  insertText: (text: string) => Promise<void>;
  /** Callback to navigate to a location */
  navigate: (file: string | undefined, line: number, column?: number) => Promise<void>;
  /** Callback to execute a command */
  executeCommand: (commandId: string, args?: Record<string, unknown>) => Promise<void>;
  /** Callback to search files */
  search: (
    query: string,
    options?: {
      regex?: boolean;
      caseSensitive?: boolean;
      includePattern?: string;
      excludePattern?: string;
      maxResults?: number;
    }
  ) => Promise<Array<{ file: string; line: number; column: number; text: string }>>;
  /** Callback to save a file */
  saveFile: (path: string) => Promise<void>;
  /** Callback to create a file */
  createFile: (path: string, content?: string, openAfterCreate?: boolean) => Promise<void>;
  /** Callback to run a terminal command */
  runTerminalCommand: (
    command: string,
    cwd?: string,
    waitForCompletion?: boolean
  ) => Promise<{ output?: string; exitCode?: number }>;
  /** Callback to list commands */
  listCommands: (
    filter?: string
  ) => Promise<Array<{ id: string; title: string; category?: string }>>;
  /** Callback to show a notification */
  showNotification: (
    message: string,
    type?: 'info' | 'warning' | 'error',
    duration?: number
  ) => Promise<void>;
  /** Callback to get screen dimensions */
  getScreenDimensions: () => { width: number; height: number; editorX: number; editorWidth: number };
  /** Callback to trigger render */
  scheduleRender: () => void;
}

// ==================== AI Integration Class ====================

/**
 * Manages AI integration in Ultra editor
 */
export class AIIntegration {
  private _debugName = 'AIIntegration';
  private _config: AIIntegrationConfig | null = null;
  private _mcpServer: MCPServer;
  private _httpTransport: HttpTransport | null = null;
  private _mcpPort: number = 0;

  // AI Chat instances
  private _aiChats: Map<string, AIChatContent> = new Map();
  private _activeAIChatId: string | null = null;
  private _chatIdCounter = 0;

  // Approvals
  private _approvals: ApprovalEntry[] = [];

  // State
  private _initialized = false;

  constructor() {
    this._mcpServer = new MCPServer({
      name: 'ultra-editor',
      version: '1.0.0',
      onApprovalRequired: (call) => this.handleApprovalRequest(call),
    });

    this.debugLog('Created');
  }

  protected debugLog(msg: string): void {
    if (isDebugEnabled()) {
      debugLog(`[${this._debugName}] ${msg}`);
    }
  }

  // ==================== Initialization ====================

  /**
   * Initialize AI integration with app callbacks
   */
  async initialize(config: AIIntegrationConfig): Promise<void> {
    if (this._initialized) {
      this.debugLog('Already initialized');
      return;
    }

    this._config = config;

    // Register tool handlers
    this.registerToolHandlers();

    // Start HTTP transport for MCP
    this._httpTransport = new HttpTransport({
      server: this._mcpServer,
      port: 0, // Auto-assign port
    });

    this._mcpPort = await this._httpTransport.start();
    this.debugLog(`MCP server started on port ${this._mcpPort}`);

    // Write MCP config file for Claude Code
    const configPath = await writeMCPConfig(this._mcpPort);
    this.debugLog(`MCP config written to: ${configPath}`);

    // Register commands
    this.registerCommands();

    // Restore approvals from session if available
    // This would be called separately with session data

    this._initialized = true;
    this.debugLog('Initialized');
  }

  /**
   * Shutdown AI integration
   */
  async shutdown(): Promise<void> {
    this.debugLog('Shutting down');

    // Stop all AI chats
    for (const chat of this._aiChats.values()) {
      chat.dispose();
    }
    this._aiChats.clear();

    // Stop MCP transport
    if (this._httpTransport) {
      this._httpTransport.stop();
      this._httpTransport = null;
    }

    // Dispose MCP server
    this._mcpServer.dispose();

    this._initialized = false;
  }

  // ==================== Tool Handlers ====================

  private registerToolHandlers(): void {
    if (!this._config) return;

    const config = this._config;
    const handlers: ToolHandlers = {
      getContext: async (args) => {
        return await config.getContext();
      },

      openFile: async (args) => {
        await config.openFile(args.path, args.line, args.column);
      },

      readFile: async (args) => {
        return await config.readFile(args.path, args.startLine, args.endLine);
      },

      editFile: async (args) => {
        await config.editFile(
          args.path,
          args.startLine,
          args.startColumn,
          args.endLine,
          args.endColumn,
          args.newText
        );
      },

      insertText: async (args) => {
        await config.insertText(args.text);
      },

      navigate: async (args) => {
        await config.navigate(args.file, args.line, args.column);
      },

      executeCommand: async (args) => {
        await config.executeCommand(args.commandId, args.args);
      },

      search: async (args) => {
        return await config.search(args.query, {
          regex: args.regex,
          caseSensitive: args.caseSensitive,
          includePattern: args.includePattern,
          excludePattern: args.excludePattern,
          maxResults: args.maxResults,
        });
      },

      saveFile: async (args) => {
        await config.saveFile(args.path);
      },

      createFile: async (args) => {
        await config.createFile(args.path, args.content, args.openAfterCreate);
      },

      runTerminalCommand: async (args) => {
        return await config.runTerminalCommand(args.command, args.cwd, args.waitForCompletion);
      },

      listCommands: async (args) => {
        return await config.listCommands(args.filter);
      },

      showNotification: async (args) => {
        await config.showNotification(args.message, args.type, args.duration);
      },
    };

    registerUltraTools(this._mcpServer, handlers);
    this.debugLog('Tool handlers registered');
  }

  // ==================== Approval System ====================

  private async handleApprovalRequest(call: PendingToolCall): Promise<boolean> {
    if (!this._config) return false;

    const dimensions = this._config.getScreenDimensions();

    // Show approval dialog
    const result = await aiApprovalDialog.show({
      toolCall: call,
      screenWidth: dimensions.width,
      screenHeight: dimensions.height,
      editorX: dimensions.editorX,
      editorWidth: dimensions.editorWidth,
    });

    // Trigger render to clear dialog
    this._config.scheduleRender();

    if (result.approved && result.scope) {
      // Save approval for future calls
      const approval: ApprovalEntry = {
        toolName: call.toolName,
        approvedAt: Date.now(),
        scope: result.scope,
      };

      if (result.scope === 'session') {
        // Session approvals expire when Ultra closes
        this._approvals.push(approval);
        this._mcpServer.addApproval(approval);
      } else if (result.scope === 'always') {
        // Always approvals persist across sessions
        this._approvals.push(approval);
        this._mcpServer.addApproval(approval);
        // TODO: Persist to settings file
      }
      // 'once' approvals are not stored
    }

    return result.approved;
  }

  /**
   * Get current approvals for session persistence
   */
  getApprovals(): ApprovalEntry[] {
    return [...this._approvals];
  }

  /**
   * Restore approvals from session
   */
  restoreApprovals(approvals: ApprovalEntry[]): void {
    this._approvals = approvals.filter((a) => a.scope === 'session' || a.scope === 'always');
    this._mcpServer.restoreApprovals(this._approvals);
    this.debugLog(`Restored ${this._approvals.length} approvals`);
  }

  // ==================== AI Chat Management ====================

  /**
   * Create a new AI chat instance
   */
  createAIChat(options?: AIChatContentOptions): AIChatContent {
    const chatId = `ai-chat-${++this._chatIdCounter}`;

    const chat = new AIChatContent(chatId, {
      ...options,
      mcpServerPort: this._mcpPort,
    });

    // Set up callbacks
    chat.onUpdate(() => {
      this._config?.scheduleRender();
    });

    this._aiChats.set(chatId, chat);
    this._activeAIChatId = chatId;

    this.debugLog(`Created AI chat: ${chatId}`);
    return chat;
  }

  /**
   * Get the active AI chat
   */
  getActiveAIChat(): AIChatContent | null {
    if (!this._activeAIChatId) return null;
    return this._aiChats.get(this._activeAIChatId) || null;
  }

  /**
   * Get all AI chats
   */
  getAllAIChats(): AIChatContent[] {
    return Array.from(this._aiChats.values());
  }

  /**
   * Close an AI chat
   */
  closeAIChat(chatId: string): void {
    const chat = this._aiChats.get(chatId);
    if (chat) {
      chat.dispose();
      this._aiChats.delete(chatId);

      if (this._activeAIChatId === chatId) {
        // Switch to another chat or null
        const remaining = Array.from(this._aiChats.keys());
        this._activeAIChatId = remaining[0] || null;
      }

      this.debugLog(`Closed AI chat: ${chatId}`);
    }
  }

  /**
   * Set active AI chat
   */
  setActiveAIChat(chatId: string): void {
    if (this._aiChats.has(chatId)) {
      this._activeAIChatId = chatId;
    }
  }

  // ==================== Commands ====================

  private registerCommands(): void {
    commandRegistry.registerAll([
      {
        id: 'ultra.ai.openChat',
        title: 'Open AI Chat',
        category: 'AI',
        handler: async () => {
          // Create a new AI chat or focus existing one
          let chat = this.getActiveAIChat();
          if (!chat) {
            chat = this.createAIChat();
          }

          // Start the AI session if not running
          if (!chat.isRunning()) {
            await chat.start();
          }

          this._config?.scheduleRender();
        },
      },
      {
        id: 'ultra.ai.newChat',
        title: 'New AI Chat',
        category: 'AI',
        handler: async () => {
          const chat = this.createAIChat();
          await chat.start();
          this._config?.scheduleRender();
        },
      },
      {
        id: 'ultra.ai.closeChat',
        title: 'Close AI Chat',
        category: 'AI',
        handler: () => {
          const chatId = this._activeAIChatId;
          if (chatId) {
            this.closeAIChat(chatId);
            this._config?.scheduleRender();
          }
        },
      },
      {
        id: 'ultra.ai.toggleChat',
        title: 'Toggle AI Chat',
        category: 'AI',
        handler: async () => {
          const chat = this.getActiveAIChat();
          if (chat && chat.isVisible()) {
            chat.setVisible(false);
          } else {
            if (!chat) {
              const newChat = this.createAIChat();
              await newChat.start();
              newChat.setVisible(true);
            } else {
              if (!chat.isRunning()) {
                await chat.start();
              }
              chat.setVisible(true);
            }
          }
          this._config?.scheduleRender();
        },
      },
      {
        id: 'ultra.ai.selectProvider',
        title: 'Select AI Provider',
        category: 'AI',
        handler: () => {
          // TODO: Show provider selection dialog
          this.debugLog('Provider selection not yet implemented');
        },
      },
      {
        id: 'ultra.ai.clearApprovals',
        title: 'Clear AI Approvals',
        category: 'AI',
        handler: () => {
          this._approvals = [];
          this._mcpServer.clearApprovals();
          this._config?.showNotification('AI approvals cleared', 'info');
        },
      },
    ]);

    this.debugLog('Commands registered');
  }

  // ==================== State ====================

  /**
   * Get MCP server port
   */
  getMCPPort(): number {
    return this._mcpPort;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this._initialized;
  }

  /**
   * Serialize state for session persistence
   */
  serialize(): {
    approvals: ApprovalEntry[];
    activeProvider?: AIProvider;
  } {
    return {
      approvals: this._approvals.filter((a) => a.scope === 'session' || a.scope === 'always'),
    };
  }

  /**
   * Restore state from session
   */
  restore(state: { approvals?: ApprovalEntry[]; activeProvider?: AIProvider }): void {
    if (state.approvals) {
      this.restoreApprovals(state.approvals);
    }
  }
}

// ==================== Singleton ====================

export const aiIntegration = new AIIntegration();
export default aiIntegration;
