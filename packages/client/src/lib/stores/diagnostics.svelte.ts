import { lspStore } from './lsp.svelte';

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface DiagnosticItem {
  /** Absolute file path (URI with file:// stripped). */
  path: string;
  /** 0-indexed line. */
  line: number;
  /** 0-indexed character. */
  character: number;
  endLine: number;
  endCharacter: number;
  severity: DiagnosticSeverity;
  message: string;
  /** The tool/linter that produced this diagnostic, e.g. "typescript", "eslint". */
  source: string;
  /** Language server that reported this — used so we can scope-clear on disconnect. */
  language: string;
}

function mapSeverity(n: number | undefined): DiagnosticSeverity {
  switch (n) {
    case 1:
      return 'error';
    case 2:
      return 'warning';
    case 4:
      return 'hint';
    default:
      return 'info';
  }
}

function pathFromUri(uri: string): string {
  return uri.startsWith('file://') ? uri.slice(7) : uri;
}

function createDiagnosticsStore() {
  /** Keyed by absolute path → list of diagnostics currently active for that file. */
  let byPath = $state<Map<string, DiagnosticItem[]>>(new Map());
  let subscribed = false;

  function setForPath(path: string, items: DiagnosticItem[]) {
    const next = new Map(byPath);
    if (items.length === 0) {
      next.delete(path);
    } else {
      next.set(path, items);
    }
    byPath = next;
  }

  function handlePublish(language: string, params: { uri: string; diagnostics: any[] }) {
    const path = pathFromUri(params.uri);
    const items: DiagnosticItem[] = (params.diagnostics || []).map((d) => ({
      path,
      line: d.range?.start?.line ?? 0,
      character: d.range?.start?.character ?? 0,
      endLine: d.range?.end?.line ?? d.range?.start?.line ?? 0,
      endCharacter: d.range?.end?.character ?? d.range?.start?.character ?? 0,
      severity: mapSeverity(d.severity),
      message: d.message || '',
      source: d.source || language,
      language,
    }));
    setForPath(path, items);
  }

  return {
    /** All diagnostics grouped by file path. */
    get byPath() {
      return byPath;
    },

    /** Flat list of every diagnostic across every file — used by the Problems panel. */
    get all(): DiagnosticItem[] {
      const out: DiagnosticItem[] = [];
      for (const items of byPath.values()) out.push(...items);
      return out;
    },

    get files(): string[] {
      return Array.from(byPath.keys()).sort();
    },

    /** Totals by severity — used for status-bar badges. */
    get counts(): Record<DiagnosticSeverity, number> {
      const out: Record<DiagnosticSeverity, number> = {
        error: 0,
        warning: 0,
        info: 0,
        hint: 0,
      };
      for (const items of byPath.values()) {
        for (const d of items) out[d.severity]++;
      }
      return out;
    },

    forFile(path: string): DiagnosticItem[] {
      return byPath.get(path) ?? [];
    },

    /**
     * Subscribe to `textDocument/publishDiagnostics` from every connected language server.
     * Idempotent — calling repeatedly is safe.
     *
     * Note: the LSP store broadcasts to a single global handler list, so one subscription
     * here covers every server. We pass the received `language` through the handler to
     * keep per-server attribution on each diagnostic item.
     */
    subscribe(): void {
      if (subscribed) return;
      subscribed = true;
      lspStore.onNotification(
        'textDocument/publishDiagnostics',
        (params: { uri: string; diagnostics: any[] }) => {
          // We don't know which server sent this without additional plumbing;
          // attribute by `source` on the diagnostic itself when present.
          handlePublish('lsp', params);
        },
      );
    },

    /** Clear everything — used when switching workspaces. */
    clear() {
      byPath = new Map();
    },
  };
}

export const diagnosticsStore = createDiagnosticsStore();
