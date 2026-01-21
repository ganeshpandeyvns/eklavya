import pg from 'pg';
import { EventEmitter } from 'events';
import type { DatabaseConfig } from '../types/index.js';

const { Pool } = pg;

export class Database extends EventEmitter {
  private pool: pg.Pool;
  private listenerClient: pg.PoolClient | null = null;

  constructor(config: DatabaseConfig) {
    super();
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  async connect(): Promise<void> {
    const client = await this.pool.connect();
    client.release();
  }

  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async getClient(): Promise<pg.PoolClient> {
    return this.pool.connect();
  }

  async transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async startListening(): Promise<void> {
    this.listenerClient = await this.pool.connect();
    await this.listenerClient.query('LISTEN eklavya_changes');

    this.listenerClient.on('notification', (msg) => {
      if (msg.payload) {
        try {
          const data = JSON.parse(msg.payload);
          this.emit('change', data);
          this.emit(`${data.table}:${data.action.toLowerCase()}`, data);
        } catch {
          // Ignore parse errors
        }
      }
    });
  }

  async stopListening(): Promise<void> {
    if (this.listenerClient) {
      await this.listenerClient.query('UNLISTEN eklavya_changes');
      this.listenerClient.release();
      this.listenerClient = null;
    }
  }

  async close(): Promise<void> {
    await this.stopListening();
    await this.pool.end();
  }
}

// Singleton instance
let db: Database | null = null;

export function getDatabase(config?: DatabaseConfig): Database {
  if (!db && config) {
    db = new Database(config);
  }
  if (!db) {
    throw new Error('Database not initialized. Call with config first.');
  }
  return db;
}
