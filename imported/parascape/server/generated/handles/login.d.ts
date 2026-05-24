import { login } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { LoginRequest, LoginResponse } from '../api-types';
import type { MaybeSecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleLogin: (
	handler: (
		request: LoginRequest,
		context: MaybeSecureHttpContext<typeof login>,
	) => LoginResponse | Promise<LoginResponse>,
) => {
	readonly execute: (
		request: LoginRequest,
		context: MaybeSecureHttpContext<typeof login>,
	) => LoginResponse | Promise<LoginResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof login;
};
