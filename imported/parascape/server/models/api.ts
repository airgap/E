// Parascape's HTTP API, expressed as @lyku/lockstep-core handler models.
// lockstep generates from this: request/response TS types (api-types), the
// server handler factories (handles), and the typed browser client (client).
//
// Every model carries an explicit `method` + `path` — the client generator only
// emits a method for models that declare `method`, and routes on `path`.
// baseUrl is "/api", so paths here are relative to that.
//
// Endpoints that don't fit a JSON request/response shape stay raw routes in the
// Worker (server/worker.ts): GET /assets/:id (binary image) and
// GET /published/:slug (public page snapshot read by the preview).
import type { TsonHandlerModel } from '@lyku/lockstep-core';

const m = <T extends TsonHandlerModel>(model: T) => model;

// ── shared response shapes ──
const userShape = {
	type: 'object',
	properties: { id: { type: 'number' }, username: { type: 'string' } },
	required: ['id', 'username'],
} as const;

const authResult = {
	type: 'object',
	properties: { token: { type: 'string' }, user: userShape },
	required: ['token', 'user'],
} as const;

const ok = {
	type: 'object',
	properties: { ok: { type: 'boolean' } },
	required: ['ok'],
} as const;

// ── auth ──
export const health = m({
	method: 'GET',
	path: '/health',
	authenticated: false,
	response: {
		type: 'object',
		properties: { ok: { type: 'boolean' }, guest: { type: 'boolean' } },
		required: ['ok', 'guest'],
	},
	title: 'Health check',
	category: 'Auth',
});

export const register = m({
	method: 'POST',
	path: '/register',
	authenticated: false,
	request: {
		type: 'object',
		properties: {
			username: { type: 'string', minLength: 3 },
			password: { type: 'string', minLength: 6 },
		},
		required: ['username', 'password'],
	},
	response: authResult,
	throws: [400, 409],
	title: 'Register',
	category: 'Auth',
});

export const login = m({
	method: 'POST',
	path: '/login',
	authenticated: false,
	request: {
		type: 'object',
		properties: { username: { type: 'string' }, password: { type: 'string' } },
		required: ['username', 'password'],
	},
	response: authResult,
	throws: [401],
	title: 'Log in',
	category: 'Auth',
});

export const logout = m({
	method: 'POST',
	path: '/logout',
	authenticated: true,
	response: ok,
	title: 'Log out',
	category: 'Auth',
});

export const me = m({
	method: 'GET',
	path: '/me',
	authenticated: true,
	response: {
		type: 'object',
		properties: { user: userShape, guest: { type: 'boolean' } },
		required: ['user', 'guest'],
	},
	title: 'Current user',
	category: 'Auth',
});

// ── projects ──
const projectSummary = {
	type: 'object',
	properties: {
		id: { type: 'number' },
		name: { type: 'string' },
		updated_at: { type: 'number' },
		// sharing (LYK-951): am I the owner, and (if shared with me) my role
		owner: { type: 'boolean' },
		role: { type: 'string' }, // 'owner' | 'editor' | 'viewer'
	},
	required: ['id', 'name', 'updated_at', 'owner', 'role'],
} as const;

const projectFull = {
	type: 'object',
	properties: {
		id: { type: 'number' },
		name: { type: 'string' },
		doc: { type: 'object' },
		updated_at: { type: 'number' },
		role: { type: 'string' }, // the caller's role: 'owner' | 'editor' | 'viewer'
	},
	required: ['id', 'name', 'doc', 'updated_at', 'role'],
} as const;

// sharing shapes (LYK-951)
const collaboratorShape = {
	type: 'object',
	properties: {
		user_id: { type: 'number' },
		username: { type: 'string' },
		role: { type: 'string' },
	},
	required: ['user_id', 'username', 'role'],
} as const;
const inviteShape = {
	type: 'object',
	properties: { token: { type: 'string' }, role: { type: 'string' } },
	required: ['token', 'role'],
} as const;

export const listProjects = m({
	method: 'GET',
	path: '/projects',
	authenticated: true,
	response: {
		type: 'object',
		properties: { projects: { type: 'array', items: projectSummary } },
		required: ['projects'],
	},
	title: 'List projects',
	category: 'Projects',
});

export const createProject = m({
	method: 'POST',
	path: '/projects',
	authenticated: true,
	request: {
		type: 'object',
		properties: { name: { type: 'string' }, doc: { type: 'object' } },
		required: ['name', 'doc'],
	},
	response: {
		type: 'object',
		properties: { id: { type: 'number' }, name: { type: 'string' } },
		required: ['id', 'name'],
	},
	title: 'Create project',
	category: 'Projects',
});

export const getProject = m({
	method: 'POST',
	path: '/project/get',
	authenticated: true,
	request: {
		type: 'object',
		properties: { id: { type: 'number' } },
		required: ['id'],
	},
	response: projectFull,
	throws: [404],
	title: 'Get project',
	category: 'Projects',
});

export const updateProject = m({
	method: 'POST',
	path: '/project/update',
	authenticated: true,
	request: {
		type: 'object',
		properties: {
			id: { type: 'number' },
			name: { type: 'string' },
			doc: { type: 'object' },
		},
		required: ['id'],
	},
	response: ok,
	throws: [404],
	title: 'Update project',
	category: 'Projects',
});

export const deleteProject = m({
	method: 'POST',
	path: '/project/delete',
	authenticated: true,
	request: {
		type: 'object',
		properties: { id: { type: 'number' } },
		required: ['id'],
	},
	response: ok,
	throws: [404],
	title: 'Delete project',
	category: 'Projects',
});

export const duplicateProject = m({
	method: 'POST',
	path: '/project/duplicate',
	authenticated: true,
	request: {
		type: 'object',
		properties: { id: { type: 'number' } },
		required: ['id'],
	},
	response: {
		type: 'object',
		properties: { id: { type: 'number' }, name: { type: 'string' } },
		required: ['id', 'name'],
	},
	throws: [404],
	title: 'Duplicate project',
	category: 'Projects',
});

// ── review comments / annotations (LYK-955) ──
const commentShape = {
	type: 'object',
	properties: {
		id: { type: 'number' },
		page_id: { type: 'number' },
		node_key: { type: 'number' },
		x: { type: 'number' },
		y: { type: 'number' },
		author_id: { type: 'number' },
		author_name: { type: 'string' },
		body: { type: 'string' },
		resolved: { type: 'boolean' },
		created_at: { type: 'number' },
	},
	required: [
		'id',
		'page_id',
		'x',
		'y',
		'author_id',
		'author_name',
		'body',
		'resolved',
		'created_at',
	],
} as const;

export const listComments = m({
	method: 'POST',
	path: '/comments/list',
	authenticated: true,
	request: {
		type: 'object',
		properties: { projectId: { type: 'number' } },
		required: ['projectId'],
	},
	response: {
		type: 'object',
		properties: { comments: { type: 'array', items: commentShape } },
		required: ['comments'],
	},
	throws: [403, 404],
	title: 'List comments',
	category: 'Comments',
});

export const addComment = m({
	method: 'POST',
	path: '/comments',
	authenticated: true,
	request: {
		type: 'object',
		properties: {
			projectId: { type: 'number' },
			pageId: { type: 'number' },
			x: { type: 'number' },
			y: { type: 'number' },
			body: { type: 'string' },
			nodeKey: { type: 'number' },
		},
		required: ['projectId', 'pageId', 'x', 'y', 'body'],
	},
	response: commentShape,
	throws: [403, 404],
	title: 'Add comment',
	category: 'Comments',
});

export const resolveComment = m({
	method: 'POST',
	path: '/comment/resolve',
	authenticated: true,
	request: {
		type: 'object',
		properties: { id: { type: 'number' }, resolved: { type: 'boolean' } },
		required: ['id', 'resolved'],
	},
	response: ok,
	throws: [403, 404],
	title: 'Resolve comment',
	category: 'Comments',
});

export const deleteComment = m({
	method: 'POST',
	path: '/comment/delete',
	authenticated: true,
	request: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
	response: ok,
	throws: [403, 404],
	title: 'Delete comment',
	category: 'Comments',
});

// ── sharing / collaborators (LYK-951) ──
export const addCollaborator = m({
	method: 'POST',
	path: '/project/collaborators',
	authenticated: true,
	request: {
		type: 'object',
		properties: {
			projectId: { type: 'number' },
			username: { type: 'string' },
			role: { type: 'string' },
		},
		required: ['projectId', 'username', 'role'],
	},
	response: collaboratorShape,
	throws: [400, 403, 404],
	title: 'Add collaborator',
	category: 'Sharing',
});

export const listCollaborators = m({
	method: 'POST',
	path: '/project/collaborators/list',
	authenticated: true,
	request: {
		type: 'object',
		properties: { projectId: { type: 'number' } },
		required: ['projectId'],
	},
	response: {
		type: 'object',
		properties: {
			owner: userShape,
			collaborators: { type: 'array', items: collaboratorShape },
		},
		required: ['owner', 'collaborators'],
	},
	throws: [403, 404],
	title: 'List collaborators',
	category: 'Sharing',
});

export const removeCollaborator = m({
	method: 'POST',
	path: '/project/collaborators/remove',
	authenticated: true,
	request: {
		type: 'object',
		properties: { projectId: { type: 'number' }, userId: { type: 'number' } },
		required: ['projectId', 'userId'],
	},
	response: ok,
	throws: [403, 404],
	title: 'Remove collaborator',
	category: 'Sharing',
});

export const createInvite = m({
	method: 'POST',
	path: '/project/invites',
	authenticated: true,
	request: {
		type: 'object',
		properties: { projectId: { type: 'number' }, role: { type: 'string' } },
		required: ['projectId', 'role'],
	},
	response: inviteShape,
	throws: [403, 404],
	title: 'Create share link',
	category: 'Sharing',
});

export const listInvites = m({
	method: 'POST',
	path: '/project/invites/list',
	authenticated: true,
	request: {
		type: 'object',
		properties: { projectId: { type: 'number' } },
		required: ['projectId'],
	},
	response: {
		type: 'object',
		properties: { invites: { type: 'array', items: inviteShape } },
		required: ['invites'],
	},
	throws: [403, 404],
	title: 'List share links',
	category: 'Sharing',
});

export const deleteInvite = m({
	method: 'POST',
	path: '/project/invites/delete',
	authenticated: true,
	request: {
		type: 'object',
		properties: { projectId: { type: 'number' }, token: { type: 'string' } },
		required: ['projectId', 'token'],
	},
	response: ok,
	throws: [403],
	title: 'Revoke share link',
	category: 'Sharing',
});

export const redeemInvite = m({
	method: 'POST',
	path: '/invite/redeem',
	authenticated: true,
	request: {
		type: 'object',
		properties: { token: { type: 'string' } },
		required: ['token'],
	},
	response: {
		type: 'object',
		properties: {
			projectId: { type: 'number' },
			role: { type: 'string' },
			name: { type: 'string' },
		},
		required: ['projectId', 'role', 'name'],
	},
	throws: [404],
	title: 'Redeem share link',
	category: 'Sharing',
});

// ── assets ──
const assetSummary = {
	type: 'object',
	properties: {
		id: { type: 'number' },
		name: { type: 'string' },
		mime: { type: 'string' },
		size: { type: 'number' },
		created_at: { type: 'number' },
	},
	required: ['id', 'name', 'mime', 'size', 'created_at'],
} as const;

export const listAssets = m({
	method: 'GET',
	path: '/assets',
	authenticated: true,
	response: {
		type: 'object',
		properties: { assets: { type: 'array', items: assetSummary } },
		required: ['assets'],
	},
	title: 'List assets',
	category: 'Assets',
});

export const uploadAsset = m({
	method: 'POST',
	path: '/assets',
	authenticated: true,
	request: {
		type: 'object',
		properties: {
			name: { type: 'string' },
			mime: { type: 'string' },
			data: { type: 'string', description: 'base64-encoded bytes' },
		},
		required: ['name', 'mime', 'data'],
	},
	response: {
		type: 'object',
		properties: {
			id: { type: 'number' },
			name: { type: 'string' },
			mime: { type: 'string' },
			size: { type: 'number' },
		},
		required: ['id', 'name', 'mime', 'size'],
	},
	throws: [400],
	title: 'Upload asset',
	category: 'Assets',
});

export const deleteAsset = m({
	method: 'POST',
	path: '/asset/delete',
	authenticated: true,
	request: {
		type: 'object',
		properties: { id: { type: 'number' } },
		required: ['id'],
	},
	response: ok,
	throws: [404],
	title: 'Delete asset',
	category: 'Assets',
});

// ── publish ──
export const publish = m({
	method: 'POST',
	path: '/publish',
	authenticated: true,
	request: {
		type: 'object',
		properties: { slug: { type: 'string' }, doc: { type: 'object' } },
		required: ['slug', 'doc'],
	},
	response: {
		type: 'object',
		properties: { slug: { type: 'string' }, url: { type: 'string' } },
		required: ['slug', 'url'],
	},
	throws: [400, 409],
	title: 'Publish page',
	category: 'Publish',
});

// ── version history / snapshots (LYK-943) ──
const snapshotMeta = {
	type: 'object',
	properties: {
		id: { type: 'number' },
		label: { type: 'string' },
		created_at: { type: 'number' },
	},
	required: ['id', 'label', 'created_at'],
} as const;

export const listSnapshots = m({
	method: 'GET',
	path: '/snapshots',
	authenticated: true,
	response: {
		type: 'object',
		properties: { snapshots: { type: 'array', items: snapshotMeta } },
		required: ['snapshots'],
	},
	title: 'List snapshots',
	category: 'History',
});

export const createSnapshot = m({
	method: 'POST',
	path: '/snapshots',
	authenticated: true,
	request: {
		type: 'object',
		properties: { label: { type: 'string' }, doc: { type: 'object' } },
		required: ['label', 'doc'],
	},
	response: snapshotMeta,
	title: 'Create snapshot',
	category: 'History',
});

export const getSnapshot = m({
	method: 'POST',
	path: '/snapshot/get',
	authenticated: true,
	request: {
		type: 'object',
		properties: { id: { type: 'number' } },
		required: ['id'],
	},
	response: {
		type: 'object',
		properties: {
			id: { type: 'number' },
			label: { type: 'string' },
			doc: { type: 'object' },
			created_at: { type: 'number' },
		},
		required: ['id', 'label', 'doc', 'created_at'],
	},
	throws: [404],
	title: 'Get snapshot',
	category: 'History',
});

export const deleteSnapshot = m({
	method: 'POST',
	path: '/snapshot/delete',
	authenticated: true,
	request: {
		type: 'object',
		properties: { id: { type: 'number' } },
		required: ['id'],
	},
	response: ok,
	throws: [404],
	title: 'Delete snapshot',
	category: 'History',
});
