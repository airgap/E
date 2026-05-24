import { listProjects } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { ListProjectsRequest, ListProjectsResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleListProjects: (
	handler: (
		request: ListProjectsRequest,
		context: SecureHttpContext<typeof listProjects>,
	) => ListProjectsResponse | Promise<ListProjectsResponse>,
) => {
	readonly execute: (
		request: ListProjectsRequest,
		context: SecureHttpContext<typeof listProjects>,
	) => ListProjectsResponse | Promise<ListProjectsResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof listProjects;
};
