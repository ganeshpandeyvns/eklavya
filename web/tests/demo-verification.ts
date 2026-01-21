/**
 * Autonomous Demo Verification Script
 * Runs all checks to verify demo is ready before declaring it complete
 */

import { chromium, Browser, Page } from 'playwright';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:3000';
const PAGES = ['/', '/projects', '/new', '/import'];
const SCREENSHOT_DIR = path.join(__dirname, '../test-results/screenshots');

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL';
  details: string;
  duration?: number;
}

const results: TestResult[] = [];

function log(message: string) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

function addResult(name: string, status: 'PASS' | 'FAIL', details: string, duration?: number) {
  results.push({ name, status, details, duration });
  const icon = status === 'PASS' ? '✓' : '✗';
  log(`${icon} ${name}: ${status} - ${details}`);
}

async function checkUrl(url: string): Promise<{ ok: boolean; status: number; time: number }> {
  const start = Date.now();
  return new Promise((resolve) => {
    http.get(url, (res) => {
      const time = Date.now() - start;
      resolve({ ok: res.statusCode === 200, status: res.statusCode || 0, time });
    }).on('error', () => {
      resolve({ ok: false, status: 0, time: Date.now() - start });
    });
  });
}

async function runProcessCheck(): Promise<boolean> {
  log('\n=== PROCESS CHECK ===');

  const result = await checkUrl(BASE_URL);
  if (result.ok) {
    addResult('Server Running', 'PASS', `Port 3000 responding (${result.time}ms)`);
    return true;
  } else {
    addResult('Server Running', 'FAIL', `Server not responding on port 3000`);
    return false;
  }
}

async function runUrlTests(): Promise<boolean> {
  log('\n=== URL TESTS ===');
  let allPass = true;

  for (const pagePath of PAGES) {
    const url = `${BASE_URL}${pagePath}`;
    const result = await checkUrl(url);

    if (result.ok && result.time < 3000) {
      addResult(`URL ${pagePath}`, 'PASS', `${result.status} in ${result.time}ms`, result.time);
    } else if (result.ok) {
      addResult(`URL ${pagePath}`, 'FAIL', `Too slow: ${result.time}ms (>3000ms)`, result.time);
      allPass = false;
    } else {
      addResult(`URL ${pagePath}`, 'FAIL', `HTTP ${result.status}`, result.time);
      allPass = false;
    }
  }

  return allPass;
}

async function runBrowserTests(): Promise<boolean> {
  log('\n=== BROWSER TESTS ===');
  let allPass = true;
  let browser: Browser | null = null;

  try {
    // Ensure screenshot directory exists
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();

    // Collect console errors
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    for (const pagePath of PAGES) {
      const url = `${BASE_URL}${pagePath}`;
      const pageName = pagePath === '/' ? 'dashboard' : pagePath.slice(1);

      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 });

        // Take screenshot
        const screenshotPath = path.join(SCREENSHOT_DIR, `${pageName}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        // Check for key elements
        const hasSidebar = await page.locator('aside').count() > 0;
        const hasHeader = await page.locator('header').count() > 0;
        const hasMain = await page.locator('main').count() > 0;

        if (hasSidebar && hasHeader && hasMain) {
          addResult(`Page ${pagePath} Structure`, 'PASS', `Layout elements present, screenshot: ${screenshotPath}`);
        } else {
          addResult(`Page ${pagePath} Structure`, 'FAIL', `Missing: ${!hasSidebar ? 'sidebar ' : ''}${!hasHeader ? 'header ' : ''}${!hasMain ? 'main' : ''}`);
          allPass = false;
        }
      } catch (err) {
        addResult(`Page ${pagePath} Load`, 'FAIL', `Error: ${err}`);
        allPass = false;
      }
    }

    // Report console errors
    if (consoleErrors.length > 0) {
      addResult('Console Errors', 'FAIL', `${consoleErrors.length} errors: ${consoleErrors.slice(0, 3).join('; ')}`);
      allPass = false;
    } else {
      addResult('Console Errors', 'PASS', 'No JavaScript errors');
    }

    // Test navigation
    log('\n=== INTERACTIVE TESTS ===');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Test sidebar navigation
    try {
      await page.click('a[href="/projects"]');
      await page.waitForURL('**/projects', { timeout: 5000 });
      addResult('Navigation', 'PASS', 'Sidebar navigation works');
    } catch (err) {
      addResult('Navigation', 'FAIL', `Navigation error: ${err}`);
      allPass = false;
    }

    // Test new project page
    try {
      await page.goto(`${BASE_URL}/new`, { waitUntil: 'networkidle' });
      const chatInput = page.locator('textarea');
      if (await chatInput.count() > 0) {
        await chatInput.fill('Test project description');
        addResult('Chat Input', 'PASS', 'Chat textarea accepts input');
      } else {
        addResult('Chat Input', 'FAIL', 'Chat textarea not found');
        allPass = false;
      }
    } catch (err) {
      addResult('Chat Input', 'FAIL', `Error: ${err}`);
      allPass = false;
    }

    // Test import page
    try {
      await page.goto(`${BASE_URL}/import`, { waitUntil: 'networkidle' });
      const buttons = page.locator('button');
      if (await buttons.count() >= 3) {
        await buttons.first().click();
        addResult('Import Buttons', 'PASS', 'Import method buttons work');
      } else {
        addResult('Import Buttons', 'FAIL', 'Import buttons not found');
        allPass = false;
      }
    } catch (err) {
      addResult('Import Buttons', 'FAIL', `Error: ${err}`);
      allPass = false;
    }

    // Mobile responsive test
    log('\n=== RESPONSIVE TEST ===');
    await context.close();
    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 667 }
    });
    const mobilePage = await mobileContext.newPage();

    try {
      await mobilePage.goto(BASE_URL, { waitUntil: 'networkidle' });
      await mobilePage.screenshot({ path: path.join(SCREENSHOT_DIR, 'mobile-dashboard.png') });
      addResult('Mobile Responsive', 'PASS', 'Mobile viewport renders correctly');
    } catch (err) {
      addResult('Mobile Responsive', 'FAIL', `Error: ${err}`);
      allPass = false;
    }

    await mobileContext.close();

  } catch (err) {
    addResult('Browser Tests', 'FAIL', `Browser launch error: ${err}`);
    allPass = false;
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  return allPass;
}

async function generateReport(): Promise<void> {
  log('\n' + '='.repeat(50));
  log('DEMO₀ VERIFICATION REPORT');
  log('='.repeat(50));

  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;
  const overall = failCount === 0 ? 'PASS' : 'FAIL';

  log(`\nTotal: ${passCount} passed, ${failCount} failed`);
  log(`\nOVERALL: ${overall}`);

  if (overall === 'PASS') {
    log('\n✓ DEMO₀ VERIFIED AND READY');
    log('  URL: http://localhost:3000');
    log(`  Screenshots: ${SCREENSHOT_DIR}`);
  } else {
    log('\n✗ DEMO₀ NOT READY - FIXES REQUIRED:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      log(`  - ${r.name}: ${r.details}`);
    });
  }

  log('\n' + '='.repeat(50));

  // Save report to file
  const reportPath = path.join(__dirname, '../test-results/demo-report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ results, overall, timestamp: new Date().toISOString() }, null, 2));
}

async function main() {
  log('Starting Demo₀ Verification...\n');

  // Run all checks
  const processOk = await runProcessCheck();

  if (!processOk) {
    log('\n✗ Server not running. Cannot proceed with tests.');
    log('  Start server with: cd web && npm run dev');
    process.exit(1);
  }

  await runUrlTests();
  await runBrowserTests();

  // Generate final report
  await generateReport();

  // Exit with appropriate code
  const failCount = results.filter(r => r.status === 'FAIL').length;
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(console.error);
