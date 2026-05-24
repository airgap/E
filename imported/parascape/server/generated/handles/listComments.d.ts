import { listComments } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { ListCommentsRequest, ListCommentsResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleListComments: (
	handler: (
		request: ListCommentsRequest,
		context: SecureHttpContext<typeof listComments>,
	) => ListCommentsResponse | Promise<ListCommentsResponse>,
) => {
	readonly execute: (
		request: ListCommentsRequest,
		context: SecureHttpContext<typeof listComments>,
	) => ListCommentsResponse | Promise<ListCommentsResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof listComments;
};
