import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';

/**
 * JWT Authentication Middleware
 *
 * Implements token-based authentication with:
 * - HMAC-SHA256 signed JWTs
 * - Access and refresh token support
 * - Configurable expiration times
 * - Timing-safe token comparison
 */

export interface JwtPayload {
  sub: string;          // Subject (user ID)
  role: 'admin' | 'user';
  iat: number;          // Issued at
  exp: number;          // Expiration
  jti?: string;         // JWT ID for revocation
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthenticatedRequest extends IncomingMessage {
  user?: JwtPayload;
  token?: string;
}

// Configuration
const JWT_SECRET = process.env.JWT_SECRET || '';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || '';
const ACCESS_TOKEN_EXPIRY = parseInt(process.env.ACCESS_TOKEN_EXPIRY_SECONDS || '3600', 10);   // 1 hour
const REFRESH_TOKEN_EXPIRY = parseInt(process.env.REFRESH_TOKEN_EXPIRY_SECONDS || '604800', 10); // 7 days

// Token blacklist for revoked tokens (in production, use Redis)
const revokedTokens = new Set<string>();

/**
 * Base64url encode a buffer or string
 */
function base64urlEncode(data: Buffer | string): string {
  // If it's a Buffer, convert to base64, then to base64url
  // If it's a string (like JSON), first convert to Buffer, then to base64url
  const base64 = Buffer.isBuffer(data)
    ? data.toString('base64')
    : Buffer.from(data, 'utf-8').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Base64url decode a string
 */
function base64urlDecode(str: string): string {
  let padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (padded.length % 4)) % 4;
  padded += '='.repeat(padding);
  return Buffer.from(padded, 'base64').toString('utf-8');
}

/**
 * Create HMAC signature for JWT
 */
function createSignature(header: string, payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(`${header}.${payload}`);
  return base64urlEncode(hmac.digest());
}

/**
 * Verify JWT signature using timing-safe comparison
 */
function verifySignature(header: string, payload: string, signature: string, secret: string): boolean {
  const expectedSignature = createSignature(header, payload, secret);

  const sigBuffer = Buffer.from(signature, 'utf-8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf-8');

  // Buffers must be same length for timingSafeEqual
  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  try {
    return timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * Generate a JWT token
 */
export function generateToken(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  expiresIn: number,
  secret: string
): string {
  const header = base64urlEncode(JSON.stringify({
    alg: 'HS256',
    typ: 'JWT'
  }));

  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + expiresIn,
    jti: payload.jti || randomBytes(16).toString('hex')
  };

  const encodedPayload = base64urlEncode(JSON.stringify(fullPayload));
  const signature = createSignature(header, encodedPayload, secret);

  return `${header}.${encodedPayload}.${signature}`;
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string, secret: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [header, payload, signature] = parts;

    // Verify signature
    if (!verifySignature(header, payload, signature, secret)) {
      return null;
    }

    // Decode payload
    const decoded = JSON.parse(base64urlDecode(payload)) as JwtPayload;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp < now) {
      return null;
    }

    // Check if token is revoked
    if (decoded.jti && revokedTokens.has(decoded.jti)) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

/**
 * Generate access and refresh token pair
 */
export function generateTokenPair(userId: string, role: 'admin' | 'user'): TokenPair {
  if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
    throw new Error('JWT secrets not configured. Set JWT_SECRET and JWT_REFRESH_SECRET environment variables.');
  }

  const accessToken = generateToken(
    { sub: userId, role },
    ACCESS_TOKEN_EXPIRY,
    JWT_SECRET
  );

  const refreshToken = generateToken(
    { sub: userId, role },
    REFRESH_TOKEN_EXPIRY,
    JWT_REFRESH_SECRET
  );

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_EXPIRY
  };
}

/**
 * Refresh an access token using a refresh token
 */
export function refreshAccessToken(refreshToken: string): TokenPair | null {
  if (!JWT_REFRESH_SECRET || !JWT_SECRET) {
    return null;
  }

  const payload = verifyToken(refreshToken, JWT_REFRESH_SECRET);
  if (!payload) {
    return null;
  }

  return generateTokenPair(payload.sub, payload.role);
}

/**
 * Revoke a token by its JTI
 */
export function revokeToken(jti: string): void {
  revokedTokens.add(jti);
}

/**
 * Extract token from Authorization header
 */
function extractToken(req: IncomingMessage): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return null;
  }

  // Support both "Bearer <token>" and just "<token>"
  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }

  return parts.length === 1 ? parts[0] : null;
}

/**
 * Authentication middleware
 *
 * Validates JWT token and attaches user info to request.
 * Returns false if authentication fails (response already sent).
 */
export async function authenticate(
  req: AuthenticatedRequest,
  res: ServerResponse
): Promise<boolean> {
  // Allow health check without auth
  if (req.url === '/api/health') {
    return true;
  }

  // Check if auth is disabled (development mode)
  if (process.env.AUTH_DISABLED === 'true') {
    req.user = {
      sub: 'dev-user',
      role: 'admin',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600
    };
    return true;
  }

  // Check for JWT secret configuration
  if (!JWT_SECRET) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Authentication not configured' }));
    return false;
  }

  const token = extractToken(req);
  if (!token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Authentication required', code: 'MISSING_TOKEN' }));
    return false;
  }

  const payload = verifyToken(token, JWT_SECRET);
  if (!payload) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' }));
    return false;
  }

  req.user = payload;
  req.token = token;
  return true;
}

/**
 * Optional authentication - doesn't fail if no token, but validates if present
 */
export async function optionalAuthenticate(req: AuthenticatedRequest): Promise<void> {
  if (!JWT_SECRET) {
    return;
  }

  const token = extractToken(req);
  if (!token) {
    return;
  }

  const payload = verifyToken(token, JWT_SECRET);
  if (payload) {
    req.user = payload;
    req.token = token;
  }
}

/**
 * Require specific role
 */
export function requireRole(
  req: AuthenticatedRequest,
  res: ServerResponse,
  requiredRole: 'admin' | 'user'
): boolean {
  if (!req.user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Authentication required', code: 'MISSING_AUTH' }));
    return false;
  }

  // Admin has access to everything
  if (req.user.role === 'admin') {
    return true;
  }

  // Check if user has required role
  if (req.user.role !== requiredRole) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Insufficient permissions', code: 'FORBIDDEN' }));
    return false;
  }

  return true;
}
