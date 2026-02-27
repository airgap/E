import type { MiddlewareHandler } from 'hono';
import { verifyToken, isAuthEnabled } from '../services/auth';
import { isOriginRemote, registerRemoteClient } from '../services/remote-access';
import { getDb } from '../db/database';
import { nanoid } from 'nanoid';

/**
 * Auth middleware — checks JWT token from Authorization header.
 * When auth is not enabled (no users exist), passes through for local connections.
 * Remote connections ALWAYS require authentication, even in single-user mode.
 * Skips auth for /auth/* routes and /health.
 */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const path = c.req.path;

  // Always skip auth for these paths (inbound webhooks use their own token auth)
  if (
    path === '/health' ||
    path.startsWith('/api/auth/') ||
    path === '/api/auth' ||
    path.startsWith('/api/webhooks/inbound/')
  ) {
    return next();
  }

  const origin = c.req.header('Origin') || '';
  const isRemote = isOriginRemote(origin);

  // Check if remote access is enabled
  const db = getDb();
  const remoteAccessEnabled = getSetting(db, 'remoteAccessEnabled', true);

  // Block remote connections if remote access is disabled
  if (isRemote && !remoteAccessEnabled) {
    return c.json({ ok: false, error: 'Remote access is disabled' }, 403);
  }

  // Remote connections ALWAYS require authentication
  if (isRemote) {
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return c.json({ ok: false, error: 'Authentication required for remote access' }, 401);
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return c.json({ ok: false, error: 'Invalid or expired token' }, 401);
    }

    // Track remote connection
    const userAgent = c.req.header('User-Agent') || '';
    const connectionId = nanoid();
    registerRemoteClient(connectionId, origin, userAgent);

    // Attach user info, remote flag, and connection ID to context
    c.set('user' as any, payload);
    c.set('isRemote' as any, true);
    c.set('remoteConnectionId' as any, connectionId);
    return next();
  }

  // Local connections: use standard auth behavior
  if (!isAuthEnabled()) {
    c.set('isRemote' as any, false);
    return next();
  }

  // Extract token from Authorization header
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return c.json({ ok: false, error: 'Authentication required' }, 401);
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return c.json({ ok: false, error: 'Invalid or expired token' }, 401);
  }

  // Attach user info to context
  c.set('user' as any, payload);
  c.set('isRemote' as any, false);
  return next();
};

function getSetting(db: any, key: string, defaultValue: any): any {
  const row = db.query('SELECT value FROM settings WHERE key = ?').get(key) as any;
  return row ? JSON.parse(row.value) : defaultValue;
}
