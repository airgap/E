import { createProject } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { CreateProjectRequest, CreateProjectResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleCreateProject: (
	handler: (
		request: CreateProjectRequest,
		context: SecureHttpContext<typeof createProject>,
	) => CreateProjectResponse | Promise<CreateProjectResponse>,
) => {
	readonly execute: (
		request: CreateProjectRequest,
		context: SecureHttpContext<typeof createProject>,
	) => CreateProjectResponse | Promise<CreateProjectResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof createProject;
};
