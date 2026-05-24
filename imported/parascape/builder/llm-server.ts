// Parascape AI builder backend — a tiny ParaBun server that runs a local
// GGUF model via `parabun:llm` and turns a natural-language prompt into a
// Parascape `.pui` component. The browser builder POSTs a prompt here and
// feeds the returned source straight into the same compile -> render path as
// hand-authored custom components.
//
// Run it with ParaBun (NOT node/bun — needs the parabun:llm builtin):
//
//   parabun builder/llm-server.ts
//   PARASCAPE_MODEL=/rigil/parabun-fixtures/llm/Llama-3.2-1B-Instruct-Q8_0.gguf \
//     PORT=8787 parabun builder/llm-server.ts
//
// Then the builder's "Generate with AI" box (which defaults to
// http://localhost:8787) will reach it. This is a dev tool: CORS is wide
// open and there is no auth.

import { LLM } from 'parabun:llm';
import manifests from '../components/manifests.json';
import { catalog } from '../components/catalog';

type Manifest = { id: string; name: string; props: { name: string; type: string; kind: string }[] };
const M = manifests as Record<string, Manifest>;

const MODEL =
	process.env.PARASCAPE_MODEL ?? '/rigil/parabun-fixtures/llm/Llama-3.2-1B-Instruct-Q4_K_M.gguf';
const PORT = Number(process.env.PORT ?? 8787);

// A compact component reference for the system prompt: display name + the
// kebab id used in the import path, one per line. Per-prop detail would bloat
// the prefill (every request re-encodes the whole system prompt) for little
// gain on a small model — the import path plus a worked example carry most of
// it, and it keeps us within the model's working context.
function componentReference(): string {
	const lines: string[] = [];
	for (const group of catalog) {
		for (const item of group.items) {
			const m = M[item.id];
			lines.push(`- ${m?.name ?? item.name} → "@parascape-design/components/${item.id}"`);
		}
	}
	return lines.join('\n');
}

const SYSTEM = `You generate a single Parascape UI component as .pui source code.

.pui is Svelte 5 with a Para flavour. Output rules — follow them exactly:
- Output ONLY the component source. No prose, no explanation, no markdown code fences.
- Start with a <script lang="pts"> block that imports every component you use.
- Import components as the default export: import Name from "@parascape-design/components/kebab-id".
- After the script block, write the markup. Put readable text inside elements as children.
- Use only the components listed below. Do not invent components or props.

Available components:
${componentReference()}

Example of a valid response:
<script lang="pts">
	import Container from "@parascape-design/components/container";
	import Header from "@parascape-design/components/header";
	import SpaceBetween from "@parascape-design/components/space-between";
	import Button from "@parascape-design/components/button";
</script>

<Container>
	<Header variant="h2">Welcome</Header>
	<SpaceBetween size="s">
		<Button variant="primary">Get started</Button>
	</SpaceBetween>
</Container>`;

// Pull the .pui out of whatever the model returned: drop markdown fences and
// any leading chatter before the first <script> or tag.
function extractPui(raw: string): string {
	let s = raw.trim();
	const fence = s.match(/```(?:svelte|html|pui|pts|ts)?\s*([\s\S]*?)```/i);
	if (fence) s = fence[1].trim();
	const start = s.search(/<script\b|<[A-Z]/);
	if (start > 0) s = s.slice(start);
	return s.trim();
}

console.log(`[parascape-llm] loading ${MODEL} …`);
const t0 = performance.now();
const llm = await LLM.load(MODEL, { maxContext: 4096 });
console.log(`[parascape-llm] model ready in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
};

const server = Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);
		if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
		if (url.pathname === '/' || url.pathname === '/health') {
			return Response.json({ ok: true, model: MODEL }, { headers: CORS });
		}
		if (url.pathname === '/generate' && req.method === 'POST') {
			let prompt = '';
			try {
				({ prompt } = (await req.json()) as { prompt?: string });
			} catch {
				return Response.json({ error: 'invalid JSON body' }, { status: 400, headers: CORS });
			}
			if (!prompt?.trim()) {
				return Response.json({ error: 'empty prompt' }, { status: 400, headers: CORS });
			}
			const t = performance.now();
			const raw = await llm.chatComplete(
				[
					{ role: 'system', content: SYSTEM },
					{ role: 'user', content: prompt.trim() },
				],
				{ maxTokens: 320, temperature: 0.2 },
			);
			const source = extractPui(raw);
			console.log(
				`[parascape-llm] "${prompt.slice(0, 50)}" -> ${source.length} chars in ${((performance.now() - t) / 1000).toFixed(1)}s`,
			);
			return Response.json({ source }, { headers: CORS });
		}
		return new Response('not found', { status: 404, headers: CORS });
	},
});

console.log(
	`[parascape-llm] listening on http://localhost:${server.port}  (POST /generate { "prompt": "..." })`,
);
