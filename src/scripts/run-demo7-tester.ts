#!/usr/bin/env npx tsx
/**
 * Demo₇ Tester: Demo System
 *
 * Verifies the demo management, approval workflow, client feedback,
 * and verification system implementation.
 */

import { getDatabase } from '../lib/database.js';
import { getDemoService, DemoService } from '../core/demos/index.js';
import { getApprovalService, ApprovalService } from '../core/demos/approval.js';
import { getVerificationService, VerificationService } from '../core/demos/verification.js';
import { getFeedbackService, FeedbackService } from '../core/demos/feedback.js';

// Test results tracking
interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, duration: Date.now() - start });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: message, duration: Date.now() - start });
    console.log(`  ✗ ${name}: ${message}`);
  }
}

// Test data
let testProjectId: string;
let testDemoId: string;
let testApprovalRequestId: string;
let testFeedbackId: string;

async function setupTestData(): Promise<void> {
  const db = getDatabase();

  // Create a test project
  const projectResult = await db.query<{ id: string }>(
    `INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING id`,
    ['Demo7 Test Project', 'Test project for Demo₇ tester']
  );
  testProjectId = projectResult.rows[0].id;
  console.log(`  Created test project: ${testProjectId}`);
}

async function cleanupTestData(): Promise<void> {
  const db = getDatabase();
  await db.query('DELETE FROM projects WHERE name = $1', ['Demo7 Test Project']);
  console.log('  Cleaned up test data');
}

// Demo Service Tests
async function testDemoCreation(demoService: DemoService): Promise<void> {
  const demo = await demoService.createDemo(testProjectId, {
    name: 'Test Demo₀',
    type: 'wow',
    description: 'Test wow demo',
    config: {
      features: ['landing-page', 'navigation'],
      excludedFeatures: ['auth'],
      scaffoldingPercent: 40,
      estimatedTime: 30,
      estimatedCost: 15,
    },
  });

  testDemoId = demo.id;

  if (!demo.id) throw new Error('Demo ID not returned');
  if (demo.type !== 'wow') throw new Error(`Expected type 'wow', got '${demo.type}'`);
  if (demo.status !== 'draft') throw new Error(`Expected status 'draft', got '${demo.status}'`);
  if (demo.version !== 1) throw new Error(`Expected version 1, got ${demo.version}`);
  if (demo.config.features.length !== 2) throw new Error('Features not saved correctly');
}

async function testDemoRetrieval(demoService: DemoService): Promise<void> {
  const demo = await demoService.getDemo(testDemoId);

  if (demo.id !== testDemoId) throw new Error('Demo ID mismatch');
  if (demo.name !== 'Test Demo₀') throw new Error('Demo name mismatch');
}

async function testDemoListing(demoService: DemoService): Promise<void> {
  const demos = await demoService.listDemos(testProjectId);

  if (demos.length === 0) throw new Error('No demos returned');
  if (!demos.find(d => d.id === testDemoId)) throw new Error('Test demo not in list');
}

async function testDemoStatusTransition(demoService: DemoService): Promise<void> {
  // Draft -> Building
  let success = await demoService.startBuild(testDemoId);
  if (!success) throw new Error('Failed to start build');

  let demo = await demoService.getDemo(testDemoId);
  if (demo.status !== 'building') throw new Error(`Expected 'building', got '${demo.status}'`);
  if (!demo.builtAt) throw new Error('builtAt not set');

  // Building -> Ready
  success = await demoService.markReady(testDemoId);
  if (!success) throw new Error('Failed to mark ready');

  demo = await demoService.getDemo(testDemoId);
  if (demo.status !== 'ready') throw new Error(`Expected 'ready', got '${demo.status}'`);
  if (!demo.readyAt) throw new Error('readyAt not set');
}

async function testInvalidStatusTransition(demoService: DemoService): Promise<void> {
  // Ready -> Building should fail
  const success = await demoService.updateStatus(testDemoId, 'building');
  if (success) throw new Error('Invalid transition should have failed');
}

async function testConfigUpdate(demoService: DemoService): Promise<void> {
  const demo = await demoService.updateConfig(testDemoId, {
    estimatedTime: 45,
    estimatedCost: 20,
  });

  if (demo.config.estimatedTime !== 45) throw new Error('estimatedTime not updated');
  if (demo.config.estimatedCost !== 20) throw new Error('estimatedCost not updated');
  // Original values should persist
  if (demo.config.features.length !== 2) throw new Error('features should persist');
}

async function testScaffoldingUpdate(demoService: DemoService): Promise<void> {
  const demo = await demoService.updateScaffolding(testDemoId, {
    totalFiles: 20,
    reusableFiles: 8,
    components: ['Button', 'Header', 'Footer'],
    routes: ['/home', '/about'],
    styles: ['main.css'],
  });

  if (demo.scaffolding.totalFiles !== 20) throw new Error('totalFiles not updated');
  if (demo.scaffolding.reusableFiles !== 8) throw new Error('reusableFiles not updated');
  if (demo.scaffolding.reusablePercent !== 40) throw new Error('reusablePercent not calculated correctly');
  if (demo.scaffolding.components.length !== 3) throw new Error('components not updated');
}

async function testPreviewUrl(demoService: DemoService): Promise<void> {
  const url = 'http://localhost:3001/preview/test123';
  const port = 3001;
  const pid = 12345;

  let demo = await demoService.setPreviewUrl(testDemoId, url, port, pid);

  if (demo.previewUrl !== url) throw new Error('previewUrl not set');
  if (demo.previewPort !== port) throw new Error('previewPort not set');
  if (demo.previewPid !== pid) throw new Error('previewPid not set');

  demo = await demoService.clearPreview(testDemoId);

  if (demo.previewUrl) throw new Error('previewUrl not cleared');
  if (demo.previewPort) throw new Error('previewPort not cleared');
  if (demo.previewPid) throw new Error('previewPid not cleared');
}

async function testDemoStats(demoService: DemoService): Promise<void> {
  const stats = await demoService.getStats(testProjectId);

  if (stats.totalDemos === 0) throw new Error('totalDemos should be > 0');
  if (stats.readyCount === 0) throw new Error('readyCount should be > 0');
}

// Approval Service Tests
async function testApprovalRequest(approvalService: ApprovalService): Promise<void> {
  const request = await approvalService.requestApproval(testDemoId, 'test-admin');

  testApprovalRequestId = request.id;

  if (!request.id) throw new Error('Approval request ID not returned');
  if (request.demoId !== testDemoId) throw new Error('demoId mismatch');
  if (request.requestedBy !== 'test-admin') throw new Error('requestedBy mismatch');
  if (request.decision !== undefined) throw new Error('decision should be undefined');
}

async function testPendingApprovals(approvalService: ApprovalService): Promise<void> {
  const pending = await approvalService.getPendingApprovals();

  if (pending.length === 0) throw new Error('No pending approvals');
  const found = pending.find(p => p.requestId === testApprovalRequestId);
  if (!found) throw new Error('Test approval not in pending list');
}

async function testApprovalDecision(approvalService: ApprovalService, demoService: DemoService): Promise<void> {
  const success = await approvalService.approve(
    testApprovalRequestId,
    'admin-user',
    { comments: 'Looks great!' }
  );

  if (!success) throw new Error('Approval failed');

  const request = await approvalService.getApprovalRequest(testApprovalRequestId);
  if (request.decision !== 'approve') throw new Error(`Expected 'approve', got '${request.decision}'`);
  if (request.decidedBy !== 'admin-user') throw new Error('decidedBy mismatch');
  if (request.comments !== 'Looks great!') throw new Error('comments mismatch');
  if (request.nextAction !== 'proceed_to_build') throw new Error(`Expected 'proceed_to_build', got '${request.nextAction}'`);

  // Demo status should be updated
  const demo = await demoService.getDemo(testDemoId);
  if (demo.status !== 'approved') throw new Error(`Expected demo status 'approved', got '${demo.status}'`);
}

async function testApprovalHistory(approvalService: ApprovalService): Promise<void> {
  const history = await approvalService.getApprovalHistory(testDemoId);

  if (history.length === 0) throw new Error('No approval history');
  if (history[0].id !== testApprovalRequestId) throw new Error('Latest approval not in history');
}

// Create a second demo for request_changes test
let testDemo2Id: string;
let testApproval2Id: string;

async function testRequestChanges(approvalService: ApprovalService, demoService: DemoService): Promise<void> {
  // Create a new demo
  const demo = await demoService.createDemo(testProjectId, {
    name: 'Test Demo₁',
    type: 'trust',
  });
  testDemo2Id = demo.id;

  // Progress to ready
  await demoService.startBuild(testDemo2Id);
  await demoService.markReady(testDemo2Id);

  // Request approval
  const request = await approvalService.requestApproval(testDemo2Id);
  testApproval2Id = request.id;

  // Request changes
  const success = await approvalService.requestChanges(
    testApproval2Id,
    'reviewer',
    {
      comments: 'Needs some work',
      changeRequests: ['Fix button alignment', 'Add loading state'],
    }
  );

  if (!success) throw new Error('Request changes failed');

  const updatedRequest = await approvalService.getApprovalRequest(testApproval2Id);
  if (updatedRequest.decision !== 'request_changes') throw new Error('Decision not set');
  if (updatedRequest.changeRequests.length !== 2) throw new Error('Change requests not saved');
  if (updatedRequest.nextAction !== 'revise_demo') throw new Error(`Expected 'revise_demo', got '${updatedRequest.nextAction}'`);

  // Demo status should be revision_requested
  const updatedDemo = await demoService.getDemo(testDemo2Id);
  if (updatedDemo.status !== 'revision_requested') throw new Error(`Expected 'revision_requested', got '${updatedDemo.status}'`);
}

// Verification Service Tests
async function testVerificationBasic(verificationService: VerificationService): Promise<void> {
  // Create a mock result (since we can't actually verify a URL)
  const result = await verificationService.verifyDemo(
    testDemoId,
    'http://localhost:3000',
    {
      skipProcess: true,
      skipUrl: true,
      skipPage: true,
      skipFlow: true,
      skipResponsive: true,
    }
  );

  // With all checks skipped, result should have no checks
  if (result.checks.length !== 0) throw new Error('Expected no checks with all skipped');
  // No passed checks means not passed
  if (result.passed !== false) throw new Error('Expected passed=false with no checks');
}

async function testVerificationHistory(verificationService: VerificationService): Promise<void> {
  const history = await verificationService.getVerificationHistory(testDemoId);
  if (history.length === 0) throw new Error('No verification history');
}

// Feedback Service Tests
async function testFeedbackCreation(feedbackService: FeedbackService): Promise<void> {
  const feedback = await feedbackService.addFeedback(testDemoId, {
    content: 'The button color should be blue',
    sentiment: 'neutral',
    category: 'design',
    pageUrl: '/home',
    elementId: 'submit-btn',
  });

  testFeedbackId = feedback.id;

  if (!feedback.id) throw new Error('Feedback ID not returned');
  if (feedback.content !== 'The button color should be blue') throw new Error('Content mismatch');
  if (feedback.sentiment !== 'neutral') throw new Error('Sentiment mismatch');
  if (feedback.category !== 'design') throw new Error('Category mismatch');
}

async function testFeedbackRetrieval(feedbackService: FeedbackService): Promise<void> {
  const feedback = await feedbackService.getFeedback(testFeedbackId);

  if (feedback.id !== testFeedbackId) throw new Error('Feedback ID mismatch');
  if (feedback.pageUrl !== '/home') throw new Error('pageUrl mismatch');
}

async function testFeedbackListing(feedbackService: FeedbackService): Promise<void> {
  // Add more feedback
  await feedbackService.addFeedback(testDemoId, {
    content: 'Great work on the navigation!',
    sentiment: 'positive',
    category: 'general',
  });

  await feedbackService.addFeedback(testDemoId, {
    content: 'Page loads too slowly',
    sentiment: 'negative',
    category: 'performance',
  });

  const allFeedback = await feedbackService.listFeedback(testDemoId);
  if (allFeedback.length !== 3) throw new Error(`Expected 3 feedback items, got ${allFeedback.length}`);

  // Filter by sentiment
  const negativeFeedback = await feedbackService.listFeedback(testDemoId, { sentiment: 'negative' });
  if (negativeFeedback.length !== 1) throw new Error('Sentiment filter not working');

  // Filter by category
  const designFeedback = await feedbackService.listFeedback(testDemoId, { category: 'design' });
  if (designFeedback.length !== 1) throw new Error('Category filter not working');
}

async function testFeedbackProcessing(feedbackService: FeedbackService): Promise<void> {
  const feedback = await feedbackService.processFeedback(
    testFeedbackId,
    'Changed button color to blue in commit abc123'
  );

  if (!feedback.processedAt) throw new Error('processedAt not set');
  if (feedback.actionTaken !== 'Changed button color to blue in commit abc123') {
    throw new Error('actionTaken mismatch');
  }
}

async function testFeedbackResolution(feedbackService: FeedbackService): Promise<void> {
  const feedback = await feedbackService.resolveFeedback(testFeedbackId);

  if (!feedback.resolvedAt) throw new Error('resolvedAt not set');

  // Test unresolved filter
  const unresolvedFeedback = await feedbackService.listFeedback(testDemoId, { unresolved: true });
  if (unresolvedFeedback.find(f => f.id === testFeedbackId)) {
    throw new Error('Resolved feedback should not appear in unresolved list');
  }
}

async function testFeedbackSummary(feedbackService: FeedbackService): Promise<void> {
  const summary = await feedbackService.getFeedbackSummary(testDemoId);

  if (summary.totalFeedback !== 3) throw new Error(`Expected 3 total, got ${summary.totalFeedback}`);
  if (summary.positiveCount !== 1) throw new Error(`Expected 1 positive, got ${summary.positiveCount}`);
  if (summary.neutralCount !== 1) throw new Error(`Expected 1 neutral, got ${summary.neutralCount}`);
  if (summary.negativeCount !== 1) throw new Error(`Expected 1 negative, got ${summary.negativeCount}`);
  // One was resolved
  if (summary.unresolvedCount !== 2) throw new Error(`Expected 2 unresolved, got ${summary.unresolvedCount}`);
}

async function testFeedbackDeletion(feedbackService: FeedbackService): Promise<void> {
  const success = await feedbackService.deleteFeedback(testFeedbackId);
  if (!success) throw new Error('Delete should return true');

  try {
    await feedbackService.getFeedback(testFeedbackId);
    throw new Error('Should have thrown error');
  } catch (error) {
    if (error instanceof Error && !error.message.includes('not found')) {
      throw error;
    }
  }
}

// Demo deletion test (must be draft)
async function testDemoDeletion(demoService: DemoService): Promise<void> {
  // Create a draft demo
  const demo = await demoService.createDemo(testProjectId, {
    name: 'To Be Deleted',
  });

  const success = await demoService.deleteDemo(demo.id);
  if (!success) throw new Error('Delete should succeed for draft');

  // Try to delete non-draft (should fail)
  try {
    await demoService.deleteDemo(testDemoId); // This is approved
    throw new Error('Should have thrown error');
  } catch (error) {
    if (error instanceof Error && !error.message.includes('Only draft')) {
      throw error;
    }
  }
}

// Demo versioning test
async function testDemoVersioning(demoService: DemoService): Promise<void> {
  // Create another demo in same project
  const demo = await demoService.createDemo(testProjectId, {
    name: 'Version Test Demo',
  });

  // Version should be incremented (we already have 2 demos)
  if (demo.version <= 2) throw new Error(`Expected version > 2, got ${demo.version}`);
}

async function main(): Promise<void> {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║     Demo₇ Tester: Demo System          ║');
  console.log('╚════════════════════════════════════════╝\n');

  const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'eklavya',
    user: process.env.DB_USER || 'eklavya',
    password: process.env.DB_PASSWORD || 'eklavya_dev_pwd',
  };

  const db = getDatabase(dbConfig);
  const demoService = getDemoService();
  const approvalService = getApprovalService();
  const verificationService = getVerificationService();
  const feedbackService = getFeedbackService();

  try {
    // Setup
    console.log('Setting up test data...');
    await setupTestData();

    // Demo Service Tests
    console.log('\n📦 Demo Service Tests:');
    await runTest('Demo creation', () => testDemoCreation(demoService));
    await runTest('Demo retrieval', () => testDemoRetrieval(demoService));
    await runTest('Demo listing', () => testDemoListing(demoService));
    await runTest('Demo status transitions', () => testDemoStatusTransition(demoService));
    await runTest('Invalid status transition rejected', () => testInvalidStatusTransition(demoService));
    await runTest('Config update', () => testConfigUpdate(demoService));
    await runTest('Scaffolding update', () => testScaffoldingUpdate(demoService));
    await runTest('Preview URL management', () => testPreviewUrl(demoService));
    await runTest('Demo statistics', () => testDemoStats(demoService));

    // Approval Service Tests
    console.log('\n✅ Approval Workflow Tests:');
    await runTest('Approval request creation', () => testApprovalRequest(approvalService));
    await runTest('Pending approvals listing', () => testPendingApprovals(approvalService));
    await runTest('Approval decision processing', () => testApprovalDecision(approvalService, demoService));
    await runTest('Approval history', () => testApprovalHistory(approvalService));
    await runTest('Request changes workflow', () => testRequestChanges(approvalService, demoService));

    // Verification Service Tests
    console.log('\n🔍 Verification Tests:');
    await runTest('Basic verification (skipped checks)', () => testVerificationBasic(verificationService));
    await runTest('Verification history', () => testVerificationHistory(verificationService));

    // Feedback Service Tests
    console.log('\n💬 Feedback Tests:');
    await runTest('Feedback creation', () => testFeedbackCreation(feedbackService));
    await runTest('Feedback retrieval', () => testFeedbackRetrieval(feedbackService));
    await runTest('Feedback listing and filtering', () => testFeedbackListing(feedbackService));
    await runTest('Feedback processing', () => testFeedbackProcessing(feedbackService));
    await runTest('Feedback resolution', () => testFeedbackResolution(feedbackService));
    await runTest('Feedback summary', () => testFeedbackSummary(feedbackService));
    await runTest('Feedback deletion', () => testFeedbackDeletion(feedbackService));

    // Additional Demo Tests
    console.log('\n📋 Additional Demo Tests:');
    await runTest('Demo deletion (draft only)', () => testDemoDeletion(demoService));
    await runTest('Demo versioning', () => testDemoVersioning(demoService));

    // Cleanup
    console.log('\nCleaning up...');
    await cleanupTestData();

  } catch (error) {
    console.error('\nFatal error:', error);
  } finally {
    await db.close();
  }

  // Summary
  console.log('\n' + '═'.repeat(50));
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  const percentage = Math.round((passed / total) * 100);

  console.log(`Results: ${passed}/${total} tests passed (${percentage}%)`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
  }

  // Grade calculation
  let grade: string;
  if (percentage >= 95) grade = 'A';
  else if (percentage >= 85) grade = 'B';
  else if (percentage >= 75) grade = 'C';
  else if (percentage >= 65) grade = 'D';
  else grade = 'F';

  console.log(`\nGrade: ${grade} (${percentage}/100)`);

  if (percentage >= 85) {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║     ✓ DEMO₇ VERIFIED AND READY         ║');
    console.log('╚════════════════════════════════════════╝');
  } else {
    console.log('\n⚠️  Demo₇ needs attention before proceeding.');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
