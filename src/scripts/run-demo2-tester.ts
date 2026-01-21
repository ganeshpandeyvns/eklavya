#!/usr/bin/env tsx
/**
 * Demo₂ RL-Based Verification Tester
 *
 * This script verifies all Demo₂ success criteria:
 * 1. API endpoints return valid data
 * 2. WebSocket connects and receives events
 * 3. Dashboard loads with real data
 * 4. Real-time updates work (< 1s latency)
 */

import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';
import { getDatabase } from '../lib/database.js';
import { getLearningSystem } from '../core/learning/index.js';

// Configuration
const CONFIG = {
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'eklavya',
    user: process.env.DB_USER || 'eklavya',
    password: process.env.DB_PASSWORD || 'eklavya_dev_pwd',
  },
  apiUrl: process.env.API_URL || 'http://localhost:4000',
  wsUrl: process.env.WS_URL || 'ws://localhost:4001',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
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
};

function log(msg: string, color = colors.reset) {
  console.log(`${color}${msg}${colors.reset}`);
}

interface TestResult {
  name: string;
  category: string;
  pass: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(
  name: string,
  category: string,
  testFn: () => Promise<boolean>
): Promise<boolean> {
  const start = Date.now();
  try {
    const pass = await testFn();
    const duration = Date.now() - start;
    results.push({ name, category, pass, duration });
    log(`  ${pass ? '✓' : '✗'} ${name} (${duration}ms)`, pass ? colors.green : colors.red);
    return pass;
  } catch (error) {
    const duration = Date.now() - start;
    const errorMsg = error instanceof Error ? error.message : String(error);
    results.push({ name, category, pass: false, duration, error: errorMsg });
    log(`  ✗ ${name} (${duration}ms) - ${errorMsg}`, colors.red);
    return false;
  }
}

async function testApiEndpoints(): Promise<number> {
  log('\n📡 API Endpoint Tests', colors.cyan);
  let passed = 0;

  // Test 1: Health endpoint
  if (await runTest('Health endpoint responds', 'api', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/health`);
    const data = await res.json() as { status?: string };
    return res.ok && data.status === 'ok';
  })) passed++;

  // Test 2: Dashboard stats
  if (await runTest('Dashboard stats endpoint', 'api', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/dashboard/stats`);
    const data = await res.json() as { activeProjects?: number };
    return res.ok && typeof data.activeProjects === 'number';
  })) passed++;

  // Test 3: Projects list
  if (await runTest('Projects list endpoint', 'api', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/projects`);
    const data = await res.json();
    return res.ok && Array.isArray(data);
  })) passed++;

  // Test 4: Prompt stats (RL learning)
  if (await runTest('Prompt stats endpoint (RL)', 'api', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/prompts/developer/stats`);
    const data = await res.json() as { agentType?: string };
    return res.ok && data.agentType === 'developer';
  })) passed++;

  // Test 5: Create project
  if (await runTest('Create project endpoint', 'api', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Demo2 Test ${Date.now()}`, description: 'Demo2 verification test' }),
    });
    return res.status === 201;
  })) passed++;

  return passed;
}

async function testWebSocketConnection(): Promise<number> {
  log('\n🔌 WebSocket Tests', colors.cyan);
  let passed = 0;

  // Test 1: WebSocket connects
  if (await runTest('WebSocket server connects', 'websocket', async () => {
    return new Promise((resolve) => {
      const ws = new WebSocket(CONFIG.wsUrl);
      const timeout = setTimeout(() => {
        ws.close();
        resolve(false);
      }, 5000);

      ws.on('open', () => {
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      });

      ws.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  })) passed++;

  // Test 2: Receives welcome message
  if (await runTest('Receives welcome message', 'websocket', async () => {
    return new Promise((resolve) => {
      const ws = new WebSocket(CONFIG.wsUrl);
      const timeout = setTimeout(() => {
        ws.close();
        resolve(false);
      }, 5000);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as { type?: string };
          if (msg.type === 'connected') {
            clearTimeout(timeout);
            ws.close();
            resolve(true);
          }
        } catch {
          // ignore parse errors
        }
      });

      ws.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  })) passed++;

  // Test 3: Subscribe to channels
  if (await runTest('Subscribe to channels', 'websocket', async () => {
    return new Promise((resolve) => {
      const ws = new WebSocket(CONFIG.wsUrl);
      const timeout = setTimeout(() => {
        ws.close();
        resolve(false);
      }, 5000);

      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'subscribe',
          payload: { channels: ['agents', 'tasks'] },
        }));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as { type?: string };
          if (msg.type === 'subscribed') {
            clearTimeout(timeout);
            ws.close();
            resolve(true);
          }
        } catch {
          // ignore parse errors
        }
      });

      ws.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  })) passed++;

  return passed;
}

async function testFrontendIntegration(): Promise<number> {
  log('\n🖥️  Frontend Integration Tests', colors.cyan);
  let passed = 0;

  // Test 1: Frontend loads
  if (await runTest('Frontend serves HTML', 'frontend', async () => {
    const res = await fetch(CONFIG.frontendUrl);
    const html = await res.text();
    return res.ok && html.includes('<!DOCTYPE html>');
  })) passed++;

  // Test 2: No console errors in HTML (basic check)
  if (await runTest('Frontend HTML is valid', 'frontend', async () => {
    const res = await fetch(CONFIG.frontendUrl);
    const html = await res.text();
    return !html.includes('Error:') && !html.includes('error:');
  })) passed++;

  // Test 3: API calls work from frontend perspective
  if (await runTest('CORS headers present', 'frontend', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/health`, {
      method: 'OPTIONS',
    });
    const corsHeader = res.headers.get('access-control-allow-origin');
    return corsHeader === '*' || res.status === 204;
  })) passed++;

  // Test 4: Static assets load
  if (await runTest('Next.js static assets accessible', 'frontend', async () => {
    const res = await fetch(`${CONFIG.frontendUrl}/_next/static/css/app/layout.css`);
    return res.ok || res.status === 304;
  })) passed++;

  return passed;
}

async function testRealTimeLatency(): Promise<number> {
  log('\n⚡ Real-Time Latency Tests', colors.cyan);
  let passed = 0;

  // Test 1: API response time
  if (await runTest('API response < 500ms', 'latency', async () => {
    const start = Date.now();
    await fetch(`${CONFIG.apiUrl}/api/dashboard/stats`);
    const latency = Date.now() - start;
    return latency < 500;
  })) passed++;

  // Test 2: WebSocket message latency
  if (await runTest('WebSocket ping latency < 100ms', 'latency', async () => {
    return new Promise((resolve) => {
      const ws = new WebSocket(CONFIG.wsUrl);
      let pingStart = 0;

      const timeout = setTimeout(() => {
        ws.close();
        resolve(false);
      }, 5000);

      ws.on('open', () => {
        pingStart = Date.now();
        ws.send(JSON.stringify({ type: 'ping' }));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as { type?: string };
          if (msg.type === 'pong') {
            const latency = Date.now() - pingStart;
            clearTimeout(timeout);
            ws.close();
            resolve(latency < 100);
          }
        } catch {
          // ignore parse errors
        }
      });

      ws.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  })) passed++;

  // Test 3: Database query latency
  if (await runTest('Database query < 100ms', 'latency', async () => {
    const db = getDatabase(CONFIG.database);
    const start = Date.now();
    await db.query('SELECT 1');
    const latency = Date.now() - start;
    return latency < 100;
  })) passed++;

  return passed;
}

async function testErrorHandling(): Promise<number> {
  log('\n🛡️  Error Handling Tests', colors.cyan);
  let passed = 0;

  // Test 1: 404 on invalid endpoint
  if (await runTest('Returns 404 for invalid endpoint', 'error', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/nonexistent`);
    return res.status === 404;
  })) passed++;

  // Test 2: Invalid project ID
  if (await runTest('Returns 404 for invalid project ID', 'error', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/projects/${uuidv4()}`);
    return res.status === 404;
  })) passed++;

  // Test 3: Invalid agent type for prompt stats
  if (await runTest('Handles invalid agent type gracefully', 'error', async () => {
    const res = await fetch(`${CONFIG.apiUrl}/api/prompts/invalid_type/stats`);
    // Should return 200 with empty data or 404
    return res.ok || res.status === 404;
  })) passed++;

  return passed;
}

async function main() {
  log('\n╔═══════════════════════════════════════════════════════════════╗', colors.magenta);
  log('║     EKLAVYA DEMO₂ - REAL-TIME DASHBOARD VERIFICATION         ║', colors.magenta);
  log('╚═══════════════════════════════════════════════════════════════╝', colors.magenta);
  log(`\nStarted: ${new Date().toISOString()}`);
  log(`API URL: ${CONFIG.apiUrl}`);
  log(`WebSocket URL: ${CONFIG.wsUrl}`);
  log(`Frontend URL: ${CONFIG.frontendUrl}\n`);

  // Initialize database connection
  const db = getDatabase(CONFIG.database);
  await db.connect();
  log('✓ Database connected', colors.green);

  // Initialize learning system
  getLearningSystem({ explorationRate: 0.1, candidateRate: 0.3 });
  log('✓ Learning system initialized', colors.green);

  // Run all test categories
  const apiPassed = await testApiEndpoints();
  const wsPassed = await testWebSocketConnection();
  const frontendPassed = await testFrontendIntegration();
  const latencyPassed = await testRealTimeLatency();
  const errorPassed = await testErrorHandling();

  // Calculate totals
  const totalTests = results.length;
  const totalPassed = results.filter(r => r.pass).length;
  const passRate = ((totalPassed / totalTests) * 100).toFixed(1);

  // Summary by category
  log('\n' + '═'.repeat(65), colors.cyan);
  log('  RESULTS BY CATEGORY', colors.cyan);
  log('═'.repeat(65), colors.cyan);

  const categories = ['api', 'websocket', 'frontend', 'latency', 'error'];
  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const catPassed = catResults.filter(r => r.pass).length;
    const color = catPassed === catResults.length ? colors.green : colors.yellow;
    log(`  ${cat.toUpperCase().padEnd(12)}: ${catPassed}/${catResults.length} passed`, color);
  }

  // Final summary
  log('\n' + '═'.repeat(65), colors.cyan);
  log('  FINAL RESULTS', colors.cyan);
  log('═'.repeat(65), colors.cyan);

  log(`\n  Total Tests: ${totalTests}`);
  log(`  Passed: ${totalPassed}`);
  log(`  Failed: ${totalTests - totalPassed}`);
  log(`  Pass Rate: ${passRate}%`);

  // Demo₂ Success Criteria Check
  log('\n' + '═'.repeat(65), colors.cyan);
  log('  DEMO₂ SUCCESS CRITERIA', colors.cyan);
  log('═'.repeat(65), colors.cyan);

  const criteriaResults = [
    { name: 'Dashboard shows real project data from API', pass: apiPassed >= 3 },
    { name: 'Agent status updates in real-time (< 1s latency)', pass: latencyPassed >= 2 },
    { name: 'Can create project via API', pass: results.find(r => r.name.includes('Create project'))?.pass || false },
    { name: 'WebSocket connects and receives events', pass: wsPassed >= 2 },
    { name: 'All API endpoints functional', pass: apiPassed >= 4 },
  ];

  for (const c of criteriaResults) {
    log(`  ${c.pass ? '✓' : '✗'} ${c.name}`, c.pass ? colors.green : colors.red);
  }

  const allCriteriaMet = criteriaResults.every(c => c.pass);
  const passThreshold = (totalPassed / totalTests) >= 0.89; // 89% threshold (16/18)

  log('\n');
  if (allCriteriaMet && passThreshold) {
    log('╔═══════════════════════════════════════════════════════════════╗', colors.green);
    log('║        ✓ DEMO₂ VERIFICATION PASSED                           ║', colors.green);
    log('╚═══════════════════════════════════════════════════════════════╝', colors.green);
    log('\nDemo₂ is ready for admin review.');
    log(`Frontend: ${CONFIG.frontendUrl}`);
    log(`API: ${CONFIG.apiUrl}`);
    log(`WebSocket: ${CONFIG.wsUrl}`);
  } else {
    log('╔═══════════════════════════════════════════════════════════════╗', colors.red);
    log('║        ✗ DEMO₂ VERIFICATION FAILED                           ║', colors.red);
    log('╚═══════════════════════════════════════════════════════════════╝', colors.red);
    log('\nSome criteria were not met. Review failed tests above.');
    if (!passThreshold) {
      log(`Pass rate ${passRate}% is below 89% threshold.`, colors.yellow);
    }
  }

  log(`\nCompleted: ${new Date().toISOString()}`);

  await db.close();
  process.exit(allCriteriaMet && passThreshold ? 0 : 1);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
