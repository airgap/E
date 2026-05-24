import { uploadAsset } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { UploadAssetRequest, UploadAssetResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleUploadAsset: (
	handler: (
		request: UploadAssetRequest,
		context: SecureHttpContext<typeof uploadAsset>,
	) => UploadAssetResponse | Promise<UploadAssetResponse>,
) => {
	readonly execute: (
		request: UploadAssetRequest,
		context: SecureHttpContext<typeof uploadAsset>,
	) => UploadAssetResponse | Promise<UploadAssetResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof uploadAsset;
};
