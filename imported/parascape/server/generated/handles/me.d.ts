import { me } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { MeRequest, MeResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleMe: (
	handler: (
		request: MeRequest,
		context: SecureHttpContext<typeof me>,
	) => MeResponse | Promise<MeResponse>,
) => {
	readonly execute: (
		request: MeRequest,
		context: SecureHttpContext<typeof me>,
	) => MeResponse | Promise<MeResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof me;
};
