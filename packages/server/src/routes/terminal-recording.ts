import { Hono } from 'hono';
import { terminalRecording } from '../services/terminal-recording';

export const terminalRecordingRoutes = new Hono();

// Start recording
terminalRecordingRoutes.post('/start', async (c) => {
  const body = await c.req.json();
  const recording = terminalRecording.startRecording(
    body.sessionId,
    body.cols || 80,
    body.rows || 24,
    body.title,
  );
  return c.json({ ok: true, recording });
});

// Stop recording
terminalRecordingRoutes.post('/:id/stop', (c) => {
  const id = c.req.param('id');
  const recording = terminalRecording.stopRecording(id);
  if (!recording) return c.json({ ok: false, error: 'Recording not found' }, 404);
  return c.json({ ok: true, recording });
});

// Record output event
terminalRecordingRoutes.post('/:id/output', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  terminalRecording.recordOutput(id, body.data);
  return c.json({ ok: true });
});

// List recordings
terminalRecordingRoutes.get('/', (c) => {
  return c.json({ ok: true, recordings: terminalRecording.listRecordings() });
});

// Get recording events (for playback)
terminalRecordingRoutes.get('/:id/events', (c) => {
  const id = c.req.param('id');
  const data = terminalRecording.getRecordingEvents(id);
  if (!data) return c.json({ ok: false, error: 'Recording not found' }, 404);
  return c.json({ ok: true, ...data });
});

// Delete a recording
terminalRecordingRoutes.delete('/:id', (c) => {
  const id = c.req.param('id');
  const deleted = terminalRecording.deleteRecording(id);
  if (!deleted) return c.json({ ok: false, error: 'Recording not found' }, 404);
  return c.json({ ok: true });
});

// Prune old recordings
terminalRecordingRoutes.post('/prune', (c) => {
  const pruned = terminalRecording.prune();
  return c.json({ ok: true, pruned });
});

// Get/set config
terminalRecordingRoutes.get('/config', (c) => {
  return c.json({ ok: true, config: terminalRecording.getConfig() });
});

terminalRecordingRoutes.post('/config', async (c) => {
  const body = await c.req.json();
  terminalRecording.setConfig(body);
  return c.json({ ok: true, config: terminalRecording.getConfig() });
});
