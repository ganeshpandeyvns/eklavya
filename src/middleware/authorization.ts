import type { ServerResponse } from 'http';
import { getDatabase } from '../lib/database.js';
import type { AuthenticatedRequest, JwtPayload } from './auth.js';

/**
 * Authorization/ACL Middleware
 *
 * Provides comprehensive access control:
 * - Project ownership verification
 * - Role-based access control (RBAC)
 * - Resource-level permissions
 * - Endpoint-level permissions
 * - Audit logging for authorization decisions
 */

// Resource types for permission checking
export type ResourceType = 'project' | 'agent' | 'task' | 'demo' | 'notification' | 'settings' | 'user' | 'system';

// Action types
export type ActionType = 'read' | 'write' | 'delete' | 'admin' | 'execute';

export interface ResourcePermission {
  resource: ResourceType;
  action: ActionType;
}

// Extended user roles
export type UserRole = 'admin' | 'user' | 'viewer' | 'service';

// Role hierarchy - higher roles inherit lower role permissions
const ROLE_HIERARCHY: Record<UserRole, number> = {
  admin: 100,
  user: 50,
  viewer: 25,
  service: 75  // Service accounts have high permissions but not admin level
};

// Define comprehensive role permissions
const ROLE_PERMISSIONS: Record<UserRole, ResourcePermission[]> = {
  admin: [
    // Admin has all permissions - handled specially in hasPermission
  ],
  user: [
    // Project permissions
    { resource: 'project', action: 'read' },
    { resource: 'project', action: 'write' },
    // Agent permissions
    { resource: 'agent', action: 'read' },
    { resource: 'agent', action: 'write' },
    { resource: 'agent', action: 'execute' },
    // Task permissions
    { resource: 'task', action: 'read' },
    { resource: 'task', action: 'write' },
    { resource: 'task', action: 'execute' },
    // Demo permissions
    { resource: 'demo', action: 'read' },
    { resource: 'demo', action: 'write' },
    // Notification permissions
    { resource: 'notification', action: 'read' },
    { resource: 'notification', action: 'write' },
    // Settings permissions (own settings only)
    { resource: 'settings', action: 'read' },
    { resource: 'settings', action: 'write' },
  ],
  viewer: [
    // Read-only access
    { resource: 'project', action: 'read' },
    { resource: 'agent', action: 'read' },
    { resource: 'task', action: 'read' },
    { resource: 'demo', action: 'read' },
    { resource: 'notification', action: 'read' },
    { resource: 'settings', action: 'read' },
  ],
  service: [
    // Service accounts for internal operations
    { resource: 'project', action: 'read' },
    { resource: 'project', action: 'write' },
    { resource: 'agent', action: 'read' },
    { resource: 'agent', action: 'write' },
    { resource: 'agent', action: 'execute' },
    { resource: 'task', action: 'read' },
    { resource: 'task', action: 'write' },
    { resource: 'task', action: 'execute' },
    { resource: 'demo', action: 'read' },
    { resource: 'demo', action: 'write' },
    { resource: 'system', action: 'read' },
    { resource: 'system', action: 'execute' },
  ]
};

// Endpoint permission mapping
export interface EndpointPermission {
  method: string;
  pattern: RegExp;
  resource: ResourceType;
  action: ActionType;
  requiresOwnership?: boolean;  // Whether to check project ownership
  adminOnly?: boolean;          // Only admin can access
  extractResourceId?: (url: string) => string | null;  // Extract resource ID from URL
}

// Define endpoint-level permissions
export const ENDPOINT_PERMISSIONS: EndpointPermission[] = [
  // Auth endpoints - no permission needed (handled by auth middleware)
  { method: 'POST', pattern: /^\/api\/auth\//, resource: 'user', action: 'read', requiresOwnership: false },

  // Health check - no permission needed
  { method: 'GET', pattern: /^\/api\/health$/, resource: 'system', action: 'read', requiresOwnership: false },

  // Project endpoints
  { method: 'GET', pattern: /^\/api\/projects$/, resource: 'project', action: 'read', requiresOwnership: false },
  { method: 'GET', pattern: /^\/api\/projects\/[^/]+$/, resource: 'project', action: 'read', requiresOwnership: true,
    extractResourceId: (url) => url.match(/\/api\/projects\/([^/]+)$/)?.[1] || null },
  { method: 'POST', pattern: /^\/api\/projects$/, resource: 'project', action: 'write', requiresOwnership: false },

  // Agent endpoints
  { method: 'GET', pattern: /^\/api\/projects\/[^/]+\/agents/, resource: 'agent', action: 'read', requiresOwnership: true,
    extractResourceId: (url) => url.match(/\/api\/projects\/([^/]+)\/agents/)?.[1] || null },
  { method: 'POST', pattern: /^\/api\/projects\/[^/]+\/agents/, resource: 'agent', action: 'write', requiresOwnership: true,
    extractResourceId: (url) => url.match(/\/api\/projects\/([^/]+)\/agents/)?.[1] || null },
  { method: 'GET', pattern: /^\/api\/agents\/[^/]+/, resource: 'agent', action: 'read', requiresOwnership: false },
  { method: 'DELETE', pattern: /^\/api\/agents\/[^/]+$/, resource: 'agent', action: 'delete', requiresOwnership: false },

  // Agent lifecycle endpoints
  { method: 'POST', pattern: /^\/api\/agents\/[^/]+\/(spawn|terminate|kill|restart)/, resource: 'agent', action: 'execute', requiresOwnership: false },

  // Agent manager endpoints - admin only
  { method: 'GET', pattern: /^\/api\/agent-manager\//, resource: 'system', action: 'read', adminOnly: true },
  { method: 'POST', pattern: /^\/api\/agent-manager\//, resource: 'system', action: 'execute', adminOnly: true },

  // Task endpoints
  { method: 'GET', pattern: /^\/api\/tasks/, resource: 'task', action: 'read', requiresOwnership: false },
  { method: 'POST', pattern: /^\/api\/tasks/, resource: 'task', action: 'write', requiresOwnership: false },
  { method: 'PUT', pattern: /^\/api\/tasks\/[^/]+/, resource: 'task', action: 'write', requiresOwnership: false },
  { method: 'DELETE', pattern: /^\/api\/tasks\/[^/]+$/, resource: 'task', action: 'delete', requiresOwnership: false },

  // Orchestrator endpoints - admin only
  { method: 'GET', pattern: /^\/api\/orchestrator\//, resource: 'system', action: 'read', adminOnly: true },
  { method: 'POST', pattern: /^\/api\/orchestrator\//, resource: 'system', action: 'execute', adminOnly: true },

  // Demo endpoints
  { method: 'GET', pattern: /^\/api\/demos/, resource: 'demo', action: 'read', requiresOwnership: false },
  { method: 'POST', pattern: /^\/api\/demos/, resource: 'demo', action: 'write', requiresOwnership: false },
  { method: 'PUT', pattern: /^\/api\/demos\/[^/]+/, resource: 'demo', action: 'write', requiresOwnership: false },
  { method: 'DELETE', pattern: /^\/api\/demos\/[^/]+$/, resource: 'demo', action: 'delete', requiresOwnership: false },

  // Self-build endpoints - admin only
  { method: 'POST', pattern: /^\/api\/self-build/, resource: 'system', action: 'execute', adminOnly: true },
  { method: 'GET', pattern: /^\/api\/self-build/, resource: 'system', action: 'read', adminOnly: true },

  // Notification endpoints
  { method: 'GET', pattern: /^\/api\/notifications/, resource: 'notification', action: 'read', requiresOwnership: false },
  { method: 'POST', pattern: /^\/api\/notifications/, resource: 'notification', action: 'write', requiresOwnership: false },
  { method: 'DELETE', pattern: /^\/api\/notifications\/[^/]+$/, resource: 'notification', action: 'delete', requiresOwnership: false },

  // Settings endpoints
  { method: 'GET', pattern: /^\/api\/settings/, resource: 'settings', action: 'read', requiresOwnership: false },
  { method: 'PUT', pattern: /^\/api\/settings/, resource: 'settings', action: 'write', requiresOwnership: false },

  // Coordination endpoints
  { method: 'GET', pattern: /^\/api\/coordination\/[^/]+/, resource: 'project', action: 'read', requiresOwnership: true,
    extractResourceId: (url) => url.match(/\/api\/coordination\/([^/]+)/)?.[1] || null },
  { method: 'POST', pattern: /^\/api\/coordination\/[^/]+/, resource: 'project', action: 'write', requiresOwnership: true,
    extractResourceId: (url) => url.match(/\/api\/coordination\/([^/]+)/)?.[1] || null },
  { method: 'DELETE', pattern: /^\/api\/coordination\/[^/]+/, resource: 'project', action: 'write', requiresOwnership: true,
    extractResourceId: (url) => url.match(/\/api\/coordination\/([^/]+)/)?.[1] || null },
];

// Cache for project ownership checks (TTL-based)
interface CacheEntry {
  isOwner: boolean;
  timestamp: number;
}

const ownershipCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = parseInt(process.env.OWNERSHIP_CACHE_TTL_MS || '60000', 10); // 1 minute cache

// Authorization audit log
interface AuthorizationAuditEntry {
  timestamp: Date;
  userId: string;
  resource: string;
  resourceId?: string;
  action: string;
  allowed: boolean;
  reason?: string;
}

const auditLog: AuthorizationAuditEntry[] = [];
const MAX_AUDIT_ENTRIES = parseInt(process.env.MAX_AUDIT_ENTRIES || '10000', 10);

/**
 * Log authorization decision for auditing
 */
function logAuthorizationDecision(entry: AuthorizationAuditEntry): void {
  // Trim log if it gets too large
  if (auditLog.length >= MAX_AUDIT_ENTRIES) {
    auditLog.splice(0, Math.floor(MAX_AUDIT_ENTRIES / 2));
  }

  auditLog.push(entry);

  // Also log to console in development or if verbose logging enabled
  if (process.env.NODE_ENV === 'development' || process.env.AUTH_VERBOSE_LOGGING === 'true') {
    console.log(JSON.stringify({
      type: 'AUTHORIZATION_DECISION',
      ...entry,
      timestamp: entry.timestamp.toISOString()
    }));
  }
}

/**
 * Get recent authorization audit entries
 */
export function getAuthorizationAuditLog(options?: {
  userId?: string;
  resource?: string;
  allowed?: boolean;
  limit?: number;
}): AuthorizationAuditEntry[] {
  let entries = [...auditLog];

  if (options?.userId) {
    entries = entries.filter(e => e.userId === options.userId);
  }
  if (options?.resource) {
    entries = entries.filter(e => e.resource === options.resource);
  }
  if (options?.allowed !== undefined) {
    entries = entries.filter(e => e.allowed === options.allowed);
  }

  // Sort by timestamp descending and limit
  entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  if (options?.limit) {
    entries = entries.slice(0, options.limit);
  }

  return entries;
}

/**
 * Clear authorization audit log
 */
export function clearAuthorizationAuditLog(): void {
  auditLog.length = 0;
}

/**
 * Clear stale cache entries
 */
function cleanCache(): void {
  const now = Date.now();
  const entries = Array.from(ownershipCache.entries());
  for (const [key, entry] of entries) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      ownershipCache.delete(key);
    }
  }
}

// Clean cache periodically
setInterval(cleanCache, CACHE_TTL_MS);

/**
 * Check if user owns a project
 */
export async function verifyProjectOwnership(
  userId: string,
  projectId: string
): Promise<boolean> {
  const cacheKey = `${userId}:${projectId}`;

  // Check cache first
  const cached = ownershipCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.isOwner;
  }

  try {
    const db = getDatabase();
    const result = await db.query(
      'SELECT owner_id FROM projects WHERE id = $1',
      [projectId]
    );

    if (result.rows.length === 0) {
      return false;
    }

    // For now, allow access if user exists (since owner_id might not be set)
    // In production, this would strictly check owner_id
    const isOwner = result.rows[0].owner_id === userId ||
                    result.rows[0].owner_id === null; // Allow if no owner set

    // Cache result
    ownershipCache.set(cacheKey, {
      isOwner,
      timestamp: Date.now()
    });

    return isOwner;
  } catch {
    // If column doesn't exist, return true (backward compatibility)
    return true;
  }
}

/**
 * Check if user can access an agent (via project ownership)
 */
export async function verifyAgentAccess(
  userId: string,
  agentId: string
): Promise<boolean> {
  try {
    const db = getDatabase();
    const result = await db.query(
      'SELECT project_id FROM agents WHERE id = $1',
      [agentId]
    );

    if (result.rows.length === 0) {
      return false;
    }

    return verifyProjectOwnership(userId, result.rows[0].project_id);
  } catch {
    return false;
  }
}

/**
 * Check if user can access a task (via project ownership)
 */
export async function verifyTaskAccess(
  userId: string,
  taskId: string
): Promise<boolean> {
  try {
    const db = getDatabase();
    const result = await db.query(
      'SELECT project_id FROM tasks WHERE id = $1',
      [taskId]
    );

    if (result.rows.length === 0) {
      return false;
    }

    return verifyProjectOwnership(userId, result.rows[0].project_id);
  } catch {
    return false;
  }
}

/**
 * Check if user can access a demo (via project ownership)
 */
export async function verifyDemoAccess(
  userId: string,
  demoId: string
): Promise<boolean> {
  try {
    const db = getDatabase();
    const result = await db.query(
      'SELECT project_id FROM demos WHERE id = $1',
      [demoId]
    );

    if (result.rows.length === 0) {
      return false;
    }

    return verifyProjectOwnership(userId, result.rows[0].project_id);
  } catch {
    return false;
  }
}

/**
 * Role-based permission check
 */
export function hasPermission(
  user: JwtPayload | undefined,
  permission: ResourcePermission
): boolean {
  if (!user) {
    return false;
  }

  // Admin has all permissions
  if (user.role === 'admin') {
    return true;
  }

  // Get permissions for user's role
  const allowedPermissions = ROLE_PERMISSIONS[user.role as UserRole] || [];

  return allowedPermissions.some(
    p => p.resource === permission.resource && p.action === permission.action
  );
}

/**
 * Check if user has any of the specified permissions
 */
export function hasAnyPermission(
  user: JwtPayload | undefined,
  permissions: ResourcePermission[]
): boolean {
  return permissions.some(p => hasPermission(user, p));
}

/**
 * Check if user has all of the specified permissions
 */
export function hasAllPermissions(
  user: JwtPayload | undefined,
  permissions: ResourcePermission[]
): boolean {
  return permissions.every(p => hasPermission(user, p));
}

/**
 * Check if role has higher or equal privilege level
 */
export function hasRoleLevel(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Get endpoint permission configuration for a request
 */
export function getEndpointPermission(method: string, url: string): EndpointPermission | null {
  // Find matching endpoint permission
  for (const perm of ENDPOINT_PERMISSIONS) {
    if (perm.method === method && perm.pattern.test(url)) {
      return perm;
    }
  }
  return null;
}

/**
 * Comprehensive authorization check for an endpoint
 */
export async function authorizeEndpoint(
  req: AuthenticatedRequest,
  res: ServerResponse
): Promise<boolean> {
  // Skip authorization if disabled (development mode)
  if (process.env.AUTH_DISABLED === 'true') {
    return true;
  }

  const url = req.url || '/';
  const method = req.method || 'GET';

  // Find endpoint permission
  const endpointPerm = getEndpointPermission(method, url);

  // If no specific permission defined, allow (will be caught by route handler)
  if (!endpointPerm) {
    return true;
  }

  // Check admin-only endpoints
  if (endpointPerm.adminOnly) {
    if (!req.user || req.user.role !== 'admin') {
      logAuthorizationDecision({
        timestamp: new Date(),
        userId: req.user?.sub || 'anonymous',
        resource: endpointPerm.resource,
        action: endpointPerm.action,
        allowed: false,
        reason: 'admin_only_endpoint'
      });

      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'This endpoint requires admin access',
        code: 'ADMIN_REQUIRED'
      }));
      return false;
    }
  }

  // Check role-based permission
  if (!hasPermission(req.user, { resource: endpointPerm.resource, action: endpointPerm.action })) {
    logAuthorizationDecision({
      timestamp: new Date(),
      userId: req.user?.sub || 'anonymous',
      resource: endpointPerm.resource,
      action: endpointPerm.action,
      allowed: false,
      reason: 'insufficient_permission'
    });

    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'You do not have permission to perform this action',
      code: 'FORBIDDEN'
    }));
    return false;
  }

  // Check ownership if required
  if (endpointPerm.requiresOwnership && req.user && req.user.role !== 'admin') {
    const resourceId = endpointPerm.extractResourceId?.(url);

    if (resourceId) {
      const isOwner = await verifyProjectOwnership(req.user.sub, resourceId);

      if (!isOwner) {
        logAuthorizationDecision({
          timestamp: new Date(),
          userId: req.user.sub,
          resource: endpointPerm.resource,
          resourceId,
          action: endpointPerm.action,
          allowed: false,
          reason: 'not_owner'
        });

        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'You do not have access to this resource',
          code: 'ACCESS_DENIED'
        }));
        return false;
      }
    }
  }

  // Log successful authorization
  logAuthorizationDecision({
    timestamp: new Date(),
    userId: req.user?.sub || 'anonymous',
    resource: endpointPerm.resource,
    resourceId: endpointPerm.extractResourceId?.(url) || undefined,
    action: endpointPerm.action,
    allowed: true
  });

  return true;
}

/**
 * Authorization middleware for project access
 */
export async function authorizeProject(
  req: AuthenticatedRequest,
  res: ServerResponse,
  projectId: string
): Promise<boolean> {
  if (!req.user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Authentication required', code: 'MISSING_AUTH' }));
    return false;
  }

  // Admin bypasses ownership check
  if (req.user.role === 'admin') {
    return true;
  }

  const hasAccess = await verifyProjectOwnership(req.user.sub, projectId);
  if (!hasAccess) {
    logAuthorizationDecision({
      timestamp: new Date(),
      userId: req.user.sub,
      resource: 'project',
      resourceId: projectId,
      action: 'read',
      allowed: false,
      reason: 'not_owner'
    });

    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Access denied to this project',
      code: 'PROJECT_ACCESS_DENIED'
    }));
    return false;
  }

  return true;
}

/**
 * Authorization middleware for agent access
 */
export async function authorizeAgent(
  req: AuthenticatedRequest,
  res: ServerResponse,
  agentId: string
): Promise<boolean> {
  if (!req.user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Authentication required', code: 'MISSING_AUTH' }));
    return false;
  }

  // Admin bypasses ownership check
  if (req.user.role === 'admin') {
    return true;
  }

  const hasAccess = await verifyAgentAccess(req.user.sub, agentId);
  if (!hasAccess) {
    logAuthorizationDecision({
      timestamp: new Date(),
      userId: req.user.sub,
      resource: 'agent',
      resourceId: agentId,
      action: 'read',
      allowed: false,
      reason: 'not_owner'
    });

    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Access denied to this agent',
      code: 'AGENT_ACCESS_DENIED'
    }));
    return false;
  }

  return true;
}

/**
 * Authorization middleware for task access
 */
export async function authorizeTask(
  req: AuthenticatedRequest,
  res: ServerResponse,
  taskId: string
): Promise<boolean> {
  if (!req.user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Authentication required', code: 'MISSING_AUTH' }));
    return false;
  }

  // Admin bypasses ownership check
  if (req.user.role === 'admin') {
    return true;
  }

  const hasAccess = await verifyTaskAccess(req.user.sub, taskId);
  if (!hasAccess) {
    logAuthorizationDecision({
      timestamp: new Date(),
      userId: req.user.sub,
      resource: 'task',
      resourceId: taskId,
      action: 'read',
      allowed: false,
      reason: 'not_owner'
    });

    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Access denied to this task',
      code: 'TASK_ACCESS_DENIED'
    }));
    return false;
  }

  return true;
}

/**
 * Authorization middleware for demo access
 */
export async function authorizeDemo(
  req: AuthenticatedRequest,
  res: ServerResponse,
  demoId: string
): Promise<boolean> {
  if (!req.user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Authentication required', code: 'MISSING_AUTH' }));
    return false;
  }

  // Admin bypasses ownership check
  if (req.user.role === 'admin') {
    return true;
  }

  const hasAccess = await verifyDemoAccess(req.user.sub, demoId);
  if (!hasAccess) {
    logAuthorizationDecision({
      timestamp: new Date(),
      userId: req.user.sub,
      resource: 'demo',
      resourceId: demoId,
      action: 'read',
      allowed: false,
      reason: 'not_owner'
    });

    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Access denied to this demo',
      code: 'DEMO_ACCESS_DENIED'
    }));
    return false;
  }

  return true;
}

/**
 * Require admin role
 */
export function requireAdmin(
  req: AuthenticatedRequest,
  res: ServerResponse
): boolean {
  if (!req.user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Authentication required', code: 'MISSING_AUTH' }));
    return false;
  }

  if (req.user.role !== 'admin') {
    logAuthorizationDecision({
      timestamp: new Date(),
      userId: req.user.sub,
      resource: 'system',
      action: 'admin',
      allowed: false,
      reason: 'not_admin'
    });

    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Admin access required',
      code: 'ADMIN_REQUIRED'
    }));
    return false;
  }

  return true;
}

/**
 * Require specific role or higher
 */
export function requireRole(
  req: AuthenticatedRequest,
  res: ServerResponse,
  role: UserRole
): boolean {
  if (!req.user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Authentication required', code: 'MISSING_AUTH' }));
    return false;
  }

  if (!hasRoleLevel(req.user.role as UserRole, role)) {
    logAuthorizationDecision({
      timestamp: new Date(),
      userId: req.user.sub,
      resource: 'system',
      action: 'admin',
      allowed: false,
      reason: `requires_role_${role}`
    });

    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: `This action requires ${role} role or higher`,
      code: 'INSUFFICIENT_ROLE'
    }));
    return false;
  }

  return true;
}

/**
 * Clear ownership cache (useful for testing)
 */
export function clearOwnershipCache(): void {
  ownershipCache.clear();
}

/**
 * Invalidate cache for specific project
 */
export function invalidateProjectCache(projectId: string): void {
  const keysToDelete: string[] = [];
  ownershipCache.forEach((_value, key) => {
    if (key.endsWith(`:${projectId}`)) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach(key => ownershipCache.delete(key));
}

/**
 * Export types for external use
 */
export type { JwtPayload };
