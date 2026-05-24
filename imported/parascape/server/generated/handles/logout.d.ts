import { logout } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { LogoutRequest, LogoutResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleLogout: (
	handler: (
		request: LogoutRequest,
		context: SecureHttpContext<typeof logout>,
	) => LogoutResponse | Promise<LogoutResponse>,
) => {
	readonly execute: (
		request: LogoutRequest,
		context: SecureHttpContext<typeof logout>,
	) => LogoutResponse | Promise<LogoutResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof logout;
};
