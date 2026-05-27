import { describe, test, expect } from 'vitest';
import { callGraphProvider, __test } from '../call-graph';
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

describe('callGraphProvider — extractDecls', () => {
  test('plain function declarations', () => {
    const src = `
function alpha() { return 1; }
function beta() { return alpha(); }
async function gamma() { await beta(); }
`;
    const decls = extractDecls(src);
    expect(decls.map((d) => d.name).sort()).toEqual(['alpha', 'beta', 'gamma']);
  });

  test('arrow-bound consts with parenthesised params', () => {
    const src = `
const add = (a, b) => a + b;
const dbl = x => x * 2;
`;
    const decls = extractDecls(src);
    expect(decls.map((d) => d.name).sort()).toEqual(['add', 'dbl']);
  });

  test('arrow block body captures full braces', () => {
    const src = `
const f = () => {
  helper();
  inner();
};
function helper() {}
function inner() {}
`;
    const f = extractDecls(src).find((d) => d.name === 'f')!;
    expect(f.body).toContain('helper()');
    expect(f.body).toContain('inner()');
  });

  test('const = function form', () => {
    const src = `const old = function (x) { return x; };`;
    expect(extractDecls(src).map((d) => d.name)).toEqual(['old']);
  });

  test('deduplicates re-declarations of the same name', () => {
    // `let foo = ...` followed by `function foo` — we keep the first match.
    const src = `let foo = () => 1;\nfunction foo() { return 2; }\n`;
    expect(extractDecls(src).filter((d) => d.name === 'foo')).toHaveLength(1);
  });
});

describe('callGraphProvider — inferEdges', () => {
  test('caller → callee for intra-file calls', () => {
    const decls = extractDecls(`
function a() { b(); }
function b() { c(); }
function c() {}
`);
    const edges = inferEdges(decls);
    expect(edges).toContainEqual({ from: 'fn:a', to: 'fn:b' });
    expect(edges).toContainEqual({ from: 'fn:b', to: 'fn:c' });
    expect(edges).not.toContainEqual({ from: 'fn:a', to: 'fn:c' });
  });

  test('self-recursion does not emit a self-edge', () => {
    const decls = extractDecls(`function loop() { loop(); }`);
    expect(inferEdges(decls)).toEqual([]);
  });

  test('identifier reference without a call does not produce an edge', () => {
    // `b` appears in `a`'s body but not as a call.
    const decls = extractDecls(`
function a() { const ref = b; return ref; }
function b() {}
`);
    expect(inferEdges(decls)).toEqual([]);
  });
});

describe('callGraphProvider — wordAtCursor', () => {
  test('returns the identifier under the cursor', () => {
    const doc = 'function fooBar() {}';
    expect(wordAtCursor(doc, 12)).toBe('fooBar');
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

  test('build() returns null when there is only one function (nothing to call)', async () => {
    const ctx = makeCtx('/x.ts', `function lonely() {}`);
    expect(await callGraphProvider.build(ctx)).toBeNull();
  });

  test('build() returns null when functions never call each other', async () => {
    const ctx = makeCtx('/x.ts', `function a() {}\nfunction b() {}\n`);
    expect(await callGraphProvider.build(ctx)).toBeNull();
  });

  test('build() centers on the function under the cursor', async () => {
    const doc = `function a() { b(); }\nfunction b() {}\n`;
    const pos = doc.indexOf('a'); // cursor on `a`
    const g = await callGraphProvider.build(makeCtx('/x.ts', doc, pos));
    expect(g).not.toBeNull();
    expect(g!.kind).toBe('call');
    expect(g!.nodes.find((n) => n.center)?.label).toBe('a');
    expect(g!.edges).toContainEqual({ from: 'fn:a', to: 'fn:b' });
    expect(g!.title).toBe('Call graph · 2 fns, 1 edge');
  });

  test('build() plural-zero / plural-many titles', async () => {
    const g = await callGraphProvider.build(
      makeCtx('/x.ts', `function a() { b(); c(); }\nfunction b() { c(); }\nfunction c() {}\n`),
    );
    expect(g!.title).toBe('Call graph · 3 fns, 3 edges');
  });
});
