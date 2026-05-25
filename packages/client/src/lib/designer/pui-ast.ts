// `.pui` markup → structural node tree for the visual designer (LYK-970).
//
// Source-canonical: we parse the markup with svelte/compiler and keep each
// node's [start,end] offsets into the ORIGINAL source, so edits are range
// patches (no lossy serialize/round-trip — comments + formatting survive). The
// `<script>`/`<style>` blocks are masked to whitespace first so Para syntax in
// the script can't break the markup parse and offsets stay aligned.
import { parse } from 'svelte/compiler';

export interface PuiAttr {
  /** Display name — `class`, `bind:value`, `on:click`, `{...spread}`. */
  name: string;
  /** static = quoted literal (editable); the rest are read-only here. */
  kind: 'static' | 'expression' | 'boolean' | 'directive' | 'spread';
  /** Literal value (static attrs only). */
  value?: string;
  /** Source range of the literal value, for in-place range patches (static only). */
  valueStart?: number;
  valueEnd?: number;
}

export interface PuiNode {
  /** Path-index id, stable across re-parse for the same structure (e.g. "0.2.1"). */
  id: string;
  type: 'element' | 'component' | 'text' | 'expression' | 'block' | 'other';
  label: string;
  start: number;
  end: number;
  /** Editable plain text (Text nodes only). */
  text?: string;
  /** Attributes/props/directives (element + component nodes). */
  attrs?: PuiAttr[];
  children: PuiNode[];
}

export interface PuiParseResult {
  tree: PuiNode[];
  error?: string;
}

/** Blank <script>/<style> bodies (keep length + newlines) so markup offsets stay aligned. */
function maskScriptStyle(src: string): string {
  return src.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, (m) => m.replace(/[^\n]/g, ' '));
}

type RawNode = Record<string, unknown> & { type?: string; start?: number; end?: number };

function childrenOf(n: RawNode): RawNode[] {
  const kids: RawNode[] = [];
  const push = (frag: unknown) => {
    const nodes = (frag as { nodes?: RawNode[] })?.nodes;
    if (Array.isArray(nodes)) kids.push(...nodes);
  };
  switch (n.type) {
    case 'RegularElement':
    case 'Component':
    case 'SvelteElement':
    case 'SvelteComponent':
    case 'SvelteFragment':
    case 'SvelteSelf':
    case 'SlotElement':
    case 'TitleElement':
      push(n.fragment);
      break;
    case 'IfBlock':
      push(n.consequent);
      push(n.alternate);
      break;
    case 'EachBlock':
      push(n.body);
      push(n.fallback);
      break;
    case 'AwaitBlock':
      push(n.pending);
      push(n.then);
      push(n.catch);
      break;
    case 'KeyBlock':
    case 'SnippetBlock':
      push(n.fragment ?? n.body);
      break;
  }
  return kids;
}

/** `bind:value` / `on:click` / `class:x` / `use:y` … from a directive node. */
function directiveLabel(a: RawNode): string {
  const name = (a.name as string) ?? '';
  const prefix: Record<string, string> = {
    BindDirective: 'bind',
    OnDirective: 'on',
    ClassDirective: 'class',
    StyleDirective: 'style',
    UseDirective: 'use',
    TransitionDirective: 'transition',
    AnimateDirective: 'animate',
    LetDirective: 'let',
  };
  const p = prefix[a.type as string];
  return p ? `${p}:${name}` : name || (a.type as string);
}

/** Element/component attributes → editable-aware descriptors. */
function attrsOf(n: RawNode): PuiAttr[] {
  const raw = n.attributes as RawNode[] | undefined;
  if (!Array.isArray(raw)) return [];
  const out: PuiAttr[] = [];
  for (const a of raw) {
    const name = (a.name as string) ?? '';
    if (a.type === 'SpreadAttribute') {
      out.push({ name: '{...}', kind: 'spread' });
    } else if (a.type === 'Attribute') {
      const v = a.value;
      if (v === true) {
        out.push({ name, kind: 'boolean' });
      } else if (Array.isArray(v) && v.length === 1 && (v[0] as RawNode).type === 'Text') {
        const t = v[0] as RawNode;
        out.push({
          name,
          kind: 'static',
          value: (t.data as string) ?? '',
          valueStart: t.start as number,
          valueEnd: t.end as number,
        });
      } else {
        // Expression `{x}`, or interpolated `"a{b}c"` — read-only here.
        out.push({ name, kind: 'expression' });
      }
    } else {
      out.push({ name: directiveLabel(a), kind: 'directive' });
    }
  }
  return out;
}

function classify(n: RawNode): { type: PuiNode['type']; label: string; text?: string } {
  const name = (n.name as string) ?? '';
  switch (n.type) {
    case 'RegularElement':
    case 'SvelteElement':
    case 'TitleElement':
    case 'SlotElement':
      return {
        type: 'element',
        label: `<${name || (n.type === 'SvelteElement' ? 'svelte:element' : 'slot')}>`,
      };
    case 'Component':
    case 'SvelteComponent':
    case 'SvelteSelf':
      return { type: 'component', label: `<${name || 'svelte:component'}>` };
    case 'Text': {
      const data = ((n.data as string) ?? '').trim();
      return {
        type: 'text',
        label: data ? `"${data.slice(0, 40)}"` : '',
        text: (n.data as string) ?? '',
      };
    }
    case 'ExpressionTag':
      return { type: 'expression', label: '{ … }' };
    case 'IfBlock':
      return { type: 'block', label: '{#if}' };
    case 'EachBlock':
      return { type: 'block', label: '{#each}' };
    case 'AwaitBlock':
      return { type: 'block', label: '{#await}' };
    case 'KeyBlock':
      return { type: 'block', label: '{#key}' };
    case 'SnippetBlock':
      return { type: 'block', label: '{#snippet}' };
    default:
      return { type: 'other', label: String(n.type ?? '') };
  }
}

function walk(nodes: RawNode[], prefix: string): PuiNode[] {
  const out: PuiNode[] = [];
  let i = 0;
  for (const n of nodes) {
    const { type, label, text } = classify(n);
    // Drop whitespace-only text nodes — pure layout noise in the outline.
    if (type === 'text' && !label) continue;
    const id = prefix ? `${prefix}.${i}` : `${i}`;
    const attrs = type === 'element' || type === 'component' ? attrsOf(n) : undefined;
    out.push({
      id,
      type,
      label,
      text,
      attrs: attrs && attrs.length ? attrs : undefined,
      start: (n.start as number) ?? 0,
      end: (n.end as number) ?? 0,
      children: walk(childrenOf(n), id),
    });
    i++;
  }
  return out;
}

export function parsePuiMarkup(source: string): PuiParseResult {
  try {
    const ast = parse(maskScriptStyle(source), { modern: true }) as unknown as {
      fragment?: { nodes?: RawNode[] };
    };
    return { tree: walk(ast.fragment?.nodes ?? [], '') };
  } catch (e) {
    return { tree: [], error: (e as Error).message };
  }
}

/**
 * Insert `data-pui-id="<id>"` into each host element's opening tag so a click in
 * the rendered preview maps back to its outline node. Returns an instrumented
 * COPY — the canonical source the user edits is never touched. Only host
 * elements get ids; components don't forward unknown attributes to the DOM, so a
 * click inside one resolves to the nearest tagged ancestor.
 */
export function instrumentMarkup(source: string, tree: PuiNode[]): string {
  const inserts: { at: number; text: string }[] = [];
  const visit = (nodes: PuiNode[]) => {
    for (const n of nodes) {
      if (n.type === 'element') {
        const m = /^<([A-Za-z][A-Za-z0-9:-]*)/.exec(source.slice(n.start, n.start + 64));
        if (m) inserts.push({ at: n.start + m[0].length, text: ` data-pui-id="${n.id}"` });
      }
      visit(n.children);
    }
  };
  visit(tree);
  // Apply back-to-front so earlier offsets stay valid as we splice.
  inserts.sort((a, b) => b.at - a.at);
  let out = source;
  for (const ins of inserts) out = out.slice(0, ins.at) + ins.text + out.slice(ins.at);
  return out;
}

/** Find a node by id in a tree. */
export function findNode(tree: PuiNode[], id: string): PuiNode | null {
  for (const n of tree) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}
