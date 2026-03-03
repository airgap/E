import { Hono } from 'hono';
import { getDb } from '../db/database';
import { getHostname } from '../golem-names';
import type { GolemRecord } from '@e/shared';

export const golemRoutes = new Hono();

function rowToRecord(row: any): GolemRecord {
  return {
    id: row.id,
    machineId: row.machine_id,
    name: row.name,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at ?? undefined,
  };
}

/** GET /api/golem — returns the local machine's golem record */
golemRoutes.get('/', (c) => {
  const db = getDb();
  const machineId = getHostname();
  const row = db.query('SELECT * FROM golems WHERE machine_id = ?').get(machineId) as any;
  if (!row) {
    return c.json({ ok: false, error: 'Golem not found for this machine' }, 404);
  }
  return c.json({ ok: true, data: rowToRecord(row) });
});

/** PATCH /api/golem — rename the local machine's golem */
golemRoutes.patch('/', async (c) => {
  const db = getDb();
  const machineId = getHostname();
  const body = await c.req.json<{ name?: string }>();

  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ ok: false, error: 'name is required' }, 400);
  }

  const name = body.name.trim();
  const now = Date.now();
  db.query('UPDATE golems SET name = ?, last_active_at = ? WHERE machine_id = ?').run(
    name,
    now,
    machineId,
  );

  const row = db.query('SELECT * FROM golems WHERE machine_id = ?').get(machineId) as any;
  if (!row) {
    return c.json({ ok: false, error: 'Golem not found for this machine' }, 404);
  }
  return c.json({ ok: true, data: rowToRecord(row) });
});
