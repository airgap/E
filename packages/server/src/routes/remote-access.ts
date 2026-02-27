import { Hono } from 'hono';
import {
  getRemoteAccessConfig,
  updateRemoteAccessConfig,
  getTailscaleStatus,
  configureTailscale,
  stopTailscale,
  generateSSHTunnelCommand,
  getRemoteClients,
} from '../services/remote-access';

const app = new Hono();

/**
 * Get remote access configuration and status
 */
app.get('/config', (c) => {
  const config = getRemoteAccessConfig();
  const tailscaleStatus = getTailscaleStatus();
  const clients = getRemoteClients();

  const port = Number(process.env.PORT || 3002);
  const sshTunnel = generateSSHTunnelCommand(port);

  return c.json({
    ok: true,
    data: {
      config,
      tailscaleStatus,
      sshTunnel,
      activeClients: clients.length,
      remoteClients: clients.filter((c) => c.isRemote).length,
    },
  });
});

/**
 * Update remote access configuration
 */
app.patch('/config', async (c) => {
  const body = await c.req.json();
  updateRemoteAccessConfig(body);
  return c.json({ ok: true });
});

/**
 * Get Tailscale status
 */
app.get('/tailscale/status', (c) => {
  const status = getTailscaleStatus();
  return c.json({ ok: true, data: status });
});

/**
 * Configure Tailscale serve/funnel
 */
app.post('/tailscale/configure', async (c) => {
  const body = await c.req.json();
  const { funnel = false } = body;
  const port = Number(process.env.PORT || 3002);

  const result = configureTailscale(port, funnel);

  if (!result.success) {
    return c.json({ ok: false, error: result.error }, 400);
  }

  return c.json({ ok: true, data: { url: result.url } });
});

/**
 * Stop Tailscale serve/funnel
 */
app.post('/tailscale/stop', (c) => {
  const result = stopTailscale();

  if (!result.success) {
    return c.json({ ok: false, error: result.error }, 400);
  }

  return c.json({ ok: true });
});

/**
 * Get SSH tunnel command
 */
app.get('/ssh-tunnel', (c) => {
  const port = Number(process.env.PORT || 3002);
  const remoteHost = c.req.query('host');
  const tunnel = generateSSHTunnelCommand(port, remoteHost);

  return c.json({ ok: true, data: tunnel });
});

/**
 * Get active remote clients
 */
app.get('/clients', (c) => {
  const clients = getRemoteClients();
  return c.json({ ok: true, data: clients });
});

/**
 * Get allowed origins from E_ALLOWED_ORIGINS env var
 */
app.get('/allowed-origins', (c) => {
  const originsStr = process.env.E_ALLOWED_ORIGINS || '';
  const origins = originsStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return c.json({ ok: true, data: { origins } });
});

export { app as remoteAccessRoutes };
