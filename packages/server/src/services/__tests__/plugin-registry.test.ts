/**
 * Plugin registry tests. Covers the four guarantees worth pinning:
 *   1. https-only enforcement on both the index URL and entry zipUrls
 *   2. sha256 verification gates install (rejects on mismatch, accepts on match)
 *   3. cache TTL behaviour (fresh = cached, force = refetched)
 *   4. registry url change purges cache so the next fetch hits the new URL
 *
 * Stubs global fetch so we can drive responses without a real server,
 * and points HOME at a tmp dir so cache + config files don't pollute the
 * user's real ~/.e.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';

let tmpHome: string;
const origHome = process.env.HOME;
const origFetch = globalThis.fetch;

beforeEach(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), 'e-plugin-registry-test-'));
  process.env.HOME = tmpHome;
  delete process.env.E_PLUGIN_REGISTRY;
  // Bun's homedir() ignores $HOME — route both services explicitly.
  const reg = await import('../plugin-registry');
  const svc = await import('../plugins');
  const target = join(tmpHome, '.e', 'plugins');
  reg.__setPluginsDirForTests(target);
  svc.__setPluginsDirForTests(target);
});

afterEach(() => {
  process.env.HOME = origHome;
  if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true });
  globalThis.fetch = origFetch;
});

async function loadServices() {
  const reg = await import('../plugin-registry');
  reg.__resetRegistryStateForTests();
  return reg;
}

function stubFetch(responses: Map<string, { body: any; status?: number }>) {
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    const r = responses.get(u);
    if (!r) throw new Error(`unstubbed fetch: ${u}`);
    const status = r.status ?? 200;
    const ok = status >= 200 && status < 300;
    const body = r.body;
    if (body instanceof Buffer || body instanceof Uint8Array) {
      // Cast — Response accepts Uint8Array at runtime; TS dom-lib's
      // BodyInit union doesn't fully cover Buffer-shaped values.
      return new Response(body as unknown as BodyInit, { status });
    }
    if (typeof body === 'string') {
      return new Response(body, { status });
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

function buildPluginZip(id: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    'plugin.json',
    Buffer.from(JSON.stringify({ id, version: '1.0.0', displayName: id }, null, 2)),
  );
  return zip.toBuffer();
}

describe('setRegistryUrl / getRegistryUrl', () => {
  test('https URL is accepted; getRegistryUrl returns it', async () => {
    const reg = await loadServices();
    const res = reg.setRegistryUrl('https://example.com/plugins.json');
    expect(res.ok).toBe(true);
    expect(reg.getRegistryUrl()).toBe('https://example.com/plugins.json');
  });

  test('http URL is rejected', async () => {
    const reg = await loadServices();
    const res = reg.setRegistryUrl('http://example.com/plugins.json');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/https/);
  });

  test('null clears the configured URL', async () => {
    const reg = await loadServices();
    reg.setRegistryUrl('https://example.com/plugins.json');
    reg.setRegistryUrl(null);
    expect(reg.getRegistryUrl()).toBe(null);
  });
});

describe('fetchRegistry', () => {
  test('returns "no registry url configured" when unset', async () => {
    const reg = await loadServices();
    const res = await reg.fetchRegistry();
    expect(res.ok).toBe(false);
    expect(res.errors?.[0]).toMatch(/no registry url/);
  });

  test('valid index round-trips into a fetch result', async () => {
    const reg = await loadServices();
    reg.setRegistryUrl('https://example.com/plugins.json');
    stubFetch(
      new Map([
        [
          'https://example.com/plugins.json',
          {
            body: {
              entries: [
                {
                  id: 'foo',
                  version: '1.0.0',
                  displayName: 'Foo',
                  zipUrl: 'https://example.com/foo-1.0.0.zip',
                },
              ],
            },
          },
        ],
      ]),
    );
    const res = await reg.fetchRegistry();
    expect(res.ok).toBe(true);
    expect(res.index!.entries[0].id).toBe('foo');
    expect(res.fromCache).toBe(false);
  });

  test('a second call within TTL returns cached result', async () => {
    const reg = await loadServices();
    reg.setRegistryUrl('https://example.com/plugins.json');
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ entries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    await reg.fetchRegistry();
    const second = await reg.fetchRegistry();
    expect(calls).toBe(1);
    expect(second.fromCache).toBe(true);
  });

  test('force=true bypasses the cache', async () => {
    const reg = await loadServices();
    reg.setRegistryUrl('https://example.com/plugins.json');
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ entries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    await reg.fetchRegistry();
    await reg.fetchRegistry({ force: true });
    expect(calls).toBe(2);
  });

  test('changing the URL purges the cache', async () => {
    const reg = await loadServices();
    reg.setRegistryUrl('https://a.example/plugins.json');
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ entries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    await reg.fetchRegistry();
    reg.setRegistryUrl('https://b.example/plugins.json');
    await reg.fetchRegistry();
    expect(calls).toBe(2);
  });

  test('rejects index documents with malformed entries', async () => {
    const reg = await loadServices();
    reg.setRegistryUrl('https://example.com/plugins.json');
    stubFetch(
      new Map([
        [
          'https://example.com/plugins.json',
          { body: { entries: [{ id: 'x' /* missing fields */ }] } },
        ],
      ]),
    );
    const res = await reg.fetchRegistry();
    expect(res.ok).toBe(false);
    expect(res.errors!.some((e) => /version/.test(e))).toBe(true);
  });

  test('rejects an http zipUrl in the index', async () => {
    const reg = await loadServices();
    reg.setRegistryUrl('https://example.com/plugins.json');
    stubFetch(
      new Map([
        [
          'https://example.com/plugins.json',
          {
            body: {
              entries: [
                {
                  id: 'foo',
                  version: '1.0.0',
                  displayName: 'Foo',
                  zipUrl: 'http://example.com/foo-1.0.0.zip',
                },
              ],
            },
          },
        ],
      ]),
    );
    const res = await reg.fetchRegistry();
    expect(res.ok).toBe(false);
    expect(res.errors!.some((e) => /https/.test(e))).toBe(true);
  });
});

describe('installFromRegistry', () => {
  test('downloads + installs when sha256 matches', async () => {
    const reg = await loadServices();
    const zipBuf = buildPluginZip('foo');
    const sha = createHash('sha256').update(zipBuf).digest('hex');
    stubFetch(new Map([['https://example.com/foo.zip', { body: zipBuf }]]));
    const res = await reg.installFromRegistry({
      id: 'foo',
      version: '1.0.0',
      displayName: 'Foo',
      zipUrl: 'https://example.com/foo.zip',
      sha256: sha,
    });
    expect(res.errors).toEqual([]);
    expect(res.plugin?.manifest.id).toBe('foo');
  });

  test('refuses to install when sha256 mismatches', async () => {
    const reg = await loadServices();
    const zipBuf = buildPluginZip('foo');
    stubFetch(new Map([['https://example.com/foo.zip', { body: zipBuf }]]));
    const res = await reg.installFromRegistry({
      id: 'foo',
      version: '1.0.0',
      displayName: 'Foo',
      zipUrl: 'https://example.com/foo.zip',
      sha256: 'a'.repeat(64), // deliberately wrong
    });
    expect(res.errors[0]).toMatch(/sha256 mismatch/);
    expect(res.plugin).toBeUndefined();
  });

  test('installs without sha256 (no integrity gate when absent)', async () => {
    const reg = await loadServices();
    const zipBuf = buildPluginZip('foo');
    stubFetch(new Map([['https://example.com/foo.zip', { body: zipBuf }]]));
    const res = await reg.installFromRegistry({
      id: 'foo',
      version: '1.0.0',
      displayName: 'Foo',
      zipUrl: 'https://example.com/foo.zip',
    });
    expect(res.errors).toEqual([]);
  });

  test('rejects http zipUrl', async () => {
    const reg = await loadServices();
    const res = await reg.installFromRegistry({
      id: 'foo',
      version: '1.0.0',
      displayName: 'Foo',
      zipUrl: 'http://example.com/foo.zip',
    });
    expect(res.errors[0]).toMatch(/https/);
  });
});
