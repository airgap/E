// Worker-side runtime helpers shared by the lockstep handlers + raw routes.
// Cloudflare Workers have neither bun:sqlite nor argon2id, so this uses D1 +
// Web Crypto PBKDF2 (ported from the local account-server).

export interface D1Result<T = Record<string, unknown>> {
	results: T[];
	success: boolean;
}
export interface D1PreparedStatement {
	bind(...values: unknown[]): D1PreparedStatement;
	first<T = Record<string, unknown>>(col?: string): Promise<T | null>;
	run<T = Record<string, unknown>>(): Promise<D1Result<T> & { meta: { last_row_id: number } }>;
	all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
export interface D1Database {
	prepare(query: string): D1PreparedStatement;
}
export interface DurableObjectStub {
	fetch(req: Request): Promise<Response>;
}
export interface DurableObjectNamespace {
	idFromName(name: string): unknown;
	get(id: unknown): DurableObjectStub;
}
export interface Env {
	DB: D1Database;
	ASSETS: { fetch: (req: Request) => Promise<Response> };
	// collaboration room (LYK-944) — one Durable Object instance per project
	ROOM: DurableObjectNamespace;
}

export const now = (): number => Date.now();

/** Thrown by handlers to produce a non-2xx response with a JSON error body. */
export class HttpError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

export const json = (data: unknown, status = 200, headers?: Headers): Response => {
	const h = headers ?? new Headers();
	h.set('content-type', 'application/json');
	return new Response(JSON.stringify(data), { status, headers: h });
};

// ── base64 (no Buffer on Workers) ──
export function b64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}
export function bytesToB64(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin);
}

// ── password hashing: PBKDF2-SHA256 via Web Crypto ──
const PBKDF2_ITER = 100_000;
export async function hashPassword(pw: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, [
		'deriveBits',
	]);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
		key,
		256,
	);
	return `pbkdf2$${PBKDF2_ITER}$${bytesToB64(salt)}$${bytesToB64(new Uint8Array(bits))}`;
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
	const [scheme, iterStr, saltB64, hashB64] = stored.split('$');
	if (scheme !== 'pbkdf2') return false;
	const salt = b64ToBytes(saltB64);
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, [
		'deriveBits',
	]);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt, iterations: Number(iterStr), hash: 'SHA-256' },
		key,
		256,
	);
	const got = bytesToB64(new Uint8Array(bits));
	if (got.length !== hashB64.length) return false;
	let diff = 0;
	for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ hashB64.charCodeAt(i);
	return diff === 0;
}

// ── sessions ──
export interface SessionUser {
	id: number;
	username: string;
}
export function bearerToken(req: Request): string {
	const auth = req.headers.get('authorization') ?? '';
	return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}
export async function userFromRequest(req: Request, env: Env): Promise<SessionUser | null> {
	const token = bearerToken(req);
	if (!token) return null;
	return env.DB.prepare(
		'SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?',
	)
		.bind(token)
		.first<SessionUser>();
}
export async function newSession(env: Env, userId: number): Promise<string> {
	const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
	await env.DB.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)')
		.bind(token, userId, now())
		.run();
	return token;
}
