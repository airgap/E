/**
 * CSRF protection middleware.
 *
 * Defense-in-depth against cross-origin attacks (CVE-2026-25253 class).
 *
 * Strategy:
 * 1. Generate a random CSRF token at server startup
 * 2. Expose it via GET /api/auth/csrf-token (safe — only reachable from allowed origins due to CORS)
 * 3. Require it as X-CSRF-Token header on all state-changing requests (POST/PUT/PATCH/DELETE)
 * 4. Also validate the Origin header on mutations — must be a known origin or absent (same-origin)
 */

import type { MiddlewareHandler } from 'hono';
import { nanoid } from 'nanoid';

// Generate a unique token per server process
const CSRF_TOKEN = nanoid(48);

/** Return the current CSRF token (called from an auth route). */
export function getCsrfToken(): string {
  return CSRF_TOKEN;
}

/** Set of HTTP methods that are state-changing and require CSRF protection. */
const PROTECTED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Paths that are exempt from CSRF checks (webhooks, auth bootstrap). */
const CSRF_EXEMPT_PATHS = ['/api/auth/', '/health', '/api/webhooks/inbound/'];

/** Allowed origin patterns for mutation requests. */
const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/\[::1\](:\d+)?$/,
  // Private network IPs (LAN access from mobile devices, etc.)
  /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  // Tailscale CGNAT range (100.64.0.0/10)
  /^https?:\/\/100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^tauri:\/\/localhost$/,
  /^https:\/\/tauri\.localhost$/,
];

function isOriginAllowed(origin: string | undefined): boolean {
  // Same-origin requests (no Origin header) are allowed
  if (!origin) return true;
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

/** Exported for reuse by CORS middleware */
export { isOriginAllowed };

/**
 * CSRF middleware — validates token and origin on state-changing requests.
 * In single-user mode this is the primary defense against cross-origin attacks.
 */
export const csrfMiddleware: MiddlewareHandler = async (c, next) => {
  const method = c.req.method;
  const path = c.req.path;

  // Only protect state-changing methods
  if (!PROTECTED_METHODS.has(method)) {
    return next();
  }

  // Skip exempt paths
  if (CSRF_EXEMPT_PATHS.some((p) => path.startsWith(p)) || path === '/health') {
    return next();
  }

  // 1. Validate Origin header — must be from a known source
  const origin = c.req.header('Origin');
  if (origin && !isOriginAllowed(origin)) {
    return c.json({ ok: false, error: 'Forbidden: invalid origin' }, 403);
  }

  // 2. Validate CSRF token
  const token = c.req.header('X-CSRF-Token');
  if (token !== CSRF_TOKEN) {
    return c.json({ ok: false, error: 'Forbidden: invalid or missing CSRF token' }, 403);
  }

  return next();
};
