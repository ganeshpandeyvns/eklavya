import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Security Headers Middleware
 *
 * Adds essential security headers to all responses:
 * - Content-Security-Policy
 * - X-Frame-Options
 * - X-Content-Type-Options
 * - Strict-Transport-Security
 * - X-XSS-Protection
 * - Referrer-Policy
 * - Permissions-Policy
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

// Default CORS configuration
const defaultCorsConfig: CorsConfig = {
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
  allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  credentials: true,
  maxAge: 86400 // 24 hours
};

/**
 * Check if origin is allowed
 */
function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  // If no origins configured, deny all (secure by default)
  if (allowedOrigins.length === 0) {
    // In development, allow localhost origins
    if (process.env.NODE_ENV === 'development' || process.env.CORS_ALLOW_ALL === 'true') {
      return true;
    }
    return false;
  }

  // Check for wildcard
  if (allowedOrigins.includes('*')) {
    return true;
  }

  // Check exact match
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  // Check pattern match (e.g., *.example.com)
  return allowedOrigins.some(allowed => {
    if (allowed.startsWith('*.')) {
      const domain = allowed.slice(2);
      return origin.endsWith(domain) || origin.endsWith('.' + domain);
    }
    return false;
  });
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

  // Check if origin is allowed
  if (origin) {
    if (isOriginAllowed(origin, config.allowedOrigins)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      // Origin not allowed - don't set CORS headers
      // For OPTIONS requests, this will cause the preflight to fail
      return false;
    }
  } else if (process.env.NODE_ENV === 'development') {
    // Allow requests without origin in development (e.g., curl, Postman)
    res.setHeader('Access-Control-Allow-Origin', '*');
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

  // Exposed headers
  if (config.exposedHeaders && config.exposedHeaders.length > 0) {
    res.setHeader('Access-Control-Expose-Headers', config.exposedHeaders.join(', '));
  }

  // Preflight cache
  if (config.maxAge !== undefined) {
    res.setHeader('Access-Control-Max-Age', config.maxAge.toString());
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
  const isAllowed = applyCorsHeaders(req, res, config || defaultCorsConfig);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    if (isAllowed) {
      res.writeHead(204);
      res.end();
    } else {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'CORS not allowed from this origin',
        code: 'CORS_ORIGIN_DENIED'
      }));
    }
    return false; // Signal to stop processing (preflight handled)
  }

  return isAllowed;
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
 * Check if request body size is within limits
 */
export function checkBodySize(
  req: IncomingMessage,
  res: ServerResponse,
  config?: BodyLimitConfig
): boolean {
  const maxSize = config?.maxSize ||
    parseInt(process.env.MAX_BODY_SIZE || String(DEFAULT_MAX_BODY_SIZE), 10);

  // Check Content-Length header
  const contentLength = req.headers['content-length'];
  if (contentLength) {
    const length = parseInt(contentLength, 10);
    if (!isNaN(length) && length > maxSize) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Request body too large',
        code: 'PAYLOAD_TOO_LARGE',
        maxSize
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
          maxSize
        }));
        resolve(null);
        return;
      }

      body += chunk.toString();
    });

    req.on('end', () => {
      if (limitExceeded) return;

      try {
        resolve(JSON.parse(body || '{}') as T);
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
 * Export all security utilities
 */
export {
  defaultConfig as defaultSecurityConfig,
  defaultCorsConfig
};
