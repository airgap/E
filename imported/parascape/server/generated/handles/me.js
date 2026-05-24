import { me } from '../../models/api';
export const handleMe = (handler) => ({
	execute: handler,
	validator: {
		validate: () => [],
		validateOrThrow: () => {},
		isValid: () => true,
	},

	model: {
		method: 'GET',
		path: '/me',
		authenticated: true,
		response: {
			type: 'object',
			properties: {
				user: {
					type: 'object',
					properties: { id: { type: 'number' }, username: { type: 'string' } },
					required: ['id', 'username'],
				},
				guest: { type: 'boolean' },
			},
			required: ['user', 'guest'],
		},
		title: 'Current user',
		category: 'Auth',
	},
});
