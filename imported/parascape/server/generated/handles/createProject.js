import { createProject } from '../../models/api';
export const handleCreateProject = (handler) => ({
	execute: handler,
	validator: {
		validate: (request) => {
			const allErrors = [];
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				allErrors.push('Value must be an object');
			} else {
				for (const prop of ['name', 'doc']) {
					if (!(prop in request)) {
						allErrors.push(`Missing required property: ${prop}`);
					}
				}

				if ('name' in request) {
					const propErrors = [];
					{
						let allErrors = propErrors;

						if (typeof request['name'] !== 'string') {
							allErrors.push('Value must be a string');
						} else {
						}
					}
					for (const error of propErrors) {
						allErrors.push(`Property "name": ${error}`);
					}
				}

				if ('doc' in request) {
					const propErrors = [];
					{
						let allErrors = propErrors;

						if (
							typeof request['doc'] !== 'object' ||
							request['doc'] === null ||
							Array.isArray(request['doc'])
						) {
							allErrors.push('Value must be an object');
						} else {
							for (const prop of []) {
								if (!(prop in request['doc'])) {
									allErrors.push(`Missing required property: ${prop}`);
								}
							}
						}
					}
					for (const error of propErrors) {
						allErrors.push(`Property "doc": ${error}`);
					}
				}
			}
			return allErrors;
		},
		validateOrThrow: (request) => {
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				throw new Error('Value must be an object');
			}

			for (const prop of ['name', 'doc']) {
				if (!(prop in request)) {
					throw new Error(`Missing required property: ${prop}`);
				}
			}

			if ('name' in request) {
				try {
					if (typeof request['name'] !== 'string') throw new Error('Value must be a string');
				} catch (error) {
					throw new Error(`Property "name": ${error.message}`);
				}
			}

			if ('doc' in request) {
				try {
					if (
						typeof request['doc'] !== 'object' ||
						request['doc'] === null ||
						Array.isArray(request['doc'])
					) {
						throw new Error('Value must be an object');
					}

					for (const prop of []) {
						if (!(prop in request['doc'])) {
							throw new Error(`Missing required property: ${prop}`);
						}
					}
				} catch (error) {
					throw new Error(`Property "doc": ${error.message}`);
				}
			}
		},
		isValid: (request) => {
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				return 'Value must be an object';
			}

			for (const prop of ['name', 'doc']) {
				if (!(prop in request)) {
					return `Missing required property: ${prop}`;
				}
			}

			if ('name' in request) {
				const propResult = (() => {
					if (typeof request['name'] !== 'string') return 'Value must be a string';

					return true;
				})();
				if (propResult !== true) {
					return `Property "name": ${propResult}`;
				}
			}

			if ('doc' in request) {
				const propResult = (() => {
					if (
						typeof request['doc'] !== 'object' ||
						request['doc'] === null ||
						Array.isArray(request['doc'])
					) {
						return 'Value must be an object';
					}

					for (const prop of []) {
						if (!(prop in request['doc'])) {
							return `Missing required property: ${prop}`;
						}
					}

					return true;
				})();
				if (propResult !== true) {
					return `Property "doc": ${propResult}`;
				}
			}
			return true;
		},
	},

	model: {
		method: 'POST',
		path: '/projects',
		authenticated: true,
		request: {
			type: 'object',
			properties: { name: { type: 'string' }, doc: { type: 'object' } },
			required: ['name', 'doc'],
		},
		response: {
			type: 'object',
			properties: { id: { type: 'number' }, name: { type: 'string' } },
			required: ['id', 'name'],
		},
		title: 'Create project',
		category: 'Projects',
	},
});
