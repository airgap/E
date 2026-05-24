import { listSnapshots } from '../../models/api';
export const handleListSnapshots = (handler) => ({
	execute: handler,
	validator: {
		validate: () => [],
		validateOrThrow: () => {},
		isValid: () => true,
	},

	model: {
		method: 'GET',
		path: '/snapshots',
		authenticated: true,
		response: {
			type: 'object',
			properties: {
				snapshots: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							id: { type: 'number' },
							label: { type: 'string' },
							created_at: { type: 'number' },
						},
						required: ['id', 'label', 'created_at'],
					},
				},
			},
			required: ['snapshots'],
		},
		title: 'List snapshots',
		category: 'History',
	},
});
