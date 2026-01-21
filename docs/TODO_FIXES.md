# Eklavya - Items to Fix

**Current Completion: 79%**
**Target: 90%+ for Production**

---

## Critical (Must Fix)

### 1. JWT Secret Validation
- **File**: `src/middleware/auth.ts` line 34-35
- **Issue**: Empty secret allowed if env var not set
- **Fix**: Add startup validation for non-empty JWT_SECRET
- **Time**: 15 min

### 2. Package.json Dependencies
- **File**: `package.json`
- **Issue**: Some runtime dependencies missing from package.json
- **Fix**: Run `npm ls` and add all required packages
- **Time**: 1 hour

### 3. Database Connection Config
- **File**: `src/lib/database.ts`
- **Issue**: Hardcoded localhost, no production config
- **Fix**: Proper env var handling for remote DB connections
- **Time**: 30 min

---

## High Priority

### 4. Workflow Auto-Trigger
- **File**: `src/core/workflow/auto-trigger.ts`
- **Issue**: `onProjectCreatedHook()` exported but never called
- **Fix**: Hook into project creation endpoint in `src/api/index.ts`
- **Time**: 30 min

### 5. Login Rate Limiting
- **File**: `src/api/auth.ts`
- **Issue**: Auth endpoints not rate-limited
- **Fix**: Apply rate limiter to login/refresh endpoints
- **Time**: 20 min

### 6. Resource Tracking
- **File**: `src/core/agent-manager/lifecycle.ts`
- **Issue**: `recordAgentResources()` never populates actual metrics
- **Fix**: Add memory/CPU collection in agent heartbeat
- **Time**: 2-3 hours

---

## Medium Priority

### 7. Monitor Agent Health Checks
- **File**: `src/core/monitor-agent/index.ts`
- **Issue**: Framework defined but actual metrics not collected
- **Fix**: Implement real health check queries
- **Time**: 3-4 hours

### 8. Mentor Agent Knowledge Base
- **File**: `src/core/mentor-agent/index.ts`
- **Issue**: Knowledge lookup returns placeholder data
- **Fix**: Implement actual knowledge search/recommendations
- **Time**: 4-5 hours

### 9. Frontend WebSocket Integration
- **File**: `web/src/lib/api.ts`
- **Issue**: WebSocket connection defined but not fully wired
- **Fix**: Connect real-time updates to dashboard components
- **Time**: 4-6 hours

### 10. Test Runner Setup
- **File**: `package.json`
- **Issue**: `npm test` exits with error
- **Fix**: Configure vitest to run all test files
- **Time**: 4-5 hours

---

## Low Priority (Post-Launch)

- [ ] Add health check endpoint for load balancers
- [ ] Add Prometheus metrics export
- [ ] Structured JSON logging
- [ ] Kubernetes manifests
- [ ] Database backup scripts
- [ ] CSRF token support
- [ ] Docker project isolation

---

## Quick Reference

| Priority | Items | Total Time |
|----------|-------|------------|
| Critical | 3 | ~2 hours |
| High | 3 | ~3 hours |
| Medium | 4 | ~16 hours |
| **Total** | **10** | **~21 hours** |

---

## Commands to Verify Fixes

```bash
# Build check
npm run build

# Run demo tests
DB_PASSWORD=eklavya_dev_pwd npx tsx src/scripts/run-demo6-tester.ts
DB_PASSWORD=eklavya_dev_pwd npx tsx src/scripts/run-demo7-tester.ts
DB_PASSWORD=eklavya_dev_pwd npx tsx src/scripts/run-demo8-tester.ts

# Start API server (for demo2-5 tests)
npm run dev

# Check JWT secret is set
echo $JWT_SECRET
```

---

*Generated: 2026-01-21*
*Review by: Architect Agent*
