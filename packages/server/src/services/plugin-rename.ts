/**
 * plugin-rename.ts — command-source rename providers (LYK-1053).
 *
 * Spawn shape: `[…argv, absPath, <line>, <character>, <newName>]` with
 * the file content piped to stdin. Stdout is JSON describing a
 * workspace edit:
 *
 *   { "<absPath>": [
 *       { startLine, startCharacter, endLine, endCharacter, newText }
 *     ],
 *     "<otherAbsPath>": [...]
 *   }
 *
 * Empty objects mean "no edit possible". First plugin whose result is
 * non-empty wins — renaming is a single-action operation; multiple
 * plugins offering conflicting edits would corrupt the workspace.
 */
import { listPlugins } from './plugins';
import type { RenameContribution, PluginManifest } from '@e/shared';
import {
  contributionAppliesTo,
  resolvePluginBinary,
  runPluginBinary,
} from './plugin-command-runner';

const STDOUT_CAP = 4 * 1024 * 1024;
const TIMEOUT_MS = 8000;

export interface RenameTextEdit {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  newText: string;
}

export interface PluginRenameResult {
  /** Map of absolute-file-path → ordered edits to apply. */
  edits: Record<string, RenameTextEdit[]>;
  source: string;
}

function normalizeEdit(raw: unknown): RenameTextEdit | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.startLine !== 'number' ||
    typeof r.startCharacter !== 'number' ||
    typeof r.endLine !== 'number' ||
    typeof r.endCharacter !== 'number' ||
    typeof r.newText !== 'string'
  ) {
    return null;
  }
  return {
    startLine: r.startLine,
    startCharacter: r.startCharacter,
    endLine: r.endLine,
    endCharacter: r.endCharacter,
    newText: r.newText,
  };
}

async function runOne(
  manifest: PluginManifest,
  installPath: string,
  contrib: RenameContribution,
  absPath: string,
  content: string,
  line: number,
  character: number,
  newName: string,
): Promise<PluginRenameResult | null> {
  const argv = contrib.command!;
  const bin = resolvePluginBinary(installPath, argv[0]);
  if (!bin) return null;
  const r = await runPluginBinary({
    bin,
    cwd: installPath,
    argv: [...argv.slice(1), absPath, String(line), String(character), newName],
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
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const edits: Record<string, RenameTextEdit[]> = {};
  for (const [filePath, rawEdits] of Object.entries(parsed)) {
    if (!Array.isArray(rawEdits)) continue;
    const norm = rawEdits.map(normalizeEdit).filter((e): e is RenameTextEdit => e !== null);
    if (norm.length > 0) edits[filePath] = norm;
  }
  if (Object.keys(edits).length === 0) return null;
  return { edits, source: `plugin:${manifest.id}` };
}

export async function runRenameForFile(
  absPath: string,
  content: string,
  line: number,
  character: number,
  newName: string,
): Promise<PluginRenameResult | null> {
  const plugins = listPlugins().filter((p) => p.enabled);
  if (plugins.length === 0) return null;
  for (const p of plugins) {
    for (const c of p.manifest.contributes?.rename ?? []) {
      if (!contributionAppliesTo(c, absPath)) continue;
      const r = await runOne(
        p.manifest,
        p.installPath,
        c,
        absPath,
        content,
        line,
        character,
        newName,
      );
      if (r) return r;
    }
  }
  return null;
}
