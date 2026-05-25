import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { installLibraryFromTarball, collectComponentManifests, resolveBundleEntry } from '../pui';

// Installs a library from an npm-pack tarball into a temp external cache and
// proves the cache is searched exactly like node_modules: discovery finds its
// manifest and the bundle path resolves its subpaths.
describe('external library cache (install from tarball)', () => {
  let work: string;
  let cache: string;
  let tgz: string;
  let fromFile: string;

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'e-lib-test-'));
    cache = join(work, 'cache');
    process.env.E_LIBRARIES_DIR = cache;
    fromFile = join(work, 'proj', 'App.pui');
    mkdirSync(join(work, 'proj'), { recursive: true });
    writeFileSync(fromFile, '<div></div>');

    // Build a tarball in npm-pack layout (package/ prefix).
    const stage = join(work, 'stage', 'package');
    mkdirSync(join(stage, 'dist'), { recursive: true });
    writeFileSync(
      join(stage, 'package.json'),
      JSON.stringify({
        name: '@fix/kit',
        version: '1.2.3',
        componentManifest: './component-manifest.json',
        exports: { './card': { svelte: './dist/card.js', default: './dist/card.js' } },
      }),
    );
    writeFileSync(
      join(stage, 'component-manifest.json'),
      JSON.stringify({
        version: 1,
        library: '@fix/kit',
        groups: [
          {
            name: 'Demo',
            components: [
              {
                name: 'Card',
                id: 'card',
                import: { module: '@fix/kit/card', name: 'Card', default: true },
                snippet: '<Card />',
                props: [],
              },
            ],
          },
        ],
      }),
    );
    writeFileSync(join(stage, 'dist', 'card.js'), 'export default 1;');
    tgz = join(work, 'fix-kit.tgz');
    const tar = Bun.spawn(['tar', '-czf', tgz, '-C', join(work, 'stage'), 'package']);
    await tar.exited;
  });

  afterAll(() => {
    delete process.env.E_LIBRARIES_DIR;
    rmSync(work, { recursive: true, force: true });
  });

  test('installs the tarball under its package name in the cache', async () => {
    const r = await installLibraryFromTarball(tgz);
    expect(r.name).toBe('@fix/kit');
    expect(r.dir).toBe(join(cache, '@fix/kit'));
  });

  test("discovery finds the cached library's manifest", () => {
    const found = collectComponentManifests(fromFile);
    const kit = found.find((f) => f.package === '@fix/kit');
    expect(kit).toBeDefined();
    expect((kit!.manifest as { library: string }).library).toBe('@fix/kit');
  });

  test("the bundle path resolves a cached library's subpath via exports", () => {
    const entry = resolveBundleEntry('@fix/kit/card', fromFile);
    expect(entry).toBe(join(cache, '@fix/kit', 'dist', 'card.js'));
  });

  test('rejects a non-tarball source', async () => {
    await expect(installLibraryFromTarball(join(work, 'nope.tgz'))).rejects.toThrow();
  });
});
