import { deleteInvite } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { DeleteInviteRequest, DeleteInviteResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleDeleteInvite: (
	handler: (
		request: DeleteInviteRequest,
		context: SecureHttpContext<typeof deleteInvite>,
	) => DeleteInviteResponse | Promise<DeleteInviteResponse>,
) => {
	readonly execute: (
		request: DeleteInviteRequest,
		context: SecureHttpContext<typeof deleteInvite>,
	) => DeleteInviteResponse | Promise<DeleteInviteResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof deleteInvite;
};
