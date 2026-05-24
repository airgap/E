import { listAssets } from '../../models/api';
export const handleListAssets = (handler) => ({
	execute: handler,
	validator: {
		validate: () => [],
		validateOrThrow: () => {},
		isValid: () => true,
	},

	model: {
		method: 'GET',
		path: '/assets',
		authenticated: true,
		response: {
			type: 'object',
			properties: {
				assets: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							id: { type: 'number' },
							name: { type: 'string' },
							mime: { type: 'string' },
							size: { type: 'number' },
							created_at: { type: 'number' },
						},
						required: ['id', 'name', 'mime', 'size', 'created_at'],
					},
				},
			},
			required: ['assets'],
		},
		title: 'List assets',
		category: 'Assets',
	},
});
