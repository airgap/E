import { resolveComment } from '../../models/api';
export const handleResolveComment = (handler) => ({
	execute: handler,
	validator: {
		validate: (request) => {
			const allErrors = [];
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				allErrors.push('Value must be an object');
			} else {
				for (const prop of ['id', 'resolved']) {
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

				if ('resolved' in request) {
					const propErrors = [];
					{
						let allErrors = propErrors;

						if (typeof request['resolved'] !== 'boolean') {
							allErrors.push('Expected boolean, got ' + typeof request['resolved']);
						}
					}
					for (const error of propErrors) {
						allErrors.push(`Property "resolved": ${error}`);
					}
				}
			}
			return allErrors;
		},
		validateOrThrow: (request) => {
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				throw new Error('Value must be an object');
			}

			for (const prop of ['id', 'resolved']) {
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

			if ('resolved' in request) {
				try {
					if (typeof request['resolved'] !== 'boolean')
						throw new Error('Expected boolean, got ' + typeof request['resolved']);
					return request['resolved'];
				} catch (error) {
					throw new Error(`Property "resolved": ${error.message}`);
				}
			}
		},
		isValid: (request) => {
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				return 'Value must be an object';
			}

			for (const prop of ['id', 'resolved']) {
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

			if ('resolved' in request) {
				const propResult = (() => {
					if (typeof request['resolved'] !== 'boolean')
						return 'Expected boolean, got ' + typeof request['resolved'];

					return true;
				})();
				if (propResult !== true) {
					return `Property "resolved": ${propResult}`;
				}
			}
			return true;
		},
	},

	model: {
		method: 'POST',
		path: '/comment/resolve',
		authenticated: true,
		request: {
			type: 'object',
			properties: { id: { type: 'number' }, resolved: { type: 'boolean' } },
			required: ['id', 'resolved'],
		},
		response: {
			type: 'object',
			properties: { ok: { type: 'boolean' } },
			required: ['ok'],
		},
		throws: [403, 404],
		title: 'Resolve comment',
		category: 'Comments',
	},
});
