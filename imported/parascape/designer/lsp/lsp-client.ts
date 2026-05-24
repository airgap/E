// LYK-964: thin client the Code rail uses to reach the `.pui` LSP worker. Each
// call gets an id and resolves when the matching reply arrives. Falls back to
// running the engine inline (same module) if Workers are unavailable, so the
// feature degrades gracefully (and stays testable) rather than going dark.
import {
	diagnostics as inlineDiagnostics,
	hoverAt as inlineHover,
	type Diagnostic,
	type HoverCard,
} from './pui-lsp';

export type { Diagnostic, HoverCard } from './pui-lsp';

export class PuiLsp {
	#worker: Worker | null = null;
	#seq = 0;
	#pending = new Map<number, (v: unknown) => void>();

	constructor() {
		try {
			this.#worker = new Worker(new URL('./lsp-worker.ts', import.meta.url), { type: 'module' });
			this.#worker.onmessage = (e: MessageEvent<{ id: number; result: unknown }>) => {
				const r = this.#pending.get(e.data.id);
				if (r) {
					this.#pending.delete(e.data.id);
					r(e.data.result);
				}
			};
			this.#worker.onerror = () => this.#fallback();
		} catch {
			this.#fallback();
		}
	}

	#fallback() {
		if (this.#worker) {
			this.#worker.terminate();
			this.#worker = null;
		}
		// reject nothing — pending calls will be re-driven inline by callers on next edit
	}

	#call<T>(payload: Record<string, unknown>): Promise<T> {
		if (!this.#worker) return Promise.reject(new Error('no worker'));
		const id = ++this.#seq;
		return new Promise<T>((resolve) => {
			this.#pending.set(id, resolve as (v: unknown) => void);
			this.#worker!.postMessage({ id, ...payload });
		});
	}

	async diagnostics(content: string, components: string[]): Promise<Diagnostic[]> {
		try {
			return await this.#call<Diagnostic[]>({ type: 'diagnostics', content, components });
		} catch {
			return inlineDiagnostics(content, components);
		}
	}

	async hover(content: string, line: number, character: number): Promise<HoverCard | null> {
		try {
			return await this.#call<HoverCard | null>({ type: 'hover', content, line, character });
		} catch {
			return inlineHover(content, line, character);
		}
	}

	dispose() {
		this.#worker?.terminate();
		this.#worker = null;
		this.#pending.clear();
	}
}
