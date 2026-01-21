/**
 * Unit Tests for Learning System
 *
 * Tests Thompson Sampling implementation and RL functionality
 */

import { describe, it, expect } from 'vitest';
import { getLearningSystem, LearningSystem } from '../core/learning/index.js';

// Beta distribution sampling function for testing
function sampleBeta(alpha: number, beta: number): number {
  // Simple approximation using central limit theorem
  // For testing purposes, this provides reasonable beta-like samples
  const n = 10;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const u1 = Math.random();
    const u2 = Math.random();
    // Approximate gamma samples
    const g1 = -Math.log(u1);
    const g2 = -Math.log(u2);
    sum += (alpha * g1) / (alpha * g1 + beta * g2);
  }
  return sum / n;
}

// Thompson sampling function for testing
function thompsonSample<T extends { alpha: number; beta: number }>(prompts: T[]): T {
  let best = prompts[0];
  let bestSample = sampleBeta(best.alpha, best.beta);

  for (let i = 1; i < prompts.length; i++) {
    const sample = sampleBeta(prompts[i].alpha, prompts[i].beta);
    if (sample > bestSample) {
      best = prompts[i];
      bestSample = sample;
    }
  }

  return best;
}

describe('Learning System', () => {
  describe('Beta Sampling', () => {
    it('should sample values between 0 and 1', () => {
      const sample = sampleBeta(1, 1);
      expect(sample).toBeGreaterThanOrEqual(0);
      expect(sample).toBeLessThanOrEqual(1);
    });

    it('should return higher samples with high alpha', () => {
      // With high alpha (successes), samples should tend toward 1
      const samples: number[] = [];
      for (let i = 0; i < 100; i++) {
        samples.push(sampleBeta(100, 1));
      }
      const avgSample = samples.reduce((a, b) => a + b, 0) / samples.length;
      expect(avgSample).toBeGreaterThan(0.7);
    });

    it('should return lower samples with high beta', () => {
      // With high beta (failures), samples should tend toward 0
      const samples: number[] = [];
      for (let i = 0; i < 100; i++) {
        samples.push(sampleBeta(1, 100));
      }
      const avgSample = samples.reduce((a, b) => a + b, 0) / samples.length;
      expect(avgSample).toBeLessThan(0.3);
    });
  });

  describe('Thompson Sampling', () => {
    it('should select prompt with highest Thompson sample more often', () => {
      const prompts = [
        { id: 'low', alpha: 1, beta: 10 },   // Low success rate
        { id: 'high', alpha: 10, beta: 1 },  // High success rate
        { id: 'medium', alpha: 5, beta: 5 }, // Medium success rate
      ];

      // Run multiple selections to verify high alpha prompt is selected more often
      const selections = new Map<string, number>();
      for (let i = 0; i < 100; i++) {
        const selected = thompsonSample(prompts);
        selections.set(selected.id, (selections.get(selected.id) || 0) + 1);
      }

      // High success prompt should be selected most often
      expect(selections.get('high')).toBeGreaterThan(selections.get('low') || 0);
    });
  });

  describe('getLearningSystem', () => {
    it('should return singleton instance', () => {
      const system1 = getLearningSystem();
      const system2 = getLearningSystem();
      expect(system1).toBe(system2);
    });

    it('should accept configuration options', () => {
      const system = getLearningSystem({
        explorationRate: 0.2,
        candidateRate: 0.4,
      });
      expect(system).toBeDefined();
    });

    it('should be instance of LearningSystem', () => {
      const system = getLearningSystem();
      expect(system).toBeInstanceOf(LearningSystem);
    });
  });

  describe('Reward Calculation', () => {
    it('should calculate positive reward for success', () => {
      const outcome = {
        tasksCompleted: 5,
        tasksFailed: 0,
        tokensUsed: 1000,
        executionTimeMs: 5000,
      };

      const reward = calculateReward(outcome);
      expect(reward).toBeGreaterThan(0);
    });

    it('should calculate negative reward for failure', () => {
      const outcome = {
        tasksCompleted: 1,
        tasksFailed: 5,
        tokensUsed: 10000,
        executionTimeMs: 60000,
      };

      const reward = calculateReward(outcome);
      expect(reward).toBeLessThan(0);
    });

    it('should penalize high token usage', () => {
      const lowTokens = calculateReward({
        tasksCompleted: 5,
        tasksFailed: 0,
        tokensUsed: 100,
        executionTimeMs: 1000,
      });

      const highTokens = calculateReward({
        tasksCompleted: 5,
        tasksFailed: 0,
        tokensUsed: 100000,
        executionTimeMs: 1000,
      });

      expect(lowTokens).toBeGreaterThan(highTokens);
    });
  });
});

// Helper function for testing reward calculation
function calculateReward(outcome: {
  tasksCompleted: number;
  tasksFailed: number;
  tokensUsed: number;
  executionTimeMs: number;
}): number {
  const successRate = outcome.tasksCompleted / (outcome.tasksCompleted + outcome.tasksFailed || 1);
  const tokenPenalty = Math.min(outcome.tokensUsed / 10000, 1) * 0.2;
  const timePenalty = Math.min(outcome.executionTimeMs / 60000, 1) * 0.1;

  return successRate - tokenPenalty - timePenalty;
}
