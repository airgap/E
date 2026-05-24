import { publish } from '../../models/api';
export const handlePublish = (handler) => ({
	execute: handler,
	validator: {
		validate: (request) => {
			const allErrors = [];
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				allErrors.push('Value must be an object');
			} else {
				for (const prop of ['slug', 'doc']) {
					if (!(prop in request)) {
						allErrors.push(`Missing required property: ${prop}`);
					}
				}

				if ('slug' in request) {
					const propErrors = [];
					{
						let allErrors = propErrors;

						if (typeof request['slug'] !== 'string') {
							allErrors.push('Value must be a string');
						} else {
						}
					}
					for (const error of propErrors) {
						allErrors.push(`Property "slug": ${error}`);
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

			for (const prop of ['slug', 'doc']) {
				if (!(prop in request)) {
					throw new Error(`Missing required property: ${prop}`);
				}
			}

			if ('slug' in request) {
				try {
					if (typeof request['slug'] !== 'string') throw new Error('Value must be a string');
				} catch (error) {
					throw new Error(`Property "slug": ${error.message}`);
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

			for (const prop of ['slug', 'doc']) {
				if (!(prop in request)) {
					return `Missing required property: ${prop}`;
				}
			}

			if ('slug' in request) {
				const propResult = (() => {
					if (typeof request['slug'] !== 'string') return 'Value must be a string';

					return true;
				})();
				if (propResult !== true) {
					return `Property "slug": ${propResult}`;
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
		path: '/publish',
		authenticated: true,
		request: {
			type: 'object',
			properties: { slug: { type: 'string' }, doc: { type: 'object' } },
			required: ['slug', 'doc'],
		},
		response: {
			type: 'object',
			properties: { slug: { type: 'string' }, url: { type: 'string' } },
			required: ['slug', 'url'],
		},
		throws: [400, 409],
		title: 'Publish page',
		category: 'Publish',
	},
});
