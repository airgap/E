import { removeCollaborator } from '../../models/api';
export const handleRemoveCollaborator = (handler) => ({
	execute: handler,
	validator: {
		validate: (request) => {
			const allErrors = [];
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				allErrors.push('Value must be an object');
			} else {
				for (const prop of ['projectId', 'userId']) {
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

				if ('userId' in request) {
					const propErrors = [];
					{
						let allErrors = propErrors;

						let numValue = request['userId'];
						if (typeof request['userId'] === 'string') {
							numValue = Number(request['userId']);
							if (isNaN(numValue)) {
								allErrors.push('Value must be a valid number');
							} else {
							}
						} else if (typeof request['userId'] !== 'number') {
							allErrors.push('Value must be a number');
						} else {
						}
					}
					for (const error of propErrors) {
						allErrors.push(`Property "userId": ${error}`);
					}
				}
			}
			return allErrors;
		},
		validateOrThrow: (request) => {
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				throw new Error('Value must be an object');
			}

			for (const prop of ['projectId', 'userId']) {
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

			if ('userId' in request) {
				try {
					let numValue = request['userId'];
					if (typeof request['userId'] === 'string') {
						numValue = Number(request['userId']);
						if (isNaN(numValue)) {
							throw new Error('Value must be a valid number');
						}
					} else if (typeof request['userId'] !== 'number') {
						throw new Error('Value must be a number');
					}
				} catch (error) {
					throw new Error(`Property "userId": ${error.message}`);
				}
			}
		},
		isValid: (request) => {
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				return 'Value must be an object';
			}

			for (const prop of ['projectId', 'userId']) {
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

			if ('userId' in request) {
				const propResult = (() => {
					let numValue = request['userId'];
					if (typeof request['userId'] === 'string') {
						numValue = Number(request['userId']);
						if (isNaN(numValue)) {
							return 'Value must be a valid number';
						}
					} else if (typeof request['userId'] !== 'number') {
						return 'Value must be a number';
					}

					return true;
				})();
				if (propResult !== true) {
					return `Property "userId": ${propResult}`;
				}
			}
			return true;
		},
	},

	model: {
		method: 'POST',
		path: '/project/collaborators/remove',
		authenticated: true,
		request: {
			type: 'object',
			properties: { projectId: { type: 'number' }, userId: { type: 'number' } },
			required: ['projectId', 'userId'],
		},
		response: {
			type: 'object',
			properties: { ok: { type: 'boolean' } },
			required: ['ok'],
		},
		throws: [403, 404],
		title: 'Remove collaborator',
		category: 'Sharing',
	},
});
