import dotenv from 'dotenv';
import { getDatabase } from './lib/database.js';
import { createMessageBus } from './core/message-bus/index.js';
import { createAgentManager } from './core/agent-manager/index.js';
import { getLearningSystem } from './core/learning/index.js';
import { getCheckpointManager } from './core/checkpoint/index.js';
import { createApiServer } from './api/index.js';
import { getWebSocketService } from './services/websocket.js';
import type { EklavyaConfig } from './types/index.js';

dotenv.config();

const config: EklavyaConfig = {
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'eklavya',
    user: process.env.DB_USER || 'eklavya',
    password: process.env.DB_PASSWORD || 'eklavya_dev_pwd',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
  defaultModel: process.env.DEFAULT_MODEL || 'claude-sonnet-4-20250514',
  maxConcurrentAgents: parseInt(process.env.MAX_CONCURRENT_AGENTS || '10'),
  checkpointIntervalMs: parseInt(process.env.CHECKPOINT_INTERVAL_MS || '900000'),
  heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '30000'),
  heartbeatTimeoutMs: parseInt(process.env.HEARTBEAT_TIMEOUT_MS || '120000'),
};

async function main() {
  console.log('Starting Eklavya Core...');

  // Initialize database
  const db = getDatabase(config.database);
  await db.connect();
  console.log('✓ Database connected');

  // Start listening for DB changes
  await db.startListening();
  console.log('✓ Database notifications active');

  // Initialize API server
  const api = createApiServer({ port: 4000 });
  await api.start(4000);
  console.log('✓ API server started on port 4000');

  // Initialize WebSocket server for real-time updates
  const wsService = getWebSocketService({ port: 4001 });
  await wsService.start();
  console.log('✓ WebSocket server started on port 4001');

  // Initialize learning system
  getLearningSystem({ explorationRate: 0.1, candidateRate: 0.3 });
  console.log('✓ Learning system initialized');

  // Initialize checkpoint manager
  getCheckpointManager({ intervalMs: config.checkpointIntervalMs, maxCheckpointsPerAgent: 10 });
  console.log('✓ Checkpoint manager initialized');

  console.log('\nEklavya Core is running!');
  console.log('API: http://localhost:4000');
  console.log('WebSocket: ws://localhost:4001');
  console.log('\nPress Ctrl+C to stop\n');

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await wsService.stop();
    await api.stop();
    await db.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Failed to start Eklavya:', error);
  process.exit(1);
});
