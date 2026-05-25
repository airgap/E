import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveComponentSource } from '../pui';

// A library that ships .pui source via `exports` should resolve to its source
// file (so the preview compiles it client-side); a compiled-JS package should
// not (it takes the bundle path). Covers string, conditional, and wildcard
// exports plus the negative cases.
describe('resolveComponentSource', () => {
  let root: string;
  let fromFile: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'e-pui-resolve-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    fromFile = join(root, 'src', 'App.pui');
    writeFileSync(fromFile, '<div></div>');

    // @kit/ui — ships .pui source via mixed exports forms
    const ui = join(root, 'node_modules', '@kit', 'ui');
    mkdirSync(join(ui, 'src'), { recursive: true });
    writeFileSync(
      join(ui, 'package.json'),
      JSON.stringify({
        name: '@kit/ui',
        exports: {
          './card': './src/Card.pui',
          './badge': { svelte: './src/Badge.pui', default: './dist/badge.js' },
          './*': './src/*.pui',
        },
      }),
    );
    writeFileSync(join(ui, 'src', 'Card.pui'), '<div class="card"></div>');
    writeFileSync(join(ui, 'src', 'Badge.pui'), '<span class="badge"></span>');
    writeFileSync(join(ui, 'src', 'stack.pui'), '<div class="stack"></div>');

    // @kit/compiled — ships only compiled JS
    const cj = join(root, 'node_modules', '@kit', 'compiled');
    mkdirSync(join(cj, 'dist'), { recursive: true });
    writeFileSync(
      join(cj, 'package.json'),
      JSON.stringify({ name: '@kit/compiled', exports: { './x': './dist/x.js' } }),
    );
    writeFileSync(join(cj, 'dist', 'x.js'), 'export default 1;');
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test('resolves a string exports entry to its .pui source', () => {
    const r = resolveComponentSource('@kit/ui/card', fromFile);
    expect(r?.path.endsWith('/@kit/ui/src/Card.pui')).toBe(true);
  });

  test('resolves a conditional exports entry via the svelte/source condition', () => {
    const r = resolveComponentSource('@kit/ui/badge', fromFile);
    expect(r?.path.endsWith('/@kit/ui/src/Badge.pui')).toBe(true);
  });

  test('resolves a wildcard exports pattern', () => {
    const r = resolveComponentSource('@kit/ui/stack', fromFile);
    expect(r?.path.endsWith('/@kit/ui/src/stack.pui')).toBe(true);
  });

  test('returns null for a compiled-JS package (uses the bundle path)', () => {
    expect(resolveComponentSource('@kit/compiled/x', fromFile)).toBeNull();
  });

  test('returns null when the package is not installed', () => {
    expect(resolveComponentSource('@nope/missing/card', fromFile)).toBeNull();
  });

  test('returns null when the exports target does not exist on disk', () => {
    expect(resolveComponentSource('@kit/ui/ghost', fromFile)).toBeNull();
  });
});
