#!/bin/bash
#
# Eklavya Dev Server Runner
# Starts the web frontend dev server
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
WEB_DIR="$PROJECT_ROOT/web"
LOG_DIR="$PROJECT_ROOT/logs"
LOG_FILE="$LOG_DIR/dev-server.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Create logs directory
mkdir -p "$LOG_DIR"

log "${YELLOW}Starting Eklavya Dev Server...${NC}"

# Kill any existing process on port 3000
if lsof -i :3000 > /dev/null 2>&1; then
    log "${YELLOW}Killing existing process on port 3000...${NC}"
    kill $(lsof -t -i :3000) 2>/dev/null || true
    sleep 2
fi

# Check if web directory exists
if [ ! -d "$WEB_DIR" ]; then
    log "${RED}Error: web directory not found at $WEB_DIR${NC}"
    exit 1
fi

# Check if node_modules exists
if [ ! -d "$WEB_DIR/node_modules" ]; then
    log "${YELLOW}Installing dependencies...${NC}"
    cd "$WEB_DIR" && npm install
fi

# Start the dev server
log "${GREEN}Starting Next.js dev server...${NC}"
cd "$WEB_DIR"

# Run in foreground so terminal shows output
npm run dev 2>&1 | tee "$LOG_FILE"
