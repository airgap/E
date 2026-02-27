import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { createTestDb } from '../../test-helpers';
import { Database } from 'bun:sqlite';

// Create test DB and add users table (not included in base test-helpers schema)
const testDb = createTestDb();
testDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )
`);

mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

import {
  createToken,
  verifyToken,
  hashPassword,
  verifyPassword,
  isAuthEnabled,
  registerUser,
  getUserByUsername,
  getUserById,
  listUsers,
} from '../auth';

function clearUsers() {
  testDb.exec('DELETE FROM users');
}

describe('createToken / verifyToken', () => {
  test('creates a valid JWT that can be verified', async () => {
    const token = await createToken('user-123', 'alice', false);
    expect(typeof token).toBe('string');

    const parts = token.split('.');
    expect(parts).toHaveLength(3);

    const payload = await verifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe('user-123');
    expect(payload!.username).toBe('alice');
    expect(payload!.isAdmin).toBe(false);
  });

  test('creates token with admin flag', async () => {
    const token = await createToken('admin-1', 'admin', true);
    const payload = await verifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.isAdmin).toBe(true);
  });

  test('token has correct iat and exp fields', async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await createToken('user-1', 'bob', false);
    const after = Math.floor(Date.now() / 1000);

    const payload = await verifyToken(token);
    expect(payload).not.toBeNull();

    // iat should be within the time window
    expect(payload!.iat).toBeGreaterThanOrEqual(before);
    expect(payload!.iat).toBeLessThanOrEqual(after);

    // exp should be ~7 days from now
    const sevenDays = 7 * 24 * 60 * 60;
    expect(payload!.exp).toBeGreaterThanOrEqual(before + sevenDays - 1);
    expect(payload!.exp).toBeLessThanOrEqual(after + sevenDays + 1);
  });

  test('returns null for malformed token (wrong number of parts)', async () => {
    const result = await verifyToken('only.two');
    expect(result).toBeNull();
  });

  test('returns null for empty string', async () => {
    const result = await verifyToken('');
    expect(result).toBeNull();
  });

  test('returns null for tampered payload', async () => {
    const token = await createToken('user-1', 'alice', false);
    const parts = token.split('.');
    // Tamper with the payload
    parts[1] = btoa(
      JSON.stringify({ sub: 'hacker', username: 'evil', isAdmin: true, iat: 0, exp: 999999999999 }),
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const tampered = parts.join('.');

    const result = await verifyToken(tampered);
    expect(result).toBeNull();
  });

  test('returns null for tampered signature', async () => {
    const token = await createToken('user-1', 'alice', false);
    const parts = token.split('.');
    parts[2] = 'invalid-signature';
    const tampered = parts.join('.');

    const result = await verifyToken(tampered);
    expect(result).toBeNull();
  });

  test('returns null for completely garbage input', async () => {
    const result = await verifyToken('garbage.garbage.garbage');
    expect(result).toBeNull();
  });

  test('different users get different tokens', async () => {
    const token1 = await createToken('user-1', 'alice', false);
    const token2 = await createToken('user-2', 'bob', false);
    expect(token1).not.toBe(token2);
  });
});

describe('hashPassword / verifyPassword', () => {
  test('hashes a password and verifies it successfully', async () => {
    const hash = await hashPassword('mySecret123');
    expect(typeof hash).toBe('string');
    expect(hash).not.toBe('mySecret123');

    const valid = await verifyPassword('mySecret123', hash);
    expect(valid).toBe(true);
  });

  test('rejects wrong password', async () => {
    const hash = await hashPassword('correctPassword');
    const valid = await verifyPassword('wrongPassword', hash);
    expect(valid).toBe(false);
  });

  test('produces different hashes for same password (salted)', async () => {
    const hash1 = await hashPassword('samePassword');
    const hash2 = await hashPassword('samePassword');
    expect(hash1).not.toBe(hash2);
  });

  test('hash looks like bcrypt output', async () => {
    const hash = await hashPassword('test');
    // bcrypt hashes start with $2b$ or $2a$
    expect(hash).toMatch(/^\$2[ab]\$/);
  });

  test('empty password throws', async () => {
    expect(hashPassword('')).rejects.toThrow();
  });

  test('long password can be hashed and verified', async () => {
    const longPw = 'a'.repeat(200);
    const hash = await hashPassword(longPw);
    const valid = await verifyPassword(longPw, hash);
    expect(valid).toBe(true);
  });
});

describe('isAuthEnabled', () => {
  beforeEach(() => {
    clearUsers();
    delete process.env.AUTH_ENABLED;
  });

  test('returns true when AUTH_ENABLED=true', () => {
    process.env.AUTH_ENABLED = 'true';
    expect(isAuthEnabled()).toBe(true);
  });

  test('returns false when AUTH_ENABLED=false', () => {
    process.env.AUTH_ENABLED = 'false';
    expect(isAuthEnabled()).toBe(false);
  });

  test('returns false when no users exist and no env var', () => {
    expect(isAuthEnabled()).toBe(false);
  });

  test('returns true when users exist in DB (auto-enable)', () => {
    testDb
      .query(
        'INSERT INTO users (id, username, password_hash, display_name, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('u1', 'alice', 'hash', 'Alice', 0, Date.now());

    expect(isAuthEnabled()).toBe(true);
  });

  test('AUTH_ENABLED=false overrides users in DB', () => {
    testDb
      .query(
        'INSERT INTO users (id, username, password_hash, display_name, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('u2', 'bob', 'hash', 'Bob', 0, Date.now());
    process.env.AUTH_ENABLED = 'false';

    expect(isAuthEnabled()).toBe(false);
  });

  test('AUTH_ENABLED=true works even with no users', () => {
    process.env.AUTH_ENABLED = 'true';
    expect(isAuthEnabled()).toBe(true);
  });
});

describe('registerUser', () => {
  beforeEach(() => {
    clearUsers();
  });

  test('registers a user and returns an id', () => {
    const id = registerUser('alice', 'hashed-pw', 'Alice', false);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  test('registered user is stored in the database', () => {
    const id = registerUser('bob', 'bob-hash', 'Bob', false);
    const row = testDb.query('SELECT * FROM users WHERE id = ?').get(id) as any;
    expect(row).toBeTruthy();
    expect(row.username).toBe('bob');
    expect(row.password_hash).toBe('bob-hash');
    expect(row.display_name).toBe('Bob');
    expect(row.is_admin).toBe(0);
    expect(row.created_at).toBeGreaterThan(0);
  });

  test('registers an admin user', () => {
    const id = registerUser('admin', 'admin-hash', 'Admin', true);
    const row = testDb.query('SELECT * FROM users WHERE id = ?').get(id) as any;
    expect(row.is_admin).toBe(1);
  });

  test('uses username as display_name when not provided', () => {
    const id = registerUser('charlie', 'charlie-hash');
    const row = testDb.query('SELECT * FROM users WHERE id = ?').get(id) as any;
    expect(row.display_name).toBe('charlie');
  });

  test('defaults to non-admin', () => {
    const id = registerUser('dave', 'dave-hash', 'Dave');
    const row = testDb.query('SELECT * FROM users WHERE id = ?').get(id) as any;
    expect(row.is_admin).toBe(0);
  });

  test('each registration generates a unique id', () => {
    const id1 = registerUser('user1', 'hash1', 'User 1');
    const id2 = registerUser('user2', 'hash2', 'User 2');
    expect(id1).not.toBe(id2);
  });

  test('throws on duplicate username', () => {
    registerUser('unique', 'hash1', 'User');
    expect(() => registerUser('unique', 'hash2', 'Other User')).toThrow();
  });
});

describe('getUserByUsername', () => {
  beforeEach(() => {
    clearUsers();
  });

  test('returns user when found', () => {
    registerUser('alice', 'alice-hash', 'Alice', true);
    const user = getUserByUsername('alice');
    expect(user).toBeTruthy();
    expect(user.username).toBe('alice');
    expect(user.password_hash).toBe('alice-hash');
    expect(user.display_name).toBe('Alice');
    expect(user.is_admin).toBe(1);
  });

  test('returns undefined/null when user not found', () => {
    const user = getUserByUsername('nonexistent');
    expect(user).toBeFalsy();
  });

  test('finds correct user among multiple', () => {
    registerUser('alice', 'hash-a', 'Alice');
    registerUser('bob', 'hash-b', 'Bob');
    registerUser('charlie', 'hash-c', 'Charlie');

    const user = getUserByUsername('bob');
    expect(user.username).toBe('bob');
    expect(user.display_name).toBe('Bob');
  });
});

describe('getUserById', () => {
  beforeEach(() => {
    clearUsers();
  });

  test('returns user by id', () => {
    const id = registerUser('alice', 'alice-hash', 'Alice');
    const user = getUserById(id);
    expect(user).toBeTruthy();
    expect(user.id).toBe(id);
    expect(user.username).toBe('alice');
  });

  test('returns undefined/null for unknown id', () => {
    const user = getUserById('nonexistent-id');
    expect(user).toBeFalsy();
  });

  test('returns correct user among multiple', () => {
    const id1 = registerUser('alice', 'hash-a', 'Alice');
    const id2 = registerUser('bob', 'hash-b', 'Bob');

    const user = getUserById(id2);
    expect(user.username).toBe('bob');
    expect(user.id).toBe(id2);
  });
});

describe('listUsers', () => {
  beforeEach(() => {
    clearUsers();
  });

  test('returns empty array when no users', () => {
    const users = listUsers();
    expect(users).toEqual([]);
  });

  test('returns all registered users', () => {
    registerUser('alice', 'hash-a', 'Alice');
    registerUser('bob', 'hash-b', 'Bob');
    registerUser('charlie', 'hash-c', 'Charlie');

    const users = listUsers();
    expect(users).toHaveLength(3);
    const usernames = users.map((u: any) => u.username);
    expect(usernames).toContain('alice');
    expect(usernames).toContain('bob');
    expect(usernames).toContain('charlie');
  });

  test('does not return password_hash in list', () => {
    registerUser('alice', 'secret-hash', 'Alice');

    const users = listUsers();
    expect(users).toHaveLength(1);
    // The listUsers query only selects specific columns, no password_hash
    expect(users[0]).not.toHaveProperty('password_hash');
  });

  test('returns correct fields for each user', () => {
    registerUser('admin', 'hash', 'Admin User', true);

    const users = listUsers();
    expect(users).toHaveLength(1);
    const user = users[0] as any;
    expect(user.id).toBeDefined();
    expect(user.username).toBe('admin');
    expect(user.display_name).toBe('Admin User');
    expect(user.is_admin).toBe(1);
    expect(user.created_at).toBeGreaterThan(0);
  });
});
