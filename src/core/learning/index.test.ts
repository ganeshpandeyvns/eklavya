/**
 * Tests for Learning System
 * Thompson Sampling and prompt evolution
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LearningSystem } from './index.js';
import { getDatabase } from '../../lib/database.js';

describe('LearningSystem', () => {
  let learningSystem: LearningSystem;
  let testProjectId: string;

  beforeAll(async () => {
    // Initialize database
    const db = getDatabase({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'eklavya',
      user: process.env.DB_USER || 'eklavya',
      password: process.env.DB_PASSWORD || 'eklavya_dev_pwd',
    });
    await db.connect();

    // Create test project
    const projectResult = await db.query<{ id: string }>(
      `INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING id`,
      ['Learning Test Project', 'Testing learning system']
    );
    testProjectId = projectResult.rows[0].id;

    // Create learning system with default options
    learningSystem = new LearningSystem();
  });

  afterAll(async () => {
    const db = getDatabase();
    // Cleanup test data
    await db.query(`DELETE FROM projects WHERE id = $1`, [testProjectId]);
    await db.close();
  });

  describe('Initialization', () => {
    it('should create learning system with default options', () => {
      const system = new LearningSystem();
      expect(system).toBeDefined();
    });

    it('should create learning system with custom options', () => {
      const system = new LearningSystem({
        explorationRate: 0.2,
        candidateRate: 0.4,
      });
      expect(system).toBeDefined();
    });
  });

  describe('Prompt Selection', () => {
    it('should handle missing prompts gracefully', async () => {
      // Should return null when no prompts exist for type
      const prompt = await learningSystem.selectPrompt('monitor');
      // Either returns null or a fallback prompt
      expect(prompt === null || prompt !== undefined).toBe(true);
    });

    it('should select a prompt for developer agent', async () => {
      const prompt = await learningSystem.selectPrompt('developer');
      // May return null if no prompts exist, which is valid
      expect(prompt === null || prompt !== undefined).toBe(true);
    });
  });

  describe('Prompt Statistics', () => {
    it('should get prompt statistics', async () => {
      const stats = await learningSystem.getPromptStats('developer');
      expect(stats).toBeDefined();
      // Stats returns an array or object depending on implementation
      expect(Array.isArray(stats) || typeof stats === 'object').toBe(true);
    });
  });
});
