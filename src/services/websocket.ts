/**
 * WebSocket Service for Real-Time Dashboard Updates
 *
 * Provides real-time communication between backend and dashboard:
 * - Agent status changes
 * - Task progress updates
 * - Activity feed events
 * - RL learning updates
 */

import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { getDatabase } from '../lib/database.js';

export interface WebSocketMessage {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface Subscription {
  projectId?: string;
  channels: Set<string>;
}

export interface WebSocketServiceOptions {
  port?: number;
  heartbeatInterval?: number;
}

/**
 * WebSocket service for real-time dashboard updates
 */
export class WebSocketService extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, Subscription> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private port: number;
  private heartbeatMs: number;
  private dbListener: (() => void) | null = null;

  constructor(options: WebSocketServiceOptions = {}) {
    super();
    this.port = options.port || 4001;
    this.heartbeatMs = options.heartbeatInterval || 30000;
  }

  /**
   * Start the WebSocket server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.port });

        this.wss.on('listening', () => {
          console.log(`WebSocket server started on port ${this.port}`);
          this.setupHeartbeat();
          this.setupDatabaseListener();
          this.emit('started', { port: this.port });
          resolve();
        });

        this.wss.on('connection', (ws, req) => {
          this.handleConnection(ws, req);
        });

        this.wss.on('error', (error) => {
          console.error('WebSocket server error:', error);
          this.emit('error', error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, req: { url?: string }): void {
    const clientId = Math.random().toString(36).slice(2, 10);
    console.log(`WebSocket client connected: ${clientId}`);

    // Initialize subscription
    this.clients.set(ws, {
      channels: new Set(['global']),
    });

    // Send welcome message
    this.sendToClient(ws, {
      type: 'connected',
      payload: {
        clientId,
        message: 'Connected to Eklavya real-time service',
        availableChannels: ['global', 'agents', 'tasks', 'activity', 'learning'],
      },
      timestamp: new Date().toISOString(),
    });

    // Handle messages from client
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleClientMessage(ws, message);
      } catch (error) {
        this.sendToClient(ws, {
          type: 'error',
          payload: { message: 'Invalid message format' },
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      console.log(`WebSocket client disconnected: ${clientId}`);
      this.clients.delete(ws);
      this.emit('clientDisconnected', { clientId });
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error(`WebSocket client error (${clientId}):`, error);
      this.clients.delete(ws);
    });

    this.emit('clientConnected', { clientId });
  }

  /**
   * Handle messages from clients
   */
  private handleClientMessage(ws: WebSocket, message: { type: string; payload?: Record<string, unknown> }): void {
    const subscription = this.clients.get(ws);
    if (!subscription) return;

    switch (message.type) {
      case 'subscribe':
        this.handleSubscribe(ws, subscription, message.payload || {});
        break;

      case 'unsubscribe':
        this.handleUnsubscribe(ws, subscription, message.payload || {});
        break;

      case 'ping':
        this.sendToClient(ws, {
          type: 'pong',
          payload: { timestamp: Date.now() },
          timestamp: new Date().toISOString(),
        });
        break;

      default:
        this.sendToClient(ws, {
          type: 'error',
          payload: { message: `Unknown message type: ${message.type}` },
          timestamp: new Date().toISOString(),
        });
    }
  }

  /**
   * Handle subscription request
   */
  private handleSubscribe(
    ws: WebSocket,
    subscription: Subscription,
    payload: Record<string, unknown>
  ): void {
    const { projectId, channels } = payload as { projectId?: string; channels?: string[] };

    if (projectId) {
      subscription.projectId = projectId;
    }

    if (channels && Array.isArray(channels)) {
      for (const channel of channels) {
        subscription.channels.add(channel);
      }
    }

    this.sendToClient(ws, {
      type: 'subscribed',
      payload: {
        projectId: subscription.projectId,
        channels: Array.from(subscription.channels),
      },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle unsubscription request
   */
  private handleUnsubscribe(
    ws: WebSocket,
    subscription: Subscription,
    payload: Record<string, unknown>
  ): void {
    const { channels } = payload as { channels?: string[] };

    if (channels && Array.isArray(channels)) {
      for (const channel of channels) {
        if (channel !== 'global') {
          subscription.channels.delete(channel);
        }
      }
    }

    this.sendToClient(ws, {
      type: 'unsubscribed',
      payload: {
        channels: Array.from(subscription.channels),
      },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send message to specific client
   */
  private sendToClient(ws: WebSocket, message: WebSocketMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast message to all subscribed clients
   */
  broadcast(channel: string, type: string, payload: Record<string, unknown>, projectId?: string): void {
    const message: WebSocketMessage = {
      type,
      payload: { ...payload, channel },
      timestamp: new Date().toISOString(),
    };

    for (const [ws, subscription] of this.clients) {
      // Check if client is subscribed to this channel
      if (!subscription.channels.has(channel) && !subscription.channels.has('global')) {
        continue;
      }

      // Check if client is subscribed to this project (if project-specific)
      if (projectId && subscription.projectId && subscription.projectId !== projectId) {
        continue;
      }

      this.sendToClient(ws, message);
    }
  }

  /**
   * Broadcast agent status change
   */
  broadcastAgentUpdate(agent: {
    id: string;
    projectId: string;
    type: string;
    status: string;
    currentTask?: string;
    progress?: number;
  }): void {
    this.broadcast('agents', 'agent:updated', agent, agent.projectId);
  }

  /**
   * Broadcast task status change
   */
  broadcastTaskUpdate(task: {
    id: string;
    projectId: string;
    title: string;
    status: string;
    progress?: number;
    assignedAgentId?: string;
  }): void {
    this.broadcast('tasks', 'task:updated', task, task.projectId);
  }

  /**
   * Broadcast activity event
   */
  broadcastActivity(activity: {
    id: string;
    projectId: string;
    agentType: string;
    action: string;
    details?: string;
  }): void {
    this.broadcast('activity', 'activity:new', activity, activity.projectId);
  }

  /**
   * Broadcast RL learning event
   */
  broadcastLearningUpdate(update: {
    promptId: string;
    agentType: string;
    outcome: string;
    reward: number;
    thompsonScore: number;
  }): void {
    this.broadcast('learning', 'learning:updated', update);
  }

  /**
   * Setup heartbeat to detect dead connections
   */
  private setupHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const [ws] of this.clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }
    }, this.heartbeatMs);
  }

  /**
   * Setup database listener for real-time updates
   */
  private async setupDatabaseListener(): Promise<void> {
    const db = getDatabase();

    // Listen for agent changes
    db.on('notification', (msg: { channel: string; payload?: string }) => {
      if (!msg.payload) return;

      try {
        const data = JSON.parse(msg.payload);

        switch (msg.channel) {
          case 'agent_changes':
            this.broadcastAgentUpdate(data);
            break;
          case 'task_changes':
            this.broadcastTaskUpdate(data);
            break;
          case 'activity_events':
            this.broadcastActivity(data);
            break;
          case 'learning_events':
            this.broadcastLearningUpdate(data);
            break;
        }
      } catch (error) {
        console.error('Error parsing database notification:', error);
      }
    });

    // Subscribe to PostgreSQL NOTIFY channels
    await db.query('LISTEN agent_changes');
    await db.query('LISTEN task_changes');
    await db.query('LISTEN activity_events');
    await db.query('LISTEN learning_events');

    console.log('Database listeners set up for real-time updates');
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    connectedClients: number;
    subscriptions: Array<{ projectId?: string; channels: string[] }>;
  } {
    const subscriptions = Array.from(this.clients.values()).map((sub) => ({
      projectId: sub.projectId,
      channels: Array.from(sub.channels),
    }));

    return {
      connectedClients: this.clients.size,
      subscriptions,
    };
  }

  /**
   * Stop the WebSocket server
   */
  async stop(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all client connections
    for (const [ws] of this.clients) {
      ws.close(1000, 'Server shutting down');
    }
    this.clients.clear();

    // Close server
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          console.log('WebSocket server stopped');
          this.emit('stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

// Singleton instance
let wsService: WebSocketService | null = null;

export function getWebSocketService(options?: WebSocketServiceOptions): WebSocketService {
  if (!wsService) {
    wsService = new WebSocketService(options);
  }
  return wsService;
}

export function createWebSocketService(options?: WebSocketServiceOptions): WebSocketService {
  return new WebSocketService(options);
}
