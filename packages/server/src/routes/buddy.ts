import { Hono } from 'hono';
import { buddyManager } from '../services/buddy-manager';
import { getHostname } from '../golem-names';
import { BUDDY_SPECIES } from '@e/shared';

const app = new Hono();

// Get or create buddy
app.get('/', (c) => {
  const state = buddyManager.getOrCreate(getHostname());
  const species = BUDDY_SPECIES.find((s) => s.id === state.speciesId);
  return c.json({ ok: true, buddy: state, species });
});

// Interact with buddy
app.post('/interact', async (c) => {
  const { type } = await c.req.json<{ type: 'pat' | 'feed' | 'play' }>();
  const state = buddyManager.interact(type);
  if (!state) return c.json({ ok: false, error: 'No buddy exists' }, 404);
  return c.json({ ok: true, buddy: state });
});

// React to event
app.post('/react', async (c) => {
  const { event } = await c.req.json<{
    event: 'build_success' | 'test_pass' | 'test_fail' | 'error' | 'deploy' | 'idle';
  }>();
  buddyManager.reactToEvent(event);
  return c.json({ ok: true, buddy: buddyManager.getState() });
});

// Get species catalog
app.get('/species', (c) => {
  return c.json({ ok: true, species: BUDDY_SPECIES });
});

// Tick (called periodically by client or server timer)
app.post('/tick', (c) => {
  buddyManager.tick();
  return c.json({ ok: true, buddy: buddyManager.getState() });
});

export const buddyRoutes = app;
