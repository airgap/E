/**
 * Notification Channels API Routes
 */

import { Hono } from 'hono';
import {
  listNotificationChannels,
  getNotificationChannel,
  createNotificationChannel,
  updateNotificationChannel,
  deleteNotificationChannel,
  getWorkspaceNotificationPreferences,
  updateWorkspaceNotificationPreferences,
  sendNotification,
  testNotificationChannel,
  getNotificationLogs,
} from '../services/notification-channels.js';
import type {
  NotificationChannelCreateInput,
  NotificationChannelUpdateInput,
  NotificationSendInput,
  WorkspaceNotificationPreferences,
} from '@e/shared';

const app = new Hono();

// List all notification channels
app.get('/', (c) => {
  const channels = listNotificationChannels();
  return c.json({ ok: true, data: channels });
});

// Get a specific notification channel
app.get('/:id', (c) => {
  const id = c.req.param('id');
  const channel = getNotificationChannel(id);

  if (!channel) {
    return c.json({ ok: false, error: 'Channel not found' }, 404);
  }

  return c.json({ ok: true, data: channel });
});

// Create a new notification channel
app.post('/', async (c) => {
  const body = (await c.req.json()) as NotificationChannelCreateInput;

  if (!body.name || !body.type || !body.config) {
    return c.json({ ok: false, error: 'name, type, and config are required' }, 400);
  }

  const channel = createNotificationChannel(body.name, body.type, body.config);
  return c.json({ ok: true, data: channel });
});

// Update a notification channel
app.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json()) as NotificationChannelUpdateInput;

  const existing = getNotificationChannel(id);
  if (!existing) {
    return c.json({ ok: false, error: 'Channel not found' }, 404);
  }

  updateNotificationChannel(id, body);

  const updated = getNotificationChannel(id);
  return c.json({ ok: true, data: updated });
});

// Delete a notification channel
app.delete('/:id', (c) => {
  const id = c.req.param('id');

  const existing = getNotificationChannel(id);
  if (!existing) {
    return c.json({ ok: false, error: 'Channel not found' }, 404);
  }

  deleteNotificationChannel(id);
  return c.json({ ok: true });
});

// Test a notification channel configuration
app.post('/test', async (c) => {
  const body = await c.req.json();
  const { config, type } = body;

  if (!config || !type) {
    return c.json({ ok: false, error: 'config and type are required' }, 400);
  }

  const result = await testNotificationChannel(config, type);
  return c.json({ ok: true, data: result });
});

// Send a notification
app.post('/send', async (c) => {
  const body = (await c.req.json()) as NotificationSendInput;

  if (!body.event || !body.title || !body.message) {
    return c.json({ ok: false, error: 'event, title, and message are required' }, 400);
  }

  try {
    await sendNotification(body);
    return c.json({ ok: true });
  } catch (error: any) {
    return c.json({ ok: false, error: error.message }, 500);
  }
});

// Get workspace notification preferences
app.get('/workspace/:workspaceId/preferences', (c) => {
  const workspaceId = c.req.param('workspaceId');
  const prefs = getWorkspaceNotificationPreferences(workspaceId);
  return c.json({ ok: true, data: prefs });
});

// Update workspace notification preferences
app.put('/workspace/:workspaceId/preferences', async (c) => {
  const workspaceId = c.req.param('workspaceId');
  const body = (await c.req.json()) as Partial<WorkspaceNotificationPreferences>;

  const prefs: WorkspaceNotificationPreferences = {
    workspaceId,
    enabledEvents: body.enabledEvents || [],
    enabledChannels: body.enabledChannels || [],
    updatedAt: Date.now(),
  };

  updateWorkspaceNotificationPreferences(prefs);
  return c.json({ ok: true, data: prefs });
});

// Get notification delivery logs
app.get('/logs', (c) => {
  const limit = parseInt(c.req.query('limit') || '50');
  const logs = getNotificationLogs(limit);
  return c.json({ ok: true, data: logs });
});

export { app as notificationChannelsRoutes };
