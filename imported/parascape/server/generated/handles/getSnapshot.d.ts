import { getSnapshot } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { GetSnapshotRequest, GetSnapshotResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleGetSnapshot: (
	handler: (
		request: GetSnapshotRequest,
		context: SecureHttpContext<typeof getSnapshot>,
	) => GetSnapshotResponse | Promise<GetSnapshotResponse>,
) => {
	readonly execute: (
		request: GetSnapshotRequest,
		context: SecureHttpContext<typeof getSnapshot>,
	) => GetSnapshotResponse | Promise<GetSnapshotResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof getSnapshot;
};
