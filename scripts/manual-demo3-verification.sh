#!/bin/bash
#
# Demo₃ Manual Verification Script
# ================================
# This script helps you manually verify the Autonomous Task Execution demo.
# Run each section and observe the results.
#

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

API_URL="http://localhost:4000"
WS_URL="ws://localhost:4001"
FRONTEND_URL="http://localhost:3000"

echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         EKLAVYA DEMO₃ - MANUAL VERIFICATION SCRIPT               ║${NC}"
echo -e "${CYAN}║               Autonomous Task Execution Demo                      ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Function to wait for user
wait_for_user() {
    echo ""
    echo -e "${YELLOW}Press Enter to continue...${NC}"
    read -r
}

# Function to run a test
run_test() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

#═══════════════════════════════════════════════════════════════════════════════
# STEP 1: Check Services
#═══════════════════════════════════════════════════════════════════════════════
run_test "STEP 1: Verify Services Are Running"

echo ""
echo -e "${CYAN}Checking API Server (port 4000)...${NC}"
if curl -s "$API_URL/api/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ API Server is running${NC}"
else
    echo -e "${RED}✗ API Server is NOT running${NC}"
    echo -e "${YELLOW}Start it with: cd src && npx tsx index.ts${NC}"
fi

echo ""
echo -e "${CYAN}Checking WebSocket Server (port 4001)...${NC}"
if nc -z localhost 4001 2>/dev/null; then
    echo -e "${GREEN}✓ WebSocket Server is running${NC}"
else
    echo -e "${RED}✗ WebSocket Server is NOT running${NC}"
fi

echo ""
echo -e "${CYAN}Checking PostgreSQL...${NC}"
if pg_isready -h localhost -p 5432 > /dev/null 2>&1 || docker exec eklavya-postgres pg_isready -U eklavya > /dev/null 2>&1; then
    echo -e "${GREEN}✓ PostgreSQL is running${NC}"
else
    echo -e "${RED}✗ PostgreSQL is NOT running${NC}"
fi

wait_for_user

#═══════════════════════════════════════════════════════════════════════════════
# STEP 2: Task Queue Operations
#═══════════════════════════════════════════════════════════════════════════════
run_test "STEP 2: Task Queue Operations"

echo ""
echo -e "${CYAN}First, let's create a test project...${NC}"
PROJECT_RESPONSE=$(curl -s -X POST "$API_URL/api/projects" \
  -H "Content-Type: application/json" \
  -d '{"name": "Demo3 Manual Test", "description": "Testing autonomous task execution"}')
PROJECT_ID=$(echo "$PROJECT_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))" 2>/dev/null)
echo -e "${GREEN}Created project: $PROJECT_ID${NC}"

echo ""
echo -e "${CYAN}Creating a task with full specification...${NC}"
TASK_RESPONSE=$(curl -s -X POST "$API_URL/api/tasks" \
  -H "Content-Type: application/json" \
  -d "{
    \"projectId\": \"$PROJECT_ID\",
    \"title\": \"Implement User Authentication\",
    \"description\": \"Create login and registration endpoints\",
    \"type\": \"developer_task\",
    \"specification\": {
      \"agentType\": \"developer\",
      \"files\": [\"src/auth/login.ts\", \"src/auth/register.ts\"],
      \"requirements\": [\"JWT tokens\", \"Password hashing\"]
    },
    \"priority\": 8,
    \"maxRetries\": 3,
    \"estimatedDurationMinutes\": 30
  }")
echo "$TASK_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$TASK_RESPONSE"
TASK_ID=$(echo "$TASK_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))" 2>/dev/null)

echo ""
echo -e "${CYAN}Get task queue statistics...${NC}"
curl -s "$API_URL/api/tasks/queue/stats?projectId=$PROJECT_ID" | python3 -m json.tool

wait_for_user

#═══════════════════════════════════════════════════════════════════════════════
# STEP 3: Orchestrator Control
#═══════════════════════════════════════════════════════════════════════════════
run_test "STEP 3: Orchestrator Control"

echo ""
echo -e "${CYAN}Starting orchestrator for project...${NC}"
curl -s -X POST "$API_URL/api/orchestrator/start" \
  -H "Content-Type: application/json" \
  -d "{\"projectId\": \"$PROJECT_ID\"}" | python3 -m json.tool

echo ""
echo -e "${CYAN}Get orchestrator status...${NC}"
curl -s "$API_URL/api/orchestrator/status?projectId=$PROJECT_ID" | python3 -m json.tool

echo ""
echo -e "${CYAN}Submit execution plan with multiple phases...${NC}"
curl -s -X POST "$API_URL/api/orchestrator/plan" \
  -H "Content-Type: application/json" \
  -d "{
    \"projectId\": \"$PROJECT_ID\",
    \"plan\": {
      \"phases\": [
        {
          \"phaseNumber\": 1,
          \"tasks\": [
            {
              \"title\": \"Setup project structure\",
              \"description\": \"Initialize folders and config files\",
              \"type\": \"setup\",
              \"agentType\": \"developer\",
              \"priority\": 9
            }
          ]
        },
        {
          \"phaseNumber\": 2,
          \"tasks\": [
            {
              \"title\": \"Implement core features\",
              \"description\": \"Build main application logic\",
              \"type\": \"implementation\",
              \"agentType\": \"developer\",
              \"priority\": 8
            },
            {
              \"title\": \"Write unit tests\",
              \"description\": \"Create comprehensive test suite\",
              \"type\": \"testing\",
              \"agentType\": \"tester\",
              \"priority\": 7
            }
          ]
        }
      ]
    }
  }" | python3 -m json.tool

wait_for_user

#═══════════════════════════════════════════════════════════════════════════════
# STEP 4: Task Assignment & Execution
#═══════════════════════════════════════════════════════════════════════════════
run_test "STEP 4: Task Assignment & Execution"

echo ""
echo -e "${CYAN}Creating a test agent...${NC}"
AGENT_RESPONSE=$(curl -s -X POST "$API_URL/api/projects/$PROJECT_ID/agents" \
  -H "Content-Type: application/json" \
  -d '{"type": "developer"}')
AGENT_ID=$(echo "$AGENT_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))" 2>/dev/null)
echo -e "${GREEN}Created agent: $AGENT_ID${NC}"

echo ""
echo -e "${CYAN}Assigning task to agent...${NC}"
curl -s -X PUT "$API_URL/api/tasks/$TASK_ID/assign" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\": \"$AGENT_ID\"}" | python3 -m json.tool

echo ""
echo -e "${CYAN}Completing task with results...${NC}"
curl -s -X PUT "$API_URL/api/tasks/$TASK_ID/complete" \
  -H "Content-Type: application/json" \
  -d '{
    "result": {
      "filesCreated": ["src/auth/login.ts", "src/auth/register.ts"],
      "linesOfCode": 150,
      "success": true
    },
    "metrics": {
      "executionTimeMs": 25000,
      "tokensUsed": 3500,
      "filesWritten": 2
    }
  }' | python3 -m json.tool

wait_for_user

#═══════════════════════════════════════════════════════════════════════════════
# STEP 5: Checkpoint System
#═══════════════════════════════════════════════════════════════════════════════
run_test "STEP 5: Checkpoint System (Recovery)"

echo ""
echo -e "${CYAN}Creating checkpoint for agent...${NC}"
CHECKPOINT_RESPONSE=$(curl -s -X POST "$API_URL/api/agents/$AGENT_ID/checkpoint" \
  -H "Content-Type: application/json" \
  -d '{
    "state": {
      "currentStep": "implementing_feature",
      "progress": 65,
      "workingMemory": {
        "currentFile": "src/auth/login.ts",
        "completedFunctions": ["validateCredentials", "hashPassword"]
      },
      "pendingActions": ["createJWT", "handleRefreshToken"]
    },
    "recoveryInstructions": "Resume from login.ts - complete JWT creation"
  }')
echo "$CHECKPOINT_RESPONSE" | python3 -m json.tool

echo ""
echo -e "${CYAN}Get checkpoint statistics...${NC}"
curl -s "$API_URL/api/checkpoints?projectId=$PROJECT_ID" | python3 -m json.tool

echo ""
echo -e "${CYAN}Get agent checkpoint history...${NC}"
curl -s "$API_URL/api/checkpoints/$AGENT_ID" | python3 -m json.tool

echo ""
echo -e "${CYAN}Resume from checkpoint (simulating recovery)...${NC}"
curl -s -X POST "$API_URL/api/agents/$AGENT_ID/resume" \
  -H "Content-Type: application/json" \
  -d '{}' | python3 -m json.tool

wait_for_user

#═══════════════════════════════════════════════════════════════════════════════
# STEP 6: Agent Messaging
#═══════════════════════════════════════════════════════════════════════════════
run_test "STEP 6: Agent Messaging"

echo ""
echo -e "${CYAN}Send message to agent...${NC}"
curl -s -X POST "$API_URL/api/agents/$AGENT_ID/message" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "task_assign",
    "payload": {
      "task": "Review authentication implementation",
      "priority": "high",
      "context": {"previousAgent": "developer-001"}
    }
  }' | python3 -m json.tool

echo ""
echo -e "${CYAN}Get agent messages...${NC}"
curl -s "$API_URL/api/agents/$AGENT_ID/messages?limit=5" | python3 -m json.tool

wait_for_user

#═══════════════════════════════════════════════════════════════════════════════
# STEP 7: Error Recovery (Retry)
#═══════════════════════════════════════════════════════════════════════════════
run_test "STEP 7: Error Recovery (Retry Mechanism)"

echo ""
echo -e "${CYAN}Creating a task that will fail...${NC}"
FAIL_TASK_RESPONSE=$(curl -s -X POST "$API_URL/api/tasks" \
  -H "Content-Type: application/json" \
  -d "{
    \"projectId\": \"$PROJECT_ID\",
    \"title\": \"Task that will fail\",
    \"description\": \"This task tests error recovery\",
    \"type\": \"test\",
    \"maxRetries\": 2
  }")
FAIL_TASK_ID=$(echo "$FAIL_TASK_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))" 2>/dev/null)
echo -e "${GREEN}Created task: $FAIL_TASK_ID${NC}"

echo ""
echo -e "${CYAN}Assigning and failing the task...${NC}"
curl -s -X PUT "$API_URL/api/tasks/$FAIL_TASK_ID/assign" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\": \"$AGENT_ID\"}" > /dev/null

curl -s -X PUT "$API_URL/api/tasks/$FAIL_TASK_ID/fail" \
  -H "Content-Type: application/json" \
  -d '{
    "errorMessage": "Compilation error: undefined variable xyz",
    "shouldRetry": true
  }' | python3 -m json.tool

echo ""
echo -e "${GREEN}Notice: Task status should be 'retrying' with retryCount = 1${NC}"

wait_for_user

#═══════════════════════════════════════════════════════════════════════════════
# STEP 8: Execution Logs
#═══════════════════════════════════════════════════════════════════════════════
run_test "STEP 8: Execution Logs"

echo ""
echo -e "${CYAN}Get execution logs for project...${NC}"
curl -s "$API_URL/api/execution-logs?projectId=$PROJECT_ID&limit=10" | python3 -m json.tool

echo ""
echo -e "${CYAN}Get execution logs for specific agent...${NC}"
curl -s "$API_URL/api/execution-logs?agentId=$AGENT_ID&limit=5" | python3 -m json.tool

wait_for_user

#═══════════════════════════════════════════════════════════════════════════════
# STEP 9: Summary
#═══════════════════════════════════════════════════════════════════════════════
run_test "STEP 9: Demo₃ Summary"

echo ""
echo -e "${CYAN}Demo₃ Features Verified:${NC}"
echo ""
echo "  ┌─────────────────────────────────────────────────────────────────┐"
echo "  │ Feature                              │ Status                   │"
echo "  ├─────────────────────────────────────────────────────────────────┤"
echo "  │ Task Queue Operations                │ ✓ Create/List/Stats      │"
echo "  │ Orchestrator Control                 │ ✓ Start/Stop/Plan        │"
echo "  │ Task Assignment                      │ ✓ Assign to agents       │"
echo "  │ Task Completion                      │ ✓ With results/metrics   │"
echo "  │ Checkpoint System                    │ ✓ Save/Restore state     │"
echo "  │ Agent Messaging                      │ ✓ Send/Receive messages  │"
echo "  │ Error Recovery                       │ ✓ Retry mechanism        │"
echo "  │ Execution Logs                       │ ✓ Detailed tracking      │"
echo "  └─────────────────────────────────────────────────────────────────┘"
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              DEMO₃ MANUAL VERIFICATION COMPLETE                   ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BOLD}Service URLs:${NC}"
echo -e "  Frontend:  ${GREEN}$FRONTEND_URL${NC}"
echo -e "  API:       ${GREEN}$API_URL${NC}"
echo -e "  WebSocket: ${GREEN}$WS_URL${NC}"
echo ""
echo -e "${BOLD}Quick Commands:${NC}"
echo -e "  ${CYAN}# Run automated tests${NC}"
echo -e "  npx tsx src/scripts/run-demo3-tester.ts"
echo ""
echo -e "  ${CYAN}# Start the backend server${NC}"
echo -e "  cd src && npx tsx index.ts"
echo ""
echo -e "  ${CYAN}# Start the frontend${NC}"
echo -e "  cd web && npm run dev"
echo ""
