import { Hono } from 'hono';
import {
  getFileTypeRegistrationStatus,
  registerFileTypes,
  unregisterFileTypes,
} from '../file-associations/registrar';

// CSRF + auth are enforced globally on /api/* (see index.ts middleware), so
// the mutating endpoints below don't need per-route guards.
export const fileAssociationRoutes = new Hono();

/** GET /api/file-associations — current OS registration status. */
fileAssociationRoutes.get('/', async (c) => {
  const status = await getFileTypeRegistrationStatus();
  return c.json(status);
});

/** POST /api/file-associations/register — register E as a handler for code file types. */
fileAssociationRoutes.post('/register', async (c) => {
  const result = await registerFileTypes();
  return c.json(result, result.ok ? 200 : 400);
});

/** POST /api/file-associations/unregister — remove E's file-type associations. */
fileAssociationRoutes.post('/unregister', async (c) => {
  const result = await unregisterFileTypes();
  return c.json(result, result.ok ? 200 : 400);
});
