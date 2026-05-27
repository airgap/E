import { describe, test, expect } from 'vitest';
import { reactiveProvider, __test } from '../reactive';
import type { ProviderContext } from '../../types';

const { extractDecls, inferEdges, symbolUnderCursor } = __test;

function makeCtx(filePath: string, doc: string, pos = 0): ProviderContext {
  const lineStart = doc.lastIndexOf('\n', pos - 1) + 1;
  return {
    filePath,
    workspacePath: '/workspace',
    pos,
    doc,
    line: doc.slice(0, pos).split('\n').length - 1,
    column: pos - lineStart,
  };
}

describe('reactiveProvider — extractDecls', () => {
  test('Para first-class signal/derived declarations', () => {
    const src = `
signal count = 0
derived doubled = count * 2
`;
    const decls = extractDecls(src);
    expect(decls.map((d) => ({ name: d.name, kind: d.kind }))).toEqual([
      { name: 'count', kind: 'signal' },
      { name: 'doubled', kind: 'derived' },
    ]);
  });

  test('Para call-form initialisers inside const/let bindings', () => {
    const src = `
const a = signal(1);
let b = derived(() => a + 1);
`;
    const decls = extractDecls(src);
    expect(decls.map((d) => d.name).sort()).toEqual(['a', 'b']);
    expect(decls.find((d) => d.name === 'a')?.kind).toBe('signal');
    expect(decls.find((d) => d.name === 'b')?.kind).toBe('derived');
  });

  test('Svelte 5 rune declarations ($state, $derived)', () => {
    const src = `
let count = $state(0);
let doubled = $derived(count * 2);
let lazy = $derived.by(() => count + 1);
`;
    const decls = extractDecls(src);
    const names = decls.map((d) => d.name);
    expect(names).toContain('count');
    expect(names).toContain('doubled');
    expect(names).toContain('lazy');
    expect(decls.find((d) => d.name === 'count')?.kind).toBe('signal');
    expect(decls.find((d) => d.name === 'doubled')?.kind).toBe('derived');
  });

  test('effects get synthesised IDs and bodies', () => {
    const src = `
const x = signal(1);
$effect(() => console.log(x));
$effect(() => x + 1);
`;
    const decls = extractDecls(src);
    const effects = decls.filter((d) => d.kind === 'effect');
    expect(effects).toHaveLength(2);
    expect(effects[0].name).toBe('effect #0');
    expect(effects[1].name).toBe('effect #1');
    expect(effects[0].body).toContain('x');
  });

  test('Para effect block form: effect { ... }', () => {
    const src = `
signal x = 1
effect {
  console.log(x)
}
`;
    const decls = extractDecls(src);
    const effects = decls.filter((d) => d.kind === 'effect');
    expect(effects).toHaveLength(1);
    expect(effects[0].body).toContain('console.log(x)');
  });

  test('returns [] when no reactive declarations are present', () => {
    expect(extractDecls('const x = 1; let y = 2;')).toEqual([]);
  });

  test('dedupes when both call-form and decl-form bind the same name', () => {
    // Pathological but we shouldn't double-count.
    const src = `signal x = 0\nconst x = signal(5)\n`;
    const decls = extractDecls(src);
    expect(decls.filter((d) => d.name === 'x')).toHaveLength(1);
  });
});

describe('reactiveProvider — inferEdges', () => {
  test('derived → signal it reads', () => {
    const decls = extractDecls(`
signal count = 0
derived doubled = count * 2
`);
    const edges = inferEdges(decls);
    expect(edges).toContainEqual({ from: 'rx:count', to: 'rx:doubled' });
  });

  test('effect → all signals/deriveds it references', () => {
    const decls = extractDecls(`
signal a = 1
signal b = 2
derived c = a + b
$effect(() => a + c);
`);
    const edges = inferEdges(decls);
    // c reads a + b
    expect(edges).toContainEqual({ from: 'rx:a', to: 'rx:c' });
    expect(edges).toContainEqual({ from: 'rx:b', to: 'rx:c' });
    // effect 0 reads a + c
    expect(edges).toContainEqual({ from: 'rx:a', to: 'eff:0' });
    expect(edges).toContainEqual({ from: 'rx:c', to: 'eff:0' });
  });

  test('signals never have incoming edges (they are sources)', () => {
    const decls = extractDecls(`
signal a = 0
signal b = a
`);
    // `signal b = a` — the body for b is "a" but signals are sources; we
    // intentionally skip signal→signal edge inference.
    const edges = inferEdges(decls);
    expect(edges.find((e) => e.to === 'rx:b')).toBeUndefined();
  });
});

describe('reactiveProvider — symbolUnderCursor', () => {
  test('returns the identifier under the cursor', () => {
    const doc = 'const fooBar = 1;';
    // Cursor in middle of "fooBar"
    expect(symbolUnderCursor(makeCtx('/x.pui', doc, 9))).toBe('fooBar');
  });

  test('returns null when cursor is on whitespace', () => {
    const doc = 'a   b';
    expect(symbolUnderCursor(makeCtx('/x.pui', doc, 2))).toBe(null);
  });
});

describe('reactiveProvider — supports / build', () => {
  test('supports() fires only for .pui / .svelte', () => {
    expect(reactiveProvider.supports(makeCtx('/x.pui', ''))).toBe(true);
    expect(reactiveProvider.supports(makeCtx('/x.svelte', ''))).toBe(true);
    expect(reactiveProvider.supports(makeCtx('/x.ts', ''))).toBe(false);
    expect(reactiveProvider.supports(makeCtx('/x.tsx', ''))).toBe(false);
  });

  test('build() returns null when no reactive primitives are declared', async () => {
    expect(await reactiveProvider.build(makeCtx('/x.pui', 'const x = 1'))).toBeNull();
  });

  test('build() returns a graph with center matching the cursor identifier', async () => {
    const doc = `signal count = 0\nderived doubled = count * 2\n`;
    const pos = doc.indexOf('count'); // cursor inside the `count` decl name
    const ctx = makeCtx('/x.pui', doc, pos);
    const g = await reactiveProvider.build(ctx);
    expect(g).not.toBeNull();
    expect(g!.kind).toBe('reactive');
    expect(g!.nodes.find((n) => n.center)?.label).toBe('count');
    expect(g!.title).toBe('Reactive · 1 signal, 1 derived, 0 effects');
  });

  test('build() handles plural-zero title formatting', async () => {
    const doc = 'signal a = 1';
    const g = await reactiveProvider.build(makeCtx('/x.pui', doc));
    expect(g!.title).toBe('Reactive · 1 signal, 0 derived, 0 effects');
  });
});
