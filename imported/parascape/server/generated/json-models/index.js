export const users = {
	type: 'object',
	properties: {
		id: { type: 'bigint', primaryKey: true },
		username: { type: 'string', unique: true, minLength: 3 },
		password_hash: { type: 'string' },
		created_at: { type: 'bigint' },
	},
	required: ['username', 'password_hash', 'created_at'],
};

export const sessions = {
	type: 'object',
	properties: {
		token: { type: 'string', primaryKey: true },
		user_id: { type: 'bigint' },
		created_at: { type: 'bigint' },
	},
	required: ['user_id', 'created_at'],
};

export const projects = {
	type: 'object',
	properties: {
		id: { type: 'bigint', primaryKey: true },
		user_id: { type: 'bigint' },
		name: { type: 'string' },
		doc: { type: 'object', properties: {}, required: [] },
		updated_at: { type: 'bigint' },
	},
	required: ['user_id', 'name', 'doc', 'updated_at'],
};

export const assets = {
	type: 'object',
	properties: {
		id: { type: 'bigint', primaryKey: true },
		user_id: { type: 'bigint' },
		name: { type: 'string' },
		mime: { type: 'string' },
		size: { type: 'bigint' },
		created_at: { type: 'bigint' },
	},
	required: ['user_id', 'name', 'mime', 'size', 'created_at'],
};

export const published = {
	type: 'object',
	properties: {
		slug: { type: 'string', primaryKey: true },
		user_id: { type: 'bigint' },
		doc: { type: 'object', properties: {}, required: [] },
		updated_at: { type: 'bigint' },
	},
	required: ['user_id', 'doc', 'updated_at'],
};

export const snapshots = {
	type: 'object',
	properties: {
		id: { type: 'bigint', primaryKey: true },
		user_id: { type: 'bigint' },
		label: { type: 'string' },
		doc: { type: 'object', properties: {}, required: [] },
		created_at: { type: 'bigint' },
	},
	required: ['user_id', 'label', 'doc', 'created_at'],
};

export const collaborators = {
	type: 'object',
	properties: {
		id: { type: 'bigint', primaryKey: true },
		project_id: { type: 'bigint' },
		user_id: { type: 'bigint' },
		role: { type: 'string' },
		created_at: { type: 'bigint' },
	},
	required: ['project_id', 'user_id', 'role', 'created_at'],
};

export const project_invites = {
	type: 'object',
	properties: {
		token: { type: 'string', primaryKey: true },
		project_id: { type: 'bigint' },
		role: { type: 'string' },
		created_by: { type: 'bigint' },
		created_at: { type: 'bigint' },
	},
	required: ['project_id', 'role', 'created_by', 'created_at'],
};

export const comments = {
	type: 'object',
	properties: {
		id: { type: 'bigint', primaryKey: true },
		project_id: { type: 'bigint' },
		page_id: { type: 'bigint' },
		node_key: { type: 'bigint' },
		x: { type: 'number' },
		y: { type: 'number' },
		author_id: { type: 'bigint' },
		author_name: { type: 'string' },
		body: { type: 'string' },
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
};
