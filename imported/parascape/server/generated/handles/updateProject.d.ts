import { updateProject } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { UpdateProjectRequest, UpdateProjectResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleUpdateProject: (
	handler: (
		request: UpdateProjectRequest,
		context: SecureHttpContext<typeof updateProject>,
	) => UpdateProjectResponse | Promise<UpdateProjectResponse>,
) => {
	readonly execute: (
		request: UpdateProjectRequest,
		context: SecureHttpContext<typeof updateProject>,
	) => UpdateProjectResponse | Promise<UpdateProjectResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof updateProject;
};
