import { Hono } from 'hono';
import { RUNTIME_FLAGS, resolveAllFlags } from '@e/shared';
import { getDb } from '../db/database';

const app = new Hono();

// ─── Remote Flag Sync (GrowthBook-style) ──────────────────────────────────
let remoteFlagEndpoint: string | null = null;
let remoteFlagPollInterval: ReturnType<typeof setInterval> | null = null;
let remoteFlagCache: Record<string, boolean> = {};

async function fetchRemoteFlags(): Promise<Record<string, boolean>> {
  if (!remoteFlagEndpoint) return {};
  try {
    const res = await fetch(remoteFlagEndpoint, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return remoteFlagCache;
    const data = (await res.json()) as any;
    // Support GrowthBook-style { features: { flagId: { defaultValue: bool } } }
    // or simple { flagId: boolean } format
    if (data.features) {
      const flags: Record<string, boolean> = {};
      for (const [key, val] of Object.entries(data.features)) {
        flags[key] = (val as any)?.defaultValue ?? (val as any)?.value ?? false;
      }
      remoteFlagCache = flags;
    } else {
      remoteFlagCache = data;
    }
    return remoteFlagCache;
  } catch {
    return remoteFlagCache;
  }
}

function startRemoteFlagPolling(endpoint: string, intervalMs = 60_000): void {
  stopRemoteFlagPolling();
  remoteFlagEndpoint = endpoint;
  fetchRemoteFlags(); // Initial fetch
  remoteFlagPollInterval = setInterval(fetchRemoteFlags, intervalMs);
}

function stopRemoteFlagPolling(): void {
  if (remoteFlagPollInterval) {
    clearInterval(remoteFlagPollInterval);
    remoteFlagPollInterval = null;
  }
  remoteFlagEndpoint = null;
  remoteFlagCache = {};
}

// Get all feature flags with their current state
app.get('/', (c) => {
  const overrides = getOverrides();
  const resolved = resolveAllFlags(overrides);
  return c.json({
    ok: true,
    flags: RUNTIME_FLAGS.map((f) => ({
      ...f,
      enabled: resolved[f.id],
      overridden: f.id in overrides,
    })),
  });
});

// Toggle a feature flag
app.post('/:id/toggle', async (c) => {
  const flagId = c.req.param('id');
  const { enabled } = await c.req.json<{ enabled: boolean }>();

  const db = getDb();
  const overrides = getOverrides();
  overrides[flagId] = enabled;

  db.query(`INSERT OR REPLACE INTO settings (key, value) VALUES ('featureFlags', ?)`).run(
    JSON.stringify(overrides),
  );

  return c.json({ ok: true, flagId, enabled });
});

// Reset a flag to its default
app.delete('/:id', (c) => {
  const flagId = c.req.param('id');
  const db = getDb();
  const overrides = getOverrides();
  delete overrides[flagId];

  db.query(`INSERT OR REPLACE INTO settings (key, value) VALUES ('featureFlags', ?)`).run(
    JSON.stringify(overrides),
  );

  return c.json({ ok: true, flagId, reset: true });
});

// Configure remote flag sync endpoint
app.post('/remote/configure', async (c) => {
  const body = await c.req.json<{ endpoint?: string; intervalMs?: number }>();
  if (body.endpoint) {
    startRemoteFlagPolling(body.endpoint, body.intervalMs || 60_000);
    return c.json({ ok: true, endpoint: body.endpoint, polling: true });
  }
  stopRemoteFlagPolling();
  return c.json({ ok: true, polling: false });
});

// Get remote flag sync status
app.get('/remote/status', (c) => {
  return c.json({
    ok: true,
    endpoint: remoteFlagEndpoint,
    polling: !!remoteFlagPollInterval,
    cachedFlags: remoteFlagCache,
  });
});

// Bulk update flags
app.post('/bulk', async (c) => {
  const body = await c.req.json<{ flags: Record<string, boolean> }>();
  const db = getDb();
  const overrides = getOverrides();
  Object.assign(overrides, body.flags);
  db.query(`INSERT OR REPLACE INTO settings (key, value) VALUES ('featureFlags', ?)`).run(
    JSON.stringify(overrides),
  );
  return c.json({ ok: true, updated: Object.keys(body.flags).length });
});

function getOverrides(): Record<string, boolean> {
  try {
    const db = getDb();
    const row = db.query("SELECT value FROM settings WHERE key = 'featureFlags'").get() as any;
    if (row?.value) {
      const local = JSON.parse(row.value);
      // Merge remote flags (local overrides take precedence)
      return { ...remoteFlagCache, ...local };
    }
  } catch {
    /* no overrides */
  }
  return { ...remoteFlagCache };
}

export const featureFlagRoutes = app;
