export declare const users: {
	type: 'object';
	properties: {
		id: { type: 'bigint'; primaryKey: true };
		username: { type: 'string'; unique: true; minLength: 3 };
		password_hash: { type: 'string' };
		created_at: { type: 'bigint' };
	};
	required: ['username', 'password_hash', 'created_at'];
};
export type Users = {
	id?: bigint;
	username: string;
	password_hash: string;
	created_at: bigint;
};

export type InsertableUsers = {
	id?: bigint;
	username?: string;
	password_hash?: string;
	created_at?: bigint;
};

export declare const sessions: {
	type: 'object';
	properties: {
		token: { type: 'string'; primaryKey: true };
		user_id: { type: 'bigint' };
		created_at: { type: 'bigint' };
	};
	required: ['user_id', 'created_at'];
};
export type Sessions = { token?: string; user_id: bigint; created_at: bigint };

export type InsertableSessions = {
	token?: string;
	user_id?: bigint;
	created_at?: bigint;
};

export declare const projects: {
	type: 'object';
	properties: {
		id: { type: 'bigint'; primaryKey: true };
		user_id: { type: 'bigint' };
		name: { type: 'string' };
		doc: { type: 'object'; properties: {}; required: [] };
		updated_at: { type: 'bigint' };
	};
	required: ['user_id', 'name', 'doc', 'updated_at'];
};
export type Projects = {
	id?: bigint;
	user_id: bigint;
	name: string;
	doc: {};
	updated_at: bigint;
};

export type InsertableProjects = {
	id?: bigint;
	user_id?: bigint;
	name?: string;
	doc?: {};
	updated_at?: bigint;
};

export declare const assets: {
	type: 'object';
	properties: {
		id: { type: 'bigint'; primaryKey: true };
		user_id: { type: 'bigint' };
		name: { type: 'string' };
		mime: { type: 'string' };
		size: { type: 'bigint' };
		created_at: { type: 'bigint' };
	};
	required: ['user_id', 'name', 'mime', 'size', 'created_at'];
};
export type Assets = {
	id?: bigint;
	user_id: bigint;
	name: string;
	mime: string;
	size: bigint;
	created_at: bigint;
};

export type InsertableAssets = {
	id?: bigint;
	user_id?: bigint;
	name?: string;
	mime?: string;
	size?: bigint;
	created_at?: bigint;
};

export declare const published: {
	type: 'object';
	properties: {
		slug: { type: 'string'; primaryKey: true };
		user_id: { type: 'bigint' };
		doc: { type: 'object'; properties: {}; required: [] };
		updated_at: { type: 'bigint' };
	};
	required: ['user_id', 'doc', 'updated_at'];
};
export type Published = {
	slug?: string;
	user_id: bigint;
	doc: {};
	updated_at: bigint;
};

export type InsertablePublished = {
	slug?: string;
	user_id?: bigint;
	doc?: {};
	updated_at?: bigint;
};

export declare const snapshots: {
	type: 'object';
	properties: {
		id: { type: 'bigint'; primaryKey: true };
		user_id: { type: 'bigint' };
		label: { type: 'string' };
		doc: { type: 'object'; properties: {}; required: [] };
		created_at: { type: 'bigint' };
	};
	required: ['user_id', 'label', 'doc', 'created_at'];
};
export type Snapshots = {
	id?: bigint;
	user_id: bigint;
	label: string;
	doc: {};
	created_at: bigint;
};

export type InsertableSnapshots = {
	id?: bigint;
	user_id?: bigint;
	label?: string;
	doc?: {};
	created_at?: bigint;
};

export declare const collaborators: {
	type: 'object';
	properties: {
		id: { type: 'bigint'; primaryKey: true };
		project_id: { type: 'bigint' };
		user_id: { type: 'bigint' };
		role: { type: 'string' };
		created_at: { type: 'bigint' };
	};
	required: ['project_id', 'user_id', 'role', 'created_at'];
};
export type Collaborators = {
	id?: bigint;
	project_id: bigint;
	user_id: bigint;
	role: string;
	created_at: bigint;
};

export type InsertableCollaborators = {
	id?: bigint;
	project_id?: bigint;
	user_id?: bigint;
	role?: string;
	created_at?: bigint;
};

export declare const project_invites: {
	type: 'object';
	properties: {
		token: { type: 'string'; primaryKey: true };
		project_id: { type: 'bigint' };
		role: { type: 'string' };
		created_by: { type: 'bigint' };
		created_at: { type: 'bigint' };
	};
	required: ['project_id', 'role', 'created_by', 'created_at'];
};
export type Project_invites = {
	token?: string;
	project_id: bigint;
	role: string;
	created_by: bigint;
	created_at: bigint;
};

export type InsertableProject_invites = {
	token?: string;
	project_id?: bigint;
	role?: string;
	created_by?: bigint;
	created_at?: bigint;
};

export declare const comments: {
	type: 'object';
	properties: {
		id: { type: 'bigint'; primaryKey: true };
		project_id: { type: 'bigint' };
		page_id: { type: 'bigint' };
		node_key: { type: 'bigint' };
		x: { type: 'number' };
		y: { type: 'number' };
		author_id: { type: 'bigint' };
		author_name: { type: 'string' };
		body: { type: 'string' };
		resolved: { type: 'boolean' };
		created_at: { type: 'bigint' };
	};
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
	];
};
export type Comments = {
	id?: bigint;
	project_id: bigint;
	page_id: bigint;
	node_key?: bigint;
	x: number;
	y: number;
	author_id: bigint;
	author_name: string;
	body: string;
	resolved: boolean;
	created_at: bigint;
};

export type InsertableComments = {
	id?: bigint;
	project_id?: bigint;
	page_id?: bigint;
	node_key?: bigint;
	x?: number;
	y?: number;
	author_id?: bigint;
	author_name?: string;
	body?: string;
	resolved?: boolean;
	created_at?: bigint;
};
