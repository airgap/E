import { listProjects } from '../../models/api';
export const handleListProjects = (handler) => ({
	execute: handler,
	validator: {
		validate: () => [],
		validateOrThrow: () => {},
		isValid: () => true,
	},

	model: {
		method: 'GET',
		path: '/projects',
		authenticated: true,
		response: {
			type: 'object',
			properties: {
				projects: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							id: { type: 'number' },
							name: { type: 'string' },
							updated_at: { type: 'number' },
							owner: { type: 'boolean' },
							role: { type: 'string' },
						},
						required: ['id', 'name', 'updated_at', 'owner', 'role'],
					},
				},
			},
			required: ['projects'],
		},
		title: 'List projects',
		category: 'Projects',
	},
});
