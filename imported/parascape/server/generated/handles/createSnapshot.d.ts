import { createSnapshot } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { CreateSnapshotRequest, CreateSnapshotResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleCreateSnapshot: (
	handler: (
		request: CreateSnapshotRequest,
		context: SecureHttpContext<typeof createSnapshot>,
	) => CreateSnapshotResponse | Promise<CreateSnapshotResponse>,
) => {
	readonly execute: (
		request: CreateSnapshotRequest,
		context: SecureHttpContext<typeof createSnapshot>,
	) => CreateSnapshotResponse | Promise<CreateSnapshotResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof createSnapshot;
};
