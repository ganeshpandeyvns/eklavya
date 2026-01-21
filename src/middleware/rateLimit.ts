import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Rate Limiting Middleware
 *
 * Implements sophisticated rate limiting with:
 * - Per-IP rate limiting
 * - Per-user rate limiting (authenticated requests)
 * - Per-endpoint rate limiting with configurable limits
 * - Sliding window algorithm
 * - Proper 429 responses with Retry-After header
 * - Environment variable configuration
 */

export interface RateLimitConfig {
  windowMs: number;           // Time window in milliseconds
  maxRequests: number;        // Maximum requests per window
  keyPrefix?: string;         // Key prefix for different limiters
  skipFailedRequests?: boolean;
  skipSuccessfulRequests?: boolean;
  message?: string;           // Custom error message
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
  firstRequest: number;
  requestTimes: number[];     // For sliding window
}

// In-memory store (in production, use Redis)
const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Parse rate limit configuration from environment
 */
function parseEnvConfig(): {
  windowMs: number;
  maxRequests: number;
  authWindowMs: number;
  authMaxRequests: number;
} {
  return {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    authWindowMs: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS || '900000', 10), // 15 min
    authMaxRequests: parseInt(process.env.RATE_LIMIT_AUTH_MAX_REQUESTS || '5', 10),
  };
}

// Get env config
const envConfig = parseEnvConfig();

// Default configurations for different endpoint types
export const RATE_LIMIT_CONFIGS = {
  // General API rate limit
  default: {
    windowMs: envConfig.windowMs,
    maxRequests: envConfig.maxRequests,
    keyPrefix: 'default'
  } as RateLimitConfig,

  // Stricter limit for authentication endpoints
  auth: {
    windowMs: envConfig.authWindowMs,
    maxRequests: envConfig.authMaxRequests,
    keyPrefix: 'auth',
    message: 'Too many login attempts. Please try again later.'
  } as RateLimitConfig,

  // Write operations
  write: {
    windowMs: parseInt(process.env.RATE_LIMIT_WRITE_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_WRITE_MAX_REQUESTS || '30', 10),
    keyPrefix: 'write'
  } as RateLimitConfig,

  // Heavy operations (spawn agents, build demos)
  heavy: {
    windowMs: parseInt(process.env.RATE_LIMIT_HEAVY_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_HEAVY_MAX_REQUESTS || '10', 10),
    keyPrefix: 'heavy',
    message: 'Rate limit exceeded for resource-intensive operations.'
  } as RateLimitConfig,

  // Uploads
  upload: {
    windowMs: parseInt(process.env.RATE_LIMIT_UPLOAD_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_UPLOAD_MAX_REQUESTS || '5', 10),
    keyPrefix: 'upload'
  } as RateLimitConfig,

  // Very strict for sensitive operations
  sensitive: {
    windowMs: parseInt(process.env.RATE_LIMIT_SENSITIVE_WINDOW_MS || '3600000', 10), // 1 hour
    maxRequests: parseInt(process.env.RATE_LIMIT_SENSITIVE_MAX_REQUESTS || '3', 10),
    keyPrefix: 'sensitive',
    message: 'Rate limit exceeded for sensitive operations.'
  } as RateLimitConfig,

  // Lenient for read operations
  read: {
    windowMs: parseInt(process.env.RATE_LIMIT_READ_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_READ_MAX_REQUESTS || '200', 10),
    keyPrefix: 'read'
  } as RateLimitConfig
};

/**
 * Endpoint rate limit mapping
 * Maps URL patterns to specific rate limit configurations
 */
interface EndpointRateLimit {
  pattern: RegExp;
  method?: string;  // Optional, if not set applies to all methods
  config: RateLimitConfig;
}

export const ENDPOINT_RATE_LIMITS: EndpointRateLimit[] = [
  // Authentication endpoints - very strict
  { pattern: /^\/api\/auth\/login/, method: 'POST', config: RATE_LIMIT_CONFIGS.auth },
  { pattern: /^\/api\/auth\/refresh/, method: 'POST', config: RATE_LIMIT_CONFIGS.auth },
  { pattern: /^\/api\/auth\/change-password/, method: 'POST', config: RATE_LIMIT_CONFIGS.sensitive },

  // Heavy operations
  { pattern: /^\/api\/agents\/[^/]+\/spawn/, method: 'POST', config: RATE_LIMIT_CONFIGS.heavy },
  { pattern: /^\/api\/demos\/[^/]+\/build/, method: 'POST', config: RATE_LIMIT_CONFIGS.heavy },
  { pattern: /^\/api\/self-build/, config: RATE_LIMIT_CONFIGS.heavy },
  { pattern: /^\/api\/orchestrator\/start/, method: 'POST', config: RATE_LIMIT_CONFIGS.heavy },
  { pattern: /^\/api\/agent-manager\/spawn-all/, method: 'POST', config: RATE_LIMIT_CONFIGS.heavy },

  // Write operations
  { pattern: /^\/api\/projects$/, method: 'POST', config: RATE_LIMIT_CONFIGS.write },
  { pattern: /^\/api\/tasks$/, method: 'POST', config: RATE_LIMIT_CONFIGS.write },
  { pattern: /^\/api\/demos$/, method: 'POST', config: RATE_LIMIT_CONFIGS.write },

  // Read operations - more lenient
  { pattern: /^\/api\/projects$/, method: 'GET', config: RATE_LIMIT_CONFIGS.read },
  { pattern: /^\/api\/dashboard/, method: 'GET', config: RATE_LIMIT_CONFIGS.read },
  { pattern: /^\/api\/health$/, method: 'GET', config: RATE_LIMIT_CONFIGS.read },
];

/**
 * Clean expired entries from the store
 */
function cleanExpiredEntries(): void {
  const now = Date.now();
  const entries = Array.from(rateLimitStore.entries());
  for (const [key, entry] of entries) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}

// Clean expired entries periodically
setInterval(cleanExpiredEntries, 60 * 1000);

/**
 * Extract client identifier from request
 * Uses X-Forwarded-For header if behind proxy, otherwise socket address
 */
function getClientIdentifier(req: IncomingMessage): string {
  // Check for forwarded header (when behind proxy)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return ips.split(',')[0].trim();
  }

  // Check for X-Real-IP header
  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  // Fall back to socket address
  const socketAddr = req.socket?.remoteAddress;
  return socketAddr || 'unknown';
}

/**
 * Get user identifier from authenticated request
 */
function getUserIdentifier(req: IncomingMessage): string | null {
  // Check if user is attached (from auth middleware)
  const authReq = req as IncomingMessage & { user?: { sub: string } };
  return authReq.user?.sub || null;
}

/**
 * Get rate limit configuration for a specific endpoint
 */
export function getEndpointRateLimitConfig(method: string, url: string): RateLimitConfig {
  // Find matching endpoint-specific rate limit
  for (const endpoint of ENDPOINT_RATE_LIMITS) {
    if (endpoint.pattern.test(url)) {
      // If method is specified, it must match
      if (endpoint.method && endpoint.method !== method) {
        continue;
      }
      return endpoint.config;
    }
  }

  // Fall back to method-based defaults
  return getRateLimiterForMethod(method);
}

/**
 * Sliding window rate limit check
 * Uses a sliding window algorithm for more accurate rate limiting
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetTime: number; retryAfter?: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  // No existing entry - create new one
  if (!entry) {
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + config.windowMs,
      firstRequest: now,
      requestTimes: [now]
    });
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetTime: now + config.windowMs
    };
  }

  // Sliding window: filter out requests outside the window
  const windowStart = now - config.windowMs;
  entry.requestTimes = entry.requestTimes.filter(time => time > windowStart);

  // Update reset time if window has shifted
  if (entry.requestTimes.length === 0) {
    entry.resetTime = now + config.windowMs;
  }

  // Check if we're at the limit
  if (entry.requestTimes.length >= config.maxRequests) {
    // Calculate when the oldest request in the window will expire
    const oldestRequest = Math.min(...entry.requestTimes);
    const retryAfter = Math.ceil((oldestRequest + config.windowMs - now) / 1000);

    return {
      allowed: false,
      remaining: 0,
      resetTime: oldestRequest + config.windowMs,
      retryAfter: Math.max(1, retryAfter)
    };
  }

  // Add current request
  entry.requestTimes.push(now);
  entry.count = entry.requestTimes.length;
  const remaining = Math.max(0, config.maxRequests - entry.count);

  return {
    allowed: true,
    remaining,
    resetTime: entry.resetTime
  };
}

/**
 * Log rate limit event
 */
function logRateLimitEvent(
  key: string,
  allowed: boolean,
  config: RateLimitConfig,
  remaining: number,
  ip: string,
  userId: string | null
): void {
  if (process.env.RATE_LIMIT_DEBUG === 'true' || !allowed) {
    console.log(JSON.stringify({
      type: 'RATE_LIMIT_EVENT',
      timestamp: new Date().toISOString(),
      key,
      allowed,
      remaining,
      limit: config.maxRequests,
      windowMs: config.windowMs,
      keyPrefix: config.keyPrefix,
      ip,
      userId: userId || undefined
    }));
  }
}

/**
 * Rate limiting middleware
 *
 * Returns false if rate limit exceeded (response already sent).
 */
export async function rateLimit(
  req: IncomingMessage,
  res: ServerResponse,
  config: RateLimitConfig = RATE_LIMIT_CONFIGS.default
): Promise<boolean> {
  // Disable rate limiting in development if configured
  if (process.env.RATE_LIMIT_DISABLED === 'true') {
    return true;
  }

  const clientId = getClientIdentifier(req);
  const userId = getUserIdentifier(req);

  // Build rate limit key - prefer user ID if authenticated
  const keyBase = userId || clientId;
  const key = `${config.keyPrefix || 'default'}:${keyBase}`;

  const result = checkRateLimit(key, config);

  // Log the event
  logRateLimitEvent(key, result.allowed, config, result.remaining, clientId, userId);

  // Set rate limit headers
  res.setHeader('X-RateLimit-Limit', config.maxRequests);
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));
  res.setHeader('X-RateLimit-Policy', `${config.maxRequests};w=${Math.ceil(config.windowMs / 1000)}`);

  if (!result.allowed) {
    const retryAfter = result.retryAfter || Math.ceil((result.resetTime - Date.now()) / 1000);
    res.setHeader('Retry-After', retryAfter);
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: config.message || 'Too many requests',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter,
      limit: config.maxRequests,
      windowMs: config.windowMs
    }));
    return false;
  }

  return true;
}

/**
 * Create rate limiter for specific configuration
 */
export function createRateLimiter(config: RateLimitConfig) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    return rateLimit(req, res, config);
  };
}

/**
 * Pre-configured rate limiters
 */
export const rateLimiters = {
  default: createRateLimiter(RATE_LIMIT_CONFIGS.default),
  auth: createRateLimiter(RATE_LIMIT_CONFIGS.auth),
  write: createRateLimiter(RATE_LIMIT_CONFIGS.write),
  heavy: createRateLimiter(RATE_LIMIT_CONFIGS.heavy),
  upload: createRateLimiter(RATE_LIMIT_CONFIGS.upload),
  sensitive: createRateLimiter(RATE_LIMIT_CONFIGS.sensitive),
  read: createRateLimiter(RATE_LIMIT_CONFIGS.read)
};

/**
 * Get appropriate rate limiter for request method
 */
export function getRateLimiterForMethod(method: string): RateLimitConfig {
  const writeOperations = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (writeOperations.includes(method)) {
    return RATE_LIMIT_CONFIGS.write;
  }
  return RATE_LIMIT_CONFIGS.read;
}

/**
 * Check if endpoint requires heavy rate limiting
 */
export function isHeavyEndpoint(url: string): boolean {
  const heavyPatterns = [
    /\/api\/agents\/.*\/spawn/,
    /\/api\/demos\/.*\/build/,
    /\/api\/self-build/,
    /\/api\/orchestrator\/start/,
    /\/api\/agent-manager\/spawn-all/,
    /\/api\/agent-manager\/terminate-all/,
  ];
  return heavyPatterns.some(pattern => pattern.test(url));
}

/**
 * Check if endpoint is authentication related
 */
export function isAuthEndpoint(url: string): boolean {
  const authPatterns = [
    /\/api\/auth\/login/,
    /\/api\/auth\/register/,
    /\/api\/auth\/refresh/,
    /\/api\/auth\/forgot-password/,
    /\/api\/auth\/reset-password/,
  ];
  return authPatterns.some(pattern => pattern.test(url));
}

/**
 * Check if endpoint is sensitive
 */
export function isSensitiveEndpoint(url: string): boolean {
  const sensitivePatterns = [
    /\/api\/auth\/change-password/,
    /\/api\/users\/.*\/delete/,
    /\/api\/projects\/.*\/delete/,
  ];
  return sensitivePatterns.some(pattern => pattern.test(url));
}

/**
 * Clear rate limit store (useful for testing)
 */
export function clearRateLimitStore(): void {
  rateLimitStore.clear();
}

/**
 * Get current rate limit status for a key
 */
export function getRateLimitStatus(key: string): RateLimitEntry | undefined {
  return rateLimitStore.get(key);
}

/**
 * Manually add entries to rate limit (for testing or admin purposes)
 */
export function setRateLimitEntry(key: string, entry: RateLimitEntry): void {
  rateLimitStore.set(key, entry);
}

/**
 * Bypass rate limit for specific IPs (e.g., internal services)
 */
const bypassedIPs = new Set<string>(
  (process.env.RATE_LIMIT_BYPASS_IPS || '').split(',').filter(Boolean)
);

export function addBypassIP(ip: string): void {
  bypassedIPs.add(ip);
}

export function removeBypassIP(ip: string): void {
  bypassedIPs.delete(ip);
}

export function isIPBypassed(ip: string): boolean {
  return bypassedIPs.has(ip);
}

/**
 * Smart rate limiter that automatically selects the right config
 */
export async function smartRateLimit(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  // Check for bypassed IPs
  const clientIP = getClientIdentifier(req);
  if (isIPBypassed(clientIP)) {
    return true;
  }

  const method = req.method || 'GET';
  const url = req.url || '/';

  // Get the appropriate config for this endpoint
  const config = getEndpointRateLimitConfig(method, url);

  return rateLimit(req, res, config);
}
