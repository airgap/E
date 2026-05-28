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
  /**
   * LSP-published diagnostics keyed by absolute path. The LSP server is
   * the source of truth for the whole file every time it publishes, so
   * we replace the list wholesale on each publish.
   */
  let byPath = $state<Map<string, DiagnosticItem[]>>(new Map());
  /**
   * Plugin (command-based) diagnostics keyed by (path → channel → items)
   * where channel = `plugin:<id>`. Stored separately from LSP results so
   * one source's refresh doesn't clobber the other's; the read-side
   * accessors merge them.
   */
  let byPathByChannel = $state<Map<string, Map<string, DiagnosticItem[]>>>(new Map());
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

  function setForPathChannel(path: string, channel: string, items: DiagnosticItem[]) {
    const next = new Map(byPathByChannel);
    const inner = new Map(next.get(path) ?? []);
    if (items.length === 0) inner.delete(channel);
    else inner.set(channel, items);
    if (inner.size === 0) next.delete(path);
    else next.set(path, inner);
    byPathByChannel = next;
  }

  function mergedForPath(path: string): DiagnosticItem[] {
    const lsp = byPath.get(path) ?? [];
    const channels = byPathByChannel.get(path);
    if (!channels || channels.size === 0) return lsp;
    const out: DiagnosticItem[] = [...lsp];
    for (const items of channels.values()) out.push(...items);
    return out;
  }

  function mergedAllPaths(): string[] {
    const set = new Set<string>(byPath.keys());
    for (const k of byPathByChannel.keys()) set.add(k);
    return Array.from(set).sort();
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
    /**
     * All diagnostics grouped by file path. Returns a merged view across
     * LSP + plugin sources; consumers should treat it as read-only.
     */
    get byPath() {
      const out = new Map<string, DiagnosticItem[]>();
      for (const p of mergedAllPaths()) {
        const merged = mergedForPath(p);
        if (merged.length > 0) out.set(p, merged);
      }
      return out;
    },

    /** Flat list of every diagnostic across every file — used by the Problems panel. */
    get all(): DiagnosticItem[] {
      const out: DiagnosticItem[] = [];
      for (const p of mergedAllPaths()) out.push(...mergedForPath(p));
      return out;
    },

    get files(): string[] {
      return mergedAllPaths();
    },

    /** Totals by severity — used for status-bar badges. */
    get counts(): Record<DiagnosticSeverity, number> {
      const out: Record<DiagnosticSeverity, number> = {
        error: 0,
        warning: 0,
        info: 0,
        hint: 0,
      };
      for (const p of mergedAllPaths()) {
        for (const d of mergedForPath(p)) out[d.severity]++;
      }
      return out;
    },

    forFile(path: string): DiagnosticItem[] {
      return mergedForPath(path);
    },

    /**
     * Replace plugin (command-based) diagnostics for `path` on `channel`.
     * Channel is `plugin:<id>`; called from refreshPluginDiagnostics
     * after the server runs the linter binary on save / on demand.
     */
    setPluginDiagnosticsForPath(path: string, channel: string, items: DiagnosticItem[]): void {
      setForPathChannel(path, channel, items);
    },

    /**
     * Refresh plugin diagnostics for `path` by POSTing to the server,
     * which spawns every matching command-based diagnostics contribution
     * and returns a normalized list. Groups items by `source` (== channel)
     * and replaces each channel's items wholesale; channels with no
     * items on this run are cleared.
     */
    async refreshPluginDiagnostics(path: string): Promise<void> {
      if (!path) return;
      let json: any;
      try {
        const res = await fetch('/api/plugins/diagnostics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        });
        if (!res.ok) return;
        json = await res.json();
      } catch {
        return;
      }
      const items: DiagnosticItem[] = (json?.data?.diagnostics ?? []).map((d: any) => ({
        path: d.path ?? path,
        line: d.line ?? 0,
        character: d.character ?? 0,
        endLine: d.endLine ?? d.line ?? 0,
        endCharacter: d.endCharacter ?? (d.character ?? 0) + 1,
        severity: d.severity ?? 'info',
        message: d.message ?? '',
        source: d.source ?? 'plugin',
        language: d.source ?? 'plugin',
      }));
      // Group by source so each channel replaces its own prior items.
      const byChannel = new Map<string, DiagnosticItem[]>();
      for (const it of items) {
        const arr = byChannel.get(it.source) ?? [];
        arr.push(it);
        byChannel.set(it.source, arr);
      }
      // Clear channels that previously had results for this path but didn't this time.
      const prev = byPathByChannel.get(path);
      if (prev) {
        for (const ch of prev.keys()) {
          if (!ch.startsWith('plugin:')) continue;
          if (!byChannel.has(ch)) setForPathChannel(path, ch, []);
        }
      }
      for (const [ch, arr] of byChannel) setForPathChannel(path, ch, arr);
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
      byPathByChannel = new Map();
    },
  };
}

export const diagnosticsStore = createDiagnosticsStore();
