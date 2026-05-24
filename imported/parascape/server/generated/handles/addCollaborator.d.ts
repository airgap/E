import { addCollaborator } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { AddCollaboratorRequest, AddCollaboratorResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleAddCollaborator: (
	handler: (
		request: AddCollaboratorRequest,
		context: SecureHttpContext<typeof addCollaborator>,
	) => AddCollaboratorResponse | Promise<AddCollaboratorResponse>,
) => {
	readonly execute: (
		request: AddCollaboratorRequest,
		context: SecureHttpContext<typeof addCollaborator>,
	) => AddCollaboratorResponse | Promise<AddCollaboratorResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof addCollaborator;
};
