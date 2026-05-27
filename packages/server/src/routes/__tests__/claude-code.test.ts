/**
 * Smoke tests for the /api/claude-code routes. The parser itself is
 * covered exhaustively by claude-code-history.test.ts; here we just
 * pin the HTTP shape (status codes + envelope).
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { claudeCodeRoutes as app } from '../claude-code';

const WORKSPACE = '/tmp/e-cc-routes-test';
const ENCODED = WORKSPACE.replace(/[/.]/g, '-');
const PROJECT_DIR = join(homedir(), '.claude', 'projects', ENCODED);

beforeEach(() => {
  if (existsSync(PROJECT_DIR)) rmSync(PROJECT_DIR, { recursive: true });
});
afterEach(() => {
  if (existsSync(PROJECT_DIR)) rmSync(PROJECT_DIR, { recursive: true });
});

async function get(path: string) {
  return app.fetch(new Request(`http://test${path}`));
}

function seedConversation(sessionId: string) {
  mkdirSync(PROJECT_DIR, { recursive: true });
  writeFileSync(
    join(PROJECT_DIR, `${sessionId}.jsonl`),
    [
      JSON.stringify({ type: 'custom-title', customTitle: 'seeded' }),
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      JSON.stringify({ type: 'assistant', message: { content: 'hello' } }),
    ].join('\n'),
  );
}

describe('/api/claude-code routes', () => {
  test('GET /conversations rejects without workspacePath', async () => {
    const res = await get('/conversations');
    expect(res.status).toBe(400);
  });

  test('GET /conversations returns [] when no project dir exists', async () => {
    const res = await get(`/conversations?workspacePath=${encodeURIComponent(WORKSPACE)}`);
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual([]);
  });

  test('GET /conversations lists existing conversations', async () => {
    seedConversation('uuid-1');
    const res = await get(`/conversations?workspacePath=${encodeURIComponent(WORKSPACE)}`);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: 'uuid-1',
      title: 'seeded',
      messageCount: 2,
    });
  });

  test('GET /conversations/:id returns the full message list', async () => {
    seedConversation('uuid-2');
    const res = await get(`/conversations/uuid-2?workspacePath=${encodeURIComponent(WORKSPACE)}`);
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.data.title).toBe('seeded');
    expect(body.data.messages.map((m: any) => m.role)).toEqual(['user', 'assistant']);
  });

  test('GET /conversations/:id 404s when missing', async () => {
    const res = await get(`/conversations/nope?workspacePath=${encodeURIComponent(WORKSPACE)}`);
    expect(res.status).toBe(404);
  });
});
