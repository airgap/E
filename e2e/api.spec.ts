import { test, expect } from '@playwright/test';

/**
 * API-level tests for the new endpoints. These don't boot the browser,
 * so they're cheap and deterministic. They cover everything that lives
 * entirely server-side: adapter discovery, file-watch registration,
 * find & replace (including the new caseSensitive / wholeWord / dryRun).
 */

test.describe('API — debug adapters', () => {
  test('GET /api/dap/adapters lists registered adapters', async ({ request }) => {
    const res = await request.get('/api/dap/adapters');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);

    // Python adapter is registered unconditionally; its `available` flag
    // depends on whether debugpy is installed on this machine.
    const python = body.data.find((a: any) => a.id === 'python');
    expect(python).toBeDefined();
    expect(python.label).toContain('Python');
    expect(typeof python.available).toBe('boolean');
  });

  test('GET /api/dap/sessions returns an empty list when no debug runs are active', async ({
    request,
  }) => {
    const res = await request.get('/api/dap/sessions');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.total).toBe(0);
    expect(body.data.sessions).toEqual([]);
  });
});

test.describe('API — filesystem watcher', () => {
  test('POST /api/file-watch/watch accepts a root path', async ({ request }) => {
    const res = await request.post('/api/file-watch/watch', {
      data: { rootPath: '/tmp' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.root).toBe('/tmp');
  });

  test('GET /api/file-watch/status reflects the most recent watch root', async ({ request }) => {
    await request.post('/api/file-watch/watch', { data: { rootPath: '/tmp' } });
    const res = await request.get('/api/file-watch/status');
    const body = await res.json();
    expect(body.data.root).toBe('/tmp');
  });
});

test.describe('API — find & replace options', () => {
  // Build a small test workspace on the server-side temp dir.
  const TEST_DIR = `/tmp/e-e2e-search-${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    await request.post('/api/files/create', {
      data: { path: `${TEST_DIR}/case.txt`, content: 'Foo foo FOO\nbar BAR Bar\n' },
    });
    await request.post('/api/files/create', {
      data: { path: `${TEST_DIR}/words.txt`, content: 'the quick fox\nthe brown fox\nfoxlike\n' },
    });
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/files/delete?path=${encodeURIComponent(`${TEST_DIR}/case.txt`)}`);
    await request.delete(`/api/files/delete?path=${encodeURIComponent(`${TEST_DIR}/words.txt`)}`);
  });

  test('caseSensitive=false matches all casings', async ({ request }) => {
    const res = await request.get(
      `/api/search?q=foo&path=${encodeURIComponent(TEST_DIR)}&caseSensitive=false`,
    );
    const body = await res.json();
    expect(body.data.totalMatches).toBe(3); // Foo + foo + FOO
  });

  test('caseSensitive=true respects case', async ({ request }) => {
    const res = await request.get(
      `/api/search?q=foo&path=${encodeURIComponent(TEST_DIR)}&caseSensitive=true`,
    );
    const body = await res.json();
    expect(body.data.totalMatches).toBe(1); // only "foo"
  });

  test('wholeWord=true excludes substrings', async ({ request }) => {
    const res = await request.get(
      `/api/search?q=fox&path=${encodeURIComponent(TEST_DIR)}&wholeWord=true`,
    );
    const body = await res.json();
    // "fox" matches in "the quick fox" and "the brown fox" but NOT "foxlike".
    expect(body.data.totalMatches).toBe(2);
  });

  test('replace dryRun counts without writing', async ({ request }) => {
    // Read original content.
    const before = await request.get(
      `/api/files/read?path=${encodeURIComponent(`${TEST_DIR}/case.txt`)}`,
    );
    const beforeContent = (await before.json()).data.content;

    const res = await request.post('/api/search/replace', {
      data: {
        searchText: 'foo',
        replaceText: 'baz',
        files: [`${TEST_DIR}/case.txt`],
        rootPath: TEST_DIR,
        caseSensitive: false,
        dryRun: true,
      },
    });
    const body = await res.json();
    expect(body.data.dryRun).toBe(true);
    expect(body.data.replacedCount).toBe(3);
    expect(body.data.filesModified).toBe(1);

    // Verify the file is unchanged on disk.
    const after = await request.get(
      `/api/files/read?path=${encodeURIComponent(`${TEST_DIR}/case.txt`)}`,
    );
    const afterContent = (await after.json()).data.content;
    expect(afterContent).toBe(beforeContent);
  });
});
