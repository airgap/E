import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  installLibraryFromZip,
  installLibraryFromDir,
  detectSourceType,
  collectComponentManifests,
} from '../pui';

// zip + local-source-directory install paths (alongside the tarball path), and
// the source-type auto-detection.
describe('library install: zip + local dir + detection', () => {
  let work: string;
  let cache: string;
  let fromFile: string;

  const writePackage = (root: string, name: string) => {
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name,
        version: '0.0.1',
        componentManifest: './component-manifest.json',
        exports: { './card': { default: './dist/card.js' } },
      }),
    );
    writeFileSync(
      join(root, 'component-manifest.json'),
      JSON.stringify({ version: 1, library: name, groups: [] }),
    );
    writeFileSync(join(root, 'dist', 'card.js'), 'export default 1;');
  };

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'e-src-test-'));
    cache = join(work, 'cache');
    process.env.E_LIBRARIES_DIR = cache;
    fromFile = join(work, 'proj', 'App.pui');
    mkdirSync(join(work, 'proj'), { recursive: true });
    writeFileSync(fromFile, '<div></div>');
  });

  afterAll(() => {
    delete process.env.E_LIBRARIES_DIR;
    rmSync(work, { recursive: true, force: true });
  });

  test('detectSourceType classifies each form', () => {
    expect(detectSourceType('https://x/y.zip')).toBe('zip');
    expect(detectSourceType('https://x/y.tgz')).toBe('tarball');
    expect(detectSourceType('git@github.com:a/b.git')).toBe('git');
    expect(detectSourceType('github:a/b')).toBe('git');
    expect(detectSourceType('https://github.com/a/b.git')).toBe('git');
    expect(detectSourceType('https://x/y')).toBe('tarball'); // http default
  });

  test('installs a library from a zip (auto-detected package root)', async () => {
    // A zip whose package sits under a top-level dir (like a GitHub source zip).
    const stage = join(work, 'ziproot', '@kit-zip');
    writePackage(stage, '@kit/zip');
    const zip = join(work, 'kit.zip');
    Bun.spawnSync(['zip', '-q', '-r', zip, '@kit-zip'], { cwd: join(work, 'ziproot') });

    const r = await installLibraryFromZip(zip);
    expect(r.name).toBe('@kit/zip');
    expect(existsSync(join(cache, '@kit/zip', 'dist', 'card.js'))).toBe(true);
    expect(collectComponentManifests(fromFile).some((m) => m.package === '@kit/zip')).toBe(true);
  });

  test('installs a local source directory (symlinked, discoverable)', () => {
    const srcDir = join(work, 'local', 'mylib');
    writePackage(srcDir, '@kit/local');

    const r = installLibraryFromDir(srcDir);
    expect(r.name).toBe('@kit/local');
    expect(detectSourceType(srcDir)).toBe('dir');
    // Edits to the source reflect through the symlink.
    writeFileSync(join(srcDir, 'dist', 'card.js'), 'export default 2;');
    expect(existsSync(join(cache, '@kit/local', 'dist', 'card.js'))).toBe(true);
    expect(collectComponentManifests(fromFile).some((m) => m.package === '@kit/local')).toBe(true);
  });
});
