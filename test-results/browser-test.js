const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || './test-results/screenshots';

async function runTests() {
    const results = [];
    const browser = await chromium.launch({ headless: true });

    try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();

        const pages = ['/', '/projects', '/new', '/import'];

        for (const pagePath of pages) {
            try {
                await page.goto(`${BASE_URL}${pagePath}`, { waitUntil: 'networkidle', timeout: 10000 });
                const name = pagePath === '/' ? 'dashboard' : pagePath.slice(1);
                await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true });
                results.push({ page: pagePath, status: 'PASS', message: 'Page loaded and screenshot captured' });
            } catch (err) {
                results.push({ page: pagePath, status: 'FAIL', message: err.message });
            }
        }

        // Mobile test
        await context.close();
        const mobileContext = await browser.newContext({ viewport: { width: 375, height: 667 } });
        const mobilePage = await mobileContext.newPage();

        try {
            await mobilePage.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 10000 });
            await mobilePage.screenshot({ path: path.join(SCREENSHOT_DIR, 'mobile.png') });
            results.push({ page: 'mobile', status: 'PASS', message: 'Mobile viewport works' });
        } catch (err) {
            results.push({ page: 'mobile', status: 'FAIL', message: err.message });
        }

    } finally {
        await browser.close();
    }

    return results;
}

runTests()
    .then(results => {
        console.log(JSON.stringify(results));
        process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0);
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
