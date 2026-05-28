/**
 * plugin-references.ts — command-source references providers (LYK-1051).
 *
 * Spawn shape: `[…argv, absPath, <line>, <character>]` with the file
 * content piped to stdin. Stdout is JSON Array<{ file, line, character,
 * endLine?, endCharacter? }>. Positions are 0-indexed (LSP convention)
 * so plugin authors can reuse existing tooling.
 *
 * Aggregates across plugins — finding references is naturally
 * union-shaped; combined with the host's own LSP/tree-sitter results.
 */
import { listPlugins } from './plugins';
import type { ReferencesContribution, PluginManifest } from '@e/shared';
import {
  contributionAppliesTo,
  resolvePluginBinary,
  runPluginBinary,
} from './plugin-command-runner';

const STDOUT_CAP = 512 * 1024;
const TIMEOUT_MS = 4000;

export interface PluginReference {
  file: string;
  line: number;
  character: number;
  endLine?: number;
  endCharacter?: number;
}

export interface PluginReferencesResult {
  references: PluginReference[];
  source: string;
}

function normalizeRef(raw: unknown): PluginReference | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.file !== 'string') return null;
  if (typeof r.line !== 'number' || r.line < 0) return null;
  if (typeof r.character !== 'number' || r.character < 0) return null;
  return {
    file: r.file,
    line: r.line,
    character: r.character,
    endLine: typeof r.endLine === 'number' ? r.endLine : undefined,
    endCharacter: typeof r.endCharacter === 'number' ? r.endCharacter : undefined,
  };
}

async function runOne(
  manifest: PluginManifest,
  installPath: string,
  contrib: ReferencesContribution,
  absPath: string,
  content: string,
  line: number,
  character: number,
): Promise<PluginReferencesResult | null> {
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
  const references = parsed.map(normalizeRef).filter((x): x is PluginReference => x !== null);
  if (references.length === 0) return null;
  return { references, source: `plugin:${manifest.id}` };
}

export async function runReferencesForFile(
  absPath: string,
  content: string,
  line: number,
  character: number,
): Promise<PluginReferencesResult[]> {
  const plugins = listPlugins().filter((p) => p.enabled);
  if (plugins.length === 0) return [];
  const tasks: Array<Promise<PluginReferencesResult | null>> = [];
  for (const p of plugins) {
    for (const c of p.manifest.contributes?.references ?? []) {
      if (!contributionAppliesTo(c, absPath)) continue;
      tasks.push(runOne(p.manifest, p.installPath, c, absPath, content, line, character));
    }
  }
  if (tasks.length === 0) return [];
  const out = await Promise.all(tasks);
  return out.filter((r): r is PluginReferencesResult => r !== null);
}
