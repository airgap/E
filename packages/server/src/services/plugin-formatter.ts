/**
 * plugin-formatter.ts — runs command-based formatter contributions (LYK-1046).
 *
 * The plugin's binary is spawned with `[…argv, absPath]`. The unformatted
 * source content is piped to its stdin; stdout is taken as the formatted
 * replacement. Stderr is captured for debugging but not surfaced.
 *
 * Contract (mirrors plugin-hovers / plugin-diagnostics):
 *   - argv[0] resolves relative to the plugin install dir; absolute /
 *     PATH-style lookups are refused.
 *   - extensions[] gates which files the formatter runs against. ['*']
 *     matches everything; omitting the field is "opt out".
 *   - The first plugin whose stdout is non-empty wins (formatting is a
 *     "one source per file" operation; layering wouldn't compose).
 *   - Timeout: 5 s (formatters often parse the file once; longer than
 *     hover but shorter than diagnostics).
 *   - Stdout cap: 4 MB — large enough for a generated file but bounded.
 */
import { resolve, sep, extname } from 'node:path';
import { existsSync } from 'node:fs';
import { listPlugins } from './plugins';
import type { FormatterContribution, PluginManifest } from '@e/shared';

const STDOUT_CAP = 4 * 1024 * 1024;
const TIMEOUT_MS = 5000;

type SpawnFn = typeof Bun.spawn;
let spawnFn: SpawnFn = Bun.spawn;

export function __setSpawnForTests(fn: SpawnFn | null): void {
  spawnFn = fn ?? Bun.spawn;
}

export interface PluginFormatResult {
  /** Replacement content for the whole file. */
  formatted: string;
  /** "plugin:<id>" — surfaced for debugging / status display. */
  source: string;
}

function contributionAppliesTo(c: FormatterContribution, absPath: string): boolean {
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
  contrib: FormatterContribution,
  absPath: string,
  content: string,
): Promise<PluginFormatResult | null> {
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
  // Pipe the unformatted content to stdin. Bun's spawn returns a FileSink
  // for stdin when stdin: 'pipe' is set; .write + .end is the API. If the
  // plugin closed stdin early we ignore the error and read whatever it
  // wrote to stdout below.
  try {
    const stdin = proc.stdin as { write: (chunk: Uint8Array) => unknown; end: () => unknown };
    if (stdin && typeof stdin.write === 'function') {
      stdin.write(new TextEncoder().encode(content));
      stdin.end();
    }
  } catch {
    /* ignore — fall through to stdout read */
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
  if (!stdout) return null;
  return { formatted: stdout, source: `plugin:${manifest.id}` };
}

/**
 * Run command-source formatters until one returns a non-empty result.
 * Formatting is one-source-per-file: the first match wins. Order
 * follows manifest registration order; for predictable behavior, plugin
 * authors should keep formatter contributions disjoint by extension.
 */
export async function runFormatForFile(
  absPath: string,
  content: string,
): Promise<PluginFormatResult | null> {
  const plugins = listPlugins().filter((p) => p.enabled);
  if (plugins.length === 0) return null;
  for (const p of plugins) {
    for (const c of p.manifest.contributes?.formatters ?? []) {
      if (!contributionAppliesTo(c, absPath)) continue;
      const r = await runOne(p.manifest, p.installPath, c, absPath, content);
      if (r) return r;
    }
  }
  return null;
}
