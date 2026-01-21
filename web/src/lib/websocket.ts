/**
 * WebSocket Client for Real-Time Dashboard Updates
 *
 * Connects to the Eklavya WebSocket server and provides:
 * - Auto-reconnection with exponential backoff
 * - Channel subscriptions (agents, tasks, activity, learning)
 * - Event callbacks for real-time updates
 */

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export interface WebSocketMessage {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface WebSocketClientOptions {
  url?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  onStatusChange?: (status: WebSocketStatus) => void;
}

type MessageHandler = (message: WebSocketMessage) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private status: WebSocketStatus = 'disconnected';
  private reconnectInterval: number;
  private maxReconnectAttempts: number;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private statusChangeCallback?: (status: WebSocketStatus) => void;
  private subscribedChannels: Set<string> = new Set(['global']);
  private subscribedProjectId?: string;

  constructor(options: WebSocketClientOptions = {}) {
    this.url = options.url || 'ws://localhost:4001';
    this.reconnectInterval = options.reconnectInterval || 3000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.statusChangeCallback = options.onStatusChange;
  }

  /**
   * Connect to the WebSocket server
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.setStatus('connecting');

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.setStatus('connected');
        this.reconnectAttempts = 0;

        // Re-subscribe to channels after reconnection
        if (this.subscribedChannels.size > 0 || this.subscribedProjectId) {
          this.sendSubscription();
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);
        this.ws = null;

        if (event.code !== 1000) {
          // Abnormal close, attempt reconnection
          this.scheduleReconnect();
        } else {
          this.setStatus('disconnected');
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting');
      this.ws = null;
    }

    this.setStatus('disconnected');
  }

  /**
   * Subscribe to channels and/or a specific project
   */
  subscribe(options: { channels?: string[]; projectId?: string }): void {
    if (options.channels) {
      options.channels.forEach(ch => this.subscribedChannels.add(ch));
    }
    if (options.projectId) {
      this.subscribedProjectId = options.projectId;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscription();
    }
  }

  /**
   * Unsubscribe from channels
   */
  unsubscribe(channels: string[]): void {
    channels.forEach(ch => {
      if (ch !== 'global') {
        this.subscribedChannels.delete(ch);
      }
    });

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({
        type: 'unsubscribe',
        payload: { channels },
      });
    }
  }

  /**
   * Register a handler for a specific message type
   */
  on(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  /**
   * Register a handler for all messages
   */
  onAny(handler: MessageHandler): () => void {
    return this.on('*', handler);
  }

  /**
   * Get current connection status
   */
  getStatus(): WebSocketStatus {
    return this.status;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.status === 'connected';
  }

  private setStatus(status: WebSocketStatus): void {
    this.status = status;
    this.statusChangeCallback?.(status);
  }

  private send(data: { type: string; payload?: Record<string, unknown> }): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private sendSubscription(): void {
    this.send({
      type: 'subscribe',
      payload: {
        channels: Array.from(this.subscribedChannels),
        projectId: this.subscribedProjectId,
      },
    });
  }

  private handleMessage(message: WebSocketMessage): void {
    // Call type-specific handlers
    const handlers = this.handlers.get(message.type);
    if (handlers) {
      handlers.forEach(handler => handler(message));
    }

    // Call wildcard handlers
    const wildcardHandlers = this.handlers.get('*');
    if (wildcardHandlers) {
      wildcardHandlers.forEach(handler => handler(message));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max reconnection attempts reached');
      this.setStatus('disconnected');
      return;
    }

    this.setStatus('reconnecting');
    this.reconnectAttempts++;

    // Exponential backoff
    const delay = this.reconnectInterval * Math.pow(1.5, this.reconnectAttempts - 1);
    console.log(`Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}

// Singleton instance
let wsClient: WebSocketClient | null = null;

export function getWebSocketClient(options?: WebSocketClientOptions): WebSocketClient {
  if (!wsClient) {
    wsClient = new WebSocketClient(options);
  }
  return wsClient;
}

export function createWebSocketClient(options?: WebSocketClientOptions): WebSocketClient {
  return new WebSocketClient(options);
}

export { WebSocketClient };
