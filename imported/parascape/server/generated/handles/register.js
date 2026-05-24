import { register } from '../../models/api';
export const handleRegister = (handler) => ({
	execute: handler,
	validator: {
		validate: (request) => {
			const allErrors = [];
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				allErrors.push('Value must be an object');
			} else {
				for (const prop of ['username', 'password']) {
					if (!(prop in request)) {
						allErrors.push(`Missing required property: ${prop}`);
					}
				}

				if ('username' in request) {
					const propErrors = [];
					{
						let allErrors = propErrors;

						if (typeof request['username'] !== 'string') {
							allErrors.push('Value must be a string');
						} else {
							if (request['username'].length < 3)
								allErrors.push('String must be at least 3 characters long');
						}
					}
					for (const error of propErrors) {
						allErrors.push(`Property "username": ${error}`);
					}
				}

				if ('password' in request) {
					const propErrors = [];
					{
						let allErrors = propErrors;

						if (typeof request['password'] !== 'string') {
							allErrors.push('Value must be a string');
						} else {
							if (request['password'].length < 6)
								allErrors.push('String must be at least 6 characters long');
						}
					}
					for (const error of propErrors) {
						allErrors.push(`Property "password": ${error}`);
					}
				}
			}
			return allErrors;
		},
		validateOrThrow: (request) => {
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				throw new Error('Value must be an object');
			}

			for (const prop of ['username', 'password']) {
				if (!(prop in request)) {
					throw new Error(`Missing required property: ${prop}`);
				}
			}

			if ('username' in request) {
				try {
					if (typeof request['username'] !== 'string') throw new Error('Value must be a string');
					else if (request['username'].length < 3)
						throw new Error('String must be at least 3 characters long');
				} catch (error) {
					throw new Error(`Property "username": ${error.message}`);
				}
			}

			if ('password' in request) {
				try {
					if (typeof request['password'] !== 'string') throw new Error('Value must be a string');
					else if (request['password'].length < 6)
						throw new Error('String must be at least 6 characters long');
				} catch (error) {
					throw new Error(`Property "password": ${error.message}`);
				}
			}
		},
		isValid: (request) => {
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				return 'Value must be an object';
			}

			for (const prop of ['username', 'password']) {
				if (!(prop in request)) {
					return `Missing required property: ${prop}`;
				}
			}

			if ('username' in request) {
				const propResult = (() => {
					if (typeof request['username'] !== 'string') return 'Value must be a string';
					else if (request['username'].length < 3)
						return 'String must be at least 3 characters long';

					return true;
				})();
				if (propResult !== true) {
					return `Property "username": ${propResult}`;
				}
			}

			if ('password' in request) {
				const propResult = (() => {
					if (typeof request['password'] !== 'string') return 'Value must be a string';
					else if (request['password'].length < 6)
						return 'String must be at least 6 characters long';

					return true;
				})();
				if (propResult !== true) {
					return `Property "password": ${propResult}`;
				}
			}
			return true;
		},
	},

	model: {
		method: 'POST',
		path: '/register',
		authenticated: false,
		request: {
			type: 'object',
			properties: {
				username: { type: 'string', minLength: 3 },
				password: { type: 'string', minLength: 6 },
			},
			required: ['username', 'password'],
		},
		response: {
			type: 'object',
			properties: {
				token: { type: 'string' },
				user: {
					type: 'object',
					properties: { id: { type: 'number' }, username: { type: 'string' } },
					required: ['id', 'username'],
				},
			},
			required: ['token', 'user'],
		},
		throws: [400, 409],
		title: 'Register',
		category: 'Auth',
	},
});
