// Client for the Parascape account + persistence API (LYK-930), backed by the
// lockstep-generated client (server/generated/client) over MessagePack — the
// session token rides as a Bearer header via getSessionId. When signed out, the
// Designer falls back to its localStorage-only persistence. assetUrl points at
// the public binary route (raw, not a client call).
import { createClient } from '../../server/generated/client/index.js';

const TOKEN_KEY = 'parascape-token';

export type Account = { id: number; username: string };
export type Role = 'owner' | 'editor' | 'viewer';
export type ProjectMeta = {
	id: number;
	name: string;
	updated_at: number;
	owner: boolean;
	role: Role;
};

export const getToken = (): string | null => {
	try {
		return localStorage.getItem(TOKEN_KEY);
	} catch {
		return null;
	}
};
const setToken = (t: string | null) => {
	try {
		if (t) localStorage.setItem(TOKEN_KEY, t);
		else localStorage.removeItem(TOKEN_KEY);
	} catch {}
};

const client = createClient({
	baseUrl: '/api',
	getSessionId: () => getToken() ?? undefined,
});

export async function register(username: string, password: string): Promise<Account> {
	const r = await client.register({ username, password });
	setToken(r.token);
	return r.user;
}
// Always-200 probe: tells the client whether the server is in guest mode without
// triggering a 401 (so we only call the authed /me when there's a token or guest).
export async function health(): Promise<{ ok: boolean; guest: boolean }> {
	const r = await client.health();
	return { ok: !!r.ok, guest: !!r.guest };
}
export async function login(username: string, password: string): Promise<Account> {
	const r = await client.login({ username, password });
	setToken(r.token);
	return r.user;
}
export async function logout(): Promise<void> {
	try {
		await client.logout();
	} catch {}
	setToken(null);
}
export async function me(): Promise<{ user: Account; guest: boolean }> {
	const r = await client.me();
	return { user: r.user, guest: !!r.guest };
}
export async function listProjects(): Promise<ProjectMeta[]> {
	return (await client.listProjects()).projects;
}
export async function getProject(
	id: number,
): Promise<{ id: number; name: string; doc: unknown; updated_at: number; role: Role }> {
	return client.getProject({ id }) as Promise<{
		id: number;
		name: string;
		doc: unknown;
		updated_at: number;
		role: Role;
	}>;
}
export async function createProject(name: string, doc: unknown): Promise<number> {
	return (await client.createProject({ name, doc })).id;
}
export async function saveProject(id: number, doc: unknown): Promise<void> {
	await client.updateProject({ id, doc });
}
export async function deleteProject(id: number): Promise<void> {
	await client.deleteProject({ id });
}
// fork any readable project into a new one you own (LYK-954)
export async function duplicateProject(id: number): Promise<{ id: number; name: string }> {
	return client.duplicateProject({ id });
}

// --- review comments (LYK-955) ---
export type Comment = {
	id: number;
	page_id: number;
	node_key?: number;
	x: number;
	y: number;
	author_id: number;
	author_name: string;
	body: string;
	resolved: boolean;
	created_at: number;
};
export async function listComments(projectId: number): Promise<Comment[]> {
	return (await client.listComments({ projectId })).comments as Comment[];
}
export async function addComment(
	projectId: number,
	pageId: number,
	x: number,
	y: number,
	body: string,
	nodeKey?: number,
): Promise<Comment> {
	return client.addComment({ projectId, pageId, x, y, body, nodeKey }) as Promise<Comment>;
}
export async function resolveComment(id: number, resolved: boolean): Promise<void> {
	await client.resolveComment({ id, resolved });
}
export async function deleteComment(id: number): Promise<void> {
	await client.deleteComment({ id });
}

// --- sharing / collaborators (LYK-951) ---
export type Collaborator = { user_id: number; username: string; role: Role };
export type ShareInvite = { token: string; role: Role };
export async function addCollaborator(
	projectId: number,
	username: string,
	role: Role,
): Promise<Collaborator> {
	return client.addCollaborator({ projectId, username, role }) as Promise<Collaborator>;
}
export async function listCollaborators(
	projectId: number,
): Promise<{ owner: Account; collaborators: Collaborator[] }> {
	return client.listCollaborators({ projectId }) as Promise<{
		owner: Account;
		collaborators: Collaborator[];
	}>;
}
export async function removeCollaborator(projectId: number, userId: number): Promise<void> {
	await client.removeCollaborator({ projectId, userId });
}
export async function createInvite(projectId: number, role: Role): Promise<ShareInvite> {
	return client.createInvite({ projectId, role }) as Promise<ShareInvite>;
}
export async function listInvites(projectId: number): Promise<ShareInvite[]> {
	return (await client.listInvites({ projectId })).invites as ShareInvite[];
}
export async function deleteInvite(projectId: number, token: string): Promise<void> {
	await client.deleteInvite({ projectId, token });
}
export async function redeemInvite(
	token: string,
): Promise<{ projectId: number; role: Role; name: string }> {
	return client.redeemInvite({ token }) as Promise<{ projectId: number; role: Role; name: string }>;
}

// --- assets (LYK-935) ---
export type AssetMeta = {
	id: number;
	name: string;
	mime: string;
	size: number;
	created_at: number;
};
// stable URL for an asset's binary (served publicly so <img src> works)
export const assetUrl = (id: number): string => `/api/assets/${id}`;
const fileToBase64 = (file: File): Promise<string> =>
	new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onerror = () => reject(new Error('read failed'));
		r.onload = () => resolve(String(r.result).split(',')[1] ?? ''); // strip the data: prefix
		r.readAsDataURL(file);
	});
export async function uploadAsset(file: File): Promise<AssetMeta> {
	const data = await fileToBase64(file);
	const r = await client.uploadAsset({
		name: file.name,
		mime: file.type || 'application/octet-stream',
		data,
	});
	return { ...r, created_at: Date.now() };
}
export async function listAssets(): Promise<AssetMeta[]> {
	return (await client.listAssets()).assets;
}
export async function deleteAsset(id: number): Promise<void> {
	await client.deleteAsset({ id });
}

// --- publish / dev preview (LYK-934) ---
export async function publish(slug: string, doc: unknown): Promise<{ slug: string; url: string }> {
	return client.publish({ slug, doc });
}

// --- version history / snapshots (LYK-943) ---
export type SnapshotMeta = { id: number; label: string; created_at: number };
export async function listSnapshots(): Promise<SnapshotMeta[]> {
	return (await client.listSnapshots()).snapshots;
}
export async function createSnapshot(label: string, doc: unknown): Promise<SnapshotMeta> {
	return client.createSnapshot({ label, doc });
}
export async function getSnapshot(
	id: number,
): Promise<{ id: number; label: string; doc: unknown; created_at: number }> {
	return client.getSnapshot({ id });
}
export async function deleteSnapshot(id: number): Promise<void> {
	await client.deleteSnapshot({ id });
}
