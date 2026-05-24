import type { ApiTypes } from '../api-types';

export interface ClientConfig {
	/** HTTP base URL (e.g. 'https://api.example.com') */
	baseUrl: string;
	/** Optional extra headers to include with every request */
	getHeaders?: () => Record<string, string>;
	/** Return the current session/auth token, or undefined if not authenticated */
	getSessionId?: () => string | undefined;
}

export interface StreamSocket<T> {
	/** Subscribe to incoming events. Returns an unsubscribe function. */
	listen(fn: (data: T) => void): () => void;
	/** Send data to the server over the WebSocket */
	send(data: unknown): void;
	/** Close the WebSocket connection */
	close(): void;
	/** Current WebSocket readyState */
	readonly readyState: number;
}

type RouteResult<K extends keyof ApiTypes> = ApiTypes[K] extends { stream: any }
	? StreamSocket<ApiTypes[K] extends { response: infer R } ? R : never>
	: Promise<ApiTypes[K] extends { response: infer R } ? R : void>;

type RouteRequest<K extends keyof ApiTypes> = ApiTypes[K] extends {
	request: infer R;
}
	? R
	: void;

export type ApiClient = {
	[K in keyof ApiTypes]: RouteRequest<K> extends void
		? () => RouteResult<K>
		: (request: RouteRequest<K>) => RouteResult<K>;
};

export declare function createClient(config: ClientConfig): ApiClient;
