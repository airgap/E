import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { createTestDb } from '../../test-helpers';

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

// Import after mock setup.
import { docsRoutes as app } from '../docs';

function clearDocs() {
  testDb.exec('DELETE FROM documents');
}

const WS = '/tmp/test-workspace';

async function postJson(path: string, body: unknown) {
  return app.fetch(
    new Request(`http://test${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function patchJson(path: string, body: unknown) {
  return app.fetch(
    new Request(`http://test${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function get(path: string) {
  return app.fetch(new Request(`http://test${path}`));
}

async function del(path: string) {
  return app.fetch(new Request(`http://test${path}`, { method: 'DELETE' }));
}

describe('/api/docs', () => {
  beforeEach(clearDocs);

  test('POST creates a doc and returns it', async () => {
    const res = await postJson('/', { workspacePath: WS, title: 'My Notes' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({
      workspacePath: WS,
      title: 'My Notes',
      content: '', // default when content omitted
      metadata: {},
    });
    expect(body.data.id).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(typeof body.data.createdAt).toBe('number');
    expect(typeof body.data.updatedAt).toBe('number');
  });

  test('POST honors provided content', async () => {
    const res = await postJson('/', {
      workspacePath: WS,
      title: 'With Body',
      content: '# Hello\n\nSome **markdown**.',
    });
    const body = (await res.json()) as any;
    expect(body.data.content).toBe('# Hello\n\nSome **markdown**.');
  });

  test('POST rejects missing workspacePath / title', async () => {
    const r1 = await postJson('/', { title: 'No workspace' });
    expect(r1.status).toBe(400);
    const r2 = await postJson('/', { workspacePath: WS });
    expect(r2.status).toBe(400);
  });

  test('GET / lists workspace docs, most-recently-updated first', async () => {
    const a = (await (await postJson('/', { workspacePath: WS, title: 'A' })).json()) as any;
    // ensure distinct updated_at via a small delay
    await new Promise((r) => setTimeout(r, 5));
    const b = (await (await postJson('/', { workspacePath: WS, title: 'B' })).json()) as any;
    // Also add an unrelated-workspace doc that should not appear.
    await postJson('/', { workspacePath: '/other/ws', title: 'Other' });

    const listRes = await get(`/?workspacePath=${encodeURIComponent(WS)}`);
    const body = (await listRes.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(2);
    // B was created after A → B first.
    expect(body.data[0].id).toBe(b.data.id);
    expect(body.data[1].id).toBe(a.data.id);
  });

  test('GET / rejects without workspacePath', async () => {
    const res = await get('/');
    expect(res.status).toBe(400);
  });

  test('GET /:id returns a single doc, 404 on missing', async () => {
    const created = (await (
      await postJson('/', { workspacePath: WS, title: 'One' })
    ).json()) as any;

    const hit = await get(`/${created.data.id}`);
    const hitBody = (await hit.json()) as any;
    expect(hit.status).toBe(200);
    expect(hitBody.data.id).toBe(created.data.id);

    const miss = await get('/nonexistent');
    expect(miss.status).toBe(404);
  });

  test('PATCH updates title / content / metadata independently', async () => {
    const created = (await (
      await postJson('/', { workspacePath: WS, title: 'Draft', content: 'orig' })
    ).json()) as any;
    const id = created.data.id;
    const origCreatedAt = created.data.createdAt;

    // Sleep so updatedAt differs detectably.
    await new Promise((r) => setTimeout(r, 5));

    const r1 = await patchJson(`/${id}`, { content: 'updated content' });
    const b1 = (await r1.json()) as any;
    expect(b1.data.title).toBe('Draft'); // unchanged
    expect(b1.data.content).toBe('updated content');
    expect(b1.data.createdAt).toBe(origCreatedAt); // immutable
    expect(b1.data.updatedAt).toBeGreaterThan(origCreatedAt);

    const r2 = await patchJson(`/${id}`, { title: 'Renamed', metadata: { pinned: true } });
    const b2 = (await r2.json()) as any;
    expect(b2.data.title).toBe('Renamed');
    expect(b2.data.content).toBe('updated content'); // still preserved
    expect(b2.data.metadata).toEqual({ pinned: true });
  });

  test('PATCH 404s for missing doc', async () => {
    const res = await patchJson('/nope', { title: 'x' });
    expect(res.status).toBe(404);
  });

  test('DELETE removes the doc, list reflects', async () => {
    const created = (await (
      await postJson('/', { workspacePath: WS, title: 'Doomed' })
    ).json()) as any;
    const id = created.data.id;

    const dRes = await del(`/${id}`);
    expect(dRes.status).toBe(200);

    const after = (await (await get(`/?workspacePath=${encodeURIComponent(WS)}`)).json()) as any;
    expect(after.data).toHaveLength(0);

    const dRes2 = await del(`/${id}`);
    expect(dRes2.status).toBe(404);
  });
});
