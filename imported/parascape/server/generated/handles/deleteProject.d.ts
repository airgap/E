import { deleteProject } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { DeleteProjectRequest, DeleteProjectResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleDeleteProject: (
	handler: (
		request: DeleteProjectRequest,
		context: SecureHttpContext<typeof deleteProject>,
	) => DeleteProjectResponse | Promise<DeleteProjectResponse>,
) => {
	readonly execute: (
		request: DeleteProjectRequest,
		context: SecureHttpContext<typeof deleteProject>,
	) => DeleteProjectResponse | Promise<DeleteProjectResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof deleteProject;
};
