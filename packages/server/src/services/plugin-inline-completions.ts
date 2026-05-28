/**
 * plugin-inline-completions.ts — command-source inline (Copilot-style)
 * completions (LYK-1050).
 *
 * Spawn shape: `[…argv, absPath, line, character]` with file content on
 * stdin. Stdout is JSON:
 *   { insertText: string, range?: { startLine, startChar, endLine, endChar } }
 * Empty / no result suppresses the suggestion. First plugin to return
 * insertText wins.
 */
import { listPlugins } from './plugins';
import type { InlineCompletionsContribution, PluginManifest } from '@e/shared';
import {
  contributionAppliesTo,
  resolvePluginBinary,
  runPluginBinary,
} from './plugin-command-runner';

const STDOUT_CAP = 64 * 1024;
const TIMEOUT_MS = 1500;

export interface PluginInlineCompletionRange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

export interface PluginInlineCompletion {
  insertText: string;
  range?: PluginInlineCompletionRange;
  source: string;
}

function normalizeRange(raw: unknown): PluginInlineCompletionRange | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.startLine !== 'number' ||
    typeof r.startCharacter !== 'number' ||
    typeof r.endLine !== 'number' ||
    typeof r.endCharacter !== 'number'
  ) {
    return undefined;
  }
  return {
    startLine: r.startLine,
    startCharacter: r.startCharacter,
    endLine: r.endLine,
    endCharacter: r.endCharacter,
  };
}

async function runOne(
  manifest: PluginManifest,
  installPath: string,
  contrib: InlineCompletionsContribution,
  absPath: string,
  content: string,
  line: number,
  character: number,
): Promise<PluginInlineCompletion | null> {
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
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  const insertText = typeof p.insertText === 'string' ? p.insertText : '';
  if (!insertText) return null;
  return {
    insertText,
    range: normalizeRange(p.range),
    source: `plugin:${manifest.id}`,
  };
}

export async function runInlineCompletionForPosition(
  absPath: string,
  content: string,
  line: number,
  character: number,
): Promise<PluginInlineCompletion | null> {
  const plugins = listPlugins().filter((p) => p.enabled);
  if (plugins.length === 0) return null;
  for (const p of plugins) {
    for (const c of p.manifest.contributes?.inlineCompletions ?? []) {
      if (!contributionAppliesTo(c, absPath)) continue;
      const r = await runOne(p.manifest, p.installPath, c, absPath, content, line, character);
      if (r) return r;
    }
  }
  return null;
}
