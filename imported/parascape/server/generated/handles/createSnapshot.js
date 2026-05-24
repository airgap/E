import { createSnapshot } from '../../models/api';
export const handleCreateSnapshot = (handler) => ({
	execute: handler,
	validator: {
		validate: (request) => {
			const allErrors = [];
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				allErrors.push('Value must be an object');
			} else {
				for (const prop of ['label', 'doc']) {
					if (!(prop in request)) {
						allErrors.push(`Missing required property: ${prop}`);
					}
				}

				if ('label' in request) {
					const propErrors = [];
					{
						let allErrors = propErrors;

						if (typeof request['label'] !== 'string') {
							allErrors.push('Value must be a string');
						} else {
						}
					}
					for (const error of propErrors) {
						allErrors.push(`Property "label": ${error}`);
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

			for (const prop of ['label', 'doc']) {
				if (!(prop in request)) {
					throw new Error(`Missing required property: ${prop}`);
				}
			}

			if ('label' in request) {
				try {
					if (typeof request['label'] !== 'string') throw new Error('Value must be a string');
				} catch (error) {
					throw new Error(`Property "label": ${error.message}`);
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

			for (const prop of ['label', 'doc']) {
				if (!(prop in request)) {
					return `Missing required property: ${prop}`;
				}
			}

			if ('label' in request) {
				const propResult = (() => {
					if (typeof request['label'] !== 'string') return 'Value must be a string';

					return true;
				})();
				if (propResult !== true) {
					return `Property "label": ${propResult}`;
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
		path: '/snapshots',
		authenticated: true,
		request: {
			type: 'object',
			properties: { label: { type: 'string' }, doc: { type: 'object' } },
			required: ['label', 'doc'],
		},
		response: {
			type: 'object',
			properties: {
				id: { type: 'number' },
				label: { type: 'string' },
				created_at: { type: 'number' },
			},
			required: ['id', 'label', 'created_at'],
		},
		title: 'Create snapshot',
		category: 'History',
	},
});
