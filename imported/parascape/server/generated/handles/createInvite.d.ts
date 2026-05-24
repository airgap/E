import { createInvite } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { CreateInviteRequest, CreateInviteResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleCreateInvite: (
	handler: (
		request: CreateInviteRequest,
		context: SecureHttpContext<typeof createInvite>,
	) => CreateInviteResponse | Promise<CreateInviteResponse>,
) => {
	readonly execute: (
		request: CreateInviteRequest,
		context: SecureHttpContext<typeof createInvite>,
	) => CreateInviteResponse | Promise<CreateInviteResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof createInvite;
};
