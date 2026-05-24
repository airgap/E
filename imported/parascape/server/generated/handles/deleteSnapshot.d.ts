import { deleteSnapshot } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { DeleteSnapshotRequest, DeleteSnapshotResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleDeleteSnapshot: (
	handler: (
		request: DeleteSnapshotRequest,
		context: SecureHttpContext<typeof deleteSnapshot>,
	) => DeleteSnapshotResponse | Promise<DeleteSnapshotResponse>,
) => {
	readonly execute: (
		request: DeleteSnapshotRequest,
		context: SecureHttpContext<typeof deleteSnapshot>,
	) => DeleteSnapshotResponse | Promise<DeleteSnapshotResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof deleteSnapshot;
};
