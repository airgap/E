/**
 * Remote workspace routes (LYK-1115) — connect the local E to a remote host
 * over SSH (bootstrap headless E + tunnel). See services/remote-workspace.ts.
 */
import { Hono } from 'hono';
import {
  listHosts,
  saveHost,
  deleteHost,
  connect,
  disconnect,
  getStatus,
  type WorkspaceHost,
} from '../services/remote-workspace';

const app = new Hono();

app.get('/hosts', (c) => c.json({ ok: true, hosts: listHosts() }));

app.post('/hosts', async (c) => {
  const body = (await c.req.json()) as Partial<WorkspaceHost>;
  if (!body.hostname || !body.user) {
    return c.json({ ok: false, error: 'hostname and user are required' }, 400);
  }
  const host: WorkspaceHost = {
    id: body.id || `${body.user}@${body.hostname}`,
    label: body.label,
    hostname: body.hostname,
    port: body.port ?? 22,
    user: body.user,
    authMethod: body.authMethod ?? 'agent-forwarding',
    keyPath: body.keyPath,
  };
  return c.json({ ok: true, hosts: saveHost(host) });
});

app.delete('/hosts/:id', (c) => c.json({ ok: true, hosts: deleteHost(c.req.param('id')) }));

app.get('/status', (c) => c.json({ ok: true, session: getStatus() }));

app.post('/connect', async (c) => {
  const body = (await c.req.json()) as { id?: string; host?: WorkspaceHost };
  const host = body.host ?? listHosts().find((h) => h.id === body.id);
  if (!host) return c.json({ ok: false, error: 'unknown host' }, 404);
  try {
    const session = await connect(host);
    return c.json({ ok: true, session });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

app.post('/disconnect', async (c) => {
  await disconnect();
  return c.json({ ok: true });
});

export { app as remoteWorkspaceRoutes };
