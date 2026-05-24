import { deleteComment } from '../../models/api';
export const handleDeleteComment = (handler) => ({
	execute: handler,
	validator: {
		validate: (request) => {
			const allErrors = [];
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				allErrors.push('Value must be an object');
			} else {
				for (const prop of ['id']) {
					if (!(prop in request)) {
						allErrors.push(`Missing required property: ${prop}`);
					}
				}

				if ('id' in request) {
					const propErrors = [];
					{
						let allErrors = propErrors;

						let numValue = request['id'];
						if (typeof request['id'] === 'string') {
							numValue = Number(request['id']);
							if (isNaN(numValue)) {
								allErrors.push('Value must be a valid number');
							} else {
							}
						} else if (typeof request['id'] !== 'number') {
							allErrors.push('Value must be a number');
						} else {
						}
					}
					for (const error of propErrors) {
						allErrors.push(`Property "id": ${error}`);
					}
				}
			}
			return allErrors;
		},
		validateOrThrow: (request) => {
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				throw new Error('Value must be an object');
			}

			for (const prop of ['id']) {
				if (!(prop in request)) {
					throw new Error(`Missing required property: ${prop}`);
				}
			}

			if ('id' in request) {
				try {
					let numValue = request['id'];
					if (typeof request['id'] === 'string') {
						numValue = Number(request['id']);
						if (isNaN(numValue)) {
							throw new Error('Value must be a valid number');
						}
					} else if (typeof request['id'] !== 'number') {
						throw new Error('Value must be a number');
					}
				} catch (error) {
					throw new Error(`Property "id": ${error.message}`);
				}
			}
		},
		isValid: (request) => {
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				return 'Value must be an object';
			}

			for (const prop of ['id']) {
				if (!(prop in request)) {
					return `Missing required property: ${prop}`;
				}
			}

			if ('id' in request) {
				const propResult = (() => {
					let numValue = request['id'];
					if (typeof request['id'] === 'string') {
						numValue = Number(request['id']);
						if (isNaN(numValue)) {
							return 'Value must be a valid number';
						}
					} else if (typeof request['id'] !== 'number') {
						return 'Value must be a number';
					}

					return true;
				})();
				if (propResult !== true) {
					return `Property "id": ${propResult}`;
				}
			}
			return true;
		},
	},

	model: {
		method: 'POST',
		path: '/comment/delete',
		authenticated: true,
		request: {
			type: 'object',
			properties: { id: { type: 'number' } },
			required: ['id'],
		},
		response: {
			type: 'object',
			properties: { ok: { type: 'boolean' } },
			required: ['ok'],
		},
		throws: [403, 404],
		title: 'Delete comment',
		category: 'Comments',
	},
});
