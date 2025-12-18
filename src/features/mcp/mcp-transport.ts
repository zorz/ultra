/**
 * MCP Transport
 *
 * Handles communication between Ultra's MCP server and Claude Code.
 * Uses stdio transport (pipes) for the embedded terminal scenario.
 */

import { debugLog, isDebugEnabled } from '../../debug.ts';
import { MCPServer } from './mcp-server.ts';

// ==================== Types ====================

export interface MCPTransportOptions {
  server: MCPServer;
}

// ==================== Stdio Transport ====================

/**
 * Stdio-based MCP transport
 *
 * This transport creates a named pipe or Unix socket that Claude Code
 * can connect to for MCP communication.
 */
export class StdioTransport {
  private _debugName = 'StdioTransport';
  private _server: MCPServer;
  private _running = false;
  private _pendingMessages: string[] = [];

  constructor(options: MCPTransportOptions) {
    this._server = options.server;
    this.debugLog('Created');
  }

  protected debugLog(msg: string): void {
    if (isDebugEnabled()) {
      debugLog(`[${this._debugName}] ${msg}`);
    }
  }

  /**
   * Process a message from Claude Code
   */
  async processMessage(message: string): Promise<string | null> {
    this.debugLog(`Processing message: ${message.substring(0, 100)}...`);
    return await this._server.handleMessage(message);
  }

  /**
   * Get pending outgoing messages
   */
  getPendingMessages(): string[] {
    const messages = [...this._pendingMessages];
    this._pendingMessages = [];
    return messages;
  }

  /**
   * Queue an outgoing message
   */
  queueMessage(message: string): void {
    this._pendingMessages.push(message);
  }

  /**
   * Start the transport
   */
  start(): void {
    if (this._running) return;
    this._running = true;

    // Set up server message callback
    this._server.onMessage((message) => {
      this.queueMessage(message);
    });

    this.debugLog('Started');
  }

  /**
   * Stop the transport
   */
  stop(): void {
    this._running = false;
    this.debugLog('Stopped');
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this._running;
  }
}

// ==================== HTTP Transport ====================

/**
 * HTTP-based MCP transport
 *
 * Runs an HTTP server that Claude Code can connect to.
 * This is useful for scenarios where Claude Code is running separately.
 */
export class HttpTransport {
  private _debugName = 'HttpTransport';
  private _server: MCPServer;
  private _httpServer: ReturnType<typeof Bun.serve> | null = null;
  private _port: number;

  constructor(options: MCPTransportOptions & { port?: number }) {
    this._server = options.server;
    this._port = options.port || 0; // 0 = auto-assign
    this.debugLog('Created');
  }

  protected debugLog(msg: string): void {
    if (isDebugEnabled()) {
      debugLog(`[${this._debugName}] ${msg}`);
    }
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<number> {
    if (this._httpServer) {
      return this._port;
    }

    this._httpServer = Bun.serve({
      port: this._port,
      fetch: async (req) => {
        // CORS headers for local development
        const corsHeaders = {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        };

        // Handle preflight
        if (req.method === 'OPTIONS') {
          return new Response(null, { headers: corsHeaders });
        }

        // Only accept POST to /mcp
        if (req.method !== 'POST') {
          return new Response('Method not allowed', {
            status: 405,
            headers: corsHeaders,
          });
        }

        const url = new URL(req.url);
        if (url.pathname !== '/mcp' && url.pathname !== '/') {
          return new Response('Not found', {
            status: 404,
            headers: corsHeaders,
          });
        }

        try {
          const body = await req.text();
          this.debugLog(`Received: ${body.substring(0, 100)}...`);

          const response = await this._server.handleMessage(body);

          if (response) {
            return new Response(response, {
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders,
              },
            });
          }

          // No response needed (notification)
          return new Response(null, {
            status: 204,
            headers: corsHeaders,
          });
        } catch (error) {
          this.debugLog(`Error: ${error}`);
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: -32603,
                message: 'Internal error',
              },
            }),
            {
              status: 500,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders,
              },
            }
          );
        }
      },
    });

    this._port = this._httpServer.port;
    this.debugLog(`Started on port ${this._port}`);
    return this._port;
  }

  /**
   * Stop the HTTP server
   */
  stop(): void {
    if (this._httpServer) {
      this._httpServer.stop();
      this._httpServer = null;
      this.debugLog('Stopped');
    }
  }

  /**
   * Get the server port
   */
  getPort(): number {
    return this._port;
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this._httpServer !== null;
  }
}

// ==================== MCP Config Generator ====================

/**
 * Generate MCP config for Claude Code
 *
 * Creates a configuration file that tells Claude Code how to connect to Ultra's MCP server.
 */
export function generateMCPConfig(port: number): object {
  return {
    mcpServers: {
      'ultra-editor': {
        url: `http://localhost:${port}/mcp`,
        transport: 'http',
      },
    },
  };
}

/**
 * Generate MCP config file path
 */
export function getMCPConfigPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
  return `${homeDir}/.ultra-mcp-config.json`;
}

/**
 * Write MCP config file
 */
export async function writeMCPConfig(port: number): Promise<string> {
  const config = generateMCPConfig(port);
  const configPath = getMCPConfigPath();

  await Bun.write(configPath, JSON.stringify(config, null, 2));

  if (isDebugEnabled()) {
    debugLog(`[MCPTransport] Wrote MCP config to: ${configPath}`);
  }

  return configPath;
}
