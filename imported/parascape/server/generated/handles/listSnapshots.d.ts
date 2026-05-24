import { listSnapshots } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { ListSnapshotsRequest, ListSnapshotsResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleListSnapshots: (
	handler: (
		request: ListSnapshotsRequest,
		context: SecureHttpContext<typeof listSnapshots>,
	) => ListSnapshotsResponse | Promise<ListSnapshotsResponse>,
) => {
	readonly execute: (
		request: ListSnapshotsRequest,
		context: SecureHttpContext<typeof listSnapshots>,
	) => ListSnapshotsResponse | Promise<ListSnapshotsResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof listSnapshots;
};
