import { listAssets } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { ListAssetsRequest, ListAssetsResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleListAssets: (
	handler: (
		request: ListAssetsRequest,
		context: SecureHttpContext<typeof listAssets>,
	) => ListAssetsResponse | Promise<ListAssetsResponse>,
) => {
	readonly execute: (
		request: ListAssetsRequest,
		context: SecureHttpContext<typeof listAssets>,
	) => ListAssetsResponse | Promise<ListAssetsResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof listAssets;
};
