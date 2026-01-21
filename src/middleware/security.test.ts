import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import {
  generateToken,
  verifyToken,
  generateTokenPair,
  authenticate,
  revokeToken
} from './auth.js';
import {
  checkRateLimit,
  clearRateLimitStore,
  RATE_LIMIT_CONFIGS
} from './rateLimit.js';
import {
  applySecurityHeaders,
  applyCorsHeaders,
  checkBodySize
} from './security.js';

// Helper to create mock request
function createMockRequest(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  Object.assign(req, overrides);
  return req;
}

// Helper to create mock response
function createMockResponse(): ServerResponse & { headers: Record<string, string | number | string[]>; statusCode: number; body: string } {
  const res = {
    headers: {} as Record<string, string | number | string[]>,
    statusCode: 200,
    body: '',
    setHeader(name: string, value: string | number | string[]) {
      this.headers[name.toLowerCase()] = value;
    },
    writeHead(statusCode: number, headers?: Record<string, string>) {
      this.statusCode = statusCode;
      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          this.headers[key.toLowerCase()] = value;
        }
      }
    },
    end(body?: string) {
      this.body = body || '';
    }
  };
  return res as unknown as ServerResponse & { headers: Record<string, string | number | string[]>; statusCode: number; body: string };
}

describe('JWT Authentication', () => {
  const testSecret = 'test-secret-minimum-32-characters-long';
  const testPayload = { sub: 'user-123', role: 'user' as const };

  describe('generateToken', () => {
    it('should generate a valid JWT token', () => {
      const token = generateToken(testPayload, 3600, testSecret);
      expect(token).toBeTruthy();
      expect(token.split('.')).toHaveLength(3);
    });

    it('should generate different tokens for different payloads', () => {
      const token1 = generateToken(testPayload, 3600, testSecret);
      const token2 = generateToken({ sub: 'user-456', role: 'admin' as const }, 3600, testSecret);
      expect(token1).not.toBe(token2);
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token', () => {
      const token = generateToken(testPayload, 3600, testSecret);
      const decoded = verifyToken(token, testSecret);
      expect(decoded).toBeTruthy();
      expect(decoded?.sub).toBe('user-123');
      expect(decoded?.role).toBe('user');
    });

    it('should reject token with wrong secret', () => {
      const token = generateToken(testPayload, 3600, testSecret);
      const decoded = verifyToken(token, 'wrong-secret');
      expect(decoded).toBeNull();
    });

    it('should reject expired token', () => {
      const token = generateToken(testPayload, -1, testSecret); // Already expired
      const decoded = verifyToken(token, testSecret);
      expect(decoded).toBeNull();
    });

    it('should reject malformed token', () => {
      expect(verifyToken('invalid', testSecret)).toBeNull();
      expect(verifyToken('a.b', testSecret)).toBeNull();
      expect(verifyToken('a.b.c.d', testSecret)).toBeNull();
    });
  });

  describe('token revocation', () => {
    it('should reject revoked tokens', () => {
      const token = generateToken({ ...testPayload, jti: 'revoke-me' }, 3600, testSecret);
      const decoded = verifyToken(token, testSecret);
      expect(decoded).toBeTruthy();

      revokeToken('revoke-me');

      const decodedAfterRevoke = verifyToken(token, testSecret);
      expect(decodedAfterRevoke).toBeNull();
    });
  });
});

describe('Rate Limiting', () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  describe('checkRateLimit', () => {
    it('should allow requests under limit', () => {
      const config = { windowMs: 60000, maxRequests: 10, keyPrefix: 'test' };

      for (let i = 0; i < 10; i++) {
        const result = checkRateLimit('test-key', config);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(9 - i);
      }
    });

    it('should block requests over limit', () => {
      const config = { windowMs: 60000, maxRequests: 3, keyPrefix: 'test' };

      // Use up the limit
      for (let i = 0; i < 3; i++) {
        checkRateLimit('test-key', config);
      }

      // Fourth request should be blocked
      const result = checkRateLimit('test-key', config);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should reset after window expires', async () => {
      const config = { windowMs: 100, maxRequests: 2, keyPrefix: 'test' };

      // Use up the limit
      checkRateLimit('test-key', config);
      checkRateLimit('test-key', config);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should be allowed again
      const result = checkRateLimit('test-key', config);
      expect(result.allowed).toBe(true);
    });
  });
});

describe('Security Headers', () => {
  describe('applySecurityHeaders', () => {
    it('should apply all default security headers', () => {
      const res = createMockResponse();
      applySecurityHeaders(res);

      expect(res.headers['content-security-policy']).toBeTruthy();
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toContain('max-age=');
      expect(res.headers['x-xss-protection']).toBe('1; mode=block');
      expect(res.headers['referrer-policy']).toBeTruthy();
      expect(res.headers['permissions-policy']).toBeTruthy();
    });

    it('should allow disabling specific headers', () => {
      const res = createMockResponse();
      applySecurityHeaders(res, {
        frameOptions: false,
        xssProtection: false
      });

      expect(res.headers['x-frame-options']).toBeUndefined();
      expect(res.headers['x-xss-protection']).toBeUndefined();
    });
  });
});

describe('CORS', () => {
  beforeEach(() => {
    vi.stubEnv('ALLOWED_ORIGINS', 'http://localhost:3000,http://example.com');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CORS_ALLOW_ALL', 'false');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('applyCorsHeaders', () => {
    it('should allow configured origins', () => {
      const req = createMockRequest({
        headers: { origin: 'http://localhost:3000' }
      });
      const res = createMockResponse();

      const allowed = applyCorsHeaders(req, res, {
        allowedOrigins: ['http://localhost:3000', 'http://example.com']
      });

      expect(allowed).toBe(true);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    });

    it('should reject non-configured origins', () => {
      const req = createMockRequest({
        headers: { origin: 'http://malicious.com' }
      });
      const res = createMockResponse();

      const allowed = applyCorsHeaders(req, res, {
        allowedOrigins: ['http://localhost:3000']
      });

      expect(allowed).toBe(false);
    });

    it('should support wildcard origin', () => {
      const req = createMockRequest({
        headers: { origin: 'http://any-origin.com' }
      });
      const res = createMockResponse();

      const allowed = applyCorsHeaders(req, res, {
        allowedOrigins: ['*']
      });

      expect(allowed).toBe(true);
    });
  });
});

describe('Body Size Limits', () => {
  describe('checkBodySize', () => {
    it('should allow requests within size limit', () => {
      const req = createMockRequest({
        headers: { 'content-length': '1000' }
      });
      const res = createMockResponse();

      const allowed = checkBodySize(req, res, { maxSize: 1048576 });
      expect(allowed).toBe(true);
    });

    it('should reject requests exceeding size limit', () => {
      const req = createMockRequest({
        headers: { 'content-length': '2000000' }
      });
      const res = createMockResponse();

      const allowed = checkBodySize(req, res, { maxSize: 1048576 });
      expect(allowed).toBe(false);
      expect(res.statusCode).toBe(413);
      expect(res.body).toContain('PAYLOAD_TOO_LARGE');
    });

    it('should allow requests without content-length header', () => {
      const req = createMockRequest({
        headers: {}
      });
      const res = createMockResponse();

      const allowed = checkBodySize(req, res, { maxSize: 1048576 });
      expect(allowed).toBe(true);
    });
  });
});
