import { getProject } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { GetProjectRequest, GetProjectResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleGetProject: (
	handler: (
		request: GetProjectRequest,
		context: SecureHttpContext<typeof getProject>,
	) => GetProjectResponse | Promise<GetProjectResponse>,
) => {
	readonly execute: (
		request: GetProjectRequest,
		context: SecureHttpContext<typeof getProject>,
	) => GetProjectResponse | Promise<GetProjectResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof getProject;
};
