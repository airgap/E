// LYK-964: the `.pui` language engine running off the main thread. The Code rail
// talks to it over postMessage (a tiny LSP-like request/response with ids).
import { diagnostics, hoverAt, type Diagnostic, type HoverCard } from './pui-lsp';

type Req =
	| { id: number; type: 'diagnostics'; content: string; components: string[] }
	| { id: number; type: 'hover'; content: string; line: number; character: number };
type Res =
	| { id: number; type: 'diagnostics'; result: Diagnostic[] }
	| { id: number; type: 'hover'; result: HoverCard | null };

self.onmessage = (e: MessageEvent<Req>) => {
	const msg = e.data;
	try {
		if (msg.type === 'diagnostics') {
			const result = diagnostics(msg.content, msg.components);
			(self as unknown as Worker).postMessage({
				id: msg.id,
				type: 'diagnostics',
				result,
			} satisfies Res);
		} else if (msg.type === 'hover') {
			const result = hoverAt(msg.content, msg.line, msg.character);
			(self as unknown as Worker).postMessage({ id: msg.id, type: 'hover', result } satisfies Res);
		}
	} catch {
		// a malformed in-progress edit shouldn't take the worker down — reply empty
		const empty = msg.type === 'diagnostics' ? [] : null;
		(self as unknown as Worker).postMessage({ id: msg.id, type: msg.type, result: empty });
	}
};
