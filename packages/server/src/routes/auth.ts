import { Hono } from 'hono';
import {
  createToken,
  hashPassword,
  verifyPassword,
  registerUser,
  getUserByUsername,
  isAuthEnabled,
  listUsers,
} from '../services/auth';
import { getCsrfToken } from '../middleware/csrf';

const app = new Hono();

// Check if auth is enabled
app.get('/status', (c) => {
  return c.json({ ok: true, data: { enabled: isAuthEnabled() } });
});

// Get CSRF token — the client must include this in X-CSRF-Token header for all mutations.
// This endpoint is safe because CORS restricts which origins can read the response.
app.get('/csrf-token', (c) => {
  return c.json({ ok: true, data: { token: getCsrfToken() } });
});

// Register a new user
app.post('/register', async (c) => {
  const body = await c.req.json();
  const { username, password, displayName } = body;

  if (!username || !password) {
    return c.json({ ok: false, error: 'Username and password required' }, 400);
  }

  if (password.length < 4) {
    return c.json({ ok: false, error: 'Password must be at least 4 characters' }, 400);
  }

  const existing = getUserByUsername(username);
  if (existing) {
    return c.json({ ok: false, error: 'Username already taken' }, 409);
  }

  // First user is always admin
  const users = listUsers();
  const isFirst = users.length === 0;

  const hash = await hashPassword(password);
  const id = registerUser(username, hash, displayName, isFirst);

  const token = await createToken(id, username, isFirst);

  return c.json(
    {
      ok: true,
      data: { id, username, token, isAdmin: isFirst },
    },
    201,
  );
});

// Login
app.post('/login', async (c) => {
  const body = await c.req.json();
  const { username, password } = body;

  if (!username || !password) {
    return c.json({ ok: false, error: 'Username and password required' }, 400);
  }

  const user = getUserByUsername(username);
  if (!user) {
    return c.json({ ok: false, error: 'Invalid credentials' }, 401);
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return c.json({ ok: false, error: 'Invalid credentials' }, 401);
  }

  const token = await createToken(user.id, user.username, Boolean(user.is_admin));

  return c.json({
    ok: true,
    data: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      isAdmin: Boolean(user.is_admin),
      token,
    },
  });
});

// Get current user info (requires auth)
app.get('/me', (c) => {
  const user = (c as any).get('user');
  if (!user) return c.json({ ok: false, error: 'Not authenticated' }, 401);
  return c.json({
    ok: true,
    data: {
      id: user.sub,
      username: user.username,
      isAdmin: user.isAdmin,
    },
  });
});

// List users (admin only)
app.get('/users', (c) => {
  const user = (c as any).get('user');
  if (!user?.isAdmin) return c.json({ ok: false, error: 'Admin required' }, 403);
  return c.json({ ok: true, data: listUsers() });
});

export { app as authRoutes };
