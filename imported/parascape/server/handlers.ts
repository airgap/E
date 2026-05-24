// Parascape API handler implementations. Each wraps a generated lockstep handle
// factory (server/generated/handles) with the actual D1-backed logic. The
// factory gives us the validator + model (used by the router in worker.ts); we
// supply the `execute`. Handlers close over `env` for D1; the authed user id
// arrives as `context.requester`.
import {
	handleHealth,
	handleRegister,
	handleLogin,
	handleLogout,
	handleMe,
	handleListProjects,
	handleCreateProject,
	handleGetProject,
	handleUpdateProject,
	handleDeleteProject,
	handleListAssets,
	handleUploadAsset,
	handleDeleteAsset,
	handlePublish,
	handleListSnapshots,
	handleCreateSnapshot,
	handleGetSnapshot,
	handleDeleteSnapshot,
	handleAddCollaborator,
	handleListCollaborators,
	handleRemoveCollaborator,
	handleCreateInvite,
	handleListInvites,
	handleDeleteInvite,
	handleRedeemInvite,
	handleDuplicateProject,
	handleListComments,
	handleAddComment,
	handleResolveComment,
	handleDeleteComment,
} from './generated/handles/index.js';
import {
	type Env,
	type SessionUser,
	HttpError,
	hashPassword,
	verifyPassword,
	newSession,
	bearerToken,
	b64ToBytes,
	now,
} from './lib';

const uid = (ctx: { requester?: bigint }): number => Number(ctx.requester);

type Role = 'owner' | 'editor' | 'viewer';
// A user's access to a project: owner (projects.user_id), a collaborator's role,
// or null (no access). Used by the project read/write handlers + the room gate.
async function roleOf(env: Env, projectId: number, userId: number): Promise<Role | null> {
	const proj = await env.DB.prepare('SELECT user_id FROM projects WHERE id = ?')
		.bind(projectId)
		.first<{ user_id: number }>();
	if (!proj) return null;
	if (Number(proj.user_id) === userId) return 'owner';
	const c = await env.DB.prepare(
		'SELECT role FROM collaborators WHERE project_id = ? AND user_id = ?',
	)
		.bind(projectId, userId)
		.first<{ role: string }>();
	if (!c) return null;
	return c.role === 'viewer' ? 'viewer' : 'editor';
}
export { roleOf };

// A comment may be resolved/deleted by its author or the project's owner.
async function canModerateComment(env: Env, commentId: number, me: number): Promise<boolean> {
	const c = await env.DB.prepare('SELECT project_id, author_id FROM comments WHERE id = ?')
		.bind(commentId)
		.first<{ project_id: number; author_id: number }>();
	if (!c) return false;
	if (Number(c.author_id) === me) return true;
	const proj = await env.DB.prepare('SELECT user_id FROM projects WHERE id = ?')
		.bind(c.project_id)
		.first<{ user_id: number }>();
	return !!proj && Number(proj.user_id) === me;
}

export function makeHandles(env: Env) {
	return {
		health: handleHealth(async () => ({ ok: true, guest: false })),

		register: handleRegister(async (req) => {
			const username = String(req.username).trim();
			const password = String(req.password);
			if (username.length < 3) throw new HttpError(400, 'Username must be at least 3 characters');
			if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
			const exists = await env.DB.prepare('SELECT id FROM users WHERE username = ?')
				.bind(username)
				.first();
			if (exists) throw new HttpError(409, 'That username is taken');
			const res = await env.DB.prepare(
				'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)',
			)
				.bind(username, await hashPassword(password), now())
				.run();
			const id = Number(res.meta.last_row_id);
			return { token: await newSession(env, id), user: { id, username } };
		}),

		login: handleLogin(async (req) => {
			const username = String(req.username).trim();
			const row = await env.DB.prepare(
				'SELECT id, username, password_hash FROM users WHERE username = ?',
			)
				.bind(username)
				.first<{ id: number; username: string; password_hash: string }>();
			if (!row || !(await verifyPassword(String(req.password), row.password_hash)))
				throw new HttpError(401, 'Wrong username or password');
			return {
				token: await newSession(env, row.id),
				user: { id: row.id, username: row.username },
			};
		}),

		logout: handleLogout(async (_req, ctx) => {
			await env.DB.prepare('DELETE FROM sessions WHERE token = ?')
				.bind(bearerToken(ctx.request))
				.run();
			return { ok: true };
		}),

		me: handleMe(async (_req, ctx) => {
			const user = await env.DB.prepare('SELECT id, username FROM users WHERE id = ?')
				.bind(uid(ctx))
				.first<SessionUser>();
			if (!user) throw new HttpError(401, 'Not signed in');
			return { user, guest: false };
		}),

		listProjects: handleListProjects(async (_req, ctx) => {
			const me = uid(ctx);
			const owned = await env.DB.prepare(
				'SELECT id, name, updated_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC',
			)
				.bind(me)
				.all<{ id: number; name: string; updated_at: number }>();
			// projects shared with me (LYK-951)
			const shared = await env.DB.prepare(
				'SELECT p.id, p.name, p.updated_at, c.role FROM collaborators c ' +
					'JOIN projects p ON p.id = c.project_id WHERE c.user_id = ? ORDER BY p.updated_at DESC',
			)
				.bind(me)
				.all<{ id: number; name: string; updated_at: number; role: string }>();
			return {
				projects: [
					...owned.results.map((r) => ({ ...r, owner: true, role: 'owner' })),
					...shared.results.map((r) => ({
						id: r.id,
						name: r.name,
						updated_at: r.updated_at,
						owner: false,
						role: r.role === 'viewer' ? 'viewer' : 'editor',
					})),
				],
			};
		}),

		createProject: handleCreateProject(async (req, ctx) => {
			const name = String(req.name ?? 'Untitled');
			const res = await env.DB.prepare(
				'INSERT INTO projects (user_id, name, doc, updated_at) VALUES (?, ?, ?, ?)',
			)
				.bind(uid(ctx), name, JSON.stringify(req.doc ?? {}), now())
				.run();
			return { id: Number(res.meta.last_row_id), name };
		}),

		getProject: handleGetProject(async (req, ctx) => {
			const role = await roleOf(env, Number(req.id), uid(ctx));
			if (!role) throw new HttpError(404, 'No such project');
			const row = await env.DB.prepare(
				'SELECT id, name, doc, updated_at FROM projects WHERE id = ?',
			)
				.bind(req.id)
				.first<{ id: number; name: string; doc: string; updated_at: number }>();
			if (!row) throw new HttpError(404, 'No such project');
			return {
				id: row.id,
				name: row.name,
				doc: JSON.parse(row.doc),
				updated_at: row.updated_at,
				role,
			};
		}),

		updateProject: handleUpdateProject(async (req, ctx) => {
			const role = await roleOf(env, Number(req.id), uid(ctx));
			if (!role) throw new HttpError(404, 'No such project');
			if (role === 'viewer') throw new HttpError(403, 'You have read-only access to this project');
			if (req.name !== undefined)
				await env.DB.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
					.bind(String(req.name), now(), req.id)
					.run();
			if (req.doc !== undefined)
				await env.DB.prepare('UPDATE projects SET doc = ?, updated_at = ? WHERE id = ?')
					.bind(JSON.stringify(req.doc), now(), req.id)
					.run();
			return { ok: true };
		}),

		deleteProject: handleDeleteProject(async (req, ctx) => {
			// Scoped by user_id, so deleting a non-owned/absent row is a harmless no-op.
			// Tidy up its shares too (owner-scoped subqueries keep this safe).
			await env.DB.prepare('DELETE FROM collaborators WHERE project_id = ?').bind(req.id).run();
			await env.DB.prepare('DELETE FROM project_invites WHERE project_id = ?').bind(req.id).run();
			await env.DB.prepare('DELETE FROM comments WHERE project_id = ?').bind(req.id).run();
			await env.DB.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?')
				.bind(req.id, uid(ctx))
				.run();
			return { ok: true };
		}),

		// ── sharing / collaborators (LYK-951) ──
		addCollaborator: handleAddCollaborator(async (req, ctx) => {
			const me = uid(ctx);
			const proj = await env.DB.prepare('SELECT user_id FROM projects WHERE id = ?')
				.bind(req.projectId)
				.first<{ user_id: number }>();
			if (!proj) throw new HttpError(404, 'No such project');
			if (Number(proj.user_id) !== me)
				throw new HttpError(403, 'Only the owner can share this project');
			const role = req.role === 'viewer' ? 'viewer' : 'editor';
			const target = await env.DB.prepare('SELECT id, username FROM users WHERE username = ?')
				.bind(String(req.username).trim())
				.first<{ id: number; username: string }>();
			if (!target) throw new HttpError(404, 'No user with that username');
			if (Number(target.id) === me) throw new HttpError(400, 'You already own this project');
			const existing = await env.DB.prepare(
				'SELECT id FROM collaborators WHERE project_id = ? AND user_id = ?',
			)
				.bind(req.projectId, target.id)
				.first();
			if (existing) {
				await env.DB.prepare(
					'UPDATE collaborators SET role = ? WHERE project_id = ? AND user_id = ?',
				)
					.bind(role, req.projectId, target.id)
					.run();
			} else {
				await env.DB.prepare(
					'INSERT INTO collaborators (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
				)
					.bind(req.projectId, target.id, role, now())
					.run();
			}
			return { user_id: Number(target.id), username: target.username, role };
		}),

		listCollaborators: handleListCollaborators(async (req, ctx) => {
			const role = await roleOf(env, Number(req.projectId), uid(ctx));
			if (!role) throw new HttpError(404, 'No such project');
			const proj = await env.DB.prepare('SELECT user_id FROM projects WHERE id = ?')
				.bind(req.projectId)
				.first<{ user_id: number }>();
			const owner = await env.DB.prepare('SELECT id, username FROM users WHERE id = ?')
				.bind(proj!.user_id)
				.first<SessionUser>();
			const rows = await env.DB.prepare(
				'SELECT c.user_id, u.username, c.role FROM collaborators c ' +
					'JOIN users u ON u.id = c.user_id WHERE c.project_id = ? ORDER BY u.username',
			)
				.bind(req.projectId)
				.all<{ user_id: number; username: string; role: string }>();
			return {
				owner: { id: Number(owner!.id), username: owner!.username },
				collaborators: rows.results.map((r) => ({
					user_id: Number(r.user_id),
					username: r.username,
					role: r.role,
				})),
			};
		}),

		removeCollaborator: handleRemoveCollaborator(async (req, ctx) => {
			const me = uid(ctx);
			const proj = await env.DB.prepare('SELECT user_id FROM projects WHERE id = ?')
				.bind(req.projectId)
				.first<{ user_id: number }>();
			if (!proj) throw new HttpError(404, 'No such project');
			// owner may remove anyone; a collaborator may remove themselves (leave)
			if (Number(proj.user_id) !== me && Number(req.userId) !== me)
				throw new HttpError(403, 'Only the owner can remove collaborators');
			await env.DB.prepare('DELETE FROM collaborators WHERE project_id = ? AND user_id = ?')
				.bind(req.projectId, req.userId)
				.run();
			return { ok: true };
		}),

		createInvite: handleCreateInvite(async (req, ctx) => {
			const me = uid(ctx);
			const proj = await env.DB.prepare('SELECT user_id FROM projects WHERE id = ?')
				.bind(req.projectId)
				.first<{ user_id: number }>();
			if (!proj) throw new HttpError(404, 'No such project');
			if (Number(proj.user_id) !== me)
				throw new HttpError(403, 'Only the owner can create share links');
			const role = req.role === 'viewer' ? 'viewer' : 'editor';
			const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
			await env.DB.prepare(
				'INSERT INTO project_invites (token, project_id, role, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
			)
				.bind(token, req.projectId, role, me, now())
				.run();
			return { token, role };
		}),

		listInvites: handleListInvites(async (req, ctx) => {
			const me = uid(ctx);
			const proj = await env.DB.prepare('SELECT user_id FROM projects WHERE id = ?')
				.bind(req.projectId)
				.first<{ user_id: number }>();
			if (!proj) throw new HttpError(404, 'No such project');
			if (Number(proj.user_id) !== me)
				throw new HttpError(403, 'Only the owner can view share links');
			const rows = await env.DB.prepare(
				'SELECT token, role FROM project_invites WHERE project_id = ? ORDER BY created_at DESC',
			)
				.bind(req.projectId)
				.all<{ token: string; role: string }>();
			return { invites: rows.results };
		}),

		deleteInvite: handleDeleteInvite(async (req, ctx) => {
			// Only revoke links on projects this user owns.
			await env.DB.prepare(
				'DELETE FROM project_invites WHERE token = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)',
			)
				.bind(req.token, uid(ctx))
				.run();
			return { ok: true };
		}),

		redeemInvite: handleRedeemInvite(async (req, ctx) => {
			const me = uid(ctx);
			const inv = await env.DB.prepare(
				'SELECT project_id, role FROM project_invites WHERE token = ?',
			)
				.bind(req.token)
				.first<{ project_id: number; role: string }>();
			if (!inv) throw new HttpError(404, 'This share link is invalid or was revoked');
			const proj = await env.DB.prepare('SELECT user_id, name FROM projects WHERE id = ?')
				.bind(inv.project_id)
				.first<{ user_id: number; name: string }>();
			if (!proj) throw new HttpError(404, 'That project no longer exists');
			if (Number(proj.user_id) === me)
				return { projectId: Number(inv.project_id), role: 'owner', name: proj.name };
			const role = inv.role === 'viewer' ? 'viewer' : 'editor';
			const existing = await env.DB.prepare(
				'SELECT role FROM collaborators WHERE project_id = ? AND user_id = ?',
			)
				.bind(inv.project_id, me)
				.first<{ role: string }>();
			if (existing)
				return { projectId: Number(inv.project_id), role: existing.role, name: proj.name };
			await env.DB.prepare(
				'INSERT INTO collaborators (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
			)
				.bind(inv.project_id, me, role, now())
				.run();
			return { projectId: Number(inv.project_id), role, name: proj.name };
		}),

		// ── duplicate project (LYK-954) — fork any project you can read into your own ──
		duplicateProject: handleDuplicateProject(async (req, ctx) => {
			const me = uid(ctx);
			if (!(await roleOf(env, Number(req.id), me))) throw new HttpError(404, 'No such project');
			const row = await env.DB.prepare('SELECT name, doc FROM projects WHERE id = ?')
				.bind(req.id)
				.first<{ name: string; doc: string }>();
			if (!row) throw new HttpError(404, 'No such project');
			const name = `${row.name} (copy)`;
			const res = await env.DB.prepare(
				'INSERT INTO projects (user_id, name, doc, updated_at) VALUES (?, ?, ?, ?)',
			)
				.bind(me, name, row.doc, now())
				.run();
			return { id: Number(res.meta.last_row_id), name };
		}),

		// ── review comments (LYK-955) — any member may read/add; author/owner moderate ──
		listComments: handleListComments(async (req, ctx) => {
			if (!(await roleOf(env, Number(req.projectId), uid(ctx))))
				throw new HttpError(404, 'No such project');
			const rows = await env.DB.prepare(
				'SELECT id, page_id, node_key, x, y, author_id, author_name, body, resolved, created_at ' +
					'FROM comments WHERE project_id = ? ORDER BY created_at ASC',
			)
				.bind(req.projectId)
				.all<{
					id: number;
					page_id: number;
					node_key: number | null;
					x: number;
					y: number;
					author_id: number;
					author_name: string;
					body: string;
					resolved: number;
					created_at: number;
				}>();
			return {
				comments: rows.results.map((r) => {
					const c: Record<string, unknown> = {
						id: r.id,
						page_id: r.page_id,
						x: r.x,
						y: r.y,
						author_id: r.author_id,
						author_name: r.author_name,
						body: r.body,
						resolved: !!r.resolved,
						created_at: r.created_at,
					};
					if (r.node_key != null) c.node_key = Number(r.node_key);
					return c;
				}),
			};
		}),

		addComment: handleAddComment(async (req, ctx) => {
			const me = uid(ctx);
			if (!(await roleOf(env, Number(req.projectId), me)))
				throw new HttpError(404, 'No such project');
			const user = await env.DB.prepare('SELECT username FROM users WHERE id = ?')
				.bind(me)
				.first<{ username: string }>();
			const author_name = user?.username ?? 'Someone';
			const nodeKey = req.nodeKey == null ? null : Number(req.nodeKey);
			const created_at = now();
			const res = await env.DB.prepare(
				'INSERT INTO comments (project_id, page_id, node_key, x, y, author_id, author_name, body, resolved, created_at) ' +
					'VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
			)
				.bind(
					req.projectId,
					req.pageId,
					nodeKey,
					req.x,
					req.y,
					me,
					author_name,
					String(req.body),
					created_at,
				)
				.run();
			const c: Record<string, unknown> = {
				id: Number(res.meta.last_row_id),
				page_id: Number(req.pageId),
				x: Number(req.x),
				y: Number(req.y),
				author_id: me,
				author_name,
				body: String(req.body),
				resolved: false,
				created_at,
			};
			if (nodeKey != null) c.node_key = nodeKey;
			return c;
		}),

		resolveComment: handleResolveComment(async (req, ctx) => {
			if (!(await canModerateComment(env, Number(req.id), uid(ctx))))
				throw new HttpError(403, 'Only the author or owner can resolve this comment');
			await env.DB.prepare('UPDATE comments SET resolved = ? WHERE id = ?')
				.bind(req.resolved ? 1 : 0, req.id)
				.run();
			return { ok: true };
		}),

		deleteComment: handleDeleteComment(async (req, ctx) => {
			if (!(await canModerateComment(env, Number(req.id), uid(ctx))))
				throw new HttpError(403, 'Only the author or owner can delete this comment');
			await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(req.id).run();
			return { ok: true };
		}),

		listAssets: handleListAssets(async (_req, ctx) => {
			const rows = await env.DB.prepare(
				'SELECT id, name, mime, size, created_at FROM assets WHERE user_id = ? ORDER BY created_at DESC',
			)
				.bind(uid(ctx))
				.all<{ id: number; name: string; mime: string; size: number; created_at: number }>();
			return { assets: rows.results };
		}),

		uploadAsset: handleUploadAsset(async (req, ctx) => {
			const bytes = b64ToBytes(String(req.data));
			const name = String(req.name);
			const mime = String(req.mime);
			const res = await env.DB.prepare(
				'INSERT INTO assets (user_id, name, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
			)
				.bind(uid(ctx), name, mime, bytes.length, bytes.buffer, now())
				.run();
			return { id: Number(res.meta.last_row_id), name, mime, size: bytes.length };
		}),

		deleteAsset: handleDeleteAsset(async (req, ctx) => {
			const owned = await env.DB.prepare('SELECT id FROM assets WHERE id = ? AND user_id = ?')
				.bind(req.id, uid(ctx))
				.first();
			if (!owned) throw new HttpError(404, 'No such asset');
			await env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(req.id).run();
			return { ok: true };
		}),

		publish: handlePublish(async (req, ctx) => {
			const slug = String(req.slug ?? '')
				.toLowerCase()
				.replace(/[^a-z0-9-]+/g, '-')
				.replace(/^-+|-+$/g, '');
			if (!slug) throw new HttpError(400, 'Missing slug');
			const existing = await env.DB.prepare('SELECT user_id FROM published WHERE slug = ?')
				.bind(slug)
				.first<{ user_id: number }>();
			if (existing && existing.user_id !== uid(ctx))
				throw new HttpError(409, 'That preview name is taken');
			await env.DB.prepare(
				'INSERT INTO published (slug, user_id, doc, updated_at) VALUES (?, ?, ?, ?) ' +
					'ON CONFLICT(slug) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at',
			)
				.bind(slug, uid(ctx), JSON.stringify(req.doc ?? {}), now())
				.run();
			return { slug, url: `/preview/${slug}` };
		}),

		// ── version history / snapshots (LYK-943) ──
		listSnapshots: handleListSnapshots(async (_req, ctx) => {
			const rows = await env.DB.prepare(
				'SELECT id, label, created_at FROM snapshots WHERE user_id = ? ORDER BY created_at DESC',
			)
				.bind(uid(ctx))
				.all<{ id: number; label: string; created_at: number }>();
			return { snapshots: rows.results };
		}),

		createSnapshot: handleCreateSnapshot(async (req, ctx) => {
			const label = String(req.label ?? 'Snapshot').slice(0, 120);
			const created_at = now();
			const res = await env.DB.prepare(
				'INSERT INTO snapshots (user_id, label, doc, created_at) VALUES (?, ?, ?, ?)',
			)
				.bind(uid(ctx), label, JSON.stringify(req.doc ?? {}), created_at)
				.run();
			return { id: Number(res.meta.last_row_id), label, created_at };
		}),

		getSnapshot: handleGetSnapshot(async (req, ctx) => {
			const row = await env.DB.prepare(
				'SELECT id, label, doc, created_at FROM snapshots WHERE id = ? AND user_id = ?',
			)
				.bind(req.id, uid(ctx))
				.first<{ id: number; label: string; doc: string; created_at: number }>();
			if (!row) throw new HttpError(404, 'No such snapshot');
			return { id: row.id, label: row.label, doc: JSON.parse(row.doc), created_at: row.created_at };
		}),

		deleteSnapshot: handleDeleteSnapshot(async (req, ctx) => {
			await env.DB.prepare('DELETE FROM snapshots WHERE id = ? AND user_id = ?')
				.bind(req.id, uid(ctx))
				.run();
			return { ok: true };
		}),
	};
}

export type HandleEntry = ReturnType<typeof makeHandles>[keyof ReturnType<typeof makeHandles>];
