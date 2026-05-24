import { duplicateProject } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { DuplicateProjectRequest, DuplicateProjectResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleDuplicateProject: (
	handler: (
		request: DuplicateProjectRequest,
		context: SecureHttpContext<typeof duplicateProject>,
	) => DuplicateProjectResponse | Promise<DuplicateProjectResponse>,
) => {
	readonly execute: (
		request: DuplicateProjectRequest,
		context: SecureHttpContext<typeof duplicateProject>,
	) => DuplicateProjectResponse | Promise<DuplicateProjectResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof duplicateProject;
};
