import type { Symbol, Location, WorkerResponse } from '$lib/workers/treesitter-worker';

function createSymbolStore() {
  let worker: Worker | null = null;
  let ready = $state(false);
  let symbolsByFile = $state<Map<string, Symbol[]>>(new Map());
  let pendingCallbacks = new Map<string, (data: any) => void>();
  let debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
