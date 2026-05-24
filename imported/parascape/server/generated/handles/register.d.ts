import { register } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { RegisterRequest, RegisterResponse } from '../api-types';
import type { MaybeSecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleRegister: (
	handler: (
		request: RegisterRequest,
		context: MaybeSecureHttpContext<typeof register>,
	) => RegisterResponse | Promise<RegisterResponse>,
) => {
	readonly execute: (
		request: RegisterRequest,
		context: MaybeSecureHttpContext<typeof register>,
	) => RegisterResponse | Promise<RegisterResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof register;
};
