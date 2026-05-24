import { deleteComment } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { DeleteCommentRequest, DeleteCommentResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleDeleteComment: (
	handler: (
		request: DeleteCommentRequest,
		context: SecureHttpContext<typeof deleteComment>,
	) => DeleteCommentResponse | Promise<DeleteCommentResponse>,
) => {
	readonly execute: (
		request: DeleteCommentRequest,
		context: SecureHttpContext<typeof deleteComment>,
	) => DeleteCommentResponse | Promise<DeleteCommentResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof deleteComment;
};
