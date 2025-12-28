/**
 * WebSocket Transport Layer for ECP
 *
 * Wraps the ECP server to enable WebSocket communication with web clients.
 * Uses JSON-RPC 2.0 over WebSocket.
 */

import type { ServerWebSocket } from 'bun';
import type { ECPServer } from '../../../ecp/server.ts';
import { debugLog } from '../../../debug.ts';

interface ClientConnection {
  id: string;
  ws: ServerWebSocket<ClientData>;
  subscriptions: Set<string>;
  authenticated: boolean;
}

interface ClientData {
  clientId: string;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface WebSocketTransportConfig {
  /** Require authentication for connections */
  requireAuth?: boolean;
  /** Authentication token (required if requireAuth is true) */
  authToken?: string;
  /** Allow connections from any origin (default: localhost only) */
  allowRemote?: boolean;
}

export class WebSocketTransport {
  private ecpServer: ECPServer;
  private clients = new Map<string, ClientConnection>();
  private config: WebSocketTransportConfig;

  constructor(ecpServer: ECPServer, config: WebSocketTransportConfig = {}) {
    this.ecpServer = ecpServer;
    this.config = {
      requireAuth: config.requireAuth ?? false,
      authToken: config.authToken,
      allowRemote: config.allowRemote ?? false,
    };

    this.setupNotificationForwarding();
    this.log('Initialized');
  }

  private log(msg: string): void {
    debugLog(`[WebSocketTransport] ${msg}`);
  }

  /**
   * Handle new WebSocket connection.
   * Called from the Bun server's WebSocket handler.
   */
  handleOpen(ws: ServerWebSocket<ClientData>): void {
    const clientId = ws.data.clientId;

    const client: ClientConnection = {
      id: clientId,
      ws,
      subscriptions: new Set(),
      authenticated: !this.config.requireAuth,
    };

    this.clients.set(clientId, client);
    this.log(`Client connected: ${clientId}`);

    // Send welcome message
    this.send(ws, {
      jsonrpc: '2.0',
      method: 'server/welcome',
      params: {
        version: '1.0.0',
        requiresAuth: this.config.requireAuth,
      },
    });
  }

  /**
   * Handle WebSocket message.
   */
  async handleMessage(ws: ServerWebSocket<ClientData>, data: string | Buffer): Promise<void> {
    const clientId = ws.data.clientId;
    const client = this.clients.get(clientId);

    if (!client) {
      this.log(`Message from unknown client: ${clientId}`);
      return;
    }

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(typeof data === 'string' ? data : data.toString());
    } catch {
      this.sendError(ws, null, -32700, 'Parse error: Invalid JSON');
      return;
    }

    // Validate JSON-RPC format
    if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      this.sendError(ws, request.id ?? null, -32600, 'Invalid Request');
      return;
    }

    // Handle authentication
    if (this.config.requireAuth && !client.authenticated) {
      if (request.method === 'auth/token') {
        await this.handleAuth(client, request);
        return;
      }
      this.sendError(ws, request.id ?? null, 401, 'Authentication required');
      return;
    }

    // Handle subscription requests
    if (request.method === 'notifications/subscribe') {
      this.handleSubscribe(client, request);
      return;
    }

    if (request.method === 'notifications/unsubscribe') {
      this.handleUnsubscribe(client, request);
      return;
    }

    // Route to ECP server
    try {
      const response = await this.ecpServer.requestRaw(request.method, request.params);

      if (request.id !== undefined) {
        this.send(ws, {
          jsonrpc: '2.0',
          id: request.id,
          ...('error' in response ? { error: response.error } : { result: response.result }),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sendError(ws, request.id ?? null, -32603, `Internal error: ${message}`);
    }
  }

  /**
   * Handle WebSocket close.
   */
  handleClose(ws: ServerWebSocket<ClientData>): void {
    const clientId = ws.data.clientId;
    this.clients.delete(clientId);
    this.log(`Client disconnected: ${clientId}`);
  }

  /**
   * Handle authentication request.
   */
  private async handleAuth(client: ClientConnection, request: JsonRpcRequest): Promise<void> {
    const params = request.params as { token?: string } | undefined;
    const token = params?.token;

    if (token === this.config.authToken) {
      client.authenticated = true;
      this.send(client.ws, {
        jsonrpc: '2.0',
        id: request.id,
        result: { success: true },
      });
      this.log(`Client authenticated: ${client.id}`);
    } else {
      this.sendError(client.ws, request.id ?? null, 401, 'Invalid token');
      this.log(`Authentication failed for: ${client.id}`);
    }
  }

  /**
   * Handle notification subscription.
   */
  private handleSubscribe(client: ClientConnection, request: JsonRpcRequest): void {
    const params = request.params as { events?: string[] } | undefined;
    const events = params?.events ?? [];

    for (const event of events) {
      client.subscriptions.add(event);
    }

    if (request.id !== undefined) {
      this.send(client.ws, {
        jsonrpc: '2.0',
        id: request.id,
        result: { subscribed: events },
      });
    }

    this.log(`Client ${client.id} subscribed to: ${events.join(', ')}`);
  }

  /**
   * Handle notification unsubscription.
   */
  private handleUnsubscribe(client: ClientConnection, request: JsonRpcRequest): void {
    const params = request.params as { events?: string[] } | undefined;
    const events = params?.events ?? [];

    for (const event of events) {
      client.subscriptions.delete(event);
    }

    if (request.id !== undefined) {
      this.send(client.ws, {
        jsonrpc: '2.0',
        id: request.id,
        result: { unsubscribed: events },
      });
    }

    this.log(`Client ${client.id} unsubscribed from: ${events.join(', ')}`);
  }

  /**
   * Set up forwarding of ECP notifications to subscribed clients.
   */
  private setupNotificationForwarding(): void {
    this.ecpServer.onNotification((method, params) => {
      const notification: JsonRpcNotification = {
        jsonrpc: '2.0',
        method,
        params,
      };

      for (const client of this.clients.values()) {
        if (!client.authenticated) continue;

        // Check if client is subscribed to this notification
        if (
          client.subscriptions.has('*') ||
          client.subscriptions.has(method) ||
          this.matchesWildcard(method, client.subscriptions)
        ) {
          this.send(client.ws, notification);
        }
      }
    });
  }

  /**
   * Check if method matches any wildcard subscription.
   * e.g., "document/*" matches "document/didChange"
   */
  private matchesWildcard(method: string, subscriptions: Set<string>): boolean {
    for (const sub of subscriptions) {
      if (sub.endsWith('/*')) {
        const prefix = sub.slice(0, -2);
        if (method.startsWith(prefix + '/')) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Send a message to a WebSocket client.
   */
  private send(ws: ServerWebSocket<ClientData>, message: JsonRpcResponse | JsonRpcNotification): void {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      this.log(`Failed to send message: ${error}`);
    }
  }

  /**
   * Send an error response.
   */
  private sendError(
    ws: ServerWebSocket<ClientData>,
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown
  ): void {
    this.send(ws, {
      jsonrpc: '2.0',
      id: id ?? undefined,
      error: { code, message, data },
    });
  }

  /**
   * Get the number of connected clients.
   */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Broadcast a notification to all authenticated clients.
   */
  broadcast(method: string, params?: unknown): void {
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    for (const client of this.clients.values()) {
      if (client.authenticated) {
        this.send(client.ws, notification);
      }
    }
  }

  /**
   * Disconnect all clients.
   */
  disconnectAll(): void {
    for (const client of this.clients.values()) {
      try {
        client.ws.close(1000, 'Server shutting down');
      } catch {
        // Ignore errors when closing
      }
    }
    this.clients.clear();
    this.log('All clients disconnected');
  }
}
