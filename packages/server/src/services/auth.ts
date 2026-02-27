/**
 * JWT authentication service.
 *
 * When AUTH_ENABLED=true (or a user exists in the DB), all API routes
 * require a valid JWT. Otherwise, auth is bypassed for single-user mode.
 */

import { nanoid } from 'nanoid';
import { getDb } from '../db/database';

const JWT_SECRET = process.env.JWT_SECRET || 'e-dev-secret-change-in-production';
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface JwtPayload {
  sub: string; // user ID
  username: string;
  isAdmin: boolean;
  iat: number;
  exp: number;
}

// Minimal JWT implementation using Bun's built-in crypto
function base64UrlEncode(data: string): string {
  return btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): string {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

async function hmacSign(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return base64UrlEncode(String.fromCharCode(...new Uint8Array(sig)));
}

async function hmacVerify(data: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(data);
  return expected === signature;
}

export async function createToken(
  userId: string,
  username: string,
  isAdmin: boolean,
): Promise<string> {
  const now = Date.now();
  const payload: JwtPayload = {
    sub: userId,
    username,
    isAdmin,
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + TOKEN_EXPIRY_MS) / 1000),
  };

  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = await hmacSign(`${header}.${body}`);
  return `${header}.${body}.${sig}`;
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const valid = await hmacVerify(`${parts[0]}.${parts[1]}`, parts[2]);
    if (!valid) return null;

    const payload = JSON.parse(base64UrlDecode(parts[1])) as JwtPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

export function isAuthEnabled(): boolean {
  if (process.env.AUTH_ENABLED === 'true') return true;
  if (process.env.AUTH_ENABLED === 'false') return false;
  // Auto-enable if any users exist
  try {
    const db = getDb();
    const row = db.query('SELECT COUNT(*) as count FROM users').get() as any;
    return row.count > 0;
  } catch {
    return false;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return await Bun.password.hash(password, { algorithm: 'bcrypt', cost: 10 });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await Bun.password.verify(password, hash);
}

export function registerUser(
  username: string,
  passwordHash: string,
  displayName?: string,
  isAdmin = false,
): string {
  const db = getDb();
  const id = nanoid();
  db.query(
    `INSERT INTO users (id, username, password_hash, display_name, is_admin, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, username, passwordHash, displayName || username, isAdmin ? 1 : 0, Date.now());
  return id;
}

export function getUserByUsername(username: string): any {
  const db = getDb();
  return db.query('SELECT * FROM users WHERE username = ?').get(username);
}

export function getUserById(id: string): any {
  const db = getDb();
  return db.query('SELECT * FROM users WHERE id = ?').get(id);
}

export function listUsers(): any[] {
  const db = getDb();
  return db
    .query('SELECT id, username, display_name, is_admin, created_at FROM users')
    .all() as any[];
}
