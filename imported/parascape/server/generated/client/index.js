import { pack, unpack } from 'msgpackr';

const routes = {
	addCollaborator: {
		method: 'POST',
		path: '/project/collaborators',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	addComment: {
		method: 'POST',
		path: '/comments',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	createInvite: {
		method: 'POST',
		path: '/project/invites',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	createProject: {
		method: 'POST',
		path: '/projects',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	createSnapshot: {
		method: 'POST',
		path: '/snapshots',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	deleteAsset: {
		method: 'POST',
		path: '/asset/delete',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	deleteComment: {
		method: 'POST',
		path: '/comment/delete',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	deleteInvite: {
		method: 'POST',
		path: '/project/invites/delete',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	deleteProject: {
		method: 'POST',
		path: '/project/delete',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	deleteSnapshot: {
		method: 'POST',
		path: '/snapshot/delete',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	duplicateProject: {
		method: 'POST',
		path: '/project/duplicate',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	getProject: {
		method: 'POST',
		path: '/project/get',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	getSnapshot: {
		method: 'POST',
		path: '/snapshot/get',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	health: {
		method: 'GET',
		path: '/health',
		stream: false,
		hasRequest: false,
		hasResponse: true,
		stringResponse: false,
	},
	listAssets: {
		method: 'GET',
		path: '/assets',
		stream: false,
		hasRequest: false,
		hasResponse: true,
		stringResponse: false,
	},
	listCollaborators: {
		method: 'POST',
		path: '/project/collaborators/list',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	listComments: {
		method: 'POST',
		path: '/comments/list',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	listInvites: {
		method: 'POST',
		path: '/project/invites/list',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	listProjects: {
		method: 'GET',
		path: '/projects',
		stream: false,
		hasRequest: false,
		hasResponse: true,
		stringResponse: false,
	},
	listSnapshots: {
		method: 'GET',
		path: '/snapshots',
		stream: false,
		hasRequest: false,
		hasResponse: true,
		stringResponse: false,
	},
	login: {
		method: 'POST',
		path: '/login',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	logout: {
		method: 'POST',
		path: '/logout',
		stream: false,
		hasRequest: false,
		hasResponse: true,
		stringResponse: false,
	},
	me: {
		method: 'GET',
		path: '/me',
		stream: false,
		hasRequest: false,
		hasResponse: true,
		stringResponse: false,
	},
	publish: {
		method: 'POST',
		path: '/publish',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	redeemInvite: {
		method: 'POST',
		path: '/invite/redeem',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	register: {
		method: 'POST',
		path: '/register',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	removeCollaborator: {
		method: 'POST',
		path: '/project/collaborators/remove',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	resolveComment: {
		method: 'POST',
		path: '/comment/resolve',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	updateProject: {
		method: 'POST',
		path: '/project/update',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
	uploadAsset: {
		method: 'POST',
		path: '/assets',
		stream: false,
		hasRequest: true,
		hasResponse: true,
		stringResponse: false,
	},
};

export function createClient(config) {
	const { baseUrl, getHeaders, getSessionId } = config;

	function wsUrl() {
		return baseUrl.replace(/^https?:/, 'wss:');
	}

	async function httpCall(routeName, route, request) {
		const url = baseUrl + route.path;
		const headers = {
			'Content-Type': 'application/x-msgpack',
			Accept: 'application/x-msgpack',
			...getHeaders?.(),
		};
		const sessionId = getSessionId?.();
		if (sessionId) headers['Authorization'] = 'Bearer ' + sessionId;

		const data = request;
		if (typeof data === 'object' && data !== null) {
			for (const key in data) {
				if (data[key] === undefined) delete data[key];
			}
		}

		const fetchOpts = {
			method: route.method || 'POST',
			headers,
			...(typeof window !== 'undefined' ? { credentials: 'include' } : {}),
		};
		if (route.hasRequest && data !== undefined) {
			fetchOpts.body = new Uint8Array(pack(data));
		}

		const res = await fetch(url, fetchOpts);
		if (!res.ok) {
			let errorMessage = res.statusText || 'Unknown error';
			try {
				const text = await res.text();
				if (text) errorMessage = text;
			} catch {}
			const err = new Error(routeName + ': ' + res.status + ' ' + errorMessage);
			err.status = res.status;
			throw err;
		}

		if (!route.hasResponse) return undefined;
		if (route.stringResponse) return res.text();
		const buf = await res.arrayBuffer();
		if (buf.byteLength === 0) return undefined;
		return unpack(new Uint8Array(buf));
	}

	function streamCall(routeName, route, request) {
		const url = wsUrl() + route.path;
		const ws = new WebSocket(url);
		const listeners = [];
		let authenticated = false;

		ws.binaryType = 'arraybuffer';

		ws.onopen = () => {
			const sessionId = getSessionId?.();
			if (sessionId) {
				ws.send(new Uint8Array(pack({ auth: sessionId })));
			}
		};

		ws.onmessage = (ev) => {
			let data;
			try {
				if (ev.data instanceof ArrayBuffer) {
					data = unpack(new Uint8Array(ev.data));
				}
			} catch (e) {
				console.error('[stream] Failed to decode:', e);
				return;
			}
			if (data?.authenticated === true) {
				authenticated = true;
				if (request !== undefined) {
					ws.send(new Uint8Array(pack(request)));
				}
				return;
			}
			if (data?.auth) return;
			for (const listener of listeners) listener(data);
		};

		return {
			listen(fn) {
				listeners.push(fn);
				return () => {
					const i = listeners.indexOf(fn);
					if (i >= 0) listeners.splice(i, 1);
				};
			},
			send(data) {
				ws.send(new Uint8Array(pack(data)));
			},
			close() {
				ws.close();
			},
			get readyState() {
				return ws.readyState;
			},
		};
	}

	const client = {};
	for (const [key, route] of Object.entries(routes)) {
		if (route.stream) {
			client[key] = (request) => streamCall(key, route, request);
		} else {
			client[key] = (request) => httpCall(key, route, request);
		}
	}
	return client;
}
