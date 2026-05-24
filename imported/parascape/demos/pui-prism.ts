// Prism grammar for `.pui` (Para UI).
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';

const PARA_KEYWORDS = [
	'signal',
	'derived',
	'effect',
	'prop',
	'pure',
	'source',
	'mount',
	'using',
	'provide',
	'inject',
];
const PARA_KEYWORD_RE = new RegExp(`\\b(?:${PARA_KEYWORDS.join('|')})\\b`);
const SVELTE_BLOCK_NAMES = ['each', 'if', 'else', 'await', 'then', 'catch', 'key', 'snippet'];
const SVELTE_TAG_NAMES = ['render', 'const', 'html', 'debug'];

export function registerPuiLanguage(): void {
	if (Prism.languages.pui) return;
	// Prism's `insertBefore(name, …)` walks `Prism.languages[name]`, so
	// the grammar HAS to be registered under its final name BEFORE the
	// inserts run. Otherwise the inserts target a detached object that
	// never makes it into the lookup table.
	Prism.languages.pui = Prism.languages.extend('tsx', {});
	const pui = Prism.languages.pui;

	Prism.languages.insertBefore('pui', 'keyword', {
		'para-keyword': { pattern: PARA_KEYWORD_RE, alias: 'keyword' },
	});

	// Order matters: opener has to match BEFORE the trailing `}` and
	// before any JS in `rest`, otherwise the `{` gets eaten as
	// punctuation and the name appears as plain text. Each entry is its
	// own atomic token; what's left between them is passed through
	// `rest: pui` for ordinary JS highlighting.
	const directiveInside: Prism.Grammar = {
		'directive-open': {
			pattern: new RegExp(
				`\\{[#:/]\\s*(?:${SVELTE_BLOCK_NAMES.join('|')})\\b|\\{@\\s*(?:${SVELTE_TAG_NAMES.join('|')})\\b`,
			),
			alias: 'keyword',
		},
		'directive-close': { pattern: /\}$/, alias: 'punctuation' },
		'directive-each-as': { pattern: /\bas\b/, alias: 'keyword' },
		rest: pui,
	};
	Prism.languages.insertBefore('pui', 'punctuation', {
		'svelte-block': {
			pattern:
				/\{[#:/]\s*[a-zA-Z]+\b(?:[^}'"`]|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)*\}/,
			greedy: true,
			inside: directiveInside,
		},
		'svelte-tag': {
			pattern:
				/\{@\s*[a-zA-Z]+\b(?:[^}'"`]|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)*\}/,
			greedy: true,
			inside: directiveInside,
		},
	});
}

export function highlightPui(src: string): string {
	registerPuiLanguage();
	return Prism.highlight(src, Prism.languages.pui!, 'pui');
}

export { Prism };
