import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Security Headers and CORS Middleware
 *
 * Provides comprehensive security features:
 * - Content-Security-Policy
 * - X-Frame-Options
 * - X-Content-Type-Options
 * - Strict-Transport-Security
 * - X-XSS-Protection
 * - Referrer-Policy
 * - Permissions-Policy
 * - CORS with configurable whitelist
 * - Request body size limits
 * - Input sanitization
 */

export interface SecurityHeadersConfig {
  contentSecurityPolicy?: string | false;
  frameOptions?: 'DENY' | 'SAMEORIGIN' | false;
  contentTypeOptions?: boolean;
  strictTransportSecurity?: {
    maxAge: number;
    includeSubDomains?: boolean;
    preload?: boolean;
  } | false;
  xssProtection?: boolean;
  referrerPolicy?: string | false;
  permissionsPolicy?: string | false;
}

// Default security headers configuration
const defaultConfig: SecurityHeadersConfig = {
  contentSecurityPolicy: [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",  // Allow inline scripts for API responses
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; '),
  frameOptions: 'DENY',
  contentTypeOptions: true,
  strictTransportSecurity: {
    maxAge: 31536000,           // 1 year
    includeSubDomains: true,
    preload: true
  },
  xssProtection: true,
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy: [
    'camera=()',
    'microphone=()',
    'geolocation=()',
    'payment=()',
    'usb=()',
    'magnetometer=()',
    'gyroscope=()',
    'accelerometer=()'
  ].join(', ')
};

/**
 * Apply security headers to response
 */
export function applySecurityHeaders(
  res: ServerResponse,
  config: SecurityHeadersConfig = defaultConfig
): void {
  // Content-Security-Policy
  const cspValue = config.contentSecurityPolicy !== false
    ? (config.contentSecurityPolicy || defaultConfig.contentSecurityPolicy)
    : null;
  if (cspValue) {
    res.setHeader('Content-Security-Policy', cspValue);
  }

  // X-Frame-Options (prevent clickjacking)
  if (config.frameOptions !== false) {
    res.setHeader('X-Frame-Options', config.frameOptions || 'DENY');
  }

  // X-Content-Type-Options (prevent MIME sniffing)
  if (config.contentTypeOptions !== false) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }

  // Strict-Transport-Security (force HTTPS)
  if (config.strictTransportSecurity !== false) {
    const hsts = config.strictTransportSecurity || defaultConfig.strictTransportSecurity;
    if (hsts) {
      let hstsValue = `max-age=${hsts.maxAge}`;
      if (hsts.includeSubDomains) {
        hstsValue += '; includeSubDomains';
      }
      if (hsts.preload) {
        hstsValue += '; preload';
      }
      res.setHeader('Strict-Transport-Security', hstsValue);
    }
  }

  // X-XSS-Protection (legacy XSS filter)
  if (config.xssProtection !== false) {
    res.setHeader('X-XSS-Protection', '1; mode=block');
  }

  // Referrer-Policy
  const referrerValue = config.referrerPolicy !== false
    ? (config.referrerPolicy || 'strict-origin-when-cross-origin')
    : null;
  if (referrerValue) {
    res.setHeader('Referrer-Policy', referrerValue);
  }

  // Permissions-Policy (formerly Feature-Policy)
  const permissionsValue = config.permissionsPolicy !== false
    ? (config.permissionsPolicy || defaultConfig.permissionsPolicy)
    : null;
  if (permissionsValue) {
    res.setHeader('Permissions-Policy', permissionsValue);
  }

  // Additional security headers
  res.setHeader('X-Download-Options', 'noopen');          // IE specific
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
}

/**
 * Security headers middleware
 */
export async function securityHeaders(
  _req: IncomingMessage,
  res: ServerResponse,
  config?: SecurityHeadersConfig
): Promise<void> {
  applySecurityHeaders(res, config || defaultConfig);
}

/**
 * Create security headers middleware with custom config
 */
export function createSecurityMiddleware(config: SecurityHeadersConfig) {
  return async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    applySecurityHeaders(res, config);
  };
}

/**
 * CORS configuration
 */
export interface CorsConfig {
  allowedOrigins: string[];    // List of allowed origins, or '*' for any
  allowedMethods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;             // Preflight cache duration in seconds
}

/**
 * Parse CORS origins from environment variable
 * Supports comma-separated list: "http://localhost:3000,https://app.example.com"
 * Also supports wildcard subdomains: "*.example.com"
 */
function parseCorsOrigins(): string[] {
  const envOrigins = process.env.CORS_ORIGINS || process.env.ALLOWED_ORIGINS || '';
  return envOrigins
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

// Default CORS configuration
const defaultCorsConfig: CorsConfig = {
  allowedOrigins: parseCorsOrigins(),
  allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'X-Request-ID',
    'X-Correlation-ID'
  ],
  exposedHeaders: [
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'X-Request-ID'
  ],
  credentials: true,
  maxAge: 86400 // 24 hours
};

/**
 * Check if origin is allowed
 */
function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  // If no origins configured, check environment
  if (allowedOrigins.length === 0) {
    // In development or if CORS_ALLOW_ALL is set, allow any origin
    if (process.env.NODE_ENV === 'development' ||
        process.env.CORS_ALLOW_ALL === 'true' ||
        process.env.AUTH_DISABLED === 'true') {
      return true;
    }
    // In production with no whitelist, deny all cross-origin requests
    return false;
  }

  // Check for wildcard (allow all)
  if (allowedOrigins.includes('*')) {
    return true;
  }

  // Check exact match
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  // Check pattern match (e.g., *.example.com)
  for (const allowed of allowedOrigins) {
    // Wildcard subdomain pattern
    if (allowed.startsWith('*.')) {
      const domain = allowed.slice(2); // Remove "*."
      try {
        const originUrl = new URL(origin);
        const originHost = originUrl.host;
        // Match exact domain or any subdomain
        if (originHost === domain || originHost.endsWith('.' + domain)) {
          return true;
        }
      } catch {
        // Invalid origin URL, continue checking
      }
    }

    // Protocol-agnostic matching (optional)
    if (allowed.startsWith('//')) {
      const pattern = allowed.slice(2);
      try {
        const originUrl = new URL(origin);
        if (originUrl.host === pattern || originUrl.host.endsWith('.' + pattern)) {
          return true;
        }
      } catch {
        // Invalid origin URL, continue checking
      }
    }
  }

  return false;
}

/**
 * Log CORS decision for debugging
 */
function logCorsDecision(origin: string | undefined, allowed: boolean, reason?: string): void {
  if (process.env.CORS_DEBUG === 'true' || process.env.NODE_ENV === 'development') {
    console.log(JSON.stringify({
      type: 'CORS_DECISION',
      timestamp: new Date().toISOString(),
      origin: origin || 'none',
      allowed,
      reason
    }));
  }
}

/**
 * Apply CORS headers to response
 */
export function applyCorsHeaders(
  req: IncomingMessage,
  res: ServerResponse,
  config: CorsConfig = defaultCorsConfig
): boolean {
  const origin = req.headers.origin;

  // No origin header = same-origin request or non-browser request
  if (!origin) {
    // In development, allow requests without origin (e.g., curl, Postman)
    if (process.env.NODE_ENV === 'development' || process.env.AUTH_DISABLED === 'true') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      logCorsDecision(undefined, true, 'no_origin_dev_mode');
      return true;
    }
    // In production, allow same-origin requests (no header needed)
    logCorsDecision(undefined, true, 'no_origin_same_origin');
    return true;
  }

  // Check if origin is in the whitelist
  if (isOriginAllowed(origin, config.allowedOrigins)) {
    // Set the specific origin (not * when using credentials)
    res.setHeader('Access-Control-Allow-Origin', origin);
    logCorsDecision(origin, true, 'whitelisted');
  } else {
    // Origin not allowed - don't set CORS headers
    logCorsDecision(origin, false, 'not_whitelisted');
    return false;
  }

  // Allow credentials if configured
  if (config.credentials) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  // Allowed methods
  if (config.allowedMethods && config.allowedMethods.length > 0) {
    res.setHeader('Access-Control-Allow-Methods', config.allowedMethods.join(', '));
  }

  // Allowed headers
  if (config.allowedHeaders && config.allowedHeaders.length > 0) {
    res.setHeader('Access-Control-Allow-Headers', config.allowedHeaders.join(', '));
  }

  // Exposed headers (headers the browser can access)
  if (config.exposedHeaders && config.exposedHeaders.length > 0) {
    res.setHeader('Access-Control-Expose-Headers', config.exposedHeaders.join(', '));
  }

  // Preflight cache duration
  if (config.maxAge !== undefined) {
    res.setHeader('Access-Control-Max-Age', config.maxAge.toString());
  }

  // Add Vary header to indicate response varies based on Origin
  const existingVary = res.getHeader('Vary');
  if (existingVary) {
    const varyValue = Array.isArray(existingVary) ? existingVary.join(', ') : String(existingVary);
    if (!varyValue.includes('Origin')) {
      res.setHeader('Vary', `${varyValue}, Origin`);
    }
  } else {
    res.setHeader('Vary', 'Origin');
  }

  return true;
}

/**
 * CORS middleware
 *
 * Handles CORS preflight and applies headers.
 * Returns false if origin is not allowed for non-OPTIONS requests.
 */
export async function cors(
  req: IncomingMessage,
  res: ServerResponse,
  config?: CorsConfig
): Promise<boolean> {
  const effectiveConfig = config || defaultCorsConfig;
  const isAllowed = applyCorsHeaders(req, res, effectiveConfig);

  // Handle preflight (OPTIONS) request
  if (req.method === 'OPTIONS') {
    if (isAllowed) {
      // Successful preflight - return 204 No Content
      res.writeHead(204);
      res.end();
    } else {
      // Origin not allowed
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'CORS not allowed from this origin',
        code: 'CORS_ORIGIN_DENIED'
      }));
    }
    return false; // Signal to stop processing (preflight handled)
  }

  // For non-preflight requests, if origin is not allowed, we can either:
  // 1. Reject the request (strict mode)
  // 2. Allow but without CORS headers (browser will block on client side)
  // We choose option 1 for security
  if (!isAllowed && req.headers.origin) {
    const strictMode = process.env.CORS_STRICT_MODE !== 'false';
    if (strictMode) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Cross-origin request not allowed from this origin',
        code: 'CORS_ORIGIN_DENIED'
      }));
      return false;
    }
    // Non-strict mode: let browser handle the CORS error
  }

  return true;
}

/**
 * Create CORS middleware with custom config
 */
export function createCorsMiddleware(config: CorsConfig) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    return cors(req, res, config);
  };
}

/**
 * Request body size limit configuration
 */
export interface BodyLimitConfig {
  maxSize: number;    // Maximum body size in bytes
  contentTypes?: string[];  // Content types to check (default: all)
}

const DEFAULT_MAX_BODY_SIZE = 1024 * 1024; // 1MB

/**
 * Get maximum body size from environment or config
 */
function getMaxBodySize(config?: BodyLimitConfig): number {
  if (config?.maxSize) {
    return config.maxSize;
  }
  return parseInt(process.env.MAX_BODY_SIZE || String(DEFAULT_MAX_BODY_SIZE), 10);
}

/**
 * Check if request body size is within limits
 */
export function checkBodySize(
  req: IncomingMessage,
  res: ServerResponse,
  config?: BodyLimitConfig
): boolean {
  const maxSize = getMaxBodySize(config);

  // Check Content-Length header
  const contentLength = req.headers['content-length'];
  if (contentLength) {
    const length = parseInt(contentLength, 10);
    if (!isNaN(length) && length > maxSize) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Request body too large',
        code: 'PAYLOAD_TOO_LARGE',
        maxSize,
        receivedSize: length
      }));
      return false;
    }
  }

  return true;
}

/**
 * Parse request body with size limit enforcement
 */
export async function parseBodyWithLimit<T>(
  req: IncomingMessage,
  res: ServerResponse,
  maxSize: number = DEFAULT_MAX_BODY_SIZE
): Promise<T | null> {
  return new Promise((resolve) => {
    let body = '';
    let totalSize = 0;
    let limitExceeded = false;

    req.on('data', (chunk: Buffer) => {
      if (limitExceeded) return;

      totalSize += chunk.length;
      if (totalSize > maxSize) {
        limitExceeded = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Request body too large',
          code: 'PAYLOAD_TOO_LARGE',
          maxSize,
          receivedSize: totalSize
        }));
        resolve(null);
        return;
      }

      body += chunk.toString();
    });

    req.on('end', () => {
      if (limitExceeded) return;

      try {
        const parsed = JSON.parse(body || '{}') as T;
        resolve(parsed);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Invalid JSON in request body',
          code: 'INVALID_JSON'
        }));
        resolve(null);
      }
    });

    req.on('error', () => {
      if (limitExceeded) return;
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Error reading request body',
        code: 'BODY_READ_ERROR'
      }));
      resolve(null);
    });
  });
}

/**
 * Input sanitization - basic HTML/script tag removal
 * For more comprehensive sanitization, use a library like DOMPurify
 */
export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') {
    return input;
  }

  // Remove script tags and their content
  let sanitized = input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove on* event handlers
  sanitized = sanitized.replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '');
  sanitized = sanitized.replace(/\bon\w+\s*=\s*[^\s>]*/gi, '');

  // Remove javascript: protocol
  sanitized = sanitized.replace(/javascript:/gi, '');

  // Remove data: protocol for potentially dangerous content types
  sanitized = sanitized.replace(/data:(?!image\/)/gi, '');

  return sanitized;
}

/**
 * Deep sanitize an object (recursively sanitize string values)
 */
export function sanitizeObject<T extends object>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map(item => {
      if (typeof item === 'string') {
        return sanitizeInput(item);
      } else if (typeof item === 'object' && item !== null) {
        return sanitizeObject(item);
      }
      return item;
    }) as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = sanitizeInput(value);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeObject(value as object);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * Validate content type
 */
export function validateContentType(
  req: IncomingMessage,
  res: ServerResponse,
  allowedTypes: string[] = ['application/json']
): boolean {
  const contentType = req.headers['content-type'];

  // No content type is OK for GET/HEAD/DELETE
  if (!contentType && ['GET', 'HEAD', 'DELETE'].includes(req.method || '')) {
    return true;
  }

  // POST/PUT/PATCH should have content type
  if (!contentType) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Content-Type header is required',
      code: 'MISSING_CONTENT_TYPE'
    }));
    return false;
  }

  // Check if content type matches allowed types (ignore charset and other params)
  const mimeType = contentType.split(';')[0].trim().toLowerCase();
  if (!allowedTypes.some(allowed => mimeType === allowed.toLowerCase())) {
    res.writeHead(415, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Unsupported content type',
      code: 'UNSUPPORTED_MEDIA_TYPE',
      allowedTypes
    }));
    return false;
  }

  return true;
}

/**
 * Combined security middleware that applies all security measures
 */
export async function applySecurity(
  req: IncomingMessage,
  res: ServerResponse,
  options?: {
    securityHeaders?: SecurityHeadersConfig;
    corsConfig?: CorsConfig;
    maxBodySize?: number;
  }
): Promise<boolean> {
  // Apply security headers
  applySecurityHeaders(res, options?.securityHeaders);

  // Handle CORS
  const corsResult = await cors(req, res, options?.corsConfig);
  if (!corsResult) {
    return false;
  }

  // Check body size for write operations
  if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {
    if (!checkBodySize(req, res, { maxSize: options?.maxBodySize || DEFAULT_MAX_BODY_SIZE })) {
      return false;
    }
  }

  return true;
}

/**
 * Export all security utilities
 */
export {
  defaultConfig as defaultSecurityConfig,
  defaultCorsConfig,
  DEFAULT_MAX_BODY_SIZE
};
