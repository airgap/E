/**
 * plugin-diagnostics.ts — runs command-based diagnostics contributions
 * declared by installed/enabled plugins, parses their stdout against the
 * declared regex pattern, and returns normalized DiagnosticItems.
 *
 * Contract for plugin authors:
 *   - `command` is resolved relative to the plugin install dir (argv[0]
 *     joined to the install path). It is spawned with the absolute file
 *     path appended as the final argv element.
 *   - `pattern` is a JS regex compiled with the global flag; matches must
 *     produce **named** groups `line`, `col`, `severity`, `message`, and
 *     optionally `file`. Anything without `line` + `message` is ignored.
 *   - severity may be 'error'|'warning'|'warn'|'info'|'hint'|'note'
 *     (case-insensitive). Anything else collapses to 'info'.
 *   - The process is killed after 5s and stdout is capped at 1 MB. Output
 *     past the cap is silently truncated — a misbehaving linter can't
 *     blow up the server.
 *
 * Source-only ('lsp') diagnostics contributions are NOT handled here —
 * those flow through the LSP server already registered for the plugin.
 */
import { resolve, sep, extname } from 'node:path';
import { existsSync } from 'node:fs';
import { listPlugins } from './plugins';
import type { DiagnosticsContribution, PluginManifest } from '@e/shared';

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface PluginDiagnosticItem {
  path: string;
  line: number; // 0-indexed
  character: number; // 0-indexed
  endLine: number;
  endCharacter: number;
  severity: DiagnosticSeverity;
  message: string;
  /** "plugin:<id>" — used as the diagnostics channel key on the client. */
  source: string;
}

const STDOUT_CAP = 1024 * 1024; // 1 MB
const TIMEOUT_MS = 5000;

type SpawnFn = typeof Bun.spawn;
let spawnFn: SpawnFn = Bun.spawn;

/** Test seam — replace the spawner with a deterministic fake. */
export function __setSpawnForTests(fn: SpawnFn | null): void {
  spawnFn = fn ?? Bun.spawn;
}

function normaliseSeverity(raw: string | undefined): DiagnosticSeverity {
  if (!raw) return 'info';
  const s = raw.toLowerCase().trim();
  if (s === 'error' || s === 'err' || s === 'e' || s === '1') return 'error';
  if (s === 'warning' || s === 'warn' || s === 'w' || s === '2') return 'warning';
  if (s === 'hint' || s === 'h' || s === '4') return 'hint';
  return 'info';
}

function intOrZero(s: string | undefined): number {
  if (!s) return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Match the contribution against a file. Returns true if either:
 *   - extension is in `extensions`, or
 *   - `languages` is omitted (we don't know the language from the path
 *     alone without consulting the LSP language map) AND extensions matches.
 * The conservative rule: at minimum the extension must match if specified;
 * if neither is specified the contribution is treated as opt-in-by-omission
 * (won't run). Plugin authors who want all-files behaviour set
 * `extensions: ['*']`.
 */
function contributionAppliesTo(c: DiagnosticsContribution, absPath: string): boolean {
  if (c.source !== 'command') return false;
  if (!c.command || c.command.length === 0) return false;
  const exts = c.extensions ?? [];
  if (exts.length === 0) return false; // require an opt-in
  if (exts.includes('*')) return true;
  const ext = extname(absPath).toLowerCase();
  return exts.some((e) => e.toLowerCase() === ext);
}

/**
 * Parse a `pattern` (named-group regex) over `text` and yield
 * normalized diagnostics. Resilient to bad regexes — a SyntaxError on
 * compile just yields zero diagnostics.
 */
export function parsePatternOutput(
  pattern: string,
  text: string,
  fallbackPath: string,
  source: string,
): PluginDiagnosticItem[] {
  let re: RegExp;
  try {
    // 'm' so plugin authors can anchor each line with ^/$; 'g' so we walk
    // every match. Most linter outputs are line-oriented.
    re = new RegExp(pattern, 'gm');
  } catch {
    return [];
  }
  const out: PluginDiagnosticItem[] = [];
  // Guard: cap matches at 5000 so a pathological pattern can't OOM us.
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && i < 5000) {
    i++;
    const groups = m.groups ?? {};
    const line = intOrZero(groups.line);
    const message = (groups.message ?? '').trim();
    if (!message) continue; // skip empty messages
    // Most linters output 1-indexed lines/cols; normalise to 0-indexed.
    const line0 = line > 0 ? line - 1 : 0;
    const colRaw = intOrZero(groups.col);
    const col0 = colRaw > 0 ? colRaw - 1 : 0;
    out.push({
      path: groups.file && groups.file.length > 0 ? groups.file : fallbackPath,
      line: line0,
      character: col0,
      endLine: line0,
      endCharacter: col0 + 1,
      severity: normaliseSeverity(groups.severity),
      message,
      source,
    });
    // Defend against zero-width matches looping forever.
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

async function readCapped(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return '';
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let total = 0;
  let parts = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > STDOUT_CAP) {
        // Stop reading; let the writer eventually pipe-break.
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        break;
      }
      parts += decoder.decode(value, { stream: true });
    }
  } catch {
    /* ignore — partial output is fine */
  }
  parts += decoder.decode();
  return parts;
}

/**
 * Run every command-source diagnostics contribution that matches `absPath`
 * across enabled plugins, concatenating results. Each contribution is
 * isolated — a failure in one doesn't suppress others.
 */
export async function runDiagnosticsForFile(absPath: string): Promise<PluginDiagnosticItem[]> {
  const plugins = listPlugins().filter((p) => p.enabled);
  if (plugins.length === 0) return [];
  const tasks: Array<Promise<PluginDiagnosticItem[]>> = [];
  for (const p of plugins) {
    const contribs = p.manifest.contributes?.diagnostics ?? [];
    for (const c of contribs) {
      if (!contributionAppliesTo(c, absPath)) continue;
      tasks.push(runOne(p.manifest, p.installPath, c, absPath));
    }
  }
  if (tasks.length === 0) return [];
  const results = await Promise.all(tasks);
  return results.flat();
}

async function runOne(
  manifest: PluginManifest,
  installPath: string,
  contrib: DiagnosticsContribution,
  absPath: string,
): Promise<PluginDiagnosticItem[]> {
  const argv = contrib.command!;
  const bin = resolveBinary(installPath, argv[0]);
  if (!bin) return [];
  const cmd = [bin, ...argv.slice(1), absPath];
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
    return [];
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
    return [];
  } finally {
    clearTimeout(killer);
  }
  if (!contrib.pattern) return [];
  return parsePatternOutput(contrib.pattern, stdout, absPath, `plugin:${manifest.id}`);
}

/** Resolve argv[0] to an absolute path inside the install dir; reject anything that escapes. */
function resolveBinary(installPath: string, arg0: string): string | null {
  if (!arg0) return null;
  // Absolute paths and bare PATH lookups are NOT honoured — only paths
  // relative to the install dir, so the plugin can't ask us to run
  // /bin/rm or whatever happens to be first in PATH.
  if (arg0.startsWith('/')) return null;
  const resolved = resolve(installPath, arg0);
  const base = resolve(installPath);
  if (!resolved.startsWith(base + sep) && resolved !== base) return null;
  if (!existsSync(resolved)) return null;
  return resolved;
}
