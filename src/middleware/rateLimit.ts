import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Rate Limiting Middleware
 *
 * Implements sliding window rate limiting with:
 * - Per-IP and per-user limits
 * - Configurable windows and thresholds
 * - Proper 429 responses with Retry-After header
 */

export interface RateLimitConfig {
  windowMs: number;           // Time window in milliseconds
  maxRequests: number;        // Maximum requests per window
  keyPrefix?: string;         // Key prefix for different limiters
  skipFailedRequests?: boolean;
  skipSuccessfulRequests?: boolean;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
  firstRequest: number;
}

// In-memory store (in production, use Redis)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Default configurations for different endpoints
export const RATE_LIMIT_CONFIGS = {
  // General API rate limit
  default: {
    windowMs: 60 * 1000,      // 1 minute
    maxRequests: 100,
    keyPrefix: 'default'
  } as RateLimitConfig,

  // Stricter limit for authentication endpoints
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,
    keyPrefix: 'auth'
  } as RateLimitConfig,

  // Write operations
  write: {
    windowMs: 60 * 1000,      // 1 minute
    maxRequests: 30,
    keyPrefix: 'write'
  } as RateLimitConfig,

  // Heavy operations (spawn agents, build demos)
  heavy: {
    windowMs: 60 * 1000,      // 1 minute
    maxRequests: 10,
    keyPrefix: 'heavy'
  } as RateLimitConfig,

  // Uploads
  upload: {
    windowMs: 60 * 1000,      // 1 minute
    maxRequests: 5,
    keyPrefix: 'upload'
  } as RateLimitConfig
};

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
 * Sliding window rate limit check
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  // No existing entry - create new one
  if (!entry) {
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + config.windowMs,
      firstRequest: now
    });
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetTime: now + config.windowMs
    };
  }

  // Check if window has expired
  if (now > entry.resetTime) {
    // Reset the window
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + config.windowMs,
      firstRequest: now
    });
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetTime: now + config.windowMs
    };
  }

  // Window still active - check count
  if (entry.count >= config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.resetTime
    };
  }

  // Increment count
  entry.count++;
  const remaining = Math.max(0, config.maxRequests - entry.count);

  return {
    allowed: true,
    remaining,
    resetTime: entry.resetTime
  };
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

  // Build rate limit key
  const clientId = getClientIdentifier(req);
  const userId = getUserIdentifier(req);
  const keyBase = userId || clientId;
  const key = `${config.keyPrefix || 'default'}:${keyBase}`;

  const result = checkRateLimit(key, config);

  // Set rate limit headers
  res.setHeader('X-RateLimit-Limit', config.maxRequests);
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
    res.setHeader('Retry-After', retryAfter);
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Too many requests',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter
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
  upload: createRateLimiter(RATE_LIMIT_CONFIGS.upload)
};

/**
 * Get appropriate rate limiter for request method
 */
export function getRateLimiterForMethod(method: string): RateLimitConfig {
  const writeOperations = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (writeOperations.includes(method)) {
    return RATE_LIMIT_CONFIGS.write;
  }
  return RATE_LIMIT_CONFIGS.default;
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
    /\/api\/agent-manager\/spawn-all/
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
    /\/api\/auth\/forgot-password/
  ];
  return authPatterns.some(pattern => pattern.test(url));
}

/**
 * Clear rate limit store (useful for testing)
 */
export function clearRateLimitStore(): void {
  rateLimitStore.clear();
}
