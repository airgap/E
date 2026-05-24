import { listInvites } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { ListInvitesRequest, ListInvitesResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleListInvites: (
	handler: (
		request: ListInvitesRequest,
		context: SecureHttpContext<typeof listInvites>,
	) => ListInvitesResponse | Promise<ListInvitesResponse>,
) => {
	readonly execute: (
		request: ListInvitesRequest,
		context: SecureHttpContext<typeof listInvites>,
	) => ListInvitesResponse | Promise<ListInvitesResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof listInvites;
};
