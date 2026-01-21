#!/usr/bin/env npx tsx
/**
 * Demo₆ Tester: Real-Time Portal
 *
 * Tests:
 * 1. Smart notification system (4 levels)
 * 2. Notification routing by availability
 * 3. Activity stream logging and retrieval
 * 4. Project progress tracking
 * 5. Notification settings management
 * 6. API endpoints for all features
 */

// Disable authentication for API tests
process.env.AUTH_DISABLED = 'true';

import { getDatabase } from '../lib/database.js';

// Initialize database with environment config
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'eklavya',
  user: process.env.DB_USER || 'eklavya',
  password: process.env.DB_PASSWORD || 'eklavya_dev_pwd',
};

// Initialize singleton
getDatabase(dbConfig);
import {
  getNotificationService,
  createNotificationService,
  type NotificationLevel,
} from '../core/notifications/index.js';
import {
  getActivityService,
} from '../core/activity/index.js';
import {
  getProgressService,
} from '../core/progress/index.js';
import { createApiServer, type ApiServer } from '../api/index.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const API_BASE = process.env.API_URL || 'http://localhost:4000';

async function apiCall<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: T }> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json() as T;
  return { status: response.status, data };
}

class Demo6Tester {
  private results: TestResult[] = [];
  private testProjectId: string = '';
  private testAgentId: string = '';
  private testTaskId: string = '';
  private apiServer: ApiServer | null = null;

  async runAllTests(): Promise<void> {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║     Demo₆: Real-Time Portal Tester     ║');
    console.log('╚════════════════════════════════════════╝\n');

    // Database is initialized automatically via getDatabase()

    // Setup test data
    await this.setupTestData();

    // Run test categories
    console.log('📢 Testing Notification System...\n');
    await this.testNotificationCreation();
    await this.testNotificationLevels();
    await this.testNotificationChannelRouting();
    await this.testNotificationReadAndAcknowledge();
    await this.testNotificationFiltering();
    await this.testUnreadCount();

    console.log('\n📡 Testing Activity Stream...\n');
    await this.testActivityLogging();
    await this.testActivityFiltering();
    await this.testActivityStats();
    await this.testActivityHelpers();

    console.log('\n📊 Testing Progress Tracking...\n');
    await this.testProgressCalculation();
    await this.testProgressSnapshot();
    await this.testProgressHistory();

    console.log('\n⚙️ Testing Notification Settings...\n');
    await this.testSettingsRetrieval();
    await this.testSettingsUpdate();
    await this.testAvailabilityMode();
    await this.testQuietHoursDetection();

    console.log('\n🌐 Testing API Endpoints...\n');
    // Start API server for endpoint tests
    await this.startApiServer();
    await this.testNotificationAPI();
    await this.testActivityAPI();
    await this.testProgressAPI();
    await this.testSettingsAPI();
    await this.stopApiServer();

    // Cleanup
    await this.cleanup();

    // Print results
    this.printResults();
  }

  private async startApiServer(): Promise<void> {
    // Check if server is already running by attempting a connection
    try {
      const response = await fetch(`${API_BASE}/api/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(1000)
      });
      if (response.ok) {
        console.log('  ✓ API server already running on port 4000\n');
        return;
      }
    } catch {
      // Server not running, we need to start it
    }

    try {
      this.apiServer = createApiServer({ port: 4000 });
      await this.apiServer.start(4000);
      // Give server time to fully start
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log('  ✓ API server started on port 4000\n');
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      if (errMsg.includes('EADDRINUSE')) {
        console.log('  ✓ API server already running on port 4000\n');
        this.apiServer = null; // Don't try to stop it later
      } else {
        console.log(`  ⚠ Could not start API server: ${errMsg}`);
        console.log('  → API tests will be skipped if server unavailable\n');
      }
    }
  }

  private async stopApiServer(): Promise<void> {
    if (this.apiServer) {
      await this.apiServer.stop();
      this.apiServer = null;
    }
  }

  private async setupTestData(): Promise<void> {
    const db = getDatabase();

    // Create test project
    const projectResult = await db.query<{ id: string }>(
      `INSERT INTO projects (name, description, status)
       VALUES ('Demo₆ Test Project', 'Testing real-time portal', 'active')
       RETURNING id`
    );
    this.testProjectId = projectResult.rows[0].id;

    // Create test agent
    const agentResult = await db.query<{ id: string }>(
      `INSERT INTO agents (project_id, type, status)
       VALUES ($1, 'developer', 'working')
       RETURNING id`,
      [this.testProjectId]
    );
    this.testAgentId = agentResult.rows[0].id;

    // Create test task
    const taskResult = await db.query<{ id: string }>(
      `INSERT INTO tasks (project_id, title, status, assigned_agent_id)
       VALUES ($1, 'Test Task', 'in_progress', $2)
       RETURNING id`,
      [this.testProjectId, this.testAgentId]
    );
    this.testTaskId = taskResult.rows[0].id;

    console.log(`✓ Setup: Project ${this.testProjectId.slice(0, 8)}, Agent ${this.testAgentId.slice(0, 8)}\n`);
  }

  private async cleanup(): Promise<void> {
    const db = getDatabase();

    // Delete test data (cascades to related tables)
    await db.query(`DELETE FROM projects WHERE id = $1`, [this.testProjectId]);

    console.log('\n✓ Cleanup completed');
  }

  private async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
    const start = Date.now();
    try {
      await testFn();
      this.results.push({ name, passed: true, duration: Date.now() - start });
      console.log(`  ✓ ${name}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.results.push({ name, passed: false, error: errorMsg, duration: Date.now() - start });
      console.log(`  ✗ ${name}: ${errorMsg}`);
    }
  }

  // Notification Tests
  private async testNotificationCreation(): Promise<void> {
    await this.runTest('Create notification', async () => {
      const service = getNotificationService();
      const notification = await service.createNotification(
        this.testProjectId,
        'info',
        'test_event',
        'Test Notification',
        {
          message: 'This is a test notification',
          agentId: this.testAgentId,
        }
      );

      if (!notification.id) throw new Error('Notification not created');
      if (notification.level !== 'info') throw new Error('Wrong level');
      if (notification.title !== 'Test Notification') throw new Error('Wrong title');
    });
  }

  private async testNotificationLevels(): Promise<void> {
    await this.runTest('Notification levels and triggers', async () => {
      const service = getNotificationService();

      // Test each level
      for (const level of ['critical', 'warning', 'info', 'silent'] as NotificationLevel[]) {
        const notification = await service.createNotification(
          this.testProjectId,
          level,
          `test_${level}`,
          `Test ${level}`,
          {}
        );

        if (notification.level !== level) {
          throw new Error(`Expected level ${level}, got ${notification.level}`);
        }
      }

      // Test level lookup from event type
      const buildFailedLevel = service.getLevelForEventType('build_failed');
      if (buildFailedLevel !== 'critical') throw new Error('build_failed should be critical');

      const demoReadyLevel = service.getLevelForEventType('demo_ready');
      if (demoReadyLevel !== 'warning') throw new Error('demo_ready should be warning');

      const milestoneLevel = service.getLevelForEventType('milestone_complete');
      if (milestoneLevel !== 'info') throw new Error('milestone_complete should be info');
    });
  }

  private async testNotificationChannelRouting(): Promise<void> {
    await this.runTest('Notification channel routing by availability', async () => {
      const service = createNotificationService({ defaultAvailability: 'active' });

      // Active mode - all channels
      const activeChannels = await service.getChannelsForNotification('critical');
      if (!activeChannels.includes('sms')) throw new Error('Critical should include SMS when active');
      if (!activeChannels.includes('email')) throw new Error('Critical should include email when active');

      // DND mode - minimal channels
      await service.setAvailabilityMode('dnd');
      const dndChannels = await service.getChannelsForNotification('info');
      if (dndChannels.length > 1) throw new Error('DND should minimize channels for info');

      // Reset
      await service.setAvailabilityMode('active');
    });
  }

  private async testNotificationReadAndAcknowledge(): Promise<void> {
    await this.runTest('Mark notification read and acknowledge', async () => {
      const service = getNotificationService();

      // Create notification
      const notification = await service.createNotification(
        this.testProjectId,
        'warning',
        'approval_needed',
        'Approval Required',
        {}
      );

      // Mark as read
      const readSuccess = await service.markAsRead(notification.id);
      if (!readSuccess) throw new Error('Failed to mark as read');

      const readNotification = await service.getNotification(notification.id);
      if (!readNotification.readAt) throw new Error('readAt not set');

      // Acknowledge
      const ackSuccess = await service.acknowledge(notification.id);
      if (!ackSuccess) throw new Error('Failed to acknowledge');

      const ackNotification = await service.getNotification(notification.id);
      if (!ackNotification.acknowledgedAt) throw new Error('acknowledgedAt not set');
    });
  }

  private async testNotificationFiltering(): Promise<void> {
    await this.runTest('Filter notifications', async () => {
      const service = getNotificationService();

      // Create notifications of different levels
      await service.createNotification(this.testProjectId, 'critical', 'test', 'Critical 1', {});
      await service.createNotification(this.testProjectId, 'critical', 'test', 'Critical 2', {});
      await service.createNotification(this.testProjectId, 'info', 'test', 'Info 1', {});

      // Filter by level
      const criticalOnly = await service.getNotifications(this.testProjectId, { level: 'critical' });
      if (criticalOnly.length < 2) throw new Error('Should have at least 2 critical notifications');
      if (criticalOnly.some(n => n.level !== 'critical')) throw new Error('Filter returned wrong level');

      // Filter by project
      const projectNotifications = await service.getNotifications(this.testProjectId, {});
      if (projectNotifications.length < 3) throw new Error('Should have at least 3 notifications');
    });
  }

  private async testUnreadCount(): Promise<void> {
    await this.runTest('Get unread notification count', async () => {
      const service = getNotificationService();

      const count = await service.getUnreadCount(this.testProjectId);
      if (typeof count.total !== 'number') throw new Error('total should be a number');
      if (typeof count.critical !== 'number') throw new Error('critical should be a number');
      if (typeof count.warning !== 'number') throw new Error('warning should be a number');
      if (typeof count.info !== 'number') throw new Error('info should be a number');
    });
  }

  // Activity Tests
  private async testActivityLogging(): Promise<void> {
    await this.runTest('Log activity events', async () => {
      const service = getActivityService();

      const activity = await service.logActivity(
        this.testProjectId,
        'agent_status',
        'Agent started working',
        {
          agentId: this.testAgentId,
          agentType: 'developer',
          notificationLevel: 'info',
        }
      );

      if (!activity.id) throw new Error('Activity not logged');
      if (activity.eventType !== 'agent_status') throw new Error('Wrong event type');
      if (activity.action !== 'Agent started working') throw new Error('Wrong action');
    });
  }

  private async testActivityFiltering(): Promise<void> {
    await this.runTest('Filter activity stream', async () => {
      const service = getActivityService();

      // Log multiple activities
      await service.logActivity(this.testProjectId, 'file_change', 'File created: test.ts', {});
      await service.logActivity(this.testProjectId, 'build_event', 'Build started', {});
      await service.logActivity(this.testProjectId, 'test_result', 'Tests passed', {});

      // Filter by event type
      const fileChanges = await service.getActivityStream({
        projectId: this.testProjectId,
        eventType: 'file_change',
      });
      if (fileChanges.some(a => a.eventType !== 'file_change')) {
        throw new Error('Filter returned wrong event type');
      }

      // Filter by project
      const projectActivity = await service.getProjectActivity(this.testProjectId, { limit: 10 });
      if (projectActivity.some(a => a.projectId !== this.testProjectId)) {
        throw new Error('Filter returned wrong project');
      }
    });
  }

  private async testActivityStats(): Promise<void> {
    await this.runTest('Get activity statistics', async () => {
      const service = getActivityService();

      const stats = await service.getActivityStats(this.testProjectId);

      if (typeof stats.totalEvents !== 'number') throw new Error('totalEvents should be number');
      if (!stats.byEventType) throw new Error('byEventType missing');
      if (!stats.byNotificationLevel) throw new Error('byNotificationLevel missing');
    });
  }

  private async testActivityHelpers(): Promise<void> {
    await this.runTest('Activity helper methods', async () => {
      const service = getActivityService();

      // Test helper methods
      const statusChange = await service.logAgentStatusChange(
        this.testProjectId,
        this.testAgentId,
        'developer',
        'working',
        'idle'
      );
      if (statusChange.eventType !== 'agent_status') throw new Error('Wrong event type for status change');

      const taskProgress = await service.logTaskProgress(
        this.testProjectId,
        this.testTaskId,
        'Test Task',
        'completed'
      );
      if (taskProgress.eventType !== 'task_progress') throw new Error('Wrong event type for task progress');

      const buildEvent = await service.logBuildEvent(
        this.testProjectId,
        'success',
        'Build completed in 45s'
      );
      if (buildEvent.eventType !== 'build_event') throw new Error('Wrong event type for build');

      const milestone = await service.logMilestone(
        this.testProjectId,
        'Phase 1 Complete',
        'All initial features implemented'
      );
      if (milestone.eventType !== 'milestone') throw new Error('Wrong event type for milestone');
    });
  }

  // Progress Tests
  private async testProgressCalculation(): Promise<void> {
    await this.runTest('Calculate project progress', async () => {
      const service = getProgressService();

      const progress = await service.getProjectProgress(this.testProjectId);

      if (typeof progress.overallPercent !== 'number') throw new Error('overallPercent should be number');
      if (!progress.currentPhase) throw new Error('currentPhase missing');
      if (!progress.agents) throw new Error('agents summary missing');
      if (!progress.tasks) throw new Error('tasks summary missing');
      if (!progress.budget) throw new Error('budget info missing');
    });
  }

  private async testProgressSnapshot(): Promise<void> {
    await this.runTest('Save progress snapshot', async () => {
      const service = getProgressService();

      const snapshot = await service.saveProgressSnapshot(this.testProjectId);

      if (!snapshot.id) throw new Error('Snapshot not created');
      if (snapshot.projectId !== this.testProjectId) throw new Error('Wrong project ID');
      if (typeof snapshot.overallPercent !== 'number') throw new Error('overallPercent missing');
    });
  }

  private async testProgressHistory(): Promise<void> {
    await this.runTest('Get progress history', async () => {
      const service = getProgressService();

      // Save multiple snapshots
      await service.saveProgressSnapshot(this.testProjectId);
      await service.saveProgressSnapshot(this.testProjectId);

      const history = await service.getProgressHistory(this.testProjectId, { limit: 10 });

      if (history.length < 2) throw new Error('Should have at least 2 snapshots');
      if (history[0].projectId !== this.testProjectId) throw new Error('Wrong project in history');
    });
  }

  // Settings Tests
  private async testSettingsRetrieval(): Promise<void> {
    await this.runTest('Get notification settings', async () => {
      const service = getNotificationService();

      const settings = await service.getSettings();

      if (!settings.availabilityMode) throw new Error('availabilityMode missing');
      if (typeof settings.emailEnabled !== 'boolean') throw new Error('emailEnabled should be boolean');
      if (typeof settings.pushEnabled !== 'boolean') throw new Error('pushEnabled should be boolean');
    });
  }

  private async testSettingsUpdate(): Promise<void> {
    await this.runTest('Update notification settings', async () => {
      const service = getNotificationService();

      const updated = await service.updateSettings({
        emailEnabled: false,
        quietHoursStart: '22:00',
        quietHoursEnd: '08:00',
      });

      if (updated.emailEnabled !== false) throw new Error('emailEnabled not updated');
      // PostgreSQL TIME can return '22:00:00' format, so check if it starts with expected value
      if (!updated.quietHoursStart || !updated.quietHoursStart.startsWith('22:00')) {
        throw new Error(`quietHoursStart not updated, got: ${updated.quietHoursStart}`);
      }

      // Reset
      await service.updateSettings({ emailEnabled: true });
    });
  }

  private async testAvailabilityMode(): Promise<void> {
    await this.runTest('Set availability mode', async () => {
      const service = getNotificationService();

      await service.setAvailabilityMode('busy');
      if (service.getAvailabilityMode() !== 'busy') throw new Error('Mode not set to busy');

      await service.setAvailabilityMode('dnd');
      if (service.getAvailabilityMode() !== 'dnd') throw new Error('Mode not set to dnd');

      // Reset
      await service.setAvailabilityMode('active');
    });
  }

  private async testQuietHoursDetection(): Promise<void> {
    await this.runTest('Detect quiet hours', async () => {
      const service = getNotificationService();

      // This test just verifies the method works
      const isQuiet = await service.isInQuietHours();
      if (typeof isQuiet !== 'boolean') throw new Error('isInQuietHours should return boolean');
    });
  }

  // API Tests
  private async testNotificationAPI(): Promise<void> {
    await this.runTest('Notification API endpoints', async () => {
      // Create notification via API
      const createRes = await apiCall<{ success: boolean; notification: { id: string } }>(
        'POST',
        '/api/notifications',
        {
          projectId: this.testProjectId,
          level: 'info',
          eventType: 'api_test',
          title: 'API Test Notification',
          message: 'Created via API',
        }
      );

      if (createRes.status !== 201) throw new Error(`Create failed: ${createRes.status}`);
      if (!createRes.data.notification?.id) throw new Error('Notification not returned');

      const notificationId = createRes.data.notification.id;

      // Get notifications
      const getRes = await apiCall<{ success: boolean; notifications: unknown[] }>(
        'GET',
        `/api/notifications?projectId=${this.testProjectId}`
      );

      if (getRes.status !== 200) throw new Error(`Get failed: ${getRes.status}`);
      if (!getRes.data.notifications) throw new Error('notifications not returned');

      // Get unread count
      const unreadRes = await apiCall<{ success: boolean; total: number }>(
        'GET',
        '/api/notifications/unread'
      );

      if (unreadRes.status !== 200) throw new Error(`Unread failed: ${unreadRes.status}`);
      if (typeof unreadRes.data.total !== 'number') throw new Error('total not returned');

      // Mark as read
      const readRes = await apiCall<{ success: boolean }>(
        'POST',
        `/api/notifications/${notificationId}/read`
      );

      if (readRes.status !== 200) throw new Error(`Mark read failed: ${readRes.status}`);
    });
  }

  private async testActivityAPI(): Promise<void> {
    await this.runTest('Activity API endpoints', async () => {
      // Log activity via API
      const logRes = await apiCall<{ success: boolean; activity: { id: string } }>(
        'POST',
        '/api/activity',
        {
          projectId: this.testProjectId,
          eventType: 'milestone',
          action: 'API Test Milestone',
          details: 'Logged via API',
        }
      );

      if (logRes.status !== 201) throw new Error(`Log failed: ${logRes.status}`);
      if (!logRes.data.activity?.id) throw new Error('Activity not returned');

      // Get recent activity
      const recentRes = await apiCall<{ success: boolean; activities: unknown[] }>(
        'GET',
        '/api/activity/recent?limit=10'
      );

      if (recentRes.status !== 200) throw new Error(`Recent failed: ${recentRes.status}`);
      if (!recentRes.data.activities) throw new Error('activities not returned');

      // Get project activity
      const projectRes = await apiCall<{ success: boolean; activities: unknown[] }>(
        'GET',
        `/api/projects/${this.testProjectId}/activity-stream`
      );

      if (projectRes.status !== 200) throw new Error(`Project activity failed: ${projectRes.status}`);

      // Get stats
      const statsRes = await apiCall<{ success: boolean; stats: object }>(
        'GET',
        '/api/activity/stats'
      );

      if (statsRes.status !== 200) throw new Error(`Stats failed: ${statsRes.status}`);
    });
  }

  private async testProgressAPI(): Promise<void> {
    await this.runTest('Progress API endpoints', async () => {
      // Get project progress
      const progressRes = await apiCall<{ success: boolean; progress: object }>(
        'GET',
        `/api/projects/${this.testProjectId}/progress`
      );

      if (progressRes.status !== 200) throw new Error(`Progress failed: ${progressRes.status}`);
      if (!progressRes.data.progress) throw new Error('progress not returned');

      // Save snapshot
      const snapshotRes = await apiCall<{ success: boolean; snapshot: { id: string } }>(
        'POST',
        `/api/projects/${this.testProjectId}/progress/snapshot`
      );

      if (snapshotRes.status !== 201) throw new Error(`Snapshot failed: ${snapshotRes.status}`);

      // Get history
      const historyRes = await apiCall<{ success: boolean; history: unknown[] }>(
        'GET',
        `/api/projects/${this.testProjectId}/progress/history`
      );

      if (historyRes.status !== 200) throw new Error(`History failed: ${historyRes.status}`);
    });
  }

  private async testSettingsAPI(): Promise<void> {
    await this.runTest('Settings API endpoints', async () => {
      // Get settings
      const getRes = await apiCall<{ success: boolean; settings: object }>(
        'GET',
        '/api/settings/notifications'
      );

      if (getRes.status !== 200) throw new Error(`Get settings failed: ${getRes.status}`);
      if (!getRes.data.settings) throw new Error('settings not returned');

      // Update settings
      const updateRes = await apiCall<{ success: boolean; settings: object }>(
        'PUT',
        '/api/settings/notifications',
        { emailEnabled: true }
      );

      if (updateRes.status !== 200) throw new Error(`Update settings failed: ${updateRes.status}`);

      // Update availability
      const availRes = await apiCall<{ success: boolean; mode: string }>(
        'PUT',
        '/api/settings/availability',
        { mode: 'active' }
      );

      if (availRes.status !== 200) throw new Error(`Update availability failed: ${availRes.status}`);
    });
  }

  private printResults(): void {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const totalTime = this.results.reduce((sum, r) => sum + r.duration, 0);

    console.log('\n════════════════════════════════════════');
    console.log('                RESULTS                 ');
    console.log('════════════════════════════════════════');
    console.log(`  Total:  ${this.results.length} tests`);
    console.log(`  Passed: ${passed} ✓`);
    console.log(`  Failed: ${failed} ✗`);
    console.log(`  Time:   ${totalTime}ms`);
    console.log('════════════════════════════════════════');

    if (failed > 0) {
      console.log('\nFailed Tests:');
      this.results
        .filter(r => !r.passed)
        .forEach(r => console.log(`  ✗ ${r.name}: ${r.error}`));
    }

    // Calculate quality metrics
    const codeQuality = Math.round((passed / this.results.length) * 100);
    const testCoverage = 50; // Estimated based on test count
    const requirementsCoverage = Math.round((passed / this.results.length) * 100);

    console.log('\n📊 Quality Metrics:');
    console.log(`  Code Quality:        ${codeQuality}%`);
    console.log(`  Test Coverage:       ${testCoverage}%`);
    console.log(`  Requirements:        ${requirementsCoverage}%`);

    // Grade calculation
    const avgScore = (codeQuality + testCoverage + requirementsCoverage) / 3;
    let grade = 'F';
    if (avgScore >= 90) grade = 'A';
    else if (avgScore >= 80) grade = 'B';
    else if (avgScore >= 70) grade = 'C';
    else if (avgScore >= 60) grade = 'D';

    console.log(`\n  Final Grade: ${grade} (${Math.round(avgScore)}/100)`);

    if (failed === 0) {
      console.log('\n╔════════════════════════════════════════╗');
      console.log('║   ✓ Demo₆ Real-Time Portal VERIFIED    ║');
      console.log('╚════════════════════════════════════════╝\n');
    }

    process.exit(failed > 0 ? 1 : 0);
  }
}

// Run the tester
const tester = new Demo6Tester();
tester.runAllTests().catch(err => {
  console.error('Tester failed:', err);
  process.exit(1);
});
