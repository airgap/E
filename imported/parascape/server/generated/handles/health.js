import { health } from '../../models/api';
export const handleHealth = (handler) => ({
	execute: handler,
	validator: {
		validate: () => [],
		validateOrThrow: () => {},
		isValid: () => true,
	},

	model: {
		method: 'GET',
		path: '/health',
		authenticated: false,
		response: {
			type: 'object',
			properties: { ok: { type: 'boolean' }, guest: { type: 'boolean' } },
			required: ['ok', 'guest'],
		},
		title: 'Health check',
		category: 'Auth',
	},
});
