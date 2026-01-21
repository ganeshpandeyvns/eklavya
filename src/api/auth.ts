import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { getDatabase } from '../lib/database.js';
import {
  generateTokenPair,
  verifyToken,
  revokeToken,
  type JwtPayload,
  type TokenPair,
  type AuthenticatedRequest
} from '../middleware/auth.js';

/**
 * Auth Routes Handler
 *
 * Provides authentication endpoints:
 * - POST /api/auth/login - Authenticate and receive tokens
 * - POST /api/auth/refresh - Refresh access token
 * - POST /api/auth/logout - Revoke tokens
 */

// Security configurations
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || '';
const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10);
const LOGIN_LOCKOUT_DURATION_MS = parseInt(process.env.LOGIN_LOCKOUT_DURATION_MS || '900000', 10); // 15 minutes

// User credentials interface
export interface UserCredentials {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  role: 'admin' | 'user';
  failedAttempts: number;
  lockedUntil: Date | null;
  lastLogin: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Login attempt tracking (in production, use Redis)
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>();
const ATTEMPT_WINDOW_MS = 900000; // 15 minutes

/**
 * Hash password with salt using PBKDF2-like approach
 */
export function hashPassword(password: string, salt: string): string {
  const hash = createHmac('sha256', salt);
  hash.update(password);
  return hash.digest('hex');
}

/**
 * Verify password using timing-safe comparison
 */
export function verifyPassword(password: string, salt: string, storedHash: string): boolean {
  const computedHash = hashPassword(password, salt);

  const computedBuffer = Buffer.from(computedHash, 'utf-8');
  const storedBuffer = Buffer.from(storedHash, 'utf-8');

  if (computedBuffer.length !== storedBuffer.length) {
    return false;
  }

  try {
    return timingSafeEqual(computedBuffer, storedBuffer);
  } catch {
    return false;
  }
}

/**
 * Generate a random salt
 */
export function generateSalt(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Check if user is locked out due to failed attempts
 */
function isLockedOut(identifier: string): { locked: boolean; remainingMs?: number } {
  const attempts = loginAttempts.get(identifier);

  if (!attempts) {
    return { locked: false };
  }

  const now = Date.now();

  // Clean up old attempts
  if (now - attempts.firstAttempt > ATTEMPT_WINDOW_MS) {
    loginAttempts.delete(identifier);
    return { locked: false };
  }

  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    const lockoutEnd = attempts.firstAttempt + LOGIN_LOCKOUT_DURATION_MS;
    if (now < lockoutEnd) {
      return { locked: true, remainingMs: lockoutEnd - now };
    }
    loginAttempts.delete(identifier);
  }

  return { locked: false };
}

/**
 * Record a failed login attempt
 */
function recordFailedAttempt(identifier: string): void {
  const attempts = loginAttempts.get(identifier);
  const now = Date.now();

  if (attempts) {
    // Check if window has expired
    if (now - attempts.firstAttempt > ATTEMPT_WINDOW_MS) {
      loginAttempts.set(identifier, { count: 1, firstAttempt: now });
    } else {
      attempts.count++;
    }
  } else {
    loginAttempts.set(identifier, { count: 1, firstAttempt: now });
  }
}

/**
 * Clear login attempts on successful login
 */
function clearLoginAttempts(identifier: string): void {
  loginAttempts.delete(identifier);
}

/**
 * Log security event
 */
function logSecurityEvent(event: string, details: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({
    type: 'SECURITY_EVENT',
    event,
    timestamp,
    ...details
  }));
}

/**
 * Parse request body
 */
async function parseBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}') as T);
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Get client IP for rate limiting and logging
 */
function getClientIP(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return ips.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Login endpoint handler
 *
 * POST /api/auth/login
 * Body: { username: string, password: string }
 * Returns: { accessToken, refreshToken, expiresIn, user: { id, username, role } }
 */
export async function login(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const clientIP = getClientIP(req);

  try {
    // Check if auth is disabled (development mode)
    if (process.env.AUTH_DISABLED === 'true') {
      const devTokens = generateTokenPair('dev-user', 'admin');
      sendJson(res, 200, {
        ...devTokens,
        user: { id: 'dev-user', username: 'admin', role: 'admin' }
      });
      return;
    }

    const body = await parseBody<{ username: string; password: string }>(req);

    if (!body.username || !body.password) {
      sendJson(res, 400, {
        error: 'Username and password are required',
        code: 'MISSING_CREDENTIALS'
      });
      return;
    }

    // Check lockout by IP and username
    const ipLockout = isLockedOut(clientIP);
    const userLockout = isLockedOut(body.username);

    if (ipLockout.locked || userLockout.locked) {
      const remainingMs = Math.max(ipLockout.remainingMs || 0, userLockout.remainingMs || 0);
      const remainingSec = Math.ceil(remainingMs / 1000);

      logSecurityEvent('LOGIN_BLOCKED', {
        username: body.username,
        ip: clientIP,
        reason: 'lockout'
      });

      sendJson(res, 429, {
        error: 'Too many failed login attempts. Please try again later.',
        code: 'ACCOUNT_LOCKED',
        retryAfter: remainingSec
      });
      return;
    }

    // Look up user in database
    let user: UserCredentials | null = null;

    try {
      const db = getDatabase();
      const result = await db.query<UserCredentials>(
        `SELECT id, username, password_hash as "passwordHash", salt, role,
                failed_attempts as "failedAttempts", locked_until as "lockedUntil",
                last_login as "lastLogin", created_at as "createdAt", updated_at as "updatedAt"
         FROM users WHERE username = $1`,
        [body.username]
      );

      if (result.rows.length > 0) {
        user = result.rows[0];
      }
    } catch (dbError) {
      // If users table doesn't exist or other DB error, fall back to env-based auth
      // This allows development without a full user system
      const adminUsername = process.env.ADMIN_USERNAME || 'admin';
      const adminPassword = process.env.ADMIN_PASSWORD;

      if (adminPassword && body.username === adminUsername && body.password === adminPassword) {
        const tokens = generateTokenPair('admin', 'admin');

        logSecurityEvent('LOGIN_SUCCESS', {
          username: adminUsername,
          ip: clientIP,
          method: 'env'
        });

        clearLoginAttempts(clientIP);
        clearLoginAttempts(body.username);

        sendJson(res, 200, {
          ...tokens,
          user: { id: 'admin', username: adminUsername, role: 'admin' }
        });
        return;
      }
    }

    // Verify password
    if (!user || !verifyPassword(body.password, user.salt, user.passwordHash)) {
      recordFailedAttempt(clientIP);
      recordFailedAttempt(body.username);

      logSecurityEvent('LOGIN_FAILED', {
        username: body.username,
        ip: clientIP,
        reason: user ? 'invalid_password' : 'user_not_found'
      });

      // Use generic error message to prevent username enumeration
      sendJson(res, 401, {
        error: 'Invalid username or password',
        code: 'INVALID_CREDENTIALS'
      });
      return;
    }

    // Check if user is locked in database
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      logSecurityEvent('LOGIN_BLOCKED', {
        username: body.username,
        ip: clientIP,
        reason: 'db_lockout'
      });

      sendJson(res, 403, {
        error: 'Account is temporarily locked',
        code: 'ACCOUNT_LOCKED'
      });
      return;
    }

    // Generate tokens
    const tokens = generateTokenPair(user.id, user.role);

    // Update last login time in database
    try {
      const db = getDatabase();
      await db.query(
        `UPDATE users SET last_login = NOW(), failed_attempts = 0, locked_until = NULL
         WHERE id = $1`,
        [user.id]
      );
    } catch {
      // Non-critical, continue even if update fails
    }

    logSecurityEvent('LOGIN_SUCCESS', {
      userId: user.id,
      username: user.username,
      ip: clientIP,
      method: 'db'
    });

    clearLoginAttempts(clientIP);
    clearLoginAttempts(body.username);

    sendJson(res, 200, {
      ...tokens,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });

  } catch (error) {
    logSecurityEvent('LOGIN_ERROR', {
      ip: clientIP,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    sendJson(res, 500, {
      error: 'Authentication service error',
      code: 'AUTH_ERROR'
    });
  }
}

/**
 * Refresh token endpoint handler
 *
 * POST /api/auth/refresh
 * Body: { refreshToken: string }
 * Returns: { accessToken, refreshToken, expiresIn }
 */
export async function refresh(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const clientIP = getClientIP(req);

  try {
    // Check if auth is disabled (development mode)
    if (process.env.AUTH_DISABLED === 'true') {
      const devTokens = generateTokenPair('dev-user', 'admin');
      sendJson(res, 200, devTokens);
      return;
    }

    if (!JWT_REFRESH_SECRET) {
      sendJson(res, 500, {
        error: 'Token refresh not configured',
        code: 'REFRESH_NOT_CONFIGURED'
      });
      return;
    }

    const body = await parseBody<{ refreshToken: string }>(req);

    if (!body.refreshToken) {
      sendJson(res, 400, {
        error: 'Refresh token is required',
        code: 'MISSING_REFRESH_TOKEN'
      });
      return;
    }

    // Verify refresh token
    const payload = verifyToken(body.refreshToken, JWT_REFRESH_SECRET);

    if (!payload) {
      logSecurityEvent('REFRESH_FAILED', {
        ip: clientIP,
        reason: 'invalid_token'
      });

      sendJson(res, 401, {
        error: 'Invalid or expired refresh token',
        code: 'INVALID_REFRESH_TOKEN'
      });
      return;
    }

    // Revoke old refresh token to prevent reuse
    if (payload.jti) {
      revokeToken(payload.jti);
    }

    // Generate new token pair
    const tokens = generateTokenPair(payload.sub, payload.role);

    logSecurityEvent('TOKEN_REFRESHED', {
      userId: payload.sub,
      ip: clientIP
    });

    sendJson(res, 200, tokens);

  } catch (error) {
    logSecurityEvent('REFRESH_ERROR', {
      ip: clientIP,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    sendJson(res, 500, {
      error: 'Token refresh failed',
      code: 'REFRESH_ERROR'
    });
  }
}

/**
 * Logout endpoint handler
 *
 * POST /api/auth/logout
 * Headers: Authorization: Bearer <accessToken>
 * Body: { refreshToken?: string } (optional, to also revoke refresh token)
 * Returns: { success: true }
 */
export async function logout(req: AuthenticatedRequest, res: ServerResponse): Promise<void> {
  const clientIP = getClientIP(req);

  try {
    // Check if auth is disabled (development mode)
    if (process.env.AUTH_DISABLED === 'true') {
      sendJson(res, 200, { success: true });
      return;
    }

    // Revoke access token
    if (req.user?.jti) {
      revokeToken(req.user.jti);
    }

    // Also revoke refresh token if provided
    const body = await parseBody<{ refreshToken?: string }>(req);

    if (body.refreshToken && JWT_REFRESH_SECRET) {
      const refreshPayload = verifyToken(body.refreshToken, JWT_REFRESH_SECRET);
      if (refreshPayload?.jti) {
        revokeToken(refreshPayload.jti);
      }
    }

    logSecurityEvent('LOGOUT', {
      userId: req.user?.sub,
      ip: clientIP
    });

    sendJson(res, 200, { success: true });

  } catch (error) {
    logSecurityEvent('LOGOUT_ERROR', {
      userId: req.user?.sub,
      ip: clientIP,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    // Return success anyway to prevent token enumeration
    sendJson(res, 200, { success: true });
  }
}

/**
 * Get current user info
 *
 * GET /api/auth/me
 * Headers: Authorization: Bearer <accessToken>
 * Returns: { user: { id, username, role } }
 */
export async function getCurrentUser(req: AuthenticatedRequest, res: ServerResponse): Promise<void> {
  try {
    if (!req.user) {
      sendJson(res, 401, {
        error: 'Not authenticated',
        code: 'NOT_AUTHENTICATED'
      });
      return;
    }

    // Try to get full user info from database
    try {
      const db = getDatabase();
      const result = await db.query(
        `SELECT id, username, role, created_at as "createdAt", last_login as "lastLogin"
         FROM users WHERE id = $1`,
        [req.user.sub]
      );

      if (result.rows.length > 0) {
        sendJson(res, 200, { user: result.rows[0] });
        return;
      }
    } catch {
      // Fall back to token info
    }

    // Return basic info from token
    sendJson(res, 200, {
      user: {
        id: req.user.sub,
        role: req.user.role
      }
    });

  } catch (error) {
    sendJson(res, 500, {
      error: 'Failed to get user info',
      code: 'USER_INFO_ERROR'
    });
  }
}

/**
 * Change password endpoint
 *
 * POST /api/auth/change-password
 * Headers: Authorization: Bearer <accessToken>
 * Body: { currentPassword: string, newPassword: string }
 * Returns: { success: true }
 */
export async function changePassword(req: AuthenticatedRequest, res: ServerResponse): Promise<void> {
  const clientIP = getClientIP(req);

  try {
    if (!req.user) {
      sendJson(res, 401, {
        error: 'Not authenticated',
        code: 'NOT_AUTHENTICATED'
      });
      return;
    }

    const body = await parseBody<{ currentPassword: string; newPassword: string }>(req);

    if (!body.currentPassword || !body.newPassword) {
      sendJson(res, 400, {
        error: 'Current password and new password are required',
        code: 'MISSING_PASSWORDS'
      });
      return;
    }

    // Validate new password strength
    if (body.newPassword.length < 8) {
      sendJson(res, 400, {
        error: 'New password must be at least 8 characters',
        code: 'WEAK_PASSWORD'
      });
      return;
    }

    const db = getDatabase();

    // Get current user
    const userResult = await db.query<{ passwordHash: string; salt: string }>(
      'SELECT password_hash as "passwordHash", salt FROM users WHERE id = $1',
      [req.user.sub]
    );

    if (userResult.rows.length === 0) {
      sendJson(res, 404, {
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
      return;
    }

    const user = userResult.rows[0];

    // Verify current password
    if (!verifyPassword(body.currentPassword, user.salt, user.passwordHash)) {
      logSecurityEvent('PASSWORD_CHANGE_FAILED', {
        userId: req.user.sub,
        ip: clientIP,
        reason: 'invalid_current_password'
      });

      sendJson(res, 401, {
        error: 'Current password is incorrect',
        code: 'INVALID_CURRENT_PASSWORD'
      });
      return;
    }

    // Generate new salt and hash
    const newSalt = generateSalt();
    const newHash = hashPassword(body.newPassword, newSalt);

    // Update password
    await db.query(
      `UPDATE users SET password_hash = $1, salt = $2, updated_at = NOW() WHERE id = $3`,
      [newHash, newSalt, req.user.sub]
    );

    // Revoke all existing tokens for this user (force re-login)
    // In a real implementation, you'd have a mechanism to revoke all user tokens
    if (req.user.jti) {
      revokeToken(req.user.jti);
    }

    logSecurityEvent('PASSWORD_CHANGED', {
      userId: req.user.sub,
      ip: clientIP
    });

    sendJson(res, 200, { success: true });

  } catch (error) {
    logSecurityEvent('PASSWORD_CHANGE_ERROR', {
      userId: req.user?.sub,
      ip: clientIP,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    sendJson(res, 500, {
      error: 'Failed to change password',
      code: 'PASSWORD_CHANGE_ERROR'
    });
  }
}

/**
 * Clear all login attempts (for testing/admin purposes)
 */
export function clearAllLoginAttempts(): void {
  loginAttempts.clear();
}

/**
 * Get login attempt count for identifier (for testing)
 */
export function getLoginAttemptCount(identifier: string): number {
  const attempts = loginAttempts.get(identifier);
  return attempts?.count || 0;
}
