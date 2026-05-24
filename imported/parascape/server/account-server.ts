// Parascape account + persistence server (LYK-930).
//
// A small ParaBun HTTP service backing the Designer's persistence: basic
// username/password auth and per-user project storage, all in a local SQLite
// file (bun:sqlite). Passwords are hashed with Bun.password (argon2id);
// sessions are opaque bearer tokens. The Vite dev server proxies /api → here
// (see vite.config.ts) so the browser talks same-origin.
//
//   bun run account:server      # or: parabun server/account-server.ts
//
// This is a LOCAL dev backend — single SQLite file, no TLS. Don't expose it.
import { Database } from 'bun:sqlite';
import { join } from 'node:path';

const PORT = Number(process.env.PARASCAPE_ACCOUNT_PORT ?? 8788);
const DB_PATH = process.env.PARASCAPE_DB ?? 'parascape.sqlite';
// Single-user "guest" mode (the desktop / Tauri build): auth is bypassed, every
// request belongs to one built-in guest account, and the account UI is hidden in
// the client. Set PARASCAPE_GUEST=1.
const GUEST = process.env.PARASCAPE_GUEST === '1' || process.env.PARASCAPE_GUEST === 'true';
// When set, this server also serves the built site (dist/) so a single Parabun
// process serves both the app and /api — the self-contained desktop binary.
const DIST = process.env.PARASCAPE_DIST ?? '';
const GUEST_USER = { id: 1, username: 'guest' };

const db = new Database(DB_PATH);
db.run('PRAGMA journal_mode = WAL');
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`);
db.run(`CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
)`);
db.run(`CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  doc TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`);
// Uploaded assets (images), stored as BLOBs in SQLite (LYK-935). The binary is
// served at GET /api/assets/:id (public so <img src> works without a token).
db.run(`CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
)`);
// Published page snapshots (LYK-934): a slug → project doc, served read-only by
// the dev preview server at /preview/:slug.
db.run(`CREATE TABLE IF NOT EXISTS published (
  slug TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  doc TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`);
if (GUEST)
	db.run(
		"INSERT OR IGNORE INTO users (id, username, password_hash, created_at) VALUES (1, 'guest', '', ?)",
		[Date.now()],
	);

const now = () => Date.now();
const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const err = (status: number, message: string) => json({ error: message }, status);

type User = { id: number; username: string; password_hash: string };

function userFor(req: Request): { id: number; username: string } | null {
	if (GUEST) return GUEST_USER; // single-user desktop build: every request is the guest
	const auth = req.headers.get('authorization') ?? '';
	const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
	if (!token) return null;
	const row = db
		.query(
			'SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?',
		)
		.get(token) as { id: number; username: string } | undefined;
	return row ?? null;
}

function newSession(userId: number): string {
	const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
	db.run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', [
		token,
		userId,
		now(),
	]);
	return token;
}

async function register(body: { username?: string; password?: string }) {
	const username = (body.username ?? '').trim();
	const password = body.password ?? '';
	if (username.length < 3) return err(400, 'Username must be at least 3 characters');
	if (password.length < 6) return err(400, 'Password must be at least 6 characters');
	const exists = db.query('SELECT id FROM users WHERE username = ?').get(username);
	if (exists) return err(409, 'That username is taken');
	const hash = await Bun.password.hash(password);
	const info = db.run('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)', [
		username,
		hash,
		now(),
	]);
	const id = Number(info.lastInsertRowid);
	return json({ token: newSession(id), user: { id, username } });
}

async function login(body: { username?: string; password?: string }) {
	const username = (body.username ?? '').trim();
	const password = body.password ?? '';
	const row = db
		.query('SELECT id, username, password_hash FROM users WHERE username = ?')
		.get(username) as User | undefined;
	if (!row || !(await Bun.password.verify(password, row.password_hash)))
		return err(401, 'Wrong username or password');
	return json({ token: newSession(row.id), user: { id: row.id, username: row.username } });
}

// Serve the built site (dist/) for non-/api routes when PARASCAPE_DIST is set.
async function serveStatic(pathname: string): Promise<Response | null> {
	if (!DIST) return null;
	const clean = decodeURIComponent(pathname.split('?')[0]);
	const candidates = clean.endsWith('/')
		? [join(DIST, clean, 'index.html')]
		: [join(DIST, clean), join(DIST, clean, 'index.html')];
	for (const c of candidates) {
		const f = Bun.file(c);
		if (await f.exists()) return new Response(f);
	}
	// multi-entry fallback → home
	const home = Bun.file(join(DIST, 'index.html'));
	if (await home.exists()) return new Response(home);
	return null;
}

const server = Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);
		// static site (desktop build) for everything that isn't the API
		if (!url.pathname.startsWith('/api')) {
			return (await serveStatic(url.pathname)) ?? new Response('Not found', { status: 404 });
		}
		const path = url.pathname.replace(/^\/api/, '');
		const method = req.method;
		const readBody = async () => {
			try {
				return (await req.json()) as Record<string, unknown>;
			} catch {
				return {};
			}
		};

		// ── public ──
		if (path === '/register' && method === 'POST') return register((await readBody()) as never);
		if (path === '/login' && method === 'POST') return login((await readBody()) as never);
		if (path === '/health' && method === 'GET') return json({ ok: true, guest: GUEST });
		// public: serve an uploaded asset's binary so <img src="/api/assets/:id"> works
		const apub = path.match(/^\/assets\/(\d+)$/);
		if (apub && method === 'GET') {
			const row = db.query('SELECT mime, data FROM assets WHERE id = ?').get(Number(apub[1])) as
				| { mime: string; data: Uint8Array }
				| undefined;
			if (!row) return err(404, 'No such asset');
			return new Response(row.data, {
				headers: { 'content-type': row.mime, 'cache-control': 'public, max-age=3600' },
			});
		}
		// public: a published page snapshot, read by the dev preview server (LYK-934)
		const pubm = path.match(/^\/published\/([a-z0-9-]+)$/);
		if (pubm && method === 'GET') {
			const row = db.query('SELECT doc, updated_at FROM published WHERE slug = ?').get(pubm[1]) as
				| { doc: string; updated_at: number }
				| undefined;
			if (!row) return err(404, 'No such published page');
			return json({ slug: pubm[1], doc: JSON.parse(row.doc), updated_at: row.updated_at });
		}

		// ── authed ──
		const user = userFor(req);
		if (!user) return err(401, 'Not signed in');

		if (path === '/me' && method === 'GET') return json({ user, guest: GUEST });
		if (path === '/logout' && method === 'POST') {
			const token = (req.headers.get('authorization') ?? '').slice(7);
			db.run('DELETE FROM sessions WHERE token = ?', [token]);
			return json({ ok: true });
		}

		if (path === '/projects' && method === 'GET') {
			const rows = db
				.query(
					'SELECT id, name, updated_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC',
				)
				.all(user.id);
			return json({ projects: rows });
		}
		if (path === '/projects' && method === 'POST') {
			const body = await readBody();
			const name = String(body.name ?? 'Untitled');
			const doc = JSON.stringify(body.doc ?? {});
			const info = db.run(
				'INSERT INTO projects (user_id, name, doc, updated_at) VALUES (?, ?, ?, ?)',
				[user.id, name, doc, now()],
			);
			return json({ id: Number(info.lastInsertRowid), name });
		}

		const pm = path.match(/^\/projects\/(\d+)$/);
		if (pm) {
			const id = Number(pm[1]);
			const owned = db
				.query('SELECT id FROM projects WHERE id = ? AND user_id = ?')
				.get(id, user.id);
			if (!owned) return err(404, 'No such project');
			if (method === 'GET') {
				const row = db
					.query('SELECT id, name, doc, updated_at FROM projects WHERE id = ?')
					.get(id) as {
					id: number;
					name: string;
					doc: string;
					updated_at: number;
				};
				return json({
					id: row.id,
					name: row.name,
					doc: JSON.parse(row.doc),
					updated_at: row.updated_at,
				});
			}
			if (method === 'PUT') {
				const body = await readBody();
				if (body.name !== undefined)
					db.run('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?', [
						String(body.name),
						now(),
						id,
					]);
				if (body.doc !== undefined)
					db.run('UPDATE projects SET doc = ?, updated_at = ? WHERE id = ?', [
						JSON.stringify(body.doc),
						now(),
						id,
					]);
				return json({ ok: true });
			}
			if (method === 'DELETE') {
				db.run('DELETE FROM projects WHERE id = ?', [id]);
				return json({ ok: true });
			}
		}

		// ── assets (LYK-935) ──
		if (path === '/assets' && method === 'GET') {
			const rows = db
				.query(
					'SELECT id, name, mime, size, created_at FROM assets WHERE user_id = ? ORDER BY created_at DESC',
				)
				.all(user.id);
			return json({ assets: rows });
		}
		if (path === '/assets' && method === 'POST') {
			const body = await readBody();
			const name = String(body.name ?? 'image');
			const mime = String(body.mime ?? 'application/octet-stream');
			const dataB64 = String(body.data ?? '');
			if (!dataB64) return err(400, 'Missing data');
			const buf = Buffer.from(dataB64, 'base64');
			const info = db.run(
				'INSERT INTO assets (user_id, name, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
				[user.id, name, mime, buf.length, buf, now()],
			);
			return json({ id: Number(info.lastInsertRowid), name, mime, size: buf.length });
		}
		const adel = path.match(/^\/assets\/(\d+)$/);
		if (adel && method === 'DELETE') {
			const id = Number(adel[1]);
			const owned = db.query('SELECT id FROM assets WHERE id = ? AND user_id = ?').get(id, user.id);
			if (!owned) return err(404, 'No such asset');
			db.run('DELETE FROM assets WHERE id = ?', [id]);
			return json({ ok: true });
		}

		// ── publish (LYK-934) ──
		if (path === '/publish' && method === 'POST') {
			const body = await readBody();
			const slug = String(body.slug ?? '')
				.toLowerCase()
				.replace(/[^a-z0-9-]+/g, '-')
				.replace(/^-+|-+$/g, '');
			if (!slug) return err(400, 'Missing slug');
			const doc = JSON.stringify(body.doc ?? {});
			const existing = db.query('SELECT user_id FROM published WHERE slug = ?').get(slug) as
				| { user_id: number }
				| undefined;
			if (existing && existing.user_id !== user.id) return err(409, 'That preview name is taken');
			db.run(
				'INSERT INTO published (slug, user_id, doc, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at',
				[slug, user.id, doc, now()],
			);
			return json({ slug, url: `/preview/${slug}` });
		}

		return err(404, 'Not found');
	},
});

console.log(
	`[account] Parascape account server on http://localhost:${server.port}  (db: ${DB_PATH})`,
);
