import { addCollaborator } from '../../models/api';
export const handleAddCollaborator = (handler) => ({
	execute: handler,
	validator: {
		validate: (request) => {
			const allErrors = [];
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				allErrors.push('Value must be an object');
			} else {
				for (const prop of ['projectId', 'username', 'role']) {
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

				if ('username' in request) {
					const propErrors = [];
					{
						let allErrors = propErrors;

						if (typeof request['username'] !== 'string') {
							allErrors.push('Value must be a string');
						} else {
						}
					}
					for (const error of propErrors) {
						allErrors.push(`Property "username": ${error}`);
					}
				}

				if ('role' in request) {
					const propErrors = [];
					{
						let allErrors = propErrors;

						if (typeof request['role'] !== 'string') {
							allErrors.push('Value must be a string');
						} else {
						}
					}
					for (const error of propErrors) {
						allErrors.push(`Property "role": ${error}`);
					}
				}
			}
			return allErrors;
		},
		validateOrThrow: (request) => {
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				throw new Error('Value must be an object');
			}

			for (const prop of ['projectId', 'username', 'role']) {
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

			if ('username' in request) {
				try {
					if (typeof request['username'] !== 'string') throw new Error('Value must be a string');
				} catch (error) {
					throw new Error(`Property "username": ${error.message}`);
				}
			}

			if ('role' in request) {
				try {
					if (typeof request['role'] !== 'string') throw new Error('Value must be a string');
				} catch (error) {
					throw new Error(`Property "role": ${error.message}`);
				}
			}
		},
		isValid: (request) => {
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				return 'Value must be an object';
			}

			for (const prop of ['projectId', 'username', 'role']) {
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

			if ('username' in request) {
				const propResult = (() => {
					if (typeof request['username'] !== 'string') return 'Value must be a string';

					return true;
				})();
				if (propResult !== true) {
					return `Property "username": ${propResult}`;
				}
			}

			if ('role' in request) {
				const propResult = (() => {
					if (typeof request['role'] !== 'string') return 'Value must be a string';

					return true;
				})();
				if (propResult !== true) {
					return `Property "role": ${propResult}`;
				}
			}
			return true;
		},
	},

	model: {
		method: 'POST',
		path: '/project/collaborators',
		authenticated: true,
		request: {
			type: 'object',
			properties: {
				projectId: { type: 'number' },
				username: { type: 'string' },
				role: { type: 'string' },
			},
			required: ['projectId', 'username', 'role'],
		},
		response: {
			type: 'object',
			properties: {
				user_id: { type: 'number' },
				username: { type: 'string' },
				role: { type: 'string' },
			},
			required: ['user_id', 'username', 'role'],
		},
		throws: [400, 403, 404],
		title: 'Add collaborator',
		category: 'Sharing',
	},
});
