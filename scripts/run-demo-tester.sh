#!/bin/bash
#
# Eklavya Demo Tester
# Autonomous verification of demos before declaring ready
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
WEB_DIR="$PROJECT_ROOT/web"
LOG_DIR="$PROJECT_ROOT/logs"
RESULTS_DIR="$PROJECT_ROOT/test-results"
LOG_FILE="$LOG_DIR/demo-tester.log"

BASE_URL="${1:-http://localhost:3000}"
PAGES=("/" "/projects" "/new" "/import")

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0

# Create directories
mkdir -p "$LOG_DIR" "$RESULTS_DIR/screenshots"

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo -e "$msg"
    echo "$msg" >> "$LOG_FILE"
}

pass() {
    log "${GREEN}✓ PASS${NC} - $1"
    ((PASS_COUNT++))
}

fail() {
    log "${RED}✗ FAIL${NC} - $1"
    ((FAIL_COUNT++))
}

header() {
    log ""
    log "${BLUE}=== $1 ===${NC}"
}

# Clear previous log
echo "" > "$LOG_FILE"

log "${YELLOW}╔════════════════════════════════════════╗${NC}"
log "${YELLOW}║     EKLAVYA DEMO VERIFICATION          ║${NC}"
log "${YELLOW}╚════════════════════════════════════════╝${NC}"
log ""
log "Target: $BASE_URL"
log "Started: $(date)"

###################
# 1. PROCESS CHECK
###################
header "PROCESS CHECK"

# Check if port 3000 is listening
if lsof -i :3000 > /dev/null 2>&1; then
    pass "Port 3000 is listening"
else
    fail "Port 3000 is not listening"
    log "${RED}Server not running. Start with: ./scripts/run-dev-server.sh${NC}"
    exit 1
fi

# Check if we can connect
if curl -s -o /dev/null -w "%{http_code}" "$BASE_URL" | grep -q "200"; then
    pass "Server responds to HTTP requests"
else
    fail "Server not responding to HTTP requests"
    exit 1
fi

###################
# 2. URL TESTS
###################
header "URL ACCESSIBILITY"

for page in "${PAGES[@]}"; do
    url="$BASE_URL$page"

    start_time=$(date +%s%N)
    http_code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
    end_time=$(date +%s%N)

    # Calculate response time in ms
    response_time=$(( (end_time - start_time) / 1000000 ))

    if [ "$http_code" = "200" ]; then
        if [ $response_time -lt 3000 ]; then
            pass "$page → HTTP $http_code (${response_time}ms)"
        else
            fail "$page → Too slow: ${response_time}ms (>3000ms limit)"
        fi
    else
        fail "$page → HTTP $http_code"
    fi
done

###################
# 3. CONTENT CHECK
###################
header "CONTENT VERIFICATION"

# Check homepage has expected content
homepage_content=$(curl -s "$BASE_URL" 2>/dev/null)

if echo "$homepage_content" | grep -q "Eklavya"; then
    pass "Homepage contains 'Eklavya' branding"
else
    fail "Homepage missing 'Eklavya' branding"
fi

if echo "$homepage_content" | grep -q "Dashboard\|Projects\|New Project"; then
    pass "Homepage contains navigation elements"
else
    fail "Homepage missing navigation elements"
fi

# Check new project page has chat
new_page_content=$(curl -s "$BASE_URL/new" 2>/dev/null)

if echo "$new_page_content" | grep -q "textarea\|chat\|describe"; then
    pass "/new page has chat/input elements"
else
    fail "/new page missing chat/input elements"
fi

# Check import page has options
import_content=$(curl -s "$BASE_URL/import" 2>/dev/null)

if echo "$import_content" | grep -q "GitHub\|Upload\|Local"; then
    pass "/import page has import method options"
else
    fail "/import page missing import method options"
fi

###################
# 4. BROWSER TEST (if playwright available)
###################
header "BROWSER TESTS"

if command -v npx &> /dev/null && [ -d "$WEB_DIR/node_modules/playwright" ]; then
    log "Running Playwright browser tests..."

    # Create a simple playwright test
    cat > "$RESULTS_DIR/browser-test.js" << 'PLAYWRIGHT_TEST'
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
PLAYWRIGHT_TEST

    cd "$WEB_DIR"
    export BASE_URL SCREENSHOT_DIR="$RESULTS_DIR/screenshots"

    if browser_output=$(node "$RESULTS_DIR/browser-test.js" 2>&1); then
        pass "Browser tests completed"

        # Parse results
        echo "$browser_output" | node -e "
            const results = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
            results.forEach(r => {
                const icon = r.status === 'PASS' ? '✓' : '✗';
                console.log(\`  \${icon} \${r.page}: \${r.message}\`);
            });
        " 2>/dev/null || true

        log "Screenshots saved to: $RESULTS_DIR/screenshots/"
    else
        fail "Browser tests failed: $browser_output"
    fi
else
    log "${YELLOW}Skipping browser tests (Playwright not installed)${NC}"
    log "Install with: cd web && npm install -D playwright && npx playwright install chromium"
fi

###################
# FINAL REPORT
###################
log ""
log "${YELLOW}════════════════════════════════════════${NC}"
log "${YELLOW}           TEST RESULTS SUMMARY         ${NC}"
log "${YELLOW}════════════════════════════════════════${NC}"
log ""
log "Passed: ${GREEN}$PASS_COUNT${NC}"
log "Failed: ${RED}$FAIL_COUNT${NC}"
log ""

if [ $FAIL_COUNT -eq 0 ]; then
    log "${GREEN}╔════════════════════════════════════════╗${NC}"
    log "${GREEN}║     ✓ DEMO₀ VERIFIED AND READY         ║${NC}"
    log "${GREEN}╚════════════════════════════════════════╝${NC}"
    log ""
    log "URL: ${BLUE}$BASE_URL${NC}"
    log "Screenshots: $RESULTS_DIR/screenshots/"
    log ""

    # Save success marker
    echo "PASS" > "$RESULTS_DIR/demo-status.txt"
    echo "{\"status\":\"PASS\",\"passed\":$PASS_COUNT,\"failed\":$FAIL_COUNT,\"url\":\"$BASE_URL\",\"timestamp\":\"$(date -Iseconds)\"}" > "$RESULTS_DIR/demo-report.json"

    exit 0
else
    log "${RED}╔════════════════════════════════════════╗${NC}"
    log "${RED}║     ✗ DEMO NOT READY - FIXES NEEDED    ║${NC}"
    log "${RED}╚════════════════════════════════════════╝${NC}"
    log ""

    # Save failure marker
    echo "FAIL" > "$RESULTS_DIR/demo-status.txt"
    echo "{\"status\":\"FAIL\",\"passed\":$PASS_COUNT,\"failed\":$FAIL_COUNT,\"timestamp\":\"$(date -Iseconds)\"}" > "$RESULTS_DIR/demo-report.json"

    exit 1
fi
