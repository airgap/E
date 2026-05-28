/**
 * plugin-hovers.ts — runs command-based hover contributions declared by
 * installed/enabled plugins. The plugin's binary is spawned with
 *   [<argv tail>, <absPath>, <line>, <character>]
 * and its stdout (interpreted as markdown) is returned to the client,
 * which renders it as a CodeMirror hover tooltip.
 *
 * Contract:
 *   - argv[0] resolves relative to the plugin install dir; absolute /
 *     PATH-style lookups are refused (so a malicious manifest can't ask
 *     us to spawn /bin/cat).
 *   - extensions[] gates which files the hover runs against. extensions
 *     of ['*'] matches everything; omitting the field means "opt out".
 *   - The first plugin whose stdout is non-empty wins. If you need
 *     stacking, declare multiple plugins or generate one combined
 *     markdown blob.
 *   - Timeout: 3 s. Stdout cap: 256 KB (anything longer is truncated).
 *     Hover queries are interactive so we keep both lower than the
 *     diagnostics caps.
 *
 * Source-only ('lsp') hovers are NOT handled here — they flow through
 * the LSP server already registered for the plugin.
 */
import { resolve, sep, extname } from 'node:path';
import { existsSync } from 'node:fs';
import { listPlugins } from './plugins';
import type { HoverContribution, PluginManifest } from '@e/shared';

const STDOUT_CAP = 256 * 1024;
const TIMEOUT_MS = 3000;

type SpawnFn = typeof Bun.spawn;
let spawnFn: SpawnFn = Bun.spawn;

export function __setSpawnForTests(fn: SpawnFn | null): void {
  spawnFn = fn ?? Bun.spawn;
}

export interface PluginHoverResult {
  markdown: string;
  source: string; // "plugin:<id>"
}

function contributionAppliesTo(c: HoverContribution, absPath: string): boolean {
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

async function runOne(
  manifest: PluginManifest,
  installPath: string,
  contrib: HoverContribution,
  absPath: string,
  line: number,
  character: number,
): Promise<PluginHoverResult | null> {
  const argv = contrib.command!;
  const bin = resolveBinary(installPath, argv[0]);
  if (!bin) return null;
  const cmd = [bin, ...argv.slice(1), absPath, String(line), String(character)];
  let proc: ReturnType<SpawnFn>;
  try {
    proc = spawnFn({
      cmd,
      cwd: installPath,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
    });
  } catch {
    return null;
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
  const md = stdout.trim();
  if (!md) return null;
  return { markdown: md, source: `plugin:${manifest.id}` };
}

/**
 * Run every matching command-source hover contribution. Returns the list
 * of every non-empty result — the client can show one or all of them.
 * Hover queries are interactive (300 ms debounce); the parallelism here
 * is bounded by the small number of plugins typically installed.
 */
export async function runHoverForFile(
  absPath: string,
  line: number,
  character: number,
): Promise<PluginHoverResult[]> {
  const plugins = listPlugins().filter((p) => p.enabled);
  if (plugins.length === 0) return [];
  const tasks: Array<Promise<PluginHoverResult | null>> = [];
  for (const p of plugins) {
    for (const c of p.manifest.contributes?.hovers ?? []) {
      if (!contributionAppliesTo(c, absPath)) continue;
      tasks.push(runOne(p.manifest, p.installPath, c, absPath, line, character));
    }
  }
  if (tasks.length === 0) return [];
  const results = await Promise.all(tasks);
  return results.filter((r): r is PluginHoverResult => r !== null);
}
