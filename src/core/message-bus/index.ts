import { createClient, RedisClientType } from 'redis';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type { Message, MessageType, RedisConfig } from '../../types/index.js';
import { getDatabase } from '../../lib/database.js';

export interface MessageBusOptions {
  redis: RedisConfig;
  projectId: string;
}

export class MessageBus extends EventEmitter {
  private publisher: RedisClientType;
  private subscriber: RedisClientType;
  private projectId: string;
  private subscriptions: Set<string> = new Set();

  constructor(options: MessageBusOptions) {
    super();
    this.projectId = options.projectId;

    const redisUrl = `redis://${options.redis.host}:${options.redis.port}`;
    this.publisher = createClient({ url: redisUrl });
    this.subscriber = createClient({ url: redisUrl });
  }

  async connect(): Promise<void> {
    await Promise.all([
      this.publisher.connect(),
      this.subscriber.connect(),
    ]);
  }

  private getChannel(target: string): string {
    return `eklavya:${this.projectId}:${target}`;
  }

  async subscribe(agentId: string): Promise<void> {
    const channels = [
      this.getChannel(agentId),
      this.getChannel('broadcast'),
    ];

    for (const channel of channels) {
      if (!this.subscriptions.has(channel)) {
        await this.subscriber.subscribe(channel, (message) => {
          try {
            const parsed = JSON.parse(message) as Message;
            this.emit('message', parsed);
            this.emit(parsed.type, parsed);
          } catch {
            // Ignore parse errors
          }
        });
        this.subscriptions.add(channel);
      }
    }
  }

  async unsubscribe(agentId: string): Promise<void> {
    const channel = this.getChannel(agentId);
    if (this.subscriptions.has(channel)) {
      await this.subscriber.unsubscribe(channel);
      this.subscriptions.delete(channel);
    }
  }

  async publish(message: Omit<Message, 'id' | 'createdAt'>): Promise<Message> {
    const fullMessage: Message = {
      ...message,
      id: uuidv4(),
      createdAt: new Date(),
    };

    // Persist to database
    const db = getDatabase();
    await db.query(
      `INSERT INTO messages (id, project_id, from_agent_id, to_agent_id, type, channel, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        fullMessage.id,
        fullMessage.projectId,
        fullMessage.fromAgentId || null,
        fullMessage.toAgentId || null,
        fullMessage.type,
        fullMessage.channel || null,
        JSON.stringify(fullMessage.payload),
        fullMessage.createdAt,
      ]
    );

    // Publish to Redis
    const channel = fullMessage.toAgentId
      ? this.getChannel(fullMessage.toAgentId)
      : this.getChannel('broadcast');

    await this.publisher.publish(channel, JSON.stringify(fullMessage));

    return fullMessage;
  }

  async sendToAgent(
    toAgentId: string,
    type: MessageType,
    payload: Record<string, unknown>,
    fromAgentId?: string
  ): Promise<Message> {
    return this.publish({
      projectId: this.projectId,
      fromAgentId,
      toAgentId,
      type,
      payload,
      processed: false,
    });
  }

  async broadcast(
    type: MessageType,
    payload: Record<string, unknown>,
    fromAgentId?: string
  ): Promise<Message> {
    return this.publish({
      projectId: this.projectId,
      fromAgentId,
      type,
      channel: 'broadcast',
      payload,
      processed: false,
    });
  }

  async getUnprocessedMessages(agentId: string): Promise<Message[]> {
    const db = getDatabase();
    const result = await db.query<Message>(
      `SELECT * FROM messages
       WHERE (to_agent_id = $1 OR channel = 'broadcast')
       AND processed = false
       ORDER BY created_at ASC`,
      [agentId]
    );
    return result.rows;
  }

  async markProcessed(messageId: string): Promise<void> {
    const db = getDatabase();
    await db.query(
      `UPDATE messages SET processed = true, processed_at = NOW() WHERE id = $1`,
      [messageId]
    );
  }

  async close(): Promise<void> {
    for (const channel of this.subscriptions) {
      await this.subscriber.unsubscribe(channel);
    }
    this.subscriptions.clear();
    await Promise.all([
      this.publisher.quit(),
      this.subscriber.quit(),
    ]);
  }
}

// Factory function
export function createMessageBus(options: MessageBusOptions): MessageBus {
  return new MessageBus(options);
}
