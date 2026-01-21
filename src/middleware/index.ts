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
  hasAnyPermission,
  hasAllPermissions,
  hasRoleLevel,
  authorizeEndpoint,
  getEndpointPermission,
  getAuthorizationAuditLog,
  clearAuthorizationAuditLog,
  clearOwnershipCache,
  invalidateProjectCache,
  ENDPOINT_PERMISSIONS,
  type ResourcePermission,
  type ResourceType,
  type ActionType,
  type UserRole,
  type EndpointPermission
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
  isSensitiveEndpoint,
  clearRateLimitStore,
  getRateLimitStatus,
  setRateLimitEntry,
  addBypassIP,
  removeBypassIP,
  isIPBypassed,
  smartRateLimit,
  getEndpointRateLimitConfig,
  RATE_LIMIT_CONFIGS,
  ENDPOINT_RATE_LIMITS,
  type RateLimitConfig
} from './rateLimit.js';

// Security Headers and CORS
export {
  securityHeaders,
  applySecurityHeaders,
  createSecurityMiddleware,
  cors,
  applyCorsHeaders,
  createCorsMiddleware,
  checkBodySize,
  parseBodyWithLimit,
  sanitizeInput,
  sanitizeObject,
  validateContentType,
  applySecurity,
  defaultSecurityConfig,
  defaultCorsConfig,
  DEFAULT_MAX_BODY_SIZE,
  type SecurityHeadersConfig,
  type CorsConfig,
  type BodyLimitConfig
} from './security.js';
