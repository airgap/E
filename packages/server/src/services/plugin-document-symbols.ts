/**
 * plugin-document-symbols.ts — runs command-source document-symbol
 * providers (LYK-1048).
 *
 * Spawn shape mirrors plugin-formatter: `[…argv, absPath]` with the file
 * content piped to stdin. Stdout is parsed as JSON matching the
 * normalized Symbol[] shape the renderer already consumes for tree-sitter
 * results, so the client can drop plugin results straight into the same
 * outline view.
 *
 * Contract:
 *   - argv[0] resolves relative to the plugin install dir; absolute /
 *     PATH-style lookups are refused.
 *   - extensions[] gates which files run; ['*'] matches everything.
 *   - First plugin whose stdout parses to a non-empty array wins.
 *   - Timeout: 4 s. Stdout cap: 2 MB.
 *   - Malformed stdout (non-JSON, wrong shape) is treated as no result.
 */
import { resolve, sep, extname } from 'node:path';
import { existsSync } from 'node:fs';
import { listPlugins } from './plugins';
import type { DocumentSymbolsContribution, PluginManifest } from '@e/shared';

const STDOUT_CAP = 2 * 1024 * 1024;
const TIMEOUT_MS = 4000;

type SpawnFn = typeof Bun.spawn;
let spawnFn: SpawnFn = Bun.spawn;

export function __setSpawnForTests(fn: SpawnFn | null): void {
  spawnFn = fn ?? Bun.spawn;
}

export interface PluginSymbol {
  name: string;
  kind: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  children?: PluginSymbol[];
}

export interface PluginDocumentSymbolsResult {
  symbols: PluginSymbol[];
  source: string;
}

function contributionAppliesTo(c: DocumentSymbolsContribution, absPath: string): boolean {
  if (c.source !== 'command') return false;
  if (!c.command || c.command.length === 0) return false;
  const exts = c.extensions ?? [];
  if (exts.length === 0) return false;
  if (exts.includes('*')) return true;
  const ext = extname(absPath).toLowerCase();
  return exts.some((e) => e.toLowerCase() === ext);
}

function resolveBinary(installPath: string, arg0: string): string | null {
  if (!arg0) return null;
  if (arg0.startsWith('/')) return null;
  const r = resolve(installPath, arg0);
  const base = resolve(installPath);
  if (!r.startsWith(base + sep) && r !== base) return null;
  if (!existsSync(r)) return null;
  return r;
}

async function readCapped(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return '';
  const dec = new TextDecoder();
  const reader = stream.getReader();
  let total = 0;
  let out = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > STDOUT_CAP) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        break;
      }
      out += dec.decode(value, { stream: true });
    }
  } catch {
    /* ignore */
  }
  out += dec.decode();
  return out;
}

/** Recursive narrow into PluginSymbol; bad shape = drop. */
function normalizeSymbol(raw: unknown): PluginSymbol | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string') return null;
  const kind = typeof r.kind === 'string' ? r.kind : 'variable';
  const startRow = typeof r.startRow === 'number' ? r.startRow : 0;
  const startCol = typeof r.startCol === 'number' ? r.startCol : 0;
  const endRow = typeof r.endRow === 'number' ? r.endRow : startRow;
  const endCol = typeof r.endCol === 'number' ? r.endCol : startCol;
  let children: PluginSymbol[] | undefined;
  if (Array.isArray(r.children)) {
    children = r.children.map(normalizeSymbol).filter((s): s is PluginSymbol => s !== null);
    if (children.length === 0) children = undefined;
  }
  return { name: r.name, kind, startRow, startCol, endRow, endCol, children };
}

async function runOne(
  manifest: PluginManifest,
  installPath: string,
  contrib: DocumentSymbolsContribution,
  absPath: string,
  content: string,
): Promise<PluginDocumentSymbolsResult | null> {
  const argv = contrib.command!;
  const bin = resolveBinary(installPath, argv[0]);
  if (!bin) return null;
  const cmd = [bin, ...argv.slice(1), absPath];
  let proc: ReturnType<SpawnFn>;
  try {
    proc = spawnFn({
      cmd,
      cwd: installPath,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'pipe',
    });
  } catch {
    return null;
  }
  try {
    const stdin = proc.stdin as { write: (chunk: Uint8Array) => unknown; end: () => unknown };
    if (stdin && typeof stdin.write === 'function') {
      stdin.write(new TextEncoder().encode(content));
      stdin.end();
    }
  } catch {
    /* ignore */
  }
  const killer = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  }, TIMEOUT_MS);
  let stdout = '';
  try {
    stdout = await readCapped(proc.stdout as ReadableStream<Uint8Array> | null);
    await proc.exited;
  } catch {
    return null;
  } finally {
    clearTimeout(killer);
  }
  if (!stdout.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const symbols = parsed.map(normalizeSymbol).filter((s): s is PluginSymbol => s !== null);
  if (symbols.length === 0) return null;
  return { symbols, source: `plugin:${manifest.id}` };
}

/**
 * First-non-empty wins. Document symbols are file-scoped; layering
 * results from multiple plugins would produce a confusing tree, so we
 * pick one.
 */
export async function runDocumentSymbolsForFile(
  absPath: string,
  content: string,
): Promise<PluginDocumentSymbolsResult | null> {
  const plugins = listPlugins().filter((p) => p.enabled);
  if (plugins.length === 0) return null;
  for (const p of plugins) {
    for (const c of p.manifest.contributes?.documentSymbols ?? []) {
      if (!contributionAppliesTo(c, absPath)) continue;
      const r = await runOne(p.manifest, p.installPath, c, absPath, content);
      if (r) return r;
    }
  }
  return null;
}
