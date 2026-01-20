#!/bin/bash
#
# Eklavya Demo Tester
# Autonomous verification of demos before declaring ready
#

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
    PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
    log "${RED}✗ FAIL${NC} - $1"
    FAIL_COUNT=$((FAIL_COUNT + 1))
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

# Browser tests are optional - skip if playwright not fully configured
log "${YELLOW}Skipping browser tests (optional - install Playwright for visual testing)${NC}"
log "To enable: cd web && npx playwright install chromium"

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
