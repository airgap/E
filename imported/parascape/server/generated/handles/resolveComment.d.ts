import { resolveComment } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { ResolveCommentRequest, ResolveCommentResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleResolveComment: (
	handler: (
		request: ResolveCommentRequest,
		context: SecureHttpContext<typeof resolveComment>,
	) => ResolveCommentResponse | Promise<ResolveCommentResponse>,
) => {
	readonly execute: (
		request: ResolveCommentRequest,
		context: SecureHttpContext<typeof resolveComment>,
	) => ResolveCommentResponse | Promise<ResolveCommentResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof resolveComment;
};
