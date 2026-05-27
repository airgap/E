import { describe, test, expect } from 'vitest';
import { callGraphProvider, __test } from '../call-graph';
import { scriptViewOf } from '../../ast';
import type { ProviderContext } from '../../types';

const { extractDecls, inferEdges, wordAtCursor } = __test;

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

const view = (src: string) => scriptViewOf(src, 'ts');

describe('callGraphProvider — extractDecls (AST)', () => {
  test('plain function declarations', () => {
    const decls = extractDecls(
      view(`
function alpha() { return 1; }
function beta() { return alpha(); }
async function gamma() { await beta(); }
`),
    );
    expect(decls.map((d) => d.name).sort()).toEqual(['alpha', 'beta', 'gamma']);
  });

  test('arrow-bound consts with parenthesised + bare params', () => {
    const decls = extractDecls(
      view(`
const add = (a, b) => a + b;
const dbl = x => x * 2;
`),
    );
    expect(decls.map((d) => d.name).sort()).toEqual(['add', 'dbl']);
  });

  test('const = function form', () => {
    const decls = extractDecls(view(`const old = function (x) { return x; };`));
    expect(decls.map((d) => d.name)).toEqual(['old']);
  });

  test('deduplicates re-declarations of the same name', () => {
    const decls = extractDecls(view(`let foo = () => 1;\nfunction foo() { return 2; }\n`));
    expect(decls.filter((d) => d.name === 'foo')).toHaveLength(1);
  });
});

describe('callGraphProvider — inferEdges (AST)', () => {
  test('caller → callee for intra-file calls', () => {
    const decls = extractDecls(
      view(`
function a() { b(); }
function b() { c(); }
function c() {}
`),
    );
    const edges = inferEdges(decls);
    expect(edges).toContainEqual({ from: 'fn:a', to: 'fn:b' });
    expect(edges).toContainEqual({ from: 'fn:b', to: 'fn:c' });
    expect(edges).not.toContainEqual({ from: 'fn:a', to: 'fn:c' });
  });

  test('self-recursion does not emit a self-edge', () => {
    const decls = extractDecls(view(`function loop() { loop(); }`));
    expect(inferEdges(decls)).toEqual([]);
  });

  test('identifier reference without a call does not produce an edge', () => {
    // `b` appears in `a`'s body but not as a call.
    const decls = extractDecls(
      view(`
function a() { const ref = b; return ref; }
function b() {}
`),
    );
    expect(inferEdges(decls)).toEqual([]);
  });

  test('regression: `obj.b()` does NOT call local `b`', () => {
    // The v1 regex `\\bb\\s*\\(` matched member-access calls too. The AST
    // correctly distinguishes PropertyAccess from plain Identifier.
    const decls = extractDecls(
      view(`
function a() { obj.b(); }
function b() {}
`),
    );
    expect(inferEdges(decls)).toEqual([]);
  });

  test('regression: `b()` inside a string literal does NOT count as a call', () => {
    const decls = extractDecls(
      view(`
function a() { return "b()"; }
function b() {}
`),
    );
    expect(inferEdges(decls)).toEqual([]);
  });

  test('regression: `b()` inside a // comment does NOT count', () => {
    const decls = extractDecls(
      view(`
function a() { /* b(); */ return 0; }
function b() {}
`),
    );
    expect(inferEdges(decls)).toEqual([]);
  });
});

describe('callGraphProvider — wordAtCursor', () => {
  test('returns the identifier under the cursor', () => {
    expect(wordAtCursor('function fooBar() {}', 12)).toBe('fooBar');
  });
});

describe('callGraphProvider — supports / build', () => {
  test('supports() covers ts/tsx/svelte/pui', () => {
    expect(callGraphProvider.supports(makeCtx('/x.ts', ''))).toBe(true);
    expect(callGraphProvider.supports(makeCtx('/x.tsx', ''))).toBe(true);
    expect(callGraphProvider.supports(makeCtx('/x.svelte', ''))).toBe(true);
    expect(callGraphProvider.supports(makeCtx('/x.pui', ''))).toBe(true);
    expect(callGraphProvider.supports(makeCtx('/x.js', ''))).toBe(false);
  });

  test('build() returns null when there is only one function', async () => {
    expect(await callGraphProvider.build(makeCtx('/x.ts', `function lonely() {}`))).toBeNull();
  });

  test('build() returns null when functions never call each other', async () => {
    expect(
      await callGraphProvider.build(makeCtx('/x.ts', `function a() {}\nfunction b() {}\n`)),
    ).toBeNull();
  });

  test('build() centers on the function under the cursor', async () => {
    const doc = `function a() { b(); }\nfunction b() {}\n`;
    const pos = doc.indexOf('a');
    const g = await callGraphProvider.build(makeCtx('/x.ts', doc, pos));
    expect(g).not.toBeNull();
    expect(g!.kind).toBe('call');
    expect(g!.nodes.find((n) => n.center)?.label).toBe('a');
    expect(g!.edges).toContainEqual({ from: 'fn:a', to: 'fn:b' });
    expect(g!.title).toBe('Call graph · 2 fns, 1 edge');
  });

  test('build() title pluralisation', async () => {
    const g = await callGraphProvider.build(
      makeCtx('/x.ts', `function a() { b(); c(); }\nfunction b() { c(); }\nfunction c() {}\n`),
    );
    expect(g!.title).toBe('Call graph · 3 fns, 3 edges');
  });
});
