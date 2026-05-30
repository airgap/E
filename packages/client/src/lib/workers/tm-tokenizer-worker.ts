/**
 * tm-tokenizer-worker.ts (LYK-1035) — TextMate grammar tokenization in a
 * web worker, backed by vscode-textmate + vscode-oniguruma.
 *
 * Lifecycle:
 *   init           → fetch + loadWASM(oniguruma), build the Registry.
 *   registerGrammar→ store a grammar's JSON keyed by its scopeName and map
 *                    languageId → scopeName. The Registry's loadGrammar
 *                    closure reads this live map.
 *   tokenize       → tokenize the document line-by-line carrying the rule
 *                    stack, convert per-line token ranges into document
 *                    char offsets, map TM scopes → cm-ts-* classes, and
 *                    return the spans for the host to decorate.
 *
 * Tokenization runs here (off the main thread) so large files don't jank
 * the editor — the acceptance's "background-tokenize on edit (web
 * worker)" requirement.
 */

import { Registry, parseRawGrammar, INITIAL } from 'vscode-textmate';
import { loadWASM, createOnigScanner, createOnigString } from 'vscode-oniguruma';

export interface TmTokenSpan {
  from: number;
  to: number;
  /** cm-ts-<category> class, or '' when no category matched. */
  cls: string;
}

export type TmWorkerRequest =
  | { type: 'init'; onigWasmUrl: string }
  | { type: 'registerGrammar'; languageId: string; scopeName: string; grammarJson: string }
  | { type: 'tokenize'; requestId: number; languageId: string; content: string };

export type TmWorkerResponse =
  | { type: 'ready' }
  | { type: 'tokens'; requestId: number; spans: TmTokenSpan[] }
  | { type: 'error'; message: string };

/** Max lines tokenized per request — bounds work on huge files. */
const MAX_LINES = 8000;

let registry: any = null;
let onigReady = false;
/** scopeName → raw grammar JSON source. */
const grammarSources = new Map<string, string>();
/** languageId → scopeName. */
const langToScope = new Map<string, string>();
/** Cache compiled grammars by scopeName so repeat tokenizes are cheap. */
const grammarCache = new Map<string, any>();

/**
 * Map a TextMate scope stack to one of our cm-ts-<category> classes.
 * Walks from the most specific scope (last) to least, returning the first
 * recognized category. Returns '' for meta/unknown scopes so we don't
 * emit a decoration for every token.
 */
function scopesToClass(scopes: string[]): string {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    // storage.type → type, storage.modifier → keyword, etc.
    if (scope.startsWith('comment')) return 'cm-ts-comment';
    if (scope.startsWith('string')) return 'cm-ts-string';
    if (scope.startsWith('constant.numeric')) return 'cm-ts-number';
    if (scope.startsWith('constant')) return 'cm-ts-constant';
    if (scope.startsWith('keyword')) return 'cm-ts-keyword';
    if (scope.startsWith('storage.type')) return 'cm-ts-type';
    if (scope.startsWith('storage')) return 'cm-ts-keyword';
    if (scope.startsWith('entity.name.function') || scope.startsWith('support.function'))
      return 'cm-ts-function';
    if (
      scope.startsWith('entity.name.type') ||
      scope.startsWith('entity.name.class') ||
      scope.startsWith('support.type') ||
      scope.startsWith('support.class')
    )
      return 'cm-ts-type';
    if (scope.startsWith('entity.name.tag')) return 'cm-ts-tag';
    if (scope.startsWith('entity.other.attribute-name')) return 'cm-ts-attribute';
    if (scope.startsWith('variable.parameter')) return 'cm-ts-parameter';
    if (scope.startsWith('variable')) return 'cm-ts-variable';
    if (scope.startsWith('support')) return 'cm-ts-variable';
    if (scope.startsWith('keyword.operator') || scope.startsWith('punctuation.separator'))
      return 'cm-ts-operator';
    if (scope.startsWith('punctuation')) return 'cm-ts-punctuation';
  }
  return '';
}

function buildRegistry() {
  registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scopeName: string) => {
      const src = grammarSources.get(scopeName);
      if (!src) return null;
      // parseRawGrammar handles both JSON and plist by file extension; we
      // only ship JSON grammars, so the .json hint is correct.
      return parseRawGrammar(src, `${scopeName}.json`);
    },
  });
  // A grammar re-register invalidates compiled caches.
  grammarCache.clear();
}

async function getGrammar(languageId: string): Promise<any | null> {
  const scopeName = langToScope.get(languageId);
  if (!scopeName || !registry) return null;
  if (grammarCache.has(scopeName)) return grammarCache.get(scopeName);
  const grammar = await registry.loadGrammar(scopeName);
  grammarCache.set(scopeName, grammar);
  return grammar;
}

async function tokenize(languageId: string, content: string): Promise<TmTokenSpan[]> {
  const grammar = await getGrammar(languageId);
  if (!grammar) return [];
  const lines = content.split('\n');
  const spans: TmTokenSpan[] = [];
  let ruleStack = INITIAL;
  let offset = 0;
  const lineCount = Math.min(lines.length, MAX_LINES);
  for (let i = 0; i < lineCount; i++) {
    const line = lines[i];
    const result = grammar.tokenizeLine(line, ruleStack);
    ruleStack = result.ruleStack;
    for (const tok of result.tokens) {
      const cls = scopesToClass(tok.scopes);
      if (!cls) continue;
      const from = offset + tok.startIndex;
      const to = offset + tok.endIndex;
      if (to > from) spans.push({ from, to, cls });
    }
    // +1 for the '\n' removed by split (the last line has no trailing
    // newline, but tokenizing stops at lineCount so the over-count is
    // harmless — offsets past the last emitted token are never used).
    offset += line.length + 1;
  }
  return spans;
}

self.onmessage = async (e: MessageEvent<TmWorkerRequest>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init': {
        if (!onigReady) {
          const res = await fetch(msg.onigWasmUrl);
          const buf = await res.arrayBuffer();
          await loadWASM(buf);
          onigReady = true;
        }
        buildRegistry();
        self.postMessage({ type: 'ready' } satisfies TmWorkerResponse);
        break;
      }
      case 'registerGrammar': {
        grammarSources.set(msg.scopeName, msg.grammarJson);
        langToScope.set(msg.languageId, msg.scopeName);
        grammarCache.delete(msg.scopeName);
        break;
      }
      case 'tokenize': {
        const spans = await tokenize(msg.languageId, msg.content);
        self.postMessage({
          type: 'tokens',
          requestId: msg.requestId,
          spans,
        } satisfies TmWorkerResponse);
        break;
      }
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies TmWorkerResponse);
  }
};
