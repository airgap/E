import { describe, test, expect } from 'vitest';
import { dataflowProvider, __test } from '../dataflow';
import type { ProviderContext } from '../../types';

const { enclosingScope, extractDecls, extractRefs, inferEdges, sliceInitialiser } = __test;

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

describe('dataflowProvider — enclosingScope', () => {
  test('returns the function body when cursor is inside it', () => {
    const doc = `
function f() {
  let a = 1;
  let b = a;
}
`;
    const pos = doc.indexOf('let a'); // cursor inside the body
    const scope = enclosingScope(doc, pos);
    expect(scope.text.startsWith('{')).toBe(true);
    expect(scope.text).toContain('let a = 1');
    expect(scope.text).toContain('let b = a');
  });

  test('returns the whole doc when cursor is at top level', () => {
    const doc = `const x = 1;\nconst y = x;\n`;
    const scope = enclosingScope(doc, 5);
    expect(scope.start).toBe(0);
    expect(scope.text).toBe(doc);
  });

  test('finds the INNER scope when nested', () => {
    const doc = `
function outer() {
  const o = 1;
  function inner() {
    const i = 2;
    /* cursor here */
  }
}
`;
    const pos = doc.indexOf('/* cursor here */');
    const scope = enclosingScope(doc, pos);
    expect(scope.text).toContain('const i = 2');
    expect(scope.text).not.toContain('const o = 1');
  });
});

describe('dataflowProvider — sliceInitialiser', () => {
  test('stops at semicolon at depth 0', () => {
    const doc = `let x = a + b; let y = 1;`;
    const start = doc.indexOf('a + b');
    expect(sliceInitialiser(doc, start).trim()).toBe('a + b');
  });

  test('respects nested parens and brackets', () => {
    const doc = `let x = f(a, b, c) + g([1, 2]);\n`;
    const start = doc.indexOf('f(');
    expect(sliceInitialiser(doc, start).trim()).toBe('f(a, b, c) + g([1, 2])');
  });
});

describe('dataflowProvider — extractRefs', () => {
  test('returns identifiers, excluding keywords', () => {
    const refs = extractRefs(`a + b * c + true`);
    expect(refs.has('a')).toBe(true);
    expect(refs.has('b')).toBe(true);
    expect(refs.has('c')).toBe(true);
    expect(refs.has('true')).toBe(false);
  });

  test('excludes identifiers after a dot (member access)', () => {
    const refs = extractRefs(`obj.foo + bar`);
    expect(refs.has('obj')).toBe(true);
    expect(refs.has('foo')).toBe(false); // member name, not a ref
    expect(refs.has('bar')).toBe(true);
  });

  test('strips string contents', () => {
    const refs = extractRefs(`"a + b" + c`);
    expect(refs.has('a')).toBe(false);
    expect(refs.has('b')).toBe(false);
    expect(refs.has('c')).toBe(true);
  });
});

describe('dataflowProvider — inferEdges', () => {
  test('downstream edges from declared-before to declared-after', () => {
    const doc = `
let a = 1;
let b = a + 1;
let c = transform(b, a);
`;
    const decls = extractDecls(doc, 0);
    const edges = inferEdges(decls);
    // a → b
    expect(edges).toContainEqual({ from: 'var:a', to: 'var:b' });
    // b → c, a → c
    expect(edges).toContainEqual({ from: 'var:b', to: 'var:c' });
    expect(edges).toContainEqual({ from: 'var:a', to: 'var:c' });
  });

  test('forward references are not edges (use-before-decl)', () => {
    const doc = `let a = b; let b = 2;`;
    const decls = extractDecls(doc, 0);
    const edges = inferEdges(decls);
    // `a = b` happens before b is declared → no edge.
    expect(edges).not.toContainEqual({ from: 'var:b', to: 'var:a' });
  });

  test('a declaration that references nothing produces no edges', () => {
    const doc = `let a = 1; let b = 2;`;
    expect(inferEdges(extractDecls(doc, 0))).toEqual([]);
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
    const pos = doc.indexOf('const b') + 'const '.length; // cursor on `b`
    const g = await dataflowProvider.build(makeCtx('/x.ts', doc, pos));
    expect(g).not.toBeNull();
    expect(g!.kind).toBe('dataflow');
    expect(g!.nodes.find((n) => n.center)?.label).toBe('b');
    expect(g!.edges).toContainEqual({ from: 'var:a', to: 'var:b' });
  });
});
