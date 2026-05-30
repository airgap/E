/**
 * Plugin-contributed grammar runtime bootstraps (LYK-1035 / LYK-1036).
 *
 * Tree-sitter grammars (LYK-1036) — full runtime ships:
 *   The tree-sitter worker stores plugin grammars in pluginGrammarUrls;
 *   the next parse for the registered language picks them up. The host
 *   forwards (language, wasmUrl) plus optional highlights.scm / folds.scm
 *   query URLs to the worker on plugin enable. The grammar highlighting
 *   CM6 extension (plugin-grammar-highlight.ts) then requests captures
 *   from the worker and renders them as decorations + fold ranges.
 *
 * TextMate grammars (LYK-1035) — full runtime ships:
 *   The grammar JSON is forwarded to the TextMate tokenizer worker
 *   (tmGrammarsStore), which tokenizes via vscode-textmate +
 *   vscode-oniguruma. The tm-grammar-highlight CM6 extension requests
 *   tokens and renders them as decorations. Only used when a plugin
 *   ships a tmGrammar *without* a treeSitterWasm — tree-sitter wins when
 *   both are present (it gives richer structure + symbols).
 */

import { pluginContributionsStore } from './pluginContributions.svelte';
import { symbolStore } from './symbols.svelte';
import { tmGrammarsStore } from './tmGrammars.svelte';
import { getBaseUrl } from '$lib/api/client';

let bootstrapped = false;

export function bootstrapPluginGrammars(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  // Per-(pluginId, language) registration tracker so we don't re-post
  // a registerGrammar message on every effect run.
  const registered = new Set<string>();
  const base = getBaseUrl();

  $effect.root(() => {
    $effect(() => {
      for (const sh of pluginContributionsStore.syntaxHighlighters) {
        const key = `${sh.pluginId}.${sh.language}`;
        if (registered.has(key)) continue;
        registered.add(key);

        if (sh.treeSitterWasm) {
          const assetUrl = (rel: string) =>
            `${base}/plugins/${encodeURIComponent(sh.pluginId)}/${rel}`;
          symbolStore.registerPluginGrammar(sh.language, assetUrl(sh.treeSitterWasm), {
            highlightsUrl: sh.highlightsQuery ? assetUrl(sh.highlightsQuery) : undefined,
            foldsUrl: sh.foldsQuery ? assetUrl(sh.foldsQuery) : undefined,
          });
        }
        if (sh.tmGrammar && !sh.treeSitterWasm) {
          // TextMate-only contribution (LYK-1035): forward the grammar to
          // the tokenizer worker. tree-sitter is preferred when both are
          // declared, so this only runs for TM-only grammars.
          const url = `${base}/plugins/${encodeURIComponent(sh.pluginId)}/${sh.tmGrammar}`;
          void tmGrammarsStore.registerGrammar(sh.language, url);
        }
      }
    });
  });
}
