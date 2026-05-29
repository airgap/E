/**
 * Plugin-contributed grammar runtime bootstraps (LYK-1035 / LYK-1036).
 *
 * Tree-sitter grammars (LYK-1036) — full runtime ships:
 *   The tree-sitter worker stores plugin grammars in pluginGrammarUrls;
 *   the next parse for the registered language picks them up. The host
 *   simply forwards the (language, wasmUrl) pair to the worker on
 *   plugin enable, and clears any cached parser by re-registering.
 *
 * TextMate grammars (LYK-1035) — surface only:
 *   The manifest contracts are honoured (the contribution lands in
 *   pluginContributionsStore.syntaxHighlighters); console-warns when a
 *   plugin ships a tmGrammar entry so the gap is visible. Wiring it
 *   into CM6 needs vscode-textmate-style tokenisation which is a
 *   substantial dep + integration; deferred to its own follow-up.
 */

import { pluginContributionsStore } from './pluginContributions.svelte';
import { symbolStore } from './symbols.svelte';
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
          const url = `${base}/plugins/${encodeURIComponent(sh.pluginId)}/${sh.treeSitterWasm}`;
          symbolStore.registerPluginGrammar(sh.language, url);
        }
        if (sh.tmGrammar && !sh.treeSitterWasm) {
          // TextMate-only contribution. Warn so plugin authors know we
          // see it but don't yet wire it. (LYK-1035 follow-up.)
          console.info(
            `[plugin-grammars] ${sh.pluginId} declared a TextMate grammar for ${sh.language}; ` +
              `runtime wiring is deferred — tokenization not yet applied.`,
          );
        }
      }
    });
  });
}
