import { deleteInvite } from '../../models/api';
export const handleDeleteInvite = (handler) => ({
	execute: handler,
	validator: {
		validate: (request) => {
			const allErrors = [];
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				allErrors.push('Value must be an object');
			} else {
				for (const prop of ['projectId', 'token']) {
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

				if ('token' in request) {
					const propErrors = [];
					{
						let allErrors = propErrors;

						if (typeof request['token'] !== 'string') {
							allErrors.push('Value must be a string');
						} else {
						}
					}
					for (const error of propErrors) {
						allErrors.push(`Property "token": ${error}`);
					}
				}
			}
			return allErrors;
		},
		validateOrThrow: (request) => {
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				throw new Error('Value must be an object');
			}

			for (const prop of ['projectId', 'token']) {
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

			if ('token' in request) {
				try {
					if (typeof request['token'] !== 'string') throw new Error('Value must be a string');
				} catch (error) {
					throw new Error(`Property "token": ${error.message}`);
				}
			}
		},
		isValid: (request) => {
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				return 'Value must be an object';
			}

			for (const prop of ['projectId', 'token']) {
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

			if ('token' in request) {
				const propResult = (() => {
					if (typeof request['token'] !== 'string') return 'Value must be a string';

					return true;
				})();
				if (propResult !== true) {
					return `Property "token": ${propResult}`;
				}
			}
			return true;
		},
	},

	model: {
		method: 'POST',
		path: '/project/invites/delete',
		authenticated: true,
		request: {
			type: 'object',
			properties: { projectId: { type: 'number' }, token: { type: 'string' } },
			required: ['projectId', 'token'],
		},
		response: {
			type: 'object',
			properties: { ok: { type: 'boolean' } },
			required: ['ok'],
		},
		throws: [403],
		title: 'Revoke share link',
		category: 'Sharing',
	},
});
