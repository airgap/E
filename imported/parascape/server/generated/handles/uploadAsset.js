import { uploadAsset } from '../../models/api';
export const handleUploadAsset = (handler) => ({
	execute: handler,
	validator: {
		validate: (request) => {
			const allErrors = [];
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				allErrors.push('Value must be an object');
			} else {
				for (const prop of ['name', 'mime', 'data']) {
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

				if ('mime' in request) {
					const propErrors = [];
					{
						let allErrors = propErrors;

						if (typeof request['mime'] !== 'string') {
							allErrors.push('Value must be a string');
						} else {
						}
					}
					for (const error of propErrors) {
						allErrors.push(`Property "mime": ${error}`);
					}
				}

				if ('data' in request) {
					const propErrors = [];
					{
						let allErrors = propErrors;

						if (typeof request['data'] !== 'string') {
							allErrors.push('Value must be a string');
						} else {
						}
					}
					for (const error of propErrors) {
						allErrors.push(`Property "data": ${error}`);
					}
				}
			}
			return allErrors;
		},
		validateOrThrow: (request) => {
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				throw new Error('Value must be an object');
			}

			for (const prop of ['name', 'mime', 'data']) {
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

			if ('mime' in request) {
				try {
					if (typeof request['mime'] !== 'string') throw new Error('Value must be a string');
				} catch (error) {
					throw new Error(`Property "mime": ${error.message}`);
				}
			}

			if ('data' in request) {
				try {
					if (typeof request['data'] !== 'string') throw new Error('Value must be a string');
				} catch (error) {
					throw new Error(`Property "data": ${error.message}`);
				}
			}
		},
		isValid: (request) => {
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				return 'Value must be an object';
			}

			for (const prop of ['name', 'mime', 'data']) {
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

			if ('mime' in request) {
				const propResult = (() => {
					if (typeof request['mime'] !== 'string') return 'Value must be a string';

					return true;
				})();
				if (propResult !== true) {
					return `Property "mime": ${propResult}`;
				}
			}

			if ('data' in request) {
				const propResult = (() => {
					if (typeof request['data'] !== 'string') return 'Value must be a string';

					return true;
				})();
				if (propResult !== true) {
					return `Property "data": ${propResult}`;
				}
			}
			return true;
		},
	},

	model: {
		method: 'POST',
		path: '/assets',
		authenticated: true,
		request: {
			type: 'object',
			properties: {
				name: { type: 'string' },
				mime: { type: 'string' },
				data: { type: 'string', description: 'base64-encoded bytes' },
			},
			required: ['name', 'mime', 'data'],
		},
		response: {
			type: 'object',
			properties: {
				id: { type: 'number' },
				name: { type: 'string' },
				mime: { type: 'string' },
				size: { type: 'number' },
			},
			required: ['id', 'name', 'mime', 'size'],
		},
		throws: [400],
		title: 'Upload asset',
		category: 'Assets',
	},
});
