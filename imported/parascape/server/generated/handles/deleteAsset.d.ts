import { deleteAsset } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { DeleteAssetRequest, DeleteAssetResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleDeleteAsset: (
	handler: (
		request: DeleteAssetRequest,
		context: SecureHttpContext<typeof deleteAsset>,
	) => DeleteAssetResponse | Promise<DeleteAssetResponse>,
) => {
	readonly execute: (
		request: DeleteAssetRequest,
		context: SecureHttpContext<typeof deleteAsset>,
	) => DeleteAssetResponse | Promise<DeleteAssetResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof deleteAsset;
};
