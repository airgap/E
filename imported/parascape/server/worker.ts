// Parascape hosted backend (parascape.script.dev) — a Cloudflare Worker.
//
// /api/* is dispatched to the lockstep-generated handles (server/generated/
// handles, implemented in server/handlers.ts): the router matches each handle's
// model.method + model.path, runs its generated validator, enforces auth, builds
// the lockstep HTTP context, and serializes the result as JSON. Two endpoints
// don't fit a JSON request/response shape and stay raw routes: GET /assets/:id
// (binary image) and GET /published/:slug (public page snapshot). Everything
// else falls through to the static site (the ASSETS binding → dist/).
//
//   schema:  wrangler d1 execute parascape --remote --file=schema.sql
//   deploy:  wrangler deploy
import { pack, unpack } from 'msgpackr';
import { makeHandles, roleOf } from './handlers';
import { type Env, HttpError, json, userFromRequest, bearerToken } from './lib';
export { ProjectRoom } from './room';

// lockstep's wire format is MessagePack (msgpackr) — it carries bigint, unlike
// JSON. The generated client sends/accepts application/x-msgpack; the handle
// dispatch below packs responses and unpacks request bodies to match.
const MSGPACK = 'application/x-msgpack';
const packed = (data: unknown, status = 200, headers?: Headers): Response => {
	const h = headers ?? new Headers();
	h.set('content-type', MSGPACK);
	return new Response(pack(data), { status, headers: h });
};
// Errors are plain text — the client surfaces the body via res.text().
const fail = (status: number, message: string) =>
	new Response(message, { status, headers: { 'content-type': 'text/plain' } });

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
	const path = url.pathname.replace(/^\/api/, '');
	const method = req.method;

	// ── raw routes (non-JSON shapes) ──
	// public asset binary — <img src="/api/assets/:id">
	const apub = path.match(/^\/assets\/(\d+)$/);
	if (apub && method === 'GET') {
		const row = await env.DB.prepare('SELECT mime, data FROM assets WHERE id = ?')
			.bind(Number(apub[1]))
			.first<{ mime: string; data: ArrayBuffer | number[] }>();
		if (!row) return fail(404, 'No such asset');
		const bytes =
			row.data instanceof ArrayBuffer
				? new Uint8Array(row.data)
				: new Uint8Array(row.data as number[]);
		return new Response(bytes, {
			headers: { 'content-type': row.mime, 'cache-control': 'public, max-age=3600' },
		});
	}
	// public published snapshot — read by /preview/?slug=… (plain JSON, not via the
	// generated client, so this stays JSON rather than msgpack).
	const pubm = path.match(/^\/published\/([a-z0-9-]+)$/);
	if (pubm && method === 'GET') {
		const row = await env.DB.prepare('SELECT doc, updated_at FROM published WHERE slug = ?')
			.bind(pubm[1])
			.first<{ doc: string; updated_at: number }>();
		if (!row) return fail(404, 'No such published page');
		return json({ slug: pubm[1], doc: JSON.parse(row.doc), updated_at: row.updated_at });
	}

	// ── real-time collaboration (LYK-944): WebSocket → the project's room ──
	// The token rides as a query param (browsers can't set WS headers); we
	// authenticate + check ownership here, then forward the upgrade to the Durable
	// Object with the editor's identity in headers.
	const collab = path.match(/^\/collab\/(\d+)$/);
	if (collab) {
		if (req.headers.get('upgrade') !== 'websocket') return fail(426, 'Expected websocket');
		const projectId = Number(collab[1]);
		const token = url.searchParams.get('t') || '';
		const user = await env.DB.prepare(
			'SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?',
		)
			.bind(token)
			.first<{ id: number; username: string }>();
		if (!user) return fail(401, 'Not signed in');
		// owner OR collaborator may join the room (LYK-951); the role gates editing.
		const role = await roleOf(env, projectId, user.id);
		if (!role) return fail(403, 'No access to this project');
		const stub = env.ROOM.get(env.ROOM.idFromName(`p:${projectId}`));
		// Pass identity via query (copying req.headers preserves the WS upgrade as-is).
		const fwd = new URL(req.url);
		fwd.searchParams.set('uid', String(user.id));
		fwd.searchParams.set('uname', user.username);
		fwd.searchParams.set('pid', String(projectId));
		fwd.searchParams.set('role', role);
		return stub.fetch(new Request(fwd.toString(), { method: req.method, headers: req.headers }));
	}

	// ── lockstep handles (msgpack) ──
	const handles = makeHandles(env);
	for (const handle of Object.values(handles)) {
		const model = handle.model as { method: string; path: string; authenticated?: boolean };
		if (model.method !== method || model.path !== path) continue;

		// request: msgpack body for non-GET; GET endpoints carry no request
		let request: unknown = {};
		if (method !== 'GET') {
			const buf = await req.arrayBuffer();
			request = buf.byteLength ? unpack(new Uint8Array(buf)) : {};
		}

		const errors = handle.validator.validate(request);
		if (errors.length) return fail(400, errors[0]);

		let requester: bigint | undefined;
		let session: string | undefined;
		if (model.authenticated) {
			const user = await userFromRequest(req, env);
			if (!user) return fail(401, 'Not signed in');
			requester = BigInt(user.id);
			session = bearerToken(req);
		}

		const responseHeaders = new Headers();
		const context = {
			strings: {} as Record<string, string>,
			model: handle.model,
			now: new Date(),
			request: req,
			responseHeaders,
			requester,
			session,
		};

		try {
			const result = await handle.execute(request as never, context as never);
			return packed(result ?? {}, 200, responseHeaders);
		} catch (e) {
			if (e instanceof HttpError) return fail(e.status, e.message);
			console.error('handler error', e);
			return fail(500, 'Internal error');
		}
	}

	return fail(404, 'Not found');
}

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const url = new URL(req.url);
		if (url.pathname.startsWith('/api')) return handleApi(req, env, url);
		return env.ASSETS.fetch(req);
	},
};
