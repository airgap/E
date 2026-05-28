/**
 * plugin-completions.ts — command-source completion providers (LYK-1049).
 *
 * Spawn shape: `[…argv, absPath, <line>, <character>]` with the file
 * content piped to stdin. Stdout is parsed as a JSON array of completion
 * items; bad entries are dropped, label is required.
 *
 * Differs from the other command-source services in two ways:
 *   - Aggregates results from every matching plugin rather than
 *     first-match (completion UIs naturally merge sources).
 *   - Tighter timeout (1.5 s) — completions are interactive and a slow
 *     plugin starves the autocomplete loop more visibly than a slow
 *     formatter or symbol fetch.
 */
import { listPlugins } from './plugins';
import type { CompletionsContribution, PluginManifest } from '@e/shared';
import {
  contributionAppliesTo,
  resolvePluginBinary,
  runPluginBinary,
} from './plugin-command-runner';

const STDOUT_CAP = 256 * 1024;
const TIMEOUT_MS = 1500;

export interface PluginCompletion {
  label: string;
  insertText: string;
  detail?: string;
  kind?: string;
  documentation?: string;
}

export interface PluginCompletionsResult {
  items: PluginCompletion[];
  source: string;
}

function normalizeItem(raw: unknown): PluginCompletion | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.label !== 'string' || !r.label) return null;
  return {
    label: r.label,
    insertText: typeof r.insertText === 'string' ? r.insertText : r.label,
    detail: typeof r.detail === 'string' ? r.detail : undefined,
    kind: typeof r.kind === 'string' ? r.kind : undefined,
    documentation: typeof r.documentation === 'string' ? r.documentation : undefined,
  };
}

async function runOne(
  manifest: PluginManifest,
  installPath: string,
  contrib: CompletionsContribution,
  absPath: string,
  content: string,
  line: number,
  character: number,
): Promise<PluginCompletionsResult | null> {
  const argv = contrib.command!;
  const bin = resolvePluginBinary(installPath, argv[0]);
  if (!bin) return null;
  const r = await runPluginBinary({
    bin,
    cwd: installPath,
    argv: [...argv.slice(1), absPath, String(line), String(character)],
    stdin: content,
    timeoutMs: TIMEOUT_MS,
    stdoutCap: STDOUT_CAP,
  });
  if (!r || !r.stdout.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const items = parsed.map(normalizeItem).filter((x): x is PluginCompletion => x !== null);
  if (items.length === 0) return null;
  return { items, source: `plugin:${manifest.id}` };
}

export async function runCompletionsForFile(
  absPath: string,
  content: string,
  line: number,
  character: number,
): Promise<PluginCompletionsResult[]> {
  const plugins = listPlugins().filter((p) => p.enabled);
  if (plugins.length === 0) return [];
  const tasks: Array<Promise<PluginCompletionsResult | null>> = [];
  for (const p of plugins) {
    for (const c of p.manifest.contributes?.completions ?? []) {
      if (!contributionAppliesTo(c, absPath)) continue;
      tasks.push(runOne(p.manifest, p.installPath, c, absPath, content, line, character));
    }
  }
  if (tasks.length === 0) return [];
  const out = await Promise.all(tasks);
  return out.filter((r): r is PluginCompletionsResult => r !== null);
}
