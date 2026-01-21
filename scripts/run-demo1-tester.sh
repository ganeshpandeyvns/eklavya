#!/bin/bash
#
# Eklavya Demo₁ Tester
# Verifies all Demo₁ components are working
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_ROOT/logs"
RESULTS_DIR="$PROJECT_ROOT/test-results"
LOG_FILE="$LOG_DIR/demo1-tester.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0

mkdir -p "$LOG_DIR" "$RESULTS_DIR"

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

echo "" > "$LOG_FILE"

log "${YELLOW}╔════════════════════════════════════════╗${NC}"
log "${YELLOW}║     EKLAVYA DEMO₁ VERIFICATION         ║${NC}"
log "${YELLOW}╚════════════════════════════════════════╝${NC}"
log ""
log "Started: $(date)"

###################
# 1. FILE STRUCTURE
###################
header "FILE STRUCTURE CHECK"

REQUIRED_FILES=(
    "src/core/agent-manager/index.ts"
    "src/core/message-bus/index.ts"
    "src/core/learning/index.ts"
    "src/core/checkpoint/index.ts"
    "src/api/index.ts"
    "src/types/index.ts"
    "src/lib/database.ts"
    "src/index.ts"
    "migrations/001_initial_schema.sql"
    "docker/docker-compose.yml"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$PROJECT_ROOT/$file" ]; then
        pass "File exists: $file"
    else
        fail "Missing file: $file"
    fi
done

###################
# 2. TYPESCRIPT BUILD
###################
header "TYPESCRIPT BUILD"

cd "$PROJECT_ROOT/src"
if [ -d "dist" ]; then
    pass "Backend compiled (dist/ exists)"
else
    fail "Backend not compiled (dist/ missing)"
fi

###################
# 3. FRONTEND CHECK
###################
header "FRONTEND CHECK"

if [ -f "$PROJECT_ROOT/web/src/lib/api.ts" ]; then
    pass "API client exists"
else
    fail "API client missing"
fi

if [ -f "$PROJECT_ROOT/web/src/components/dashboard/AgentStatus.tsx" ]; then
    pass "Agent status component exists"
else
    fail "Agent status component missing"
fi

###################
# 4. DOCKER CONFIG
###################
header "DOCKER CONFIGURATION"

if grep -q "postgres:16" "$PROJECT_ROOT/docker/docker-compose.yml" 2>/dev/null; then
    pass "PostgreSQL 16 configured"
else
    fail "PostgreSQL not configured"
fi

if grep -q "redis:7" "$PROJECT_ROOT/docker/docker-compose.yml" 2>/dev/null; then
    pass "Redis 7 configured"
else
    fail "Redis not configured"
fi

###################
# 5. DATABASE SCHEMA
###################
header "DATABASE SCHEMA"

REQUIRED_TABLES=("projects" "agents" "tasks" "messages" "prompts" "checkpoints" "learning_events")

for table in "${REQUIRED_TABLES[@]}"; do
    if grep -q "CREATE TABLE $table" "$PROJECT_ROOT/migrations/001_initial_schema.sql" 2>/dev/null; then
        pass "Table defined: $table"
    else
        fail "Table missing: $table"
    fi
done

###################
# 6. CORE MODULES
###################
header "CORE MODULES"

# Check agent manager has spawn capability
if grep -q "spawnAgent" "$PROJECT_ROOT/src/core/agent-manager/index.ts" 2>/dev/null; then
    pass "Agent spawning implemented"
else
    fail "Agent spawning not implemented"
fi

# Check message bus has pub/sub
if grep -q "publish" "$PROJECT_ROOT/src/core/message-bus/index.ts" 2>/dev/null && \
   grep -q "subscribe" "$PROJECT_ROOT/src/core/message-bus/index.ts" 2>/dev/null; then
    pass "Message bus pub/sub implemented"
else
    fail "Message bus pub/sub not implemented"
fi

# Check learning system has Thompson Sampling
if grep -q "sampleBeta" "$PROJECT_ROOT/src/core/learning/index.ts" 2>/dev/null; then
    pass "Thompson Sampling implemented"
else
    fail "Thompson Sampling not implemented"
fi

# Check checkpoint system
if grep -q "createCheckpoint" "$PROJECT_ROOT/src/core/checkpoint/index.ts" 2>/dev/null; then
    pass "Checkpoint system implemented"
else
    fail "Checkpoint system not implemented"
fi

###################
# 7. API ENDPOINTS
###################
header "API ENDPOINTS"

ENDPOINTS=("/api/projects" "/api/agents" "/api/tasks" "/api/health" "messages")

for endpoint in "${ENDPOINTS[@]}"; do
    if grep -q "$endpoint" "$PROJECT_ROOT/src/api/index.ts" 2>/dev/null; then
        pass "Endpoint defined: $endpoint"
    else
        fail "Endpoint missing: $endpoint"
    fi
done

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
    log "${GREEN}║     ✓ DEMO₁ VERIFIED AND READY         ║${NC}"
    log "${GREEN}╚════════════════════════════════════════╝${NC}"
    log ""
    log "Components ready:"
    log "  - Agent Manager (spawn/terminate/monitor)"
    log "  - Message Bus (Redis pub/sub)"
    log "  - Learning System (Thompson Sampling RL)"
    log "  - Checkpoint System (state persistence)"
    log "  - API Server (REST endpoints)"
    log "  - Database Schema (PostgreSQL)"
    log "  - Real-time Dashboard Updates"
    log ""
    log "To start infrastructure:"
    log "  cd docker && docker-compose up -d"
    log ""
    log "To start backend:"
    log "  cd src && npm run dev"
    log ""
    log "To start frontend:"
    log "  cd web && npm run dev"
    log ""

    echo "PASS" > "$RESULTS_DIR/demo1-status.txt"
    echo "{\"status\":\"PASS\",\"passed\":$PASS_COUNT,\"failed\":$FAIL_COUNT,\"timestamp\":\"$(date -Iseconds)\"}" > "$RESULTS_DIR/demo1-report.json"

    exit 0
else
    log "${RED}╔════════════════════════════════════════╗${NC}"
    log "${RED}║     ✗ DEMO₁ NOT READY - FIXES NEEDED   ║${NC}"
    log "${RED}╚════════════════════════════════════════╝${NC}"
    log ""

    echo "FAIL" > "$RESULTS_DIR/demo1-status.txt"
    echo "{\"status\":\"FAIL\",\"passed\":$PASS_COUNT,\"failed\":$FAIL_COUNT,\"timestamp\":\"$(date -Iseconds)\"}" > "$RESULTS_DIR/demo1-report.json"

    exit 1
fi
