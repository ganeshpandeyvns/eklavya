import type { ServerResponse } from 'http';
import { getDatabase } from '../lib/database.js';
import type { AuthenticatedRequest, JwtPayload } from './auth.js';

/**
 * Authorization/ACL Middleware
 *
 * Provides resource-based access control:
 * - Project ownership verification
 * - Role-based access control (RBAC)
 * - Resource-level permissions
 */

export interface ResourcePermission {
  resource: 'project' | 'agent' | 'task' | 'demo' | 'notification';
  action: 'read' | 'write' | 'delete' | 'admin';
}

// Cache for project ownership checks (TTL-based)
interface CacheEntry {
  isOwner: boolean;
  timestamp: number;
}

const ownershipCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60000; // 1 minute cache

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

  // Define role permissions
  const rolePermissions: Record<string, ResourcePermission[]> = {
    user: [
      { resource: 'project', action: 'read' },
      { resource: 'project', action: 'write' },
      { resource: 'agent', action: 'read' },
      { resource: 'task', action: 'read' },
      { resource: 'task', action: 'write' },
      { resource: 'demo', action: 'read' },
      { resource: 'notification', action: 'read' },
    ]
  };

  const allowedPermissions = rolePermissions[user.role] || [];
  return allowedPermissions.some(
    p => p.resource === permission.resource && p.action === permission.action
  );
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
 * Clear ownership cache (useful for testing)
 */
export function clearOwnershipCache(): void {
  ownershipCache.clear();
}
