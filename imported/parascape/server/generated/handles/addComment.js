import { addComment } from '../../models/api';
export const handleAddComment = (handler) => ({
	execute: handler,
	validator: {
		validate: (request) => {
			const allErrors = [];
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				allErrors.push('Value must be an object');
			} else {
				for (const prop of ['projectId', 'pageId', 'x', 'y', 'body']) {
					if (!(prop in request)) {
						allErrors.push(`Missing required property: ${prop}`);
					}
				}

				if ('projectId' in request) {
					const propErrors = [];
					{
						let allErrors = propErrors;

						let numValue = request['projectId'];
						if (typeof request['projectId'] === 'string') {
							numValue = Number(request['projectId']);
							if (isNaN(numValue)) {
								allErrors.push('Value must be a valid number');
							} else {
							}
						} else if (typeof request['projectId'] !== 'number') {
							allErrors.push('Value must be a number');
						} else {
						}
					}
					for (const error of propErrors) {
						allErrors.push(`Property "projectId": ${error}`);
					}
				}

				if ('pageId' in request) {
					const propErrors = [];
					{
						let allErrors = propErrors;

						let numValue = request['pageId'];
						if (typeof request['pageId'] === 'string') {
							numValue = Number(request['pageId']);
							if (isNaN(numValue)) {
								allErrors.push('Value must be a valid number');
							} else {
							}
						} else if (typeof request['pageId'] !== 'number') {
							allErrors.push('Value must be a number');
						} else {
						}
					}
					for (const error of propErrors) {
						allErrors.push(`Property "pageId": ${error}`);
					}
				}

				if ('x' in request) {
					const propErrors = [];
					{
						let allErrors = propErrors;

						let numValue = request['x'];
						if (typeof request['x'] === 'string') {
							numValue = Number(request['x']);
							if (isNaN(numValue)) {
								allErrors.push('Value must be a valid number');
							} else {
							}
						} else if (typeof request['x'] !== 'number') {
							allErrors.push('Value must be a number');
						} else {
						}
					}
					for (const error of propErrors) {
						allErrors.push(`Property "x": ${error}`);
					}
				}

				if ('y' in request) {
					const propErrors = [];
					{
						let allErrors = propErrors;

						let numValue = request['y'];
						if (typeof request['y'] === 'string') {
							numValue = Number(request['y']);
							if (isNaN(numValue)) {
								allErrors.push('Value must be a valid number');
							} else {
							}
						} else if (typeof request['y'] !== 'number') {
							allErrors.push('Value must be a number');
						} else {
						}
					}
					for (const error of propErrors) {
						allErrors.push(`Property "y": ${error}`);
					}
				}

				if ('body' in request) {
					const propErrors = [];
					{
						let allErrors = propErrors;

						if (typeof request['body'] !== 'string') {
							allErrors.push('Value must be a string');
						} else {
						}
					}
					for (const error of propErrors) {
						allErrors.push(`Property "body": ${error}`);
					}
				}

				if ('nodeKey' in request) {
					const propErrors = [];
					{
						let allErrors = propErrors;

						let numValue = request['nodeKey'];
						if (typeof request['nodeKey'] === 'string') {
							numValue = Number(request['nodeKey']);
							if (isNaN(numValue)) {
								allErrors.push('Value must be a valid number');
							} else {
							}
						} else if (typeof request['nodeKey'] !== 'number') {
							allErrors.push('Value must be a number');
						} else {
						}
					}
					for (const error of propErrors) {
						allErrors.push(`Property "nodeKey": ${error}`);
					}
				}
			}
			return allErrors;
		},
		validateOrThrow: (request) => {
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				throw new Error('Value must be an object');
			}

			for (const prop of ['projectId', 'pageId', 'x', 'y', 'body']) {
				if (!(prop in request)) {
					throw new Error(`Missing required property: ${prop}`);
				}
			}

			if ('projectId' in request) {
				try {
					let numValue = request['projectId'];
					if (typeof request['projectId'] === 'string') {
						numValue = Number(request['projectId']);
						if (isNaN(numValue)) {
							throw new Error('Value must be a valid number');
						}
					} else if (typeof request['projectId'] !== 'number') {
						throw new Error('Value must be a number');
					}
				} catch (error) {
					throw new Error(`Property "projectId": ${error.message}`);
				}
			}

			if ('pageId' in request) {
				try {
					let numValue = request['pageId'];
					if (typeof request['pageId'] === 'string') {
						numValue = Number(request['pageId']);
						if (isNaN(numValue)) {
							throw new Error('Value must be a valid number');
						}
					} else if (typeof request['pageId'] !== 'number') {
						throw new Error('Value must be a number');
					}
				} catch (error) {
					throw new Error(`Property "pageId": ${error.message}`);
				}
			}

			if ('x' in request) {
				try {
					let numValue = request['x'];
					if (typeof request['x'] === 'string') {
						numValue = Number(request['x']);
						if (isNaN(numValue)) {
							throw new Error('Value must be a valid number');
						}
					} else if (typeof request['x'] !== 'number') {
						throw new Error('Value must be a number');
					}
				} catch (error) {
					throw new Error(`Property "x": ${error.message}`);
				}
			}

			if ('y' in request) {
				try {
					let numValue = request['y'];
					if (typeof request['y'] === 'string') {
						numValue = Number(request['y']);
						if (isNaN(numValue)) {
							throw new Error('Value must be a valid number');
						}
					} else if (typeof request['y'] !== 'number') {
						throw new Error('Value must be a number');
					}
				} catch (error) {
					throw new Error(`Property "y": ${error.message}`);
				}
			}

			if ('body' in request) {
				try {
					if (typeof request['body'] !== 'string') throw new Error('Value must be a string');
				} catch (error) {
					throw new Error(`Property "body": ${error.message}`);
				}
			}

			if ('nodeKey' in request) {
				try {
					let numValue = request['nodeKey'];
					if (typeof request['nodeKey'] === 'string') {
						numValue = Number(request['nodeKey']);
						if (isNaN(numValue)) {
							throw new Error('Value must be a valid number');
						}
					} else if (typeof request['nodeKey'] !== 'number') {
						throw new Error('Value must be a number');
					}
				} catch (error) {
					throw new Error(`Property "nodeKey": ${error.message}`);
				}
			}
		},
		isValid: (request) => {
			if (typeof request !== 'object' || request === null || Array.isArray(request)) {
				return 'Value must be an object';
			}

			for (const prop of ['projectId', 'pageId', 'x', 'y', 'body']) {
				if (!(prop in request)) {
					return `Missing required property: ${prop}`;
				}
			}

			if ('projectId' in request) {
				const propResult = (() => {
					let numValue = request['projectId'];
					if (typeof request['projectId'] === 'string') {
						numValue = Number(request['projectId']);
						if (isNaN(numValue)) {
							return 'Value must be a valid number';
						}
					} else if (typeof request['projectId'] !== 'number') {
						return 'Value must be a number';
					}

					return true;
				})();
				if (propResult !== true) {
					return `Property "projectId": ${propResult}`;
				}
			}

			if ('pageId' in request) {
				const propResult = (() => {
					let numValue = request['pageId'];
					if (typeof request['pageId'] === 'string') {
						numValue = Number(request['pageId']);
						if (isNaN(numValue)) {
							return 'Value must be a valid number';
						}
					} else if (typeof request['pageId'] !== 'number') {
						return 'Value must be a number';
					}

					return true;
				})();
				if (propResult !== true) {
					return `Property "pageId": ${propResult}`;
				}
			}

			if ('x' in request) {
				const propResult = (() => {
					let numValue = request['x'];
					if (typeof request['x'] === 'string') {
						numValue = Number(request['x']);
						if (isNaN(numValue)) {
							return 'Value must be a valid number';
						}
					} else if (typeof request['x'] !== 'number') {
						return 'Value must be a number';
					}

					return true;
				})();
				if (propResult !== true) {
					return `Property "x": ${propResult}`;
				}
			}

			if ('y' in request) {
				const propResult = (() => {
					let numValue = request['y'];
					if (typeof request['y'] === 'string') {
						numValue = Number(request['y']);
						if (isNaN(numValue)) {
							return 'Value must be a valid number';
						}
					} else if (typeof request['y'] !== 'number') {
						return 'Value must be a number';
					}

					return true;
				})();
				if (propResult !== true) {
					return `Property "y": ${propResult}`;
				}
			}

			if ('body' in request) {
				const propResult = (() => {
					if (typeof request['body'] !== 'string') return 'Value must be a string';

					return true;
				})();
				if (propResult !== true) {
					return `Property "body": ${propResult}`;
				}
			}

			if ('nodeKey' in request) {
				const propResult = (() => {
					let numValue = request['nodeKey'];
					if (typeof request['nodeKey'] === 'string') {
						numValue = Number(request['nodeKey']);
						if (isNaN(numValue)) {
							return 'Value must be a valid number';
						}
					} else if (typeof request['nodeKey'] !== 'number') {
						return 'Value must be a number';
					}

					return true;
				})();
				if (propResult !== true) {
					return `Property "nodeKey": ${propResult}`;
				}
			}
			return true;
		},
	},

	model: {
		method: 'POST',
		path: '/comments',
		authenticated: true,
		request: {
			type: 'object',
			properties: {
				projectId: { type: 'number' },
				pageId: { type: 'number' },
				x: { type: 'number' },
				y: { type: 'number' },
				body: { type: 'string' },
				nodeKey: { type: 'number' },
			},
			required: ['projectId', 'pageId', 'x', 'y', 'body'],
		},
		response: {
			type: 'object',
			properties: {
				id: { type: 'number' },
				page_id: { type: 'number' },
				node_key: { type: 'number' },
				x: { type: 'number' },
				y: { type: 'number' },
				author_id: { type: 'number' },
				author_name: { type: 'string' },
				body: { type: 'string' },
				resolved: { type: 'boolean' },
				created_at: { type: 'number' },
			},
			required: [
				'id',
				'page_id',
				'x',
				'y',
				'author_id',
				'author_name',
				'body',
				'resolved',
				'created_at',
			],
		},
		throws: [403, 404],
		title: 'Add comment',
		category: 'Comments',
	},
});
