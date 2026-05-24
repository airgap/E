import { listCollaborators } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { ListCollaboratorsRequest, ListCollaboratorsResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleListCollaborators: (
	handler: (
		request: ListCollaboratorsRequest,
		context: SecureHttpContext<typeof listCollaborators>,
	) => ListCollaboratorsResponse | Promise<ListCollaboratorsResponse>,
) => {
	readonly execute: (
		request: ListCollaboratorsRequest,
		context: SecureHttpContext<typeof listCollaborators>,
	) => ListCollaboratorsResponse | Promise<ListCollaboratorsResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof listCollaborators;
};
