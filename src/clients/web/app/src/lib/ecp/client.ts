/**
 * ECP WebSocket Client
 *
 * Browser-side JSON-RPC 2.0 client for communicating with the ECP server.
 */

type NotificationCallback = (params: unknown) => void;
type ConnectionCallback = () => void;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  method: string;
  timeout: ReturnType<typeof setTimeout>;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  method?: string;
  params?: unknown;
}

const REQUEST_TIMEOUT = 30000; // 30 seconds
const RECONNECT_DELAY = 1000; // 1 second
const MAX_RECONNECT_DELAY = 30000; // 30 seconds

class ECPClient {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private notificationHandlers = new Map<string, Set<NotificationCallback>>();
  private connectionHandlers = {
    connect: new Set<ConnectionCallback>(),
    disconnect: new Set<ConnectionCallback>(),
  };

  private url: string = '';
  private isConnecting = false;
  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Connect to the ECP server.
   */
  async connect(url: string): Promise<void> {
    this.url = url;
    this.shouldReconnect = true;
    return this.doConnect();
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
        resolve();
        return;
      }

      this.isConnecting = true;

      try {
        this.ws = new WebSocket(this.url);
      } catch (error) {
        this.isConnecting = false;
        reject(error);
        return;
      }

      this.ws.onopen = () => {
        this.isConnecting = false;
        this.reconnectAttempts = 0;

        // Subscribe to all notifications by default
        this.send({
          jsonrpc: '2.0',
          id: ++this.requestId,
          method: 'notifications/subscribe',
          params: { events: ['*'] },
        });

        // Notify connection handlers
        for (const handler of this.connectionHandlers.connect) {
          handler();
        }

        resolve();
      };

      this.ws.onerror = (event) => {
        this.isConnecting = false;
        console.error('WebSocket error:', event);
        reject(new Error('WebSocket connection failed'));
      };

      this.ws.onclose = () => {
        this.isConnecting = false;

        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timeout);
          pending.reject(new Error('Connection closed'));
          this.pendingRequests.delete(id);
        }

        // Notify disconnect handlers
        for (const handler of this.connectionHandlers.disconnect) {
          handler();
        }

        // Attempt reconnection
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const delay = Math.min(
      RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts),
      MAX_RECONNECT_DELAY
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.doConnect().catch(() => {
        // Reconnect failed, will try again
      });
    }, delay);
  }

  /**
   * Disconnect from the server.
   */
  disconnect(): void {
    this.shouldReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Check if connected.
   */
  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Send a request and wait for response.
   */
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.isConnected) {
      throw new Error('Not connected to ECP server');
    }

    const id = ++this.requestId;

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, REQUEST_TIMEOUT);

      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        method,
        timeout,
      });

      this.send({
        jsonrpc: '2.0',
        id,
        method,
        params,
      });
    });
  }

  /**
   * Subscribe to notifications.
   */
  subscribe(event: string, callback: NotificationCallback): () => void {
    if (!this.notificationHandlers.has(event)) {
      this.notificationHandlers.set(event, new Set());
    }

    this.notificationHandlers.get(event)!.add(callback);

    // Return unsubscribe function
    return () => {
      const handlers = this.notificationHandlers.get(event);
      if (handlers) {
        handlers.delete(callback);
        if (handlers.size === 0) {
          this.notificationHandlers.delete(event);
        }
      }
    };
  }

  /**
   * Subscribe to connection events.
   */
  onConnect(callback: ConnectionCallback): () => void {
    this.connectionHandlers.connect.add(callback);
    return () => this.connectionHandlers.connect.delete(callback);
  }

  /**
   * Subscribe to disconnection events.
   */
  onDisconnect(callback: ConnectionCallback): () => void {
    this.connectionHandlers.disconnect.add(callback);
    return () => this.connectionHandlers.disconnect.delete(callback);
  }

  private send(message: JsonRpcRequest): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleMessage(data: string): void {
    let message: JsonRpcResponse;

    try {
      message = JSON.parse(data);
    } catch {
      console.error('Failed to parse message:', data);
      return;
    }

    // Response to a request
    if (message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id);

        if (message.error) {
          pending.reject(new Error(`[${message.error.code}] ${message.error.message}`));
        } else {
          pending.resolve(message.result);
        }
      }
      return;
    }

    // Notification
    if (message.method) {
      this.handleNotification(message.method, message.params);
    }
  }

  private handleNotification(method: string, params: unknown): void {
    // Try exact match
    const exactHandlers = this.notificationHandlers.get(method);
    if (exactHandlers) {
      for (const handler of exactHandlers) {
        try {
          handler(params);
        } catch (error) {
          console.error(`Notification handler error for ${method}:`, error);
        }
      }
    }

    // Try wildcard match
    const wildcardHandlers = this.notificationHandlers.get('*');
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          handler({ method, params });
        } catch (error) {
          console.error('Wildcard notification handler error:', error);
        }
      }
    }

    // Try prefix match (e.g., "document/*" matches "document/didChange")
    for (const [pattern, handlers] of this.notificationHandlers) {
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -2);
        if (method.startsWith(prefix + '/')) {
          for (const handler of handlers) {
            try {
              handler(params);
            } catch (error) {
              console.error(`Prefix notification handler error for ${pattern}:`, error);
            }
          }
        }
      }
    }
  }
}

// Singleton instance
export const ecpClient = new ECPClient();
export default ecpClient;
