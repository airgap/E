import { redeemInvite } from '../../models/api';
export const handleRedeemInvite = (handler) => ({
	execute: handler,
	validator: {
		validate: (request) => {
			const allErrors = [];
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				allErrors.push('Value must be an object');
			} else {
				for (const prop of ['token']) {
					if (!(prop in request)) {
						allErrors.push(`Missing required property: ${prop}`);
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

			for (const prop of ['token']) {
				if (!(prop in request)) {
					throw new Error(`Missing required property: ${prop}`);
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

			for (const prop of ['token']) {
				if (!(prop in request)) {
					return `Missing required property: ${prop}`;
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
		path: '/invite/redeem',
		authenticated: true,
		request: {
			type: 'object',
			properties: { token: { type: 'string' } },
			required: ['token'],
		},
		response: {
			type: 'object',
			properties: {
				projectId: { type: 'number' },
				role: { type: 'string' },
				name: { type: 'string' },
			},
			required: ['projectId', 'role', 'name'],
		},
		throws: [404],
		title: 'Redeem share link',
		category: 'Sharing',
	},
});
