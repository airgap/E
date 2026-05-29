import type {
  Symbol,
  Location,
  WorkerResponse,
  HighlightSpan,
  FoldSpan,
} from '$lib/workers/treesitter-worker';

function createSymbolStore() {
  let worker: Worker | null = null;
  let ready = $state(false);
  let symbolsByFile = $state<Map<string, Symbol[]>>(new Map());
  let pendingCallbacks = new Map<string, (data: any) => void>();
  let debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Languages with a registered plugin highlights query (LYK-1036). */
  let highlightLanguages = $state<Set<string>>(new Set());
  /** Correlation id + callback map for highlight requests. */
  let highlightSeq = 0;
  const highlightCallbacks = new Map<
    number,
    (r: { spans: HighlightSpan[]; folds: FoldSpan[] }) => void
  >();

  function initWorker() {
    if (worker) return;
    try {
      worker = new Worker(new URL('../workers/treesitter-worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        switch (msg.type) {
          case 'ready':
            ready = true;
            break;
          case 'parsed': {
            console.debug(
              '[symbolStore] parsed',
              msg.fileId,
              'symbols:',
              msg.symbols.length,
              msg.symbols.map((s: any) => s.name).slice(0, 10),
            );
            const newMap = new Map(symbolsByFile);
            newMap.set(msg.fileId, msg.symbols);
            symbolsByFile = newMap;
            break;
          }
          case 'definitions': {
            const cb = pendingCallbacks.get(`def:${msg.fileId}`);
            if (cb) {
              cb(msg.locations);
              pendingCallbacks.delete(`def:${msg.fileId}`);
            }
            break;
          }
          case 'references': {
            const cb = pendingCallbacks.get(`ref:${msg.fileId}`);
            if (cb) {
              cb(msg.locations);
              pendingCallbacks.delete(`ref:${msg.fileId}`);
            }
            break;
          }
          case 'highlights': {
            const cb = highlightCallbacks.get(msg.requestId);
            if (cb) {
              cb({ spans: msg.spans, folds: msg.folds });
              highlightCallbacks.delete(msg.requestId);
            }
            break;
          }
          case 'error':
            console.warn('Tree-sitter worker error:', msg.message);
            break;
        }
      };
      worker.postMessage({ type: 'init' });
    } catch (e) {
      console.warn('Failed to initialize tree-sitter worker:', e);
    }
  }

  return {
    get ready() {
      return ready;
    },
    get symbolsByFile() {
      return symbolsByFile;
    },

    init() {
      initWorker();
    },

    /**
     * Register a plugin-contributed tree-sitter grammar (LYK-1036). The
     * worker stores the (language, wasmUrl) pair and clears any cached
     * parser so the next parse picks the new grammar up. Optional
     * highlights/folds .scm URLs enable query-based syntax highlighting.
     */
    registerPluginGrammar(
      language: string,
      wasmUrl: string,
      opts?: { highlightsUrl?: string; foldsUrl?: string },
    ) {
      if (!worker) initWorker();
      worker?.postMessage({
        type: 'registerGrammar',
        language,
        wasmUrl,
        highlightsUrl: opts?.highlightsUrl,
        foldsUrl: opts?.foldsUrl,
      });
      if (opts?.highlightsUrl) {
        highlightLanguages = new Set(highlightLanguages).add(language);
      }
    },

    /** True when a plugin highlights query is registered for `language`. */
    hasPluginHighlights(language: string): boolean {
      return highlightLanguages.has(language);
    },

    /**
     * Run the registered grammar's highlights (+ folds) queries over
     * `content`. Resolves to capture spans in char offsets. Returns empty
     * results (never rejects) when no grammar/query is registered or the
     * worker errors — callers treat highlighting as best-effort.
     */
    requestHighlights(
      content: string,
      language: string,
    ): Promise<{ spans: HighlightSpan[]; folds: FoldSpan[] }> {
      if (!worker) initWorker();
      if (!worker || !highlightLanguages.has(language)) {
        return Promise.resolve({ spans: [], folds: [] });
      }
      const requestId = ++highlightSeq;
      return new Promise((resolve) => {
        highlightCallbacks.set(requestId, resolve);
        worker!.postMessage({ type: 'highlight', requestId, content, language });
        // Safety timeout so a dropped response can't leak the callback.
        setTimeout(() => {
          if (highlightCallbacks.has(requestId)) {
            highlightCallbacks.delete(requestId);
            resolve({ spans: [], folds: [] });
          }
        }, 4000);
      });
    },

    /**
     * Request a parse with 300ms debounce.
     */
    requestParse(fileId: string, content: string, language: string) {
      if (!worker) initWorker();
      // Debounce
      const existing = debounceTimers.get(fileId);
      if (existing) clearTimeout(existing);

      debounceTimers.set(
        fileId,
        setTimeout(() => {
          debounceTimers.delete(fileId);
          worker?.postMessage({ type: 'parse', fileId, content, language });
        }, 300),
      );
    },

    /**
     * Immediately parse (no debounce, for initial load).
     */
    parseFull(fileId: string, content: string, language: string) {
      if (!worker) initWorker();
      worker?.postMessage({ type: 'parse', fileId, content, language });
    },

    getSymbols(fileId: string): Symbol[] {
      return symbolsByFile.get(fileId) ?? [];
    },

    async findDefinitions(fileId: string, row: number, col: number): Promise<Location[]> {
      if (!worker) return [];
      return new Promise((resolve) => {
        pendingCallbacks.set(`def:${fileId}`, resolve);
        worker!.postMessage({
          type: 'definitions',
          fileId,
          position: { row, col },
        });
        // Timeout after 2s
        setTimeout(() => {
          if (pendingCallbacks.has(`def:${fileId}`)) {
            pendingCallbacks.delete(`def:${fileId}`);
            resolve([]);
          }
        }, 2000);
      });
    },

    async findReferences(fileId: string, symbolName: string): Promise<Location[]> {
      if (!worker) return [];
      return new Promise((resolve) => {
        pendingCallbacks.set(`ref:${fileId}`, resolve);
        worker!.postMessage({
          type: 'references',
          fileId,
          symbolName,
        });
        setTimeout(() => {
          if (pendingCallbacks.has(`ref:${fileId}`)) {
            pendingCallbacks.delete(`ref:${fileId}`);
            resolve([]);
          }
        }, 2000);
      });
    },

    destroy() {
      if (worker) {
        worker.terminate();
        worker = null;
      }
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();
      pendingCallbacks.clear();
    },
  };
}

export const symbolStore = createSymbolStore();
