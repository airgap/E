import { health } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { HealthRequest, HealthResponse } from '../api-types';
import type { MaybeSecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleHealth: (
	handler: (
		request: HealthRequest,
		context: MaybeSecureHttpContext<typeof health>,
	) => HealthResponse | Promise<HealthResponse>,
) => {
	readonly execute: (
		request: HealthRequest,
		context: MaybeSecureHttpContext<typeof health>,
	) => HealthResponse | Promise<HealthResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof health;
};
