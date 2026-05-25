import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { collectComponentManifests } from '../pui';

// Builds a throwaway workspace: a project that depends on two packages — one
// ships a componentManifest, one doesn't — and asserts discovery picks up only
// the former by walking up to node_modules, exactly as it would in a real tree.
describe('collectComponentManifests', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'e-pui-manifests-'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'proj',
        dependencies: { '@demo/lib': '1.0.0' },
        devDependencies: { '@demo/nolib': '1.0.0', '@demo/missing': '1.0.0' },
      }),
    );
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'App.pui'), '<div></div>');

    // @demo/lib — declares + ships a manifest
    const lib = join(root, 'node_modules', '@demo', 'lib');
    mkdirSync(lib, { recursive: true });
    writeFileSync(
      join(lib, 'package.json'),
      JSON.stringify({ name: '@demo/lib', componentManifest: './component-manifest.json' }),
    );
    writeFileSync(
      join(lib, 'component-manifest.json'),
      JSON.stringify({ version: 1, library: '@demo/lib', groups: [] }),
    );

    // @demo/nolib — installed but no manifest field
    const nolib = join(root, 'node_modules', '@demo', 'nolib');
    mkdirSync(nolib, { recursive: true });
    writeFileSync(join(nolib, 'package.json'), JSON.stringify({ name: '@demo/nolib' }));

    // @demo/missing — declares a manifest but the file is absent
    const missing = join(root, 'node_modules', '@demo', 'missing');
    mkdirSync(missing, { recursive: true });
    writeFileSync(
      join(missing, 'package.json'),
      JSON.stringify({ name: '@demo/missing', componentManifest: './gone.json' }),
    );
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test('discovers only deps that declare AND ship a manifest', () => {
    const found = collectComponentManifests(join(root, 'src', 'App.pui'));
    expect(found.map((f) => f.package)).toEqual(['@demo/lib']);
    expect((found[0].manifest as { library: string }).library).toBe('@demo/lib');
  });

  test('returns [] when there is no project package.json', () => {
    expect(collectComponentManifests('/definitely/not/here/App.pui')).toEqual([]);
  });
});
