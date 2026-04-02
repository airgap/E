/**
 * MEMORY.md Index Routes
 */

import { Hono } from 'hono';
import {
  readMemoryEntries,
  writeMemoryEntry,
  updateMemoryEntry,
  deleteMemoryEntry,
  readIndex,
  rebuildIndex,
} from '../services/memory-index';

export const memoryIndexRoutes = new Hono();

// List all memory entries
memoryIndexRoutes.get('/entries', (c) => {
  const workspace = c.req.query('workspace') || '.';
  const entries = readMemoryEntries(workspace);
  return c.json({ ok: true, entries });
});

// Get the MEMORY.md index
memoryIndexRoutes.get('/index', (c) => {
  const workspace = c.req.query('workspace') || '.';
  const index = readIndex(workspace);
  return c.json({ ok: true, index });
});

// Create a new memory entry
memoryIndexRoutes.post('/entries', async (c) => {
  try {
    const body = await c.req.json();
    const entry = writeMemoryEntry(body.workspace || '.', {
      name: body.name,
      description: body.description || '',
      type: body.type || 'project',
      content: body.content,
    });
    return c.json({ ok: true, entry });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});

// Update a memory entry
memoryIndexRoutes.put('/entries/:filename', async (c) => {
  try {
    const filename = c.req.param('filename');
    const body = await c.req.json();
    const entry = updateMemoryEntry(body.workspace || '.', filename, body);
    if (!entry) return c.json({ ok: false, error: 'Entry not found' }, 404);
    return c.json({ ok: true, entry });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});

// Delete a memory entry
memoryIndexRoutes.delete('/entries/:filename', (c) => {
  const filename = c.req.param('filename');
  const workspace = c.req.query('workspace') || '.';
  const deleted = deleteMemoryEntry(workspace, filename);
  if (!deleted) return c.json({ ok: false, error: 'Entry not found' }, 404);
  return c.json({ ok: true });
});

// Rebuild the index
memoryIndexRoutes.post('/rebuild', (c) => {
  const workspace = c.req.query('workspace') || '.';
  rebuildIndex(workspace);
  return c.json({ ok: true });
});
