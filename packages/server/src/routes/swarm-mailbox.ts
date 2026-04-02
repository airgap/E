/**
 * Swarm Coordinator Mailbox Routes
 */

import { Hono } from 'hono';
import { swarmMailbox } from '../services/swarm-mailbox';

export const swarmMailboxRoutes = new Hono();

// Send a message
swarmMailboxRoutes.post('/send', async (c) => {
  try {
    const body = await c.req.json();
    const msg = swarmMailbox.send(
      body.groupId,
      body.fromAgentId,
      body.toAgentId,
      body.type,
      body.payload || {},
    );
    return c.json({ ok: true, message: msg });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});

// Claim a message
swarmMailboxRoutes.post('/:id/claim', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const claimed = swarmMailbox.claim(id, body.claimerId);
  return c.json({ ok: true, claimed });
});

// Respond to a message (grant/deny permission)
swarmMailboxRoutes.post('/:id/respond', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const response = swarmMailbox.respond(
      id,
      body.responderId,
      body.responseType,
      body.payload || {},
    );
    if (!response) return c.json({ ok: false, error: 'Message not found' }, 404);
    return c.json({ ok: true, response });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});

// Get pending messages for an agent
swarmMailboxRoutes.get('/pending/:agentId', (c) => {
  const agentId = c.req.param('agentId');
  const groupId = c.req.query('groupId');
  const messages = swarmMailbox.getPending(agentId, groupId);
  return c.json({ ok: true, messages });
});

// Get all messages in a group
swarmMailboxRoutes.get('/group/:groupId', (c) => {
  const groupId = c.req.param('groupId');
  const messages = swarmMailbox.getGroupMessages(groupId);
  return c.json({ ok: true, messages });
});
