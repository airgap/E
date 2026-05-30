/**
 * tmGrammars.svelte.ts (LYK-1035) — host side of the TextMate tokenizer
 * worker. Lazily spins up the worker on first grammar registration, loads
 * oniguruma's WASM (served from /onig.wasm), forwards grammar JSON, and
 * exposes requestTokens() for the CM6 highlight extension.
 *
 * Grammar JSON is fetched here (not in the worker) so the worker stays
 * free of host URL/auth concerns; we pass the parsed scopeName + raw
 * source across.
 */

import type { TmWorkerResponse, TmTokenSpan } from '$lib/workers/tm-tokenizer-worker';

function createTmGrammarsStore() {
  let worker: Worker | null = null;
  let ready = false;
  /** Languages with a registered TextMate grammar. */
  let languages = $state<Set<string>>(new Set());
  let seq = 0;
  const callbacks = new Map<number, (spans: TmTokenSpan[]) => void>();
  /** Registrations queued before the worker signals ready. */
  const pendingRegistrations: Array<{
    languageId: string;
    scopeName: string;
    grammarJson: string;
  }> = [];

  function initWorker() {
    if (worker) return;
    try {
      worker = new Worker(new URL('../workers/tm-tokenizer-worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (e: MessageEvent<TmWorkerResponse>) => {
        const msg = e.data;
        if (msg.type === 'ready') {
          ready = true;
          // Flush any registrations queued during init.
          for (const r of pendingRegistrations.splice(0)) {
            worker?.postMessage({ type: 'registerGrammar', ...r });
          }
        } else if (msg.type === 'tokens') {
          const cb = callbacks.get(msg.requestId);
          if (cb) {
            cb(msg.spans);
            callbacks.delete(msg.requestId);
          }
        } else if (msg.type === 'error') {
          console.warn('[tm-grammars] worker error:', msg.message);
        }
      };
      // Resolve the oniguruma wasm URL against the app base so it works
      // under a non-root base path too.
      const onigWasmUrl = `${location.origin}/onig.wasm`;
      worker.postMessage({ type: 'init', onigWasmUrl });
    } catch (e) {
      console.warn('[tm-grammars] failed to start worker:', e);
    }
  }

  /** Extract the scopeName from a TextMate grammar JSON string. */
  function scopeNameOf(grammarJson: string): string | null {
    try {
      const parsed = JSON.parse(grammarJson);
      return typeof parsed?.scopeName === 'string' ? parsed.scopeName : null;
    } catch {
      return null;
    }
  }

  return {
    /** True when a TextMate grammar is registered for `language`. */
    has(language: string): boolean {
      return languages.has(language);
    },

    /**
     * Register a plugin TextMate grammar. Fetches the grammar JSON from
     * `grammarUrl`, reads its scopeName, and forwards it to the worker.
     */
    async registerGrammar(languageId: string, grammarUrl: string): Promise<void> {
      if (!worker) initWorker();
      let grammarJson: string;
      try {
        const res = await fetch(grammarUrl);
        if (!res.ok) return;
        grammarJson = await res.text();
      } catch {
        return;
      }
      const scopeName = scopeNameOf(grammarJson);
      if (!scopeName) {
        console.warn(`[tm-grammars] ${languageId}: grammar has no scopeName; skipping`);
        return;
      }
      languages = new Set(languages).add(languageId);
      const reg = { languageId, scopeName, grammarJson };
      if (ready) worker?.postMessage({ type: 'registerGrammar', ...reg });
      else pendingRegistrations.push(reg);
    },

    /**
     * Tokenize `content` for `language`. Resolves to span list (empty on
     * no-grammar / error / 5s timeout). Best-effort — highlighting never
     * blocks editing.
     */
    requestTokens(content: string, language: string): Promise<TmTokenSpan[]> {
      if (!worker || !languages.has(language)) return Promise.resolve([]);
      const requestId = ++seq;
      return new Promise((resolve) => {
        callbacks.set(requestId, resolve);
        worker!.postMessage({ type: 'tokenize', requestId, languageId: language, content });
        setTimeout(() => {
          if (callbacks.has(requestId)) {
            callbacks.delete(requestId);
            resolve([]);
          }
        }, 5000);
      });
    },
  };
}

export const tmGrammarsStore = createTmGrammarsStore();
