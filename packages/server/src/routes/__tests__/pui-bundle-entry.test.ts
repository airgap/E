import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveBundleEntry } from '../pui';

// The bundle path must honor `exports` (a precompiled lib's components live at
// ./dist/<x>.js, not ./<x>.js) and still fall back to a naive probe for packages
// without exports.
describe('resolveBundleEntry', () => {
  let root: string;
  let fromFile: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'e-pui-bundle-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    fromFile = join(root, 'src', 'App.pui');
    writeFileSync(fromFile, '<div></div>');

    // precompiled lib: subpath → ./dist/<x>.js via exports conditions
    const lib = join(root, 'node_modules', '@kit', 'ui');
    mkdirSync(join(lib, 'dist'), { recursive: true });
    writeFileSync(
      join(lib, 'package.json'),
      JSON.stringify({
        name: '@kit/ui',
        exports: { './button': { svelte: './dist/button.js', default: './dist/button.js' } },
      }),
    );
    writeFileSync(join(lib, 'dist', 'button.js'), 'export default 1;');

    // plain lib: no exports → naive join + extension probe
    const plain = join(root, 'node_modules', 'plainlib');
    mkdirSync(plain, { recursive: true });
    writeFileSync(join(plain, 'package.json'), JSON.stringify({ name: 'plainlib' }));
    writeFileSync(join(plain, 'widget.js'), 'export default 2;');
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test('resolves a subpath through exports to the compiled JS', () => {
    const e = resolveBundleEntry('@kit/ui/button', fromFile);
    expect(e?.endsWith('/@kit/ui/dist/button.js')).toBe(true);
  });

  test('falls back to a naive probe for a package without exports', () => {
    const e = resolveBundleEntry('plainlib/widget', fromFile);
    expect(e?.endsWith('/plainlib/widget.js')).toBe(true);
  });

  test('returns null when nothing resolves', () => {
    expect(resolveBundleEntry('@kit/ui/missing', fromFile)).toBeNull();
    expect(resolveBundleEntry('@nope/x', fromFile)).toBeNull();
  });
});
