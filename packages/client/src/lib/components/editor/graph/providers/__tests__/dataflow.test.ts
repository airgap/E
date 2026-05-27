import { describe, test, expect } from 'vitest';
import { dataflowProvider, __test } from '../dataflow';
import { scriptViewOf, enclosingFunction } from '../../ast';
import type { ProviderContext } from '../../types';

const { extractDecls, inferEdges, collectPatternNames, wordAtCursor } = __test;

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

describe('dataflowProvider — enclosingFunction (AST scope)', () => {
  test('finds the inner function when nested', () => {
    const src = `
function outer() {
  const o = 1;
  function inner() {
    const i = 2;
    /* cursor here */
  }
}
`;
    const v = view(src);
    const pos = src.indexOf('/* cursor here */');
    const fn = enclosingFunction(v.source, pos);
    expect(fn).not.toBeNull();
    // Body should include `const i` but not `const o`.
    const bodyText = src.slice(fn!.body!.pos, fn!.body!.end);
    expect(bodyText).toContain('const i = 2');
    expect(bodyText).not.toContain('const o = 1');
  });

  test('returns null at module top level', () => {
    const v = view(`const x = 1;\nconst y = x;`);
    expect(enclosingFunction(v.source, 5)).toBeNull();
  });
});

describe('dataflowProvider — collectPatternNames', () => {
  test('object destructure', () => {
    const v = view(`const { a, b: alias } = obj;`);
    // Walk to the BindingPattern and collect names.
    const decl = (v.source.statements[0] as any).declarationList.declarations[0];
    const names = collectPatternNames(decl.name);
    expect(names.map((n) => n.name).sort()).toEqual(['a', 'alias']);
  });

  test('array destructure with rest', () => {
    const v = view(`const [ x, y, ...tail ] = arr;`);
    const decl = (v.source.statements[0] as any).declarationList.declarations[0];
    const names = collectPatternNames(decl.name);
    expect(names.map((n) => n.name).sort()).toEqual(['tail', 'x', 'y']);
  });
});

describe('dataflowProvider — extract + inferEdges', () => {
  test('downstream edges follow declaration order', () => {
    const v = view(`
let a = 1;
let b = a + 1;
let c = transform(b, a);
`);
    const decls = extractDecls(v, v.source);
    const edges = inferEdges(decls);
    expect(edges).toContainEqual({ from: 'var:a', to: 'var:b' });
    expect(edges).toContainEqual({ from: 'var:b', to: 'var:c' });
    expect(edges).toContainEqual({ from: 'var:a', to: 'var:c' });
  });

  test('forward references (use-before-decl) are not edges', () => {
    const v = view(`let a = b; let b = 2;`);
    const decls = extractDecls(v, v.source);
    const edges = inferEdges(decls);
    expect(edges).not.toContainEqual({ from: 'var:b', to: 'var:a' });
  });

  test('regression: `obj.b` does NOT depend on local `b`', () => {
    const v = view(`let b = 1; let x = obj.b + 5;`);
    const decls = extractDecls(v, v.source);
    const edges = inferEdges(decls);
    expect(edges).not.toContainEqual({ from: 'var:b', to: 'var:x' });
  });

  test('regression: `"b"` string content does NOT depend on local `b`', () => {
    const v = view(`let b = 1; let x = "b" + 5;`);
    const decls = extractDecls(v, v.source);
    const edges = inferEdges(decls);
    expect(edges).not.toContainEqual({ from: 'var:b', to: 'var:x' });
  });

  test('destructure binding names become first-class nodes', () => {
    const v = view(`const { a, b } = obj; const c = a + b;`);
    const decls = extractDecls(v, v.source);
    const names = decls.map((d) => d.name).sort();
    expect(names).toEqual(['a', 'b', 'c']);
    const edges = inferEdges(decls);
    expect(edges).toContainEqual({ from: 'var:a', to: 'var:c' });
    expect(edges).toContainEqual({ from: 'var:b', to: 'var:c' });
  });

  test('nested function decls do NOT pollute outer scope', () => {
    // The cursor scope is the file; inner function vars should NOT appear.
    const v = view(`
const top = 1;
function inner() {
  const hidden = 99;
}
const bot = top + 1;
`);
    const decls = extractDecls(v, v.source);
    const names = decls.map((d) => d.name).sort();
    expect(names).toEqual(['bot', 'top']);
    expect(names).not.toContain('hidden');
  });
});

describe('dataflowProvider — supports / build', () => {
  test('supports() covers ts/tsx/svelte/pui', () => {
    expect(dataflowProvider.supports(makeCtx('/x.ts', ''))).toBe(true);
    expect(dataflowProvider.supports(makeCtx('/x.tsx', ''))).toBe(true);
    expect(dataflowProvider.supports(makeCtx('/x.svelte', ''))).toBe(true);
    expect(dataflowProvider.supports(makeCtx('/x.pui', ''))).toBe(true);
    expect(dataflowProvider.supports(makeCtx('/x.json', ''))).toBe(false);
  });

  test('build() returns null when there is only one declaration', async () => {
    expect(await dataflowProvider.build(makeCtx('/x.ts', `const lone = 1;`))).toBeNull();
  });

  test('build() returns null when declarations never reference each other', async () => {
    expect(await dataflowProvider.build(makeCtx('/x.ts', `const a = 1; const b = 2;`))).toBeNull();
  });

  test('build() centers on the variable under the cursor', async () => {
    const doc = `
function f() {
  const a = source();
  const b = a + 1;
}
`;
    const pos = doc.indexOf('const b') + 'const '.length;
    const g = await dataflowProvider.build(makeCtx('/x.ts', doc, pos));
    expect(g).not.toBeNull();
    expect(g!.kind).toBe('dataflow');
    expect(g!.nodes.find((n) => n.center)?.label).toBe('b');
    expect(g!.edges).toContainEqual({ from: 'var:a', to: 'var:b' });
  });
});

describe('dataflowProvider — wordAtCursor', () => {
  test('returns identifier under cursor', () => {
    expect(wordAtCursor('const fooBar = 1;', 9)).toBe('fooBar');
  });
});
