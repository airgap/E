import { listInvites } from '../../models/api';
export const handleListInvites = (handler) => ({
	execute: handler,
	validator: {
		validate: (request) => {
			const allErrors = [];
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				allErrors.push('Value must be an object');
			} else {
				for (const prop of ['projectId']) {
					if (!(prop in request)) {
						allErrors.push(`Missing required property: ${prop}`);
					}
				}

				if ('projectId' in request) {
					const propErrors = [];
					{
						let allErrors = propErrors;

						let numValue = request['projectId'];
						if (typeof request['projectId'] === 'string') {
							numValue = Number(request['projectId']);
							if (isNaN(numValue)) {
								allErrors.push('Value must be a valid number');
							} else {
							}
						} else if (typeof request['projectId'] !== 'number') {
							allErrors.push('Value must be a number');
						} else {
						}
					}
					for (const error of propErrors) {
						allErrors.push(`Property "projectId": ${error}`);
					}
				}
			}
			return allErrors;
		},
		validateOrThrow: (request) => {
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				throw new Error('Value must be an object');
			}

			for (const prop of ['projectId']) {
				if (!(prop in request)) {
					throw new Error(`Missing required property: ${prop}`);
				}
			}

			if ('projectId' in request) {
				try {
					let numValue = request['projectId'];
					if (typeof request['projectId'] === 'string') {
						numValue = Number(request['projectId']);
						if (isNaN(numValue)) {
							throw new Error('Value must be a valid number');
						}
					} else if (typeof request['projectId'] !== 'number') {
						throw new Error('Value must be a number');
					}
				} catch (error) {
					throw new Error(`Property "projectId": ${error.message}`);
				}
			}
		},
		isValid: (request) => {
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				return 'Value must be an object';
			}

			for (const prop of ['projectId']) {
				if (!(prop in request)) {
					return `Missing required property: ${prop}`;
				}
			}

			if ('projectId' in request) {
				const propResult = (() => {
					let numValue = request['projectId'];
					if (typeof request['projectId'] === 'string') {
						numValue = Number(request['projectId']);
						if (isNaN(numValue)) {
							return 'Value must be a valid number';
						}
					} else if (typeof request['projectId'] !== 'number') {
						return 'Value must be a number';
					}

					return true;
				})();
				if (propResult !== true) {
					return `Property "projectId": ${propResult}`;
				}
			}
			return true;
		},
	},

	model: {
		method: 'POST',
		path: '/project/invites/list',
		authenticated: true,
		request: {
			type: 'object',
			properties: { projectId: { type: 'number' } },
			required: ['projectId'],
		},
		response: {
			type: 'object',
			properties: {
				invites: {
					type: 'array',
					items: {
						type: 'object',
						properties: { token: { type: 'string' }, role: { type: 'string' } },
						required: ['token', 'role'],
					},
				},
			},
			required: ['invites'],
		},
		throws: [403, 404],
		title: 'List share links',
		category: 'Sharing',
	},
});
