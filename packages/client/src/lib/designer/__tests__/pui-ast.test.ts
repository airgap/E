import { describe, test, expect } from 'vitest';
import { parsePuiMarkup, instrumentMarkup, findNode, type PuiNode } from '../pui-ast';

// The designer's outline, inspector, click-to-select, and every edit operation
// (text/attr patches, delete/duplicate, drag-reorder) are built on the offsets
// and classification this module produces. These tests pin that contract.

const SAMPLE = `<script lang="pts">
  let count = signal(0);
  // <div> in a comment must not appear in the tree
</script>

<div class="card" id={dynamicId} hidden>
  <h1 class="title">Hello</h1>
  {#if count() > 0}
    <Button variant="primary" on:click={inc} disabled={busy}>Add</Button>
  {/if}
</div>

<style>.card { color: red; /* <h1> in css */ }</style>`;

const flat = (tree: PuiNode[]): PuiNode[] => tree.flatMap((n) => [n, ...flat(n.children)]);

describe('parsePuiMarkup', () => {
  test('builds the markup tree with stable path-ids', () => {
    const { tree, error } = parsePuiMarkup(SAMPLE);
    expect(error).toBeUndefined();
    expect(tree).toHaveLength(1);
    const div = tree[0];
    expect(div.type).toBe('element');
    expect(div.label).toBe('<div>');
    expect(div.id).toBe('0');
    // children: <h1> (0.0) and {#if} (0.1); whitespace text dropped
    const kids = div.children;
    expect(kids.map((k) => k.id)).toEqual(['0.0', '0.1']);
    expect(kids[0].label).toBe('<h1>');
    expect(kids[1].label).toBe('{#if}');
    // <Button> nests inside the if-block
    expect(kids[1].children[0].id).toBe('0.1.0');
    expect(kids[1].children[0].type).toBe('component');
    expect(kids[1].children[0].label).toBe('<Button>');
  });

  test('node offsets reconstruct the original source slice', () => {
    const { tree } = parsePuiMarkup(SAMPLE);
    for (const n of flat(tree)) {
      const slice = SAMPLE.slice(n.start, n.end);
      if (n.type === 'element') expect(slice.startsWith('<')).toBe(true);
      if (n.type === 'text') expect(slice).toBe(n.text);
    }
  });

  test('masks <script>/<style> so their contents never pollute the tree', () => {
    const labels = flat(parsePuiMarkup(SAMPLE).tree).map((n) => n.label);
    // The `<div>` in the JS comment and `<h1>` in the CSS comment are masked out.
    expect(labels.filter((l) => l === '<div>')).toHaveLength(1);
    expect(labels.filter((l) => l === '<h1>')).toHaveLength(1);
  });

  test('drops whitespace-only text nodes but keeps real text', () => {
    const texts = flat(parsePuiMarkup(SAMPLE).tree).filter((n) => n.type === 'text');
    expect(texts.map((t) => t.text)).toEqual(['Hello', 'Add']);
  });

  test('does not throw on malformed markup', () => {
    expect(() => parsePuiMarkup('<div><span>')).not.toThrow();
    const r = parsePuiMarkup('<div><span>');
    expect(Array.isArray(r.tree)).toBe(true);
  });
});

describe('attribute classification', () => {
  const div = parsePuiMarkup(SAMPLE).tree[0];
  const button = findNode([div], '0.1.0')!;

  test('classifies static / expression / boolean attrs', () => {
    const byName = Object.fromEntries((div.attrs ?? []).map((a) => [a.name, a]));
    expect(byName.class.kind).toBe('static');
    expect(byName.class.value).toBe('card');
    expect(byName.id.kind).toBe('expression');
    expect(byName.hidden.kind).toBe('boolean');
  });

  test('static attr value range round-trips against the source', () => {
    const cls = (div.attrs ?? []).find((a) => a.name === 'class')!;
    expect(SAMPLE.slice(cls.valueStart, cls.valueEnd)).toBe('card');
  });

  test('classifies directives with the right prefix and spread', () => {
    const kinds = Object.fromEntries((button.attrs ?? []).map((a) => [a.name, a.kind]));
    expect(kinds.variant).toBe('static');
    expect(kinds['on:click']).toBe('directive');
    expect(kinds.disabled).toBe('expression');

    const spread = parsePuiMarkup('<div {...rest}></div>').tree[0];
    expect(spread.attrs?.[0]).toMatchObject({ name: '{...}', kind: 'spread' });
  });

  test('empty static value stays a zero-width editable range', () => {
    const node = parsePuiMarkup('<div class=""></div>').tree[0];
    const cls = node.attrs![0];
    expect(cls.kind).toBe('static');
    expect(cls.value).toBe('');
    expect(cls.valueStart).toBe(cls.valueEnd);
  });
});

describe('instrumentMarkup', () => {
  test('tags host elements with their path-id, leaves components untouched', () => {
    const { tree } = parsePuiMarkup(SAMPLE);
    const out = instrumentMarkup(SAMPLE, tree);
    expect(out).toContain('<div data-pui-id="0"');
    expect(out).toContain('<h1 data-pui-id="0.0"');
    // <Button> is a component — never tagged (it wouldn't forward the attr).
    expect(out).not.toContain('<Button data-pui-id');
  });

  test('the instrumented copy still parses to the same structure', () => {
    const { tree } = parsePuiMarkup(SAMPLE);
    const out = instrumentMarkup(SAMPLE, tree);
    const reparsed = parsePuiMarkup(out);
    expect(reparsed.error).toBeUndefined();
    const ids = (t: PuiNode[]): string[] => t.flatMap((n) => [n.id, ...ids(n.children)]);
    expect(ids(reparsed.tree)).toEqual(ids(tree));
  });

  test('leaves the canonical source unchanged (returns a copy)', () => {
    const before = SAMPLE;
    instrumentMarkup(SAMPLE, parsePuiMarkup(SAMPLE).tree);
    expect(SAMPLE).toBe(before);
  });
});

describe('findNode', () => {
  const { tree } = parsePuiMarkup(SAMPLE);
  test('finds a deeply nested node by id', () => {
    expect(findNode(tree, '0.1.0')?.label).toBe('<Button>');
  });
  test('returns null for a missing id', () => {
    expect(findNode(tree, '9.9')).toBeNull();
  });
});
