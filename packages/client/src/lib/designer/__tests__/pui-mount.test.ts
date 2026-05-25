import { describe, test, expect, vi } from 'vitest';

// The published @lyku/para-transpile dist uses extensionless ESM imports that
// vitest's resolver can't follow (vite handles them at app-build time). These
// tests only exercise the .pui compile path — transpile() is for .ts/.pts deps —
// so stub it to a pass-through to keep the module importable here.
vi.mock('@lyku/para-transpile', () => ({ transpile: (s: string) => s }));

import { compilePui } from '../pui-compile';
import { resolvePuiRoot } from '../pui-mount';

// Proof of source-library resolution: a root .pui imports a component by BARE
// specifier (@kit/ui/card); resolveSource maps it to a source path, readFile
// serves the .pui source, and the harness compiles it into the graph. This is
// the capability that lets a .pui component library render in the preview
// without the (svelte-incapable) parabun bundler. We stop at the resolved
// component (resolvePuiRoot) rather than mount() — the DOM mount needs Svelte's
// browser build, which vitest's resolver doesn't select; the resolve+compile
// loop is the new logic under test.
describe('resolvePuiRoot — bare source-library resolution', () => {
  test('resolves + compiles a bare .pui component into the graph', async () => {
    const root = `<script>\n  import Card from '@kit/ui/card';\n</script>\n<main><Card /></main>`;
    const compiled = await compilePui(root, 'App.pui');
    expect(compiled.ok).toBe(true);

    const cardSource = '<div class="card">CARD CONTENT</div>';
    let readPath = '';
    let bundled = false;

    // If the card couldn't be resolved/compiled, resolveDeps throws — so a
    // function Component here already proves the bare source lib was handled.
    const root_ = await resolvePuiRoot({
      rootJs: compiled.js!,
      rootCss: compiled.css,
      filePath: '/proj/src/App.pui',
      readFile: async (path) => {
        readPath = path;
        return path === '/kit/ui/src/Card.pui' ? cardSource : null;
      },
      resolveSource: async (spec) =>
        spec === '@kit/ui/card' ? { path: '/kit/ui/src/Card.pui' } : null,
      bundle: async () => {
        bundled = true;
        return null;
      },
    });

    expect(typeof root_.Component).toBe('function');
    expect(readPath).toBe('/kit/ui/src/Card.pui');
    expect(bundled).toBe(false); // source lib never touches the bundler
  });

  test('falls back to the bundler when the spec is not a source lib', async () => {
    const root = `<script>\n  import Widget from 'compiled-lib';\n</script>\n<main><Widget /></main>`;
    const compiled = await compilePui(root, 'App.pui');
    expect(compiled.ok).toBe(true);

    let bundleCalledWith = '';
    await expect(
      resolvePuiRoot({
        rootJs: compiled.js!,
        rootCss: compiled.css,
        filePath: '/proj/src/App.pui',
        readFile: async () => null,
        resolveSource: async () => null,
        bundle: async (spec) => {
          bundleCalledWith = spec;
          return null; // simulate "not bundleable" → resolve error
        },
      }),
    ).rejects.toThrow();

    expect(bundleCalledWith).toBe('compiled-lib');
  });
});
