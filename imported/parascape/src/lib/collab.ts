// Real-time collaboration client (LYK-944).
//
// Holds a Yjs doc mirroring the open project, syncs it over a WebSocket to the
// project's Durable Object room (server/room.ts), and tracks peer presence
// (live cursors + who's editing). The Designer drives it: push(currentProject)
// on every local edit, and applies the "remote" callback's project on inbound
// changes. Echo is avoided because projectToYDoc is idempotent (stable JSON) and
// remote updates apply under a "remote" origin that the local→server sender skips.
import * as Y from 'yjs';
import { type CollabProject, projectToYDoc, ydocToProject, colorFor } from './collab-doc';

export type Presence = {
	id: number;
	name: string;
	color: string;
	cursor?: { x: number; y: number };
	page?: number;
};

type Events = {
	remote: (project: CollabProject) => void;
	presence: (peers: Presence[]) => void;
	status: (online: boolean) => void;
	comments: () => void; // a peer added/changed a comment → refetch (LYK-955)
};

const b64encode = (bytes: Uint8Array): string => {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin);
};
const b64decode = (b64: string): Uint8Array => {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
};

export type CollabHandle = {
	connect(): void;
	disconnect(): void;
	push(project: CollabProject): void;
	setCursor(x: number, y: number, page: number): void;
	notifyComments(): void;
	on<K extends keyof Events>(ev: K, cb: Events[K]): void;
};

export function createCollab(opts: {
	projectId: number;
	token: string;
	selfName: string;
	selfId: string;
	// the editor's current project, used to seed a brand-new (empty) room exactly once
	getLocal: () => CollabProject;
}): CollabHandle {
	const doc = new Y.Doc();
	const myColor = colorFor(opts.selfId || opts.selfName);
	const peers = new Map<number, Presence>();
	const handlers: { [K in keyof Events]?: Events[K] } = {};
	const emit = <K extends keyof Events>(ev: K, ...args: Parameters<Events[K]>) =>
		(handlers[ev] as ((...a: Parameters<Events[K]>) => void) | undefined)?.(...args);

	let ws: WebSocket | null = null;
	let open = false;
	let closed = false; // disconnect() called → stop reconnecting
	let synced = false; // received the room's initial state at least once
	let myCursor: { x: number; y: number; page: number } | null = null;
	let cursorTimer: ReturnType<typeof setTimeout> | null = null;

	// Local edits produce non-"remote"-origin updates → forward to the room.
	doc.on('update', (update: Uint8Array, origin: unknown) => {
		if (origin === 'remote') return;
		if (open && ws) ws.send(JSON.stringify({ t: 'update', update: b64encode(update) }));
	});

	// Local edits are mirrored into the shared doc — but only after we've taken the
	// room's state (synced). Seeding before then would create a second, independent
	// copy of the project that merges into duplicates; instead exactly one client
	// (the first into an empty room) seeds, in onSync below.
	function push(project: CollabProject): void {
		if (!synced) return;
		doc.transact(() => projectToYDoc(doc, project), 'local');
	}

	// The room's full state on (re)connect. First time: adopt it if non-empty, else
	// seed the empty room from local. Later syncs just re-adopt (idempotent merge).
	function onSync(b64: string): void {
		Y.applyUpdate(doc, b64decode(b64), 'remote');
		const first = !synced;
		synced = true;
		const proj = ydocToProject(doc);
		if (proj.pages.length) emit('remote', proj);
		else if (first) push(opts.getLocal());
	}

	function applyRemote(b64: string): void {
		Y.applyUpdate(doc, b64decode(b64), 'remote');
		const proj = ydocToProject(doc);
		if (proj.pages.length) emit('remote', proj);
	}

	function sendPresence(): void {
		if (!open || !ws) return;
		const p: Partial<Presence> = { name: opts.selfName, color: myColor };
		if (myCursor) {
			p.cursor = { x: myCursor.x, y: myCursor.y };
			p.page = myCursor.page;
		}
		ws.send(JSON.stringify({ t: 'presence', p }));
	}

	function setCursor(x: number, y: number, page: number): void {
		myCursor = { x, y, page };
		if (cursorTimer) return; // throttle to ~20/s
		cursorTimer = setTimeout(() => {
			cursorTimer = null;
			sendPresence();
		}, 50);
	}

	function handle(msg: { t: string; [k: string]: unknown }): void {
		switch (msg.t) {
			case 'welcome': {
				peers.clear();
				for (const p of (msg.peers as Presence[]) ?? []) peers.set(p.id, p);
				emit('presence', [...peers.values()]);
				break;
			}
			case 'sync':
				onSync(msg.update as string);
				break;
			case 'update':
				applyRemote(msg.update as string);
				break;
			case 'presence': {
				const p = msg.p as Presence;
				peers.set(Number(msg.clientId), { ...p, id: Number(msg.clientId) });
				emit('presence', [...peers.values()]);
				break;
			}
			case 'leave':
				peers.delete(Number(msg.clientId));
				emit('presence', [...peers.values()]);
				break;
			case 'comments':
				emit('comments');
				break;
		}
	}

	function notifyComments(): void {
		if (open && ws) ws.send(JSON.stringify({ t: 'comments' }));
	}

	function connect(): void {
		if (closed || ws) return;
		const proto = location.protocol === 'https:' ? 'wss' : 'ws';
		const url = `${proto}://${location.host}/api/collab/${opts.projectId}?t=${encodeURIComponent(opts.token)}`;
		ws = new WebSocket(url);
		ws.onopen = () => {
			open = true;
			emit('status', true);
			// On reconnect (already synced), our doc shares item IDs with the room, so
			// re-sending full state just merges any offline edits. On first connect we
			// must NOT send — we wait for the room's state (onSync) to avoid seeding a
			// duplicate copy. Announce presence either way.
			if (synced)
				ws?.send(JSON.stringify({ t: 'update', update: b64encode(Y.encodeStateAsUpdate(doc)) }));
			sendPresence();
		};
		ws.onmessage = (ev: MessageEvent) => {
			try {
				handle(JSON.parse(typeof ev.data === 'string' ? ev.data : ''));
			} catch {}
		};
		ws.onclose = () => {
			open = false;
			ws = null;
			emit('status', false);
			peers.clear();
			emit('presence', []);
			if (!closed) setTimeout(connect, 2000); // reconnect with backoff
		};
		ws.onerror = () => ws?.close();
	}

	function disconnect(): void {
		closed = true;
		open = false;
		try {
			ws?.close();
		} catch {}
		ws = null;
	}

	return {
		connect,
		disconnect,
		push,
		setCursor,
		notifyComments,
		on: (ev, cb) => {
			handlers[ev] = cb;
		},
	};
}
