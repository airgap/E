// ProjectRoom — the per-project Durable Object that powers real-time
// collaboration (LYK-944). One instance per project (keyed `p:<id>`); the Worker
// authenticates the WebSocket upgrade (session + ownership) and forwards it here
// with the editor's identity in headers.
//
// The room holds the authoritative Yjs doc, relays each client's updates to the
// others, relays presence (cursors / who's editing, not persisted), and snapshots
// the merged doc to D1's projects row (so plain REST loads stay current and the
// state survives the DO being evicted). Yjs updates are commutative, so a late
// joiner just gets the full state on connect.
import * as Y from 'yjs';
import { ydocToProject, colorFor } from '../src/lib/collab-doc';
import type { Env } from './lib';
import { bytesToB64, b64ToBytes, now } from './lib';

type Presence = {
	id: number;
	name: string;
	color: string;
	cursor?: { x: number; y: number };
	page?: number;
};
type Client = { ws: WebSocket; p: Presence; canEdit: boolean };

interface DOStorage {
	get<T = unknown>(key: string): Promise<T | undefined>;
	put(key: string, value: unknown): Promise<void>;
}
interface DOState {
	storage: DOStorage;
}

export class ProjectRoom {
	private state: DOState;
	private env: Env;
	private doc = new Y.Doc();
	private loaded = false;
	private clients = new Map<number, Client>();
	private seq = 0;
	private projectId = 0;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(state: DOState, env: Env) {
		this.state = state;
		this.env = env;
	}

	private async ensureLoaded(): Promise<void> {
		if (this.loaded) return;
		this.loaded = true;
		const saved = await this.state.storage.get<Uint8Array | ArrayBuffer | number[]>('y');
		if (saved) {
			const bytes =
				saved instanceof Uint8Array
					? saved
					: saved instanceof ArrayBuffer
						? new Uint8Array(saved)
						: Uint8Array.from(saved as number[]);
			try {
				Y.applyUpdate(this.doc, bytes, 'load');
			} catch {}
		}
	}

	async fetch(req: Request): Promise<Response> {
		if (req.headers.get('upgrade') !== 'websocket')
			return new Response('expected websocket', { status: 426 });
		const q = new URL(req.url).searchParams;
		const pid = Number(q.get('pid') ?? 0);
		if (pid) this.projectId = pid;
		const userId = q.get('uid') || '';
		const name = q.get('uname') || 'Someone';
		const canEdit = q.get('role') !== 'viewer'; // owner/editor may write; viewer is read-only
		await this.ensureLoaded();

		const pair = new WebSocketPair();
		const client = (pair as unknown as Record<number, WebSocket>)[0];
		const server = (pair as unknown as Record<number, WebSocket>)[1];
		(server as unknown as { accept(): void }).accept();

		const clientId = ++this.seq;
		const who: Presence = { id: clientId, name, color: colorFor(userId || name) };
		this.clients.set(clientId, { ws: server, p: who, canEdit });

		const peers = [...this.clients.values()].filter((c) => c.p.id !== clientId).map((c) => c.p);
		server.send(JSON.stringify({ t: 'welcome', clientId, peers }));
		server.send(JSON.stringify({ t: 'sync', update: bytesToB64(Y.encodeStateAsUpdate(this.doc)) }));
		this.broadcast(clientId, JSON.stringify({ t: 'presence', clientId, p: who }));

		server.addEventListener('message', (ev: MessageEvent) => this.onMessage(clientId, ev.data));
		server.addEventListener('close', () => this.onClose(clientId));
		server.addEventListener('error', () => this.onClose(clientId));

		return new Response(null, { status: 101, webSocket: client } as ResponseInit & {
			webSocket: WebSocket;
		});
	}

	private onMessage(clientId: number, data: string | ArrayBuffer): void {
		const me = this.clients.get(clientId);
		if (!me) return;
		let msg: { t: string; [k: string]: unknown };
		try {
			msg = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
		} catch {
			return;
		}
		if (msg.t === 'update') {
			if (!me.canEdit) return; // viewers are read-only — drop edits even from a hostile client
			try {
				Y.applyUpdate(this.doc, b64ToBytes(msg.update as string), 'client');
			} catch {
				return;
			}
			this.broadcast(clientId, JSON.stringify({ t: 'update', update: msg.update }));
			this.schedulePersist();
		} else if (msg.t === 'presence') {
			me.p = { ...me.p, ...(msg.p as Partial<Presence>), id: clientId };
			this.broadcast(clientId, JSON.stringify({ t: 'presence', clientId, p: me.p }));
		} else if (msg.t === 'comments') {
			// review comments live in D1, not the CRDT — just relay a "refetch" ping
			// (allowed from any member, incl. viewers, since commenting is open to them)
			this.broadcast(clientId, JSON.stringify({ t: 'comments' }));
		} else if (msg.t === 'sync') {
			try {
				const diff = Y.encodeStateAsUpdate(this.doc, b64ToBytes(msg.sv as string));
				me.ws.send(JSON.stringify({ t: 'sync', update: bytesToB64(diff) }));
			} catch {}
		}
	}

	private onClose(clientId: number): void {
		if (!this.clients.has(clientId)) return;
		this.clients.delete(clientId);
		this.broadcast(clientId, JSON.stringify({ t: 'leave', clientId }));
	}

	private broadcast(exceptId: number, str: string): void {
		for (const [id, c] of this.clients) {
			if (id === exceptId) continue;
			try {
				c.ws.send(str);
			} catch {}
		}
	}

	private schedulePersist(): void {
		if (this.saveTimer) return;
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			void this.persist();
		}, 600);
	}

	private async persist(): Promise<void> {
		try {
			await this.state.storage.put('y', Y.encodeStateAsUpdate(this.doc));
			if (this.projectId) {
				const proj = ydocToProject(this.doc);
				if (proj.pages.length) {
					await this.env.DB.prepare('UPDATE projects SET doc = ?, updated_at = ? WHERE id = ?')
						.bind(JSON.stringify(proj), now(), this.projectId)
						.run();
				}
			}
		} catch {
			// best-effort; the live doc is the source of truth while clients are connected
		}
	}
}
