#!/bin/bash
#
# Eklavya Overnight Runner
# Runs autonomous agents overnight without supervision
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_ROOT/logs"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
LOG_FILE="$LOG_DIR/overnight_$TIMESTAMP.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

mkdir -p "$LOG_DIR"

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo -e "$msg"
    echo "$msg" >> "$LOG_FILE"
}

log "${YELLOW}╔════════════════════════════════════════════╗${NC}"
log "${YELLOW}║     EKLAVYA OVERNIGHT AUTONOMOUS RUN       ║${NC}"
log "${YELLOW}╚════════════════════════════════════════════╝${NC}"
log ""
log "Started: $(date)"
log "Log file: $LOG_FILE"
log ""

# Step 1: Start dev server in background
log "${BLUE}Step 1: Starting dev server...${NC}"
"$SCRIPT_DIR/run-dev-server.sh" &
SERVER_PID=$!
log "Server PID: $SERVER_PID"

# Wait for server to be ready
log "Waiting for server to start..."
for i in {1..30}; do
    if curl -s -o /dev/null http://localhost:3000 2>/dev/null; then
        log "${GREEN}Server is ready!${NC}"
        break
    fi
    sleep 1
done

# Step 2: Run demo tester
log ""
log "${BLUE}Step 2: Running demo verification...${NC}"
if "$SCRIPT_DIR/run-demo-tester.sh"; then
    log "${GREEN}Demo verification passed!${NC}"
else
    log "${RED}Demo verification failed!${NC}"
    log "Check logs for details"
fi

# Step 3: Report results
log ""
log "${BLUE}Step 3: Final Report${NC}"
log "════════════════════════════════════════════"

if [ -f "$PROJECT_ROOT/test-results/demo-status.txt" ]; then
    status=$(cat "$PROJECT_ROOT/test-results/demo-status.txt")
    if [ "$status" = "PASS" ]; then
        log "${GREEN}DEMO STATUS: READY${NC}"
        log "URL: http://localhost:3000"
    else
        log "${RED}DEMO STATUS: NOT READY${NC}"
    fi
fi

log ""
log "Server still running (PID: $SERVER_PID)"
log "To stop: kill $SERVER_PID"
log ""
log "Overnight run completed at $(date)"

# Keep server running
wait $SERVER_PID
