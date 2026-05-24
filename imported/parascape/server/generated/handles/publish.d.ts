import { publish } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { PublishRequest, PublishResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handlePublish: (
	handler: (
		request: PublishRequest,
		context: SecureHttpContext<typeof publish>,
	) => PublishResponse | Promise<PublishResponse>,
) => {
	readonly execute: (
		request: PublishRequest,
		context: SecureHttpContext<typeof publish>,
	) => PublishResponse | Promise<PublishResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof publish;
};
