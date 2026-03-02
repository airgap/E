import type { MiddlewareHandler } from 'hono';
import { verifyToken, isAuthEnabled } from '../services/auth';
import { isOriginRemote, registerRemoteClient } from '../services/remote-access';
import { getDb } from '../db/database';
import { nanoid } from 'nanoid';

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const path = c.req.path;

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

  if (isRemote && !remoteAccessEnabled) {
    console.error(`[auth] Rejected remote connection from ${origin} (Remote Access Disabled)`);
    return c.json({ ok: false, error: 'Forbidden: remote access is disabled' }, 403);
  }

  if (isRemote) {
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) return c.json({ ok: false, error: 'Authentication required for remote access' }, 401);

    const payload = await verifyToken(token);
    if (!payload) return c.json({ ok: false, error: 'Invalid or expired token' }, 401);

    const userAgent = c.req.header('User-Agent') || '';
    const connectionId = nanoid();
    registerRemoteClient(connectionId, origin, userAgent);

    c.set('user' as any, payload);
    c.set('isRemote' as any, true);
    c.set('remoteConnectionId' as any, connectionId);
    return next();
  }

  if (!isAuthEnabled()) {
    c.set('isRemote' as any, false);
    return next();
  }

  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) return c.json({ ok: false, error: 'Authentication required' }, 401);

  const payload = await verifyToken(token);
  if (!payload) return c.json({ ok: false, error: 'Invalid or expired token' }, 401);

  c.set('user' as any, payload);
  c.set('isRemote' as any, false);
  return next();
};

function getSetting(db: any, key: string, defaultValue: any): any {
  const row = db.query('SELECT value FROM settings WHERE key = ?').get(key) as any;
  return row ? JSON.parse(row.value) : defaultValue;
}
