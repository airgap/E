export type AddCollaboratorRequest = {
	projectId: number;
	username: string;
	role: string;
};
export type AddCollaboratorResponse = {
	user_id: number;
	username: string;
	role: string;
};
export type AddCommentRequest = {
	projectId: number;
	pageId: number;
	x: number;
	y: number;
	body: string;
	nodeKey?: number;
};
export type AddCommentResponse = {
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
export type CreateInviteRequest = { projectId: number; role: string };
export type CreateInviteResponse = { token: string; role: string };
export type CreateProjectRequest = { name: string; doc: {} };
export type CreateProjectResponse = { id: number; name: string };
export type CreateSnapshotRequest = { label: string; doc: {} };
export type CreateSnapshotResponse = {
	id: number;
	label: string;
	created_at: number;
};
export type DeleteAssetRequest = { id: number };
export type DeleteAssetResponse = { ok: boolean };
export type DeleteCommentRequest = { id: number };
export type DeleteCommentResponse = { ok: boolean };
export type DeleteInviteRequest = { projectId: number; token: string };
export type DeleteInviteResponse = { ok: boolean };
export type DeleteProjectRequest = { id: number };
export type DeleteProjectResponse = { ok: boolean };
export type DeleteSnapshotRequest = { id: number };
export type DeleteSnapshotResponse = { ok: boolean };
export type DuplicateProjectRequest = { id: number };
export type DuplicateProjectResponse = { id: number; name: string };
export type GetProjectRequest = { id: number };
export type GetProjectResponse = {
	id: number;
	name: string;
	doc: {};
	updated_at: number;
	role: string;
};
export type GetSnapshotRequest = { id: number };
export type GetSnapshotResponse = {
	id: number;
	label: string;
	doc: {};
	created_at: number;
};
export type HealthRequest = void;
export type HealthResponse = { ok: boolean; guest: boolean };
export type ListAssetsRequest = void;
export type ListAssetsResponse = {
	assets: Array<{
		id: number;
		name: string;
		mime: string;
		size: number;
		created_at: number;
	}>;
};
export type ListCollaboratorsRequest = { projectId: number };
export type ListCollaboratorsResponse = {
	owner: { id: number; username: string };
	collaborators: Array<{ user_id: number; username: string; role: string }>;
};
export type ListCommentsRequest = { projectId: number };
export type ListCommentsResponse = {
	comments: Array<{
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
	}>;
};
export type ListInvitesRequest = { projectId: number };
export type ListInvitesResponse = {
	invites: Array<{ token: string; role: string }>;
};
export type ListProjectsRequest = void;
export type ListProjectsResponse = {
	projects: Array<{
		id: number;
		name: string;
		updated_at: number;
		owner: boolean;
		role: string;
	}>;
};
export type ListSnapshotsRequest = void;
export type ListSnapshotsResponse = {
	snapshots: Array<{ id: number; label: string; created_at: number }>;
};
export type LoginRequest = { username: string; password: string };
export type LoginResponse = {
	token: string;
	user: { id: number; username: string };
};
export type LogoutRequest = void;
export type LogoutResponse = { ok: boolean };
export type MeRequest = void;
export type MeResponse = {
	user: { id: number; username: string };
	guest: boolean;
};
export type PublishRequest = { slug: string; doc: {} };
export type PublishResponse = { slug: string; url: string };
export type RedeemInviteRequest = { token: string };
export type RedeemInviteResponse = {
	projectId: number;
	role: string;
	name: string;
};
export type RegisterRequest = { username: string; password: string };
export type RegisterResponse = {
	token: string;
	user: { id: number; username: string };
};
export type RemoveCollaboratorRequest = { projectId: number; userId: number };
export type RemoveCollaboratorResponse = { ok: boolean };
export type ResolveCommentRequest = { id: number; resolved: boolean };
export type ResolveCommentResponse = { ok: boolean };
export type UpdateProjectRequest = { id: number; name?: string; doc?: {} };
export type UpdateProjectResponse = { ok: boolean };
export type UploadAssetRequest = { name: string; mime: string; data: string };
export type UploadAssetResponse = {
	id: number;
	name: string;
	mime: string;
	size: number;
};

export type ApiTypes = {
	addCollaborator: {
		request: AddCollaboratorRequest;
		response: AddCollaboratorResponse;
	};
	addComment: { request: AddCommentRequest; response: AddCommentResponse };
	createInvite: {
		request: CreateInviteRequest;
		response: CreateInviteResponse;
	};
	createProject: {
		request: CreateProjectRequest;
		response: CreateProjectResponse;
	};
	createSnapshot: {
		request: CreateSnapshotRequest;
		response: CreateSnapshotResponse;
	};
	deleteAsset: { request: DeleteAssetRequest; response: DeleteAssetResponse };
	deleteComment: {
		request: DeleteCommentRequest;
		response: DeleteCommentResponse;
	};
	deleteInvite: {
		request: DeleteInviteRequest;
		response: DeleteInviteResponse;
	};
	deleteProject: {
		request: DeleteProjectRequest;
		response: DeleteProjectResponse;
	};
	deleteSnapshot: {
		request: DeleteSnapshotRequest;
		response: DeleteSnapshotResponse;
	};
	duplicateProject: {
		request: DuplicateProjectRequest;
		response: DuplicateProjectResponse;
	};
	getProject: { request: GetProjectRequest; response: GetProjectResponse };
	getSnapshot: { request: GetSnapshotRequest; response: GetSnapshotResponse };
	health: { response: HealthResponse };
	listAssets: { response: ListAssetsResponse };
	listCollaborators: {
		request: ListCollaboratorsRequest;
		response: ListCollaboratorsResponse;
	};
	listComments: {
		request: ListCommentsRequest;
		response: ListCommentsResponse;
	};
	listInvites: { request: ListInvitesRequest; response: ListInvitesResponse };
	listProjects: { response: ListProjectsResponse };
	listSnapshots: { response: ListSnapshotsResponse };
	login: { request: LoginRequest; response: LoginResponse };
	logout: { response: LogoutResponse };
	me: { response: MeResponse };
	publish: { request: PublishRequest; response: PublishResponse };
	redeemInvite: {
		request: RedeemInviteRequest;
		response: RedeemInviteResponse;
	};
	register: { request: RegisterRequest; response: RegisterResponse };
	removeCollaborator: {
		request: RemoveCollaboratorRequest;
		response: RemoveCollaboratorResponse;
	};
	resolveComment: {
		request: ResolveCommentRequest;
		response: ResolveCommentResponse;
	};
	updateProject: {
		request: UpdateProjectRequest;
		response: UpdateProjectResponse;
	};
	uploadAsset: { request: UploadAssetRequest; response: UploadAssetResponse };
};
