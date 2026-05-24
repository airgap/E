import { removeCollaborator } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { RemoveCollaboratorRequest, RemoveCollaboratorResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleRemoveCollaborator: (
	handler: (
		request: RemoveCollaboratorRequest,
		context: SecureHttpContext<typeof removeCollaborator>,
	) => RemoveCollaboratorResponse | Promise<RemoveCollaboratorResponse>,
) => {
	readonly execute: (
		request: RemoveCollaboratorRequest,
		context: SecureHttpContext<typeof removeCollaborator>,
	) => RemoveCollaboratorResponse | Promise<RemoveCollaboratorResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof removeCollaborator;
};
