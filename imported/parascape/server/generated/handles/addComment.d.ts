import { addComment } from '../../models/api';
import type { ApiTypes } from '../api-types';
import type { AddCommentRequest, AddCommentResponse } from '../api-types';
import type { SecureHttpContext } from '@lyku/lockstep-core/contexts';
export declare const handleAddComment: (
	handler: (
		request: AddCommentRequest,
		context: SecureHttpContext<typeof addComment>,
	) => AddCommentResponse | Promise<AddCommentResponse>,
) => {
	readonly execute: (
		request: AddCommentRequest,
		context: SecureHttpContext<typeof addComment>,
	) => AddCommentResponse | Promise<AddCommentResponse>;
	readonly validator: {
		validate: (request: unknown) => string[];
		validateOrThrow: (request: unknown) => void;
		isValid: (request: unknown) => string | true;
	};
	readonly model: typeof addComment;
};
