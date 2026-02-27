import { Hono } from 'hono';
import { getDb } from '../db/database';

const app = new Hono();

/**
 * Transcribe audio using OpenAI Whisper API
 * POST /voice/transcribe
 * Body: multipart/form-data with 'audio' file
 */
app.post('/transcribe', async (c) => {
  try {
    // Get Whisper API key from settings
    const db = getDb();
    const row = db.query('SELECT value FROM settings WHERE key = ?').get('whisperApiKey') as any;

    if (!row) {
      return c.json({ ok: false, error: 'Whisper API key not configured in server settings' }, 400);
    }

    const whisperApiKey = JSON.parse(row.value);
    if (!whisperApiKey) {
      return c.json({ ok: false, error: 'Whisper API key not configured in server settings' }, 400);
    }

    // Get the uploaded audio file
    const body = await c.req.parseBody();
    const audioFile = body['audio'];

    if (!audioFile || typeof audioFile === 'string') {
      return c.json({ ok: false, error: 'No audio file provided' }, 400);
    }

    // Get language parameter
    const language = c.req.query('language');

    // Create FormData for Whisper API
    const formData = new FormData();
    const blob = new Blob([await audioFile.arrayBuffer()], { type: audioFile.type });
    formData.append('file', blob, 'audio.webm');
    formData.append('model', 'whisper-1');

    if (language) {
      formData.append('language', language.split('-')[0]); // e.g., 'en-US' -> 'en'
    }

    // Call Whisper API
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${whisperApiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[voice] Whisper API error:', response.status, errorText);
      return c.json(
        { ok: false, error: `Whisper API error: ${response.status} ${response.statusText}` },
        500,
      );
    }

    const result = (await response.json()) as { text: string };
    return c.json({ ok: true, data: { text: result.text } });
  } catch (error) {
    console.error('[voice] Transcription error:', error);
    return c.json({ ok: false, error: (error as Error).message }, 500);
  }
});

export default app;
