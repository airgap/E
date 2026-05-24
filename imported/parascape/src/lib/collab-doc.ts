// Shared CRDT document mapping for real-time collaboration (LYK-944).
//
// Both the browser client (src/lib/collab.ts) and the Cloudflare Durable Object
// room (server/room.ts) (de)serialize a Parascape project to/from a Yjs doc with
// this module — kept independent of designer/Designer.pui (a .pui can't be
// imported server-side) but mirroring its `Project` shape structurally.
//
// Granularity (what merges conflict-free vs last-writer-wins):
//   - project meta (data, components, counters) — one field each, LWW per field
//   - the page LIST — a Y.Array of page maps, so add / remove / per-page edits by
//     different editors merge cleanly (two people on different pages never clash)
//   - a single page's section TREE — one JSON field on that page's map, so two
//     people editing the *same* page resolve last-writer-wins on that page.
// Finer (per-section) merge within one page is a documented follow-up.
import * as Y from 'yjs';

export type CollabPage = {
	id: number;
	name: string;
	route: string;
	params: string;
	doc: { sections: unknown[]; codeOverride: string | null };
	meta?: unknown;
};
export type CollabProject = {
	pages: CollabPage[];
	activePageId: number;
	nextKey: number;
	components: unknown[];
	nextCompId: number;
	data?: Record<string, unknown>;
	dataUrl?: string;
};

const META = 'meta';
const PAGES = 'pages';

// Deterministic JSON: object keys sorted recursively, so the same logical state
// always stringifies identically. This is what makes `projectToYDoc` idempotent —
// re-applying an unchanged project mutates nothing and emits no Yjs update, which
// is what stops a remote-apply → local-autosave → re-broadcast echo loop.
export function stableStringify(value: unknown): string {
	return JSON.stringify(canon(value));
}
function canon(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(canon);
	if (v && typeof v === 'object') {
		const out: Record<string, unknown> = {};
		for (const k of Object.keys(v as Record<string, unknown>).sort())
			out[k] = canon((v as Record<string, unknown>)[k]);
		return out;
	}
	return v;
}

function setIfChanged(m: Y.Map<unknown>, k: string, v: unknown): void {
	if (m.get(k) !== v) m.set(k, v);
}
function findPage(arr: Y.Array<Y.Map<unknown>>, id: number): Y.Map<unknown> | null {
	for (let i = 0; i < arr.length; i++) if (Number(arr.get(i).get('id')) === id) return arr.get(i);
	return null;
}
function writePageScalars(m: Y.Map<unknown>, pg: CollabPage): void {
	setIfChanged(m, 'id', pg.id);
	setIfChanged(m, 'name', pg.name);
	setIfChanged(m, 'route', pg.route);
	setIfChanged(m, 'params', pg.params);
	setIfChanged(m, 'meta', stableStringify(pg.meta ?? null));
	setIfChanged(m, 'codeOverride', pg.doc?.codeOverride ?? null);
}

// ── per-node section storage (LYK-952) + structural CRDT (LYK-953) ──
// A page's section tree is stored as:
//   `nodes`  — a Y.Map of key → that node's own fields (children excluded), so
//              edits to different nodes merge; same-node edits are LWW per field.
//   `order`  — a Y.Map of parentKey → Y.Array<childKey> ("root" = top level; every
//              node with a children array gets an entry, empty for empty containers).
//              Yjs sequence CRDT → concurrent add/remove both survive, reorder
//              merges deterministically. (Was: one `structure` JSON string in 952,
//              one `sections` JSON string before that — both still read as fallback.)
const NODES = 'nodes';
const ORDER = 'order';
const STRUCT = 'structure'; // legacy (LYK-952), read-only fallback
const ROOT = 'root';
type Skel = { k: number; c?: Skel[] };

// Split a tree into a flat key→own-fields map and a parentKey→childKeys map.
function decompose(sections: unknown[]): {
	flat: Map<string, unknown>;
	childrenOf: Map<string, number[]>;
} {
	const flat = new Map<string, unknown>();
	const childrenOf = new Map<string, number[]>();
	const walk = (list: unknown[]): number[] => {
		const ids: number[] = [];
		for (const n of list) {
			const node = n as Record<string, unknown>;
			const key = Number(node.key);
			const { children, ...own } = node;
			flat.set(String(key), own);
			ids.push(key);
			if (Array.isArray(children)) childrenOf.set(String(key), walk(children as unknown[]));
		}
		return ids;
	};
	childrenOf.set(ROOT, walk(sections));
	return { flat, childrenOf };
}

const sameSeq = (a: number[], b: number[]): boolean =>
	a.length === b.length && a.every((v, i) => v === b[i]);

// Converge a Y.Array to `desired` with minimal ops, so concurrent edits from
// another client merge instead of being replaced wholesale.
function reconcileArray(yarr: Y.Array<number>, desired: number[]): void {
	if (sameSeq(yarr.toArray(), desired)) return;
	for (let i = yarr.length - 1; i >= 0; i--) if (!desired.includes(yarr.get(i))) yarr.delete(i, 1);
	for (let i = 0; i < desired.length; i++) {
		const cur = yarr.toArray();
		if (cur[i] === desired[i]) continue;
		const at = cur.indexOf(desired[i]);
		if (at !== -1) yarr.delete(at, 1);
		yarr.insert(i, [desired[i]]);
	}
	while (yarr.length > desired.length) yarr.delete(yarr.length - 1, 1);
}

function writeSections(pageMap: Y.Map<unknown>, sections: unknown[]): void {
	let nm = pageMap.get(NODES);
	if (!(nm instanceof Y.Map)) {
		nm = new Y.Map<unknown>();
		pageMap.set(NODES, nm); // pageMap must already be integrated (see projectToYDoc)
	}
	let om = pageMap.get(ORDER);
	if (!(om instanceof Y.Map)) {
		om = new Y.Map<unknown>();
		pageMap.set(ORDER, om);
	}
	const ynodes = nm as Y.Map<unknown>;
	const yorder = om as Y.Map<unknown>;
	const { flat, childrenOf } = decompose(sections);
	// node fields
	for (const [k, node] of flat) setIfChanged(ynodes, k, stableStringify(node));
	for (const k of [...ynodes.keys()]) if (!flat.has(k)) ynodes.delete(k);
	// structure: one Y.Array per parent
	for (const [parent, ids] of childrenOf) {
		let arr = yorder.get(parent);
		if (!(arr instanceof Y.Array)) {
			arr = new Y.Array<number>();
			yorder.set(parent, arr);
		}
		reconcileArray(arr as Y.Array<number>, ids);
	}
	for (const k of [...yorder.keys()]) if (!childrenOf.has(k)) yorder.delete(k);
	// migrate off older formats
	if (pageMap.has(STRUCT)) pageMap.delete(STRUCT);
	if (pageMap.has('sections')) pageMap.delete('sections');
}

function readSections(pageMap: Y.Map<unknown>): unknown[] {
	const nm = pageMap.get(NODES);
	const om = pageMap.get(ORDER);
	if (nm instanceof Y.Map && om instanceof Y.Map) {
		const seen = new Set<string>();
		const build = (parent: string): unknown[] => {
			const arr = om.get(parent);
			if (!(arr instanceof Y.Array)) return [];
			const out: unknown[] = [];
			for (const key of (arr as Y.Array<number>).toArray()) {
				const ks = String(key);
				if (seen.has(ks)) continue; // a concurrent reparent can list a key under two parents; first wins
				seen.add(ks);
				const own = safeParse(nm.get(ks), {}) as Record<string, unknown>;
				const node: Record<string, unknown> = { ...own, key };
				if (om.get(ks) instanceof Y.Array) node.children = build(ks);
				out.push(node);
			}
			return out;
		};
		return build(ROOT);
	}
	// legacy fallback: LYK-952 `structure` string, then pre-952 `sections` string
	const struct = pageMap.get(STRUCT);
	if (typeof struct === 'string' && nm instanceof Y.Map) {
		const rebuild = (skel: Skel[]): unknown[] =>
			skel.map((s) => {
				const own = safeParse((nm as Y.Map<unknown>).get(String(s.k)), {}) as Record<
					string,
					unknown
				>;
				const node: Record<string, unknown> = { ...own, key: s.k };
				if (s.c) node.children = rebuild(s.c);
				return node;
			});
		return rebuild(safeParse(struct, []) as Skel[]);
	}
	return safeParse(pageMap.get('sections'), []) as unknown[];
}

/** Reconcile a project into the Y.Doc, mutating only what differs. Counters
 *  merge by max so two clients minting new keys don't regress each other. The
 *  active page is intentionally NOT synced — each editor keeps its own viewport. */
export function projectToYDoc(doc: Y.Doc, p: CollabProject): void {
	const meta = doc.getMap<unknown>(META);
	setIfChanged(meta, 'nextKey', Math.max(Number(meta.get('nextKey') ?? 0), p.nextKey));
	setIfChanged(meta, 'nextCompId', Math.max(Number(meta.get('nextCompId') ?? 0), p.nextCompId));
	setIfChanged(meta, 'components', stableStringify(p.components ?? []));
	setIfChanged(meta, 'data', stableStringify(p.data ?? {}));
	setIfChanged(meta, 'dataUrl', p.dataUrl ?? '');

	const arr = doc.getArray<Y.Map<unknown>>(PAGES);
	const wantIds = p.pages.map((pg) => pg.id);
	// drop removed pages (high index first so indices stay valid)
	for (let i = arr.length - 1; i >= 0; i--) {
		if (!wantIds.includes(Number(arr.get(i).get('id')))) arr.delete(i, 1);
	}
	// upsert; new pages append (manual reorder is a follow-up). New page maps are
	// pushed (integrated) BEFORE writeSections, so its nested `nodes` Y.Map attaches
	// to an integrated parent.
	p.pages.forEach((pg) => {
		let m = findPage(arr, pg.id);
		if (!m) {
			m = new Y.Map<unknown>();
			arr.push([m]); // integrate first, so writes (incl. the nested nodes map) attach cleanly
		}
		writePageScalars(m, pg);
		writeSections(m, pg.doc?.sections ?? []);
	});
}

export function ydocToProject(doc: Y.Doc): CollabProject {
	const meta = doc.getMap<unknown>(META);
	const arr = doc.getArray<Y.Map<unknown>>(PAGES);
	const pages: CollabPage[] = [];
	for (let i = 0; i < arr.length; i++) {
		const m = arr.get(i);
		pages.push({
			id: Number(m.get('id')),
			name: String(m.get('name') ?? 'Page'),
			route: String(m.get('route') ?? '/'),
			params: String(m.get('params') ?? ''),
			meta: safeParse(m.get('meta'), null) ?? undefined,
			doc: {
				sections: readSections(m),
				codeOverride: (m.get('codeOverride') as string | null) ?? null,
			},
		});
	}
	return {
		pages,
		activePageId: pages[0]?.id ?? 1,
		nextKey: Number(meta.get('nextKey') ?? 1),
		nextCompId: Number(meta.get('nextCompId') ?? 1),
		components: safeParse(meta.get('components'), []) as unknown[],
		data: safeParse(meta.get('data'), {}) as Record<string, unknown>,
		dataUrl: String(meta.get('dataUrl') ?? '') || undefined,
	};
}
function safeParse<T>(v: unknown, fallback: T): T {
	if (typeof v !== 'string') return fallback;
	try {
		return JSON.parse(v) as T;
	} catch {
		return fallback;
	}
}

/** Stable per-identity colour for presence cursors/avatars. */
export function colorFor(seed: string): string {
	let h = 0;
	for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
	return `hsl(${h}, 70%, 55%)`;
}
