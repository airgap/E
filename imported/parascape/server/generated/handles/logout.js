import { logout } from '../../models/api';
export const handleLogout = (handler) => ({
	execute: handler,
	validator: {
		validate: () => [],
		validateOrThrow: () => {},
		isValid: () => true,
	},

	model: {
		method: 'POST',
		path: '/logout',
		authenticated: true,
		response: {
			type: 'object',
			properties: { ok: { type: 'boolean' } },
			required: ['ok'],
		},
		title: 'Log out',
		category: 'Auth',
	},
});
