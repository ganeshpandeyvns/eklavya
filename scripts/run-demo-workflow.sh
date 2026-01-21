#!/bin/bash
#
# Demo Workflow Runner
# ====================
# Runs the complete demo verification workflow:
# 1. Run demo tester (functional tests)
# 2. Run architect review (quality gates)
# 3. Generate summary report
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Get demo number from argument
DEMO_NUM=${1:-4}

echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║              EKLAVYA DEMO WORKFLOW                                ║${NC}"
echo -e "${CYAN}║                 Demo${DEMO_NUM} Complete Verification                     ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Change to project directory
cd "$(dirname "$0")/.."

# Step 1: Run Demo Tester
echo -e "${BOLD}STEP 1: Running Demo${DEMO_NUM} Functional Tests${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

TESTER_SCRIPT="src/scripts/run-demo${DEMO_NUM}-tester.ts"

if [ ! -f "$TESTER_SCRIPT" ]; then
    echo -e "${RED}Error: Demo${DEMO_NUM} tester not found: ${TESTER_SCRIPT}${NC}"
    exit 1
fi

echo "Running: npx tsx ${TESTER_SCRIPT}"
echo ""

if npx tsx "$TESTER_SCRIPT"; then
    echo -e "${GREEN}✓ Demo${DEMO_NUM} functional tests PASSED${NC}"
    TESTER_PASSED=true
else
    echo -e "${RED}✗ Demo${DEMO_NUM} functional tests FAILED${NC}"
    echo -e "${YELLOW}Fix test failures before running architect review.${NC}"
    exit 1
fi

echo ""

# Step 2: Run Architect Review
echo -e "${BOLD}STEP 2: Running Architect Review${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

echo "Running: npx tsx src/scripts/post-demo-review.ts ${DEMO_NUM}"
echo ""

if npx tsx src/scripts/post-demo-review.ts "$DEMO_NUM"; then
    echo -e "${GREEN}✓ Architect review PASSED${NC}"
    REVIEW_PASSED=true
else
    echo -e "${YELLOW}⚠ Architect review has recommendations${NC}"
    REVIEW_PASSED=false
fi

echo ""

# Step 3: Summary
echo -e "${BOLD}WORKFLOW SUMMARY${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [ "$TESTER_PASSED" = true ] && [ "$REVIEW_PASSED" = true ]; then
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║        ✓ DEMO${DEMO_NUM} COMPLETE - READY FOR NEXT STAGE               ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    NEXT_DEMO=$((DEMO_NUM + 1))
    if [ $NEXT_DEMO -le 8 ]; then
        echo -e "Next: ${CYAN}Demo${NEXT_DEMO}${NC}"
        echo -e "Run: ${CYAN}./scripts/run-demo-workflow.sh ${NEXT_DEMO}${NC}"
    else
        echo -e "${GREEN}All demos complete! Ready for Full Build.${NC}"
    fi
elif [ "$TESTER_PASSED" = true ]; then
    echo -e "${YELLOW}╔═══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║        ⚠ DEMO${DEMO_NUM} FUNCTIONAL - REVIEW HAS RECOMMENDATIONS       ║${NC}"
    echo -e "${YELLOW}╚═══════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "Tests passed but architect review found areas for improvement."
    echo -e "You may proceed to next demo or address recommendations first."
else
    echo -e "${RED}╔═══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║        ✗ DEMO${DEMO_NUM} FAILED - FIX ISSUES BEFORE CONTINUING          ║${NC}"
    echo -e "${RED}╚═══════════════════════════════════════════════════════════════════╝${NC}"
    exit 1
fi

echo ""
