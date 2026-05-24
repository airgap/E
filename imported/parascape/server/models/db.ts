// Parascape's database schema, expressed as @lyku/lockstep-core models.
// Single source of truth for the hosted D1 backend.
//
//   • `records`  — bare PostgresRecordModels → record types (json-models)
//   • `config`   — table models (records + indexes) → schema.sql (lockstep-sqlite)
//
// Mirrors the local bun:sqlite account-server: users / sessions / projects /
// assets / published. Primary keys are column-level (`primaryKey: true`); the
// table wrapper only adds indexes.
import type { PostgresRecordModel, PostgresTableModel } from '@lyku/lockstep-core';

const rec = <S extends PostgresRecordModel>(r: S) => r;

export const users = rec({
	properties: {
		id: { type: 'bigserial', primaryKey: true },
		username: { type: 'text', unique: true, minLength: 3 },
		password_hash: { type: 'text' },
		created_at: { type: 'bigint' }, // epoch ms
	},
	required: ['username', 'password_hash', 'created_at'],
});

export const sessions = rec({
	properties: {
		token: { type: 'text', primaryKey: true },
		user_id: { type: 'bigint' },
		created_at: { type: 'bigint' },
	},
	required: ['user_id', 'created_at'],
});

export const projects = rec({
	properties: {
		id: { type: 'bigserial', primaryKey: true },
		user_id: { type: 'bigint' },
		name: { type: 'text' },
		doc: { type: 'jsonb' }, // Designer project JSON
		updated_at: { type: 'bigint' },
	},
	required: ['user_id', 'name', 'doc', 'updated_at'],
});

export const assets = rec({
	properties: {
		id: { type: 'bigserial', primaryKey: true },
		user_id: { type: 'bigint' },
		name: { type: 'text' },
		mime: { type: 'text' },
		size: { type: 'bigint' },
		data: { type: 'bytea' }, // image bytes (BLOB)
		created_at: { type: 'bigint' },
	},
	required: ['user_id', 'name', 'mime', 'size', 'data', 'created_at'],
});

export const published = rec({
	properties: {
		slug: { type: 'text', primaryKey: true },
		user_id: { type: 'bigint' },
		doc: { type: 'jsonb' }, // published page snapshot
		updated_at: { type: 'bigint' },
	},
	required: ['user_id', 'doc', 'updated_at'],
});

// Cross-account sharing (LYK-951): who (besides the owner) may open a project,
// and their role. Uniqueness of (project_id, user_id) is enforced in the handler
// (lockstep-sqlite indexes are non-unique; an upsert keeps one row per pair).
export const collaborators = rec({
	properties: {
		id: { type: 'bigserial', primaryKey: true },
		project_id: { type: 'bigint' },
		user_id: { type: 'bigint' },
		role: { type: 'text' }, // 'editor' | 'viewer'
		created_at: { type: 'bigint' },
	},
	required: ['project_id', 'user_id', 'role', 'created_at'],
});

// Share-link tokens (LYK-951): a reusable link that, when redeemed by a
// signed-in user, adds them as a collaborator with the link's role.
export const project_invites = rec({
	properties: {
		token: { type: 'text', primaryKey: true },
		project_id: { type: 'bigint' },
		role: { type: 'text' }, // 'editor' | 'viewer'
		created_by: { type: 'bigint' },
		created_at: { type: 'bigint' },
	},
	required: ['project_id', 'role', 'created_by', 'created_at'],
});

// Review comments / annotations (LYK-955): pinned to a normalized canvas
// position on a page, optionally associated with a node. Any project member
// (incl. viewers) may add; author or owner may resolve/delete.
export const comments = rec({
	properties: {
		id: { type: 'bigserial', primaryKey: true },
		project_id: { type: 'bigint' },
		page_id: { type: 'bigint' },
		node_key: { type: 'bigint' }, // optional (nullable) — pin associated with a node
		x: { type: 'real' }, // normalized 0..1 canvas position
		y: { type: 'real' },
		author_id: { type: 'bigint' },
		author_name: { type: 'text' },
		body: { type: 'text' },
		resolved: { type: 'boolean' },
		created_at: { type: 'bigint' },
	},
	required: [
		'project_id',
		'page_id',
		'x',
		'y',
		'author_id',
		'author_name',
		'body',
		'resolved',
		'created_at',
	],
});

// Version history (LYK-943): named, restorable project snapshots.
export const snapshots = rec({
	properties: {
		id: { type: 'bigserial', primaryKey: true },
		user_id: { type: 'bigint' },
		label: { type: 'text' },
		doc: { type: 'jsonb' }, // full Designer project blob at snapshot time
		created_at: { type: 'bigint' },
	},
	required: ['user_id', 'label', 'doc', 'created_at'],
});

// json-models can't represent `bytea`; the binary `data` column is read as raw
// bytes by the Worker, never as a JSON record field. Strip it from the record
// type while keeping it in the DB schema below.
const { data: _data, ...assetMetaProps } = assets.properties;
const assetMeta = {
	properties: assetMetaProps,
	required: assets.required.filter((r) => r !== 'data'),
};

// snapshot record type omits the heavy `doc` from list responses but keeps it
// for getSnapshot; json-models keeps the full record (doc is jsonb → object).

/** Bare records → json-models (record types). */
export const records = {
	users,
	sessions,
	projects,
	assets: assetMeta,
	published,
	snapshots,
	collaborators,
	project_invites,
	comments,
};

/** Table models (records + indexes) → schema.sql via @lyku/lockstep-sqlite. */
const tbl = <S extends PostgresRecordModel>(m: PostgresTableModel<S>) => m;
export const config = {
	tables: {
		users: tbl({ schema: users }),
		sessions: tbl({ schema: sessions, indexes: ['user_id'] }),
		projects: tbl({ schema: projects, indexes: ['user_id'] }),
		assets: tbl({ schema: assets, indexes: ['user_id'] }),
		published: tbl({ schema: published }),
		snapshots: tbl({ schema: snapshots, indexes: ['user_id'] }),
		collaborators: tbl({ schema: collaborators, indexes: ['project_id', 'user_id'] }),
		project_invites: tbl({ schema: project_invites, indexes: ['project_id'] }),
		comments: tbl({ schema: comments, indexes: ['project_id'] }),
	},
};
