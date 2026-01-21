#!/usr/bin/env tsx
/**
 * Demo: Parallel RL-Based Agents
 *
 * This demonstrates how Eklavya orchestrates multiple agents in parallel,
 * with each agent selected via Thompson Sampling and outcomes feeding back
 * into the RL system for continuous improvement.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../lib/database.js';
import { getLearningSystem } from '../core/learning/index.js';
import type { AgentType } from '../types/index.js';

// Configuration
const CONFIG = {
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'eklavya',
    user: process.env.DB_USER || 'eklavya',
    password: process.env.DB_PASSWORD || 'eklavya_dev_pwd',
  },
};

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const agentColors: Record<AgentType, string> = {
  orchestrator: colors.magenta,
  architect: colors.cyan,
  developer: colors.blue,
  tester: colors.yellow,
  qa: colors.green,
  pm: colors.gray,
  uat: colors.green,
  sre: colors.red,
  monitor: colors.gray,
  mentor: colors.cyan,
};

function log(msg: string, color = colors.reset) {
  console.log(`${color}${msg}${colors.reset}`);
}

function logAgent(agentType: AgentType, agentId: string, msg: string) {
  const color = agentColors[agentType];
  const shortId = agentId.slice(0, 8);
  console.log(`${color}[${agentType.toUpperCase().padEnd(12)}:${shortId}]${colors.reset} ${msg}`);
}

// Simulated task execution (represents Claude Code doing work)
async function simulateAgentWork(
  agentType: AgentType,
  agentId: string,
  taskTitle: string,
  promptVersion: number
): Promise<{ success: boolean; bugsIntroduced: number; executionTime: number }> {
  logAgent(agentType, agentId, `Starting: ${taskTitle} (Prompt v${promptVersion})`);

  // Simulate work time (1-3 seconds)
  const workTime = 1000 + Math.random() * 2000;
  await new Promise(resolve => setTimeout(resolve, workTime));

  // Simulate success/failure based on prompt version (higher versions are "better")
  // This demonstrates how RL improves over time
  const baseSuccessRate = 0.6 + (promptVersion * 0.05);
  const success = Math.random() < baseSuccessRate;

  // Simulate bugs (developers only)
  let bugsIntroduced = 0;
  if (agentType === 'developer' && success) {
    // Higher prompt versions introduce fewer bugs
    const bugRate = 0.3 - (promptVersion * 0.03);
    if (Math.random() < bugRate) {
      bugsIntroduced = Math.floor(Math.random() * 2) + 1;
    }
  }

  if (success) {
    logAgent(agentType, agentId, `${colors.green}✓ Completed${colors.reset}: ${taskTitle}${bugsIntroduced > 0 ? ` (${bugsIntroduced} bugs)` : ''}`);
  } else {
    logAgent(agentType, agentId, `${colors.red}✗ Failed${colors.reset}: ${taskTitle}`);
  }

  return { success, bugsIntroduced, executionTime: workTime };
}

async function main() {
  log('\n╔═══════════════════════════════════════════════════════════════╗', colors.magenta);
  log('║     EKLAVYA: PARALLEL RL-BASED AGENT DEMONSTRATION            ║', colors.magenta);
  log('╚═══════════════════════════════════════════════════════════════╝', colors.magenta);

  // Initialize
  const db = getDatabase(CONFIG.database);
  await db.connect();
  log('\n✓ Database connected', colors.green);

  const learningSystem = getLearningSystem({ explorationRate: 0.1, candidateRate: 0.3 });
  log('✓ Learning system initialized', colors.green);

  // Create/get project
  let projectId: string;
  const projectResult = await db.query<{ id: string }>(
    `SELECT id FROM projects WHERE name = 'Parallel Demo' LIMIT 1`
  );

  if (projectResult.rows.length === 0) {
    const newProject = await db.query<{ id: string }>(
      `INSERT INTO projects (name, description) VALUES ('Parallel Demo', 'Demonstrating parallel RL agents') RETURNING id`
    );
    projectId = newProject.rows[0].id;
  } else {
    projectId = projectResult.rows[0].id;
  }

  // Ensure prompts exist for all agent types
  const agentTypes: AgentType[] = ['orchestrator', 'architect', 'developer', 'tester', 'qa'];

  for (const agentType of agentTypes) {
    const existing = await db.query(
      `SELECT id FROM prompts WHERE agent_type = $1 LIMIT 1`,
      [agentType]
    );

    if (existing.rows.length === 0) {
      // Create initial prompts (versions 1-3 to show evolution)
      for (let version = 1; version <= 3; version++) {
        await db.query(
          `INSERT INTO prompts (agent_type, version, status, content, alpha, beta)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            agentType,
            version,
            version === 3 ? 'production' : version === 2 ? 'candidate' : 'experimental',
            `${agentType} prompt version ${version}`,
            1 + version * 0.5,  // Higher versions start with higher alpha
            1,
          ]
        );
      }
    }
  }

  log('\n✓ Prompts initialized for all agent types', colors.green);

  // Define parallel tasks (simulating a feature build)
  const tasks = [
    // Phase 1: Architecture (1 agent)
    { type: 'architect', title: 'Design authentication system' },

    // Phase 2: Parallel development (3 developers)
    { type: 'developer', title: 'Implement user registration' },
    { type: 'developer', title: 'Implement login/logout' },
    { type: 'developer', title: 'Implement JWT token handling' },

    // Phase 3: Parallel testing (2 testers)
    { type: 'tester', title: 'Test registration flow' },
    { type: 'tester', title: 'Test authentication flow' },

    // Phase 4: QA (1 agent)
    { type: 'qa', title: 'End-to-end auth testing' },
  ];

  // Display execution plan
  log('\n' + '═'.repeat(65), colors.cyan);
  log('  EXECUTION PLAN', colors.cyan);
  log('═'.repeat(65), colors.cyan);
  log('\n  Phase 1: Architecture (1 agent)');
  log('    └─ [ARCHITECT] Design authentication system');
  log('\n  Phase 2: Parallel Development (3 agents)');
  log('    ├─ [DEVELOPER] Implement user registration');
  log('    ├─ [DEVELOPER] Implement login/logout');
  log('    └─ [DEVELOPER] Implement JWT token handling');
  log('\n  Phase 3: Parallel Testing (2 agents)');
  log('    ├─ [TESTER] Test registration flow');
  log('    └─ [TESTER] Test authentication flow');
  log('\n  Phase 4: QA Validation (1 agent)');
  log('    └─ [QA] End-to-end auth testing');

  // Execute phases
  log('\n' + '═'.repeat(65), colors.cyan);
  log('  EXECUTION', colors.cyan);
  log('═'.repeat(65), colors.cyan);

  const phases = [
    { name: 'Architecture', tasks: [tasks[0]] },
    { name: 'Development', tasks: tasks.slice(1, 4) },
    { name: 'Testing', tasks: tasks.slice(4, 6) },
    { name: 'QA', tasks: [tasks[6]] },
  ];

  let totalRewards = 0;
  let totalAgents = 0;
  const agentOutcomes: Array<{
    agentType: AgentType;
    promptVersion: number;
    success: boolean;
    reward: number;
  }> = [];

  for (const phase of phases) {
    log(`\n▸ Phase: ${phase.name} (${phase.tasks.length} parallel agent${phase.tasks.length > 1 ? 's' : ''})`, colors.yellow);

    // Spawn agents in parallel for this phase
    const phasePromises = phase.tasks.map(async (task) => {
      const agentType = task.type as AgentType;
      const agentId = uuidv4();

      // Select prompt using Thompson Sampling
      const selectedPrompt = await learningSystem.selectPrompt(agentType);
      const promptId = selectedPrompt?.id || '';
      const promptVersion = selectedPrompt?.version || 1;

      // Record agent spawn
      await db.query(
        `INSERT INTO agents (id, project_id, type, status, prompt_id, created_at)
         VALUES ($1, $2, $3, 'working', $4, NOW())`,
        [agentId, projectId, agentType, promptId]
      );

      // Simulate work
      const result = await simulateAgentWork(agentType, agentId, task.title, promptVersion);

      // Calculate reward
      let reward = result.success ? 0.5 : -0.5;
      if (result.bugsIntroduced > 0) {
        reward -= 0.2 * result.bugsIntroduced;
      }

      // Record outcome
      if (promptId) {
        await learningSystem.recordOutcome({
          promptId,
          projectId,
          agentId,
          outcome: result.success ? 'success' : 'failure',
          reward,
          context: {
            agentType,
            taskTitle: task.title,
            bugsIntroduced: result.bugsIntroduced,
            executionTimeMs: result.executionTime,
          },
        });
      }

      // Update agent status
      await db.query(
        `UPDATE agents SET status = $1, updated_at = NOW() WHERE id = $2`,
        [result.success ? 'completed' : 'failed', agentId]
      );

      totalRewards += reward;
      totalAgents++;
      agentOutcomes.push({ agentType, promptVersion, success: result.success, reward });

      return result;
    });

    // Wait for all agents in this phase
    await Promise.all(phasePromises);
  }

  // Summary
  log('\n' + '═'.repeat(65), colors.cyan);
  log('  RESULTS SUMMARY', colors.cyan);
  log('═'.repeat(65), colors.cyan);

  const successCount = agentOutcomes.filter(o => o.success).length;
  const avgReward = totalRewards / totalAgents;

  log(`\n  Agents Spawned: ${totalAgents}`);
  log(`  Successful: ${successCount} (${(successCount / totalAgents * 100).toFixed(0)}%)`);
  log(`  Failed: ${totalAgents - successCount}`);
  log(`  Average Reward: ${avgReward >= 0 ? '+' : ''}${avgReward.toFixed(3)}`);

  // Show prompt performance evolution
  log('\n' + '═'.repeat(65), colors.cyan);
  log('  PROMPT LEARNING STATISTICS', colors.cyan);
  log('═'.repeat(65), colors.cyan);

  for (const agentType of agentTypes) {
    const stats = await db.query<{
      version: number;
      status: string;
      alpha: string;
      beta: string;
      total_uses: number;
    }>(
      `SELECT version, status, alpha, beta, total_uses
       FROM prompts WHERE agent_type = $1 ORDER BY version`,
      [agentType]
    );

    log(`\n  ${agentType.toUpperCase()}:`);
    for (const row of stats.rows) {
      const alpha = parseFloat(row.alpha);
      const beta = parseFloat(row.beta);
      const thompsonScore = alpha / (alpha + beta);
      const bar = '█'.repeat(Math.round(thompsonScore * 20));
      const status = row.status.padEnd(12);
      log(`    v${row.version} [${status}] ${bar.padEnd(20)} ${thompsonScore.toFixed(3)} (α=${alpha.toFixed(1)}, β=${beta.toFixed(1)})`);
    }
  }

  // Final message
  log('\n' + '═'.repeat(65), colors.green);
  log('  RL FEEDBACK LOOP DEMONSTRATED', colors.green);
  log('═'.repeat(65), colors.green);
  log(`
  • Each agent was selected using Thompson Sampling
  • Outcomes (success/failure/bugs) were recorded
  • Rewards/penalties were applied to prompt versions
  • Over time, better prompts get higher Thompson scores
  • Poorly performing prompts get deprecated automatically

  Run this demo multiple times to see prompts evolve!
  `);

  await db.close();
}

main().catch(console.error);
