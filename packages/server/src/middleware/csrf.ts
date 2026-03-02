/**
 * CSRF protection middleware.
 */

import type { MiddlewareHandler } from 'hono';
import { nanoid } from 'nanoid';

// Generate a unique token per server process
const CSRF_TOKEN = nanoid(48);

export function getCsrfToken(): string {
  return CSRF_TOKEN;
}

const PROTECTED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_EXEMPT_PATHS = ['/api/auth/', '/health', '/api/webhooks/inbound/'];

const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/\[::1\](:\d+)?$/,
  /^tauri:\/\/localhost$/,
  /^https:\/\/tauri\.localhost$/,
  /^tauri:\/\/.*$/,
  /^https:\/\/tauri\..*$/,
];

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (origin.startsWith('tauri://') || origin.startsWith('https://tauri.localhost')) return true;
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

export { isOriginAllowed };

export const csrfMiddleware: MiddlewareHandler = async (c, next) => {
  const method = c.req.method;
  const path = c.req.path;

  // BYPASS IN DEV for localhost and Tailscale
  const origin = c.req.header('Origin') || '';
  if (
    origin.includes('localhost') ||
    origin.includes('127.0.0.1') ||
    origin.startsWith('http://100.') ||
    origin.startsWith('https://100.')
  ) {
    return next();
  }

  if (!PROTECTED_METHODS.has(method)) return next();
  if (CSRF_EXEMPT_PATHS.some((p) => path.startsWith(p)) || path === '/health') return next();

  if (origin && !isOriginAllowed(origin)) {
    console.error(`[CSRF] Rejected invalid origin: ${origin}`);
    return c.json({ ok: false, error: `Forbidden: invalid origin (${origin})` }, 403);
  }

  const token = c.req.header('X-CSRF-Token');
  if (token !== CSRF_TOKEN) {
    console.error(`[CSRF] Rejected missing or invalid token for path ${path}`);
    return c.json({ ok: false, error: 'Forbidden: invalid or missing CSRF token' }, 403);
  }

  return next();
};
