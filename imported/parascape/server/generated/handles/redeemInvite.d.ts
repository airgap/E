import { redeemInvite } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { RedeemInviteRequest, RedeemInviteResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleRedeemInvite: (
	handler: (
		request: RedeemInviteRequest,
		context: SecureHttpContext<typeof redeemInvite>,
	) => RedeemInviteResponse | Promise<RedeemInviteResponse>,
) => {
	readonly execute: (
		request: RedeemInviteRequest,
		context: SecureHttpContext<typeof redeemInvite>,
	) => RedeemInviteResponse | Promise<RedeemInviteResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof redeemInvite;
};
