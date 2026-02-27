import { Hono } from 'hono';
import { isOriginRemote } from '../services/remote-access';

const app = new Hono();

/**
 * Get current session information including remote status
 */
app.get('/', (c) => {
  const origin = c.req.header('Origin') || '';
  const isRemote = isOriginRemote(origin);
  const userAgent = c.req.header('User-Agent') || '';

  return c.json({
    ok: true,
    data: {
      origin,
      isRemote,
      userAgent,
      timestamp: Date.now(),
    },
  });
});

export { app as sessionInfoRoutes };
