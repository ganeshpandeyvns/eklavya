/**
 * Security Middleware Exports
 *
 * Central export point for all security-related middleware.
 */

// Authentication
export {
  authenticate,
  optionalAuthenticate,
  requireRole,
  generateToken,
  verifyToken,
  generateTokenPair,
  refreshAccessToken,
  revokeToken,
  type JwtPayload,
  type TokenPair,
  type AuthenticatedRequest
} from './auth.js';

// Authorization
export {
  authorizeProject,
  authorizeAgent,
  authorizeTask,
  authorizeDemo,
  requireAdmin,
  verifyProjectOwnership,
  verifyAgentAccess,
  verifyTaskAccess,
  verifyDemoAccess,
  hasPermission,
  clearOwnershipCache,
  type ResourcePermission
} from './authorization.js';

// Rate Limiting
export {
  rateLimit,
  checkRateLimit,
  createRateLimiter,
  rateLimiters,
  getRateLimiterForMethod,
  isHeavyEndpoint,
  isAuthEndpoint,
  clearRateLimitStore,
  RATE_LIMIT_CONFIGS,
  type RateLimitConfig
} from './rateLimit.js';

// Security Headers and CORS
export {
  securityHeaders,
  applySecurityHeaders,
  createSecurityMiddleware,
  cors,
  applyCorsHeaders,
  checkBodySize,
  parseBodyWithLimit,
  defaultSecurityConfig,
  defaultCorsConfig,
  type SecurityHeadersConfig,
  type CorsConfig,
  type BodyLimitConfig
} from './security.js';
