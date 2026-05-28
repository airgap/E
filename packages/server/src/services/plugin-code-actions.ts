/**
 * plugin-code-actions.ts — command-source code action providers (LYK-1047).
 *
 * Spawn shape: `[…argv, absPath, startLine, startChar, endLine, endChar]`
 * with the file content piped to stdin. Stdout is JSON:
 *   Array<{ title, kind?, edit?: TextEdit }>
 *
 * Aggregates across plugins — code action menus naturally combine
 * sources.
 */
import { listPlugins } from './plugins';
import type { CodeActionsContribution, PluginManifest } from '@e/shared';
import {
  contributionAppliesTo,
  resolvePluginBinary,
  runPluginBinary,
} from './plugin-command-runner';

const STDOUT_CAP = 512 * 1024;
const TIMEOUT_MS = 3000;

export interface PluginCodeActionEdit {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  newText: string;
}

export interface PluginCodeAction {
  title: string;
  kind?: string;
  edit?: PluginCodeActionEdit;
  /**
   * Multi-file edit (LYK-1052 refactoring). Keys are absolute file
   * paths, values are ordered TextEdits to apply to that file. The
   * client treats this the same way it treats rename's workspace edit
   * map — sorting edits reverse-position per file before applying.
   */
  workspaceEdit?: Record<string, PluginCodeActionEdit[]>;
}

export interface PluginCodeActionsResult {
  actions: PluginCodeAction[];
  source: string;
}

function normalizeEdit(raw: unknown): PluginCodeActionEdit | null {
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

function normalizeWorkspaceEdit(raw: unknown): Record<string, PluginCodeActionEdit[]> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, PluginCodeActionEdit[]> = {};
  for (const [filePath, edits] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(edits)) continue;
    const norm = edits.map(normalizeEdit).filter((e): e is PluginCodeActionEdit => e !== null);
    if (norm.length > 0) out[filePath] = norm;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeAction(raw: unknown): PluginCodeAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.title !== 'string' || !r.title) return null;
  const edit = r.edit !== undefined ? normalizeEdit(r.edit) : undefined;
  const workspaceEdit = normalizeWorkspaceEdit(r.workspaceEdit);
  return {
    title: r.title,
    kind: typeof r.kind === 'string' ? r.kind : undefined,
    edit: edit ?? undefined,
    workspaceEdit,
  };
}

async function runOne(
  manifest: PluginManifest,
  installPath: string,
  contrib: CodeActionsContribution,
  absPath: string,
  content: string,
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number,
): Promise<PluginCodeActionsResult | null> {
  const argv = contrib.command!;
  const bin = resolvePluginBinary(installPath, argv[0]);
  if (!bin) return null;
  const r = await runPluginBinary({
    bin,
    cwd: installPath,
    argv: [
      ...argv.slice(1),
      absPath,
      String(startLine),
      String(startChar),
      String(endLine),
      String(endChar),
    ],
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
  const actions = parsed.map(normalizeAction).filter((a): a is PluginCodeAction => a !== null);
  if (actions.length === 0) return null;
  return { actions, source: `plugin:${manifest.id}` };
}

export async function runCodeActionsForRange(
  absPath: string,
  content: string,
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number,
): Promise<PluginCodeActionsResult[]> {
  const plugins = listPlugins().filter((p) => p.enabled);
  if (plugins.length === 0) return [];
  const tasks: Array<Promise<PluginCodeActionsResult | null>> = [];
  for (const p of plugins) {
    for (const c of p.manifest.contributes?.codeActions ?? []) {
      if (!contributionAppliesTo(c, absPath)) continue;
      tasks.push(
        runOne(
          p.manifest,
          p.installPath,
          c,
          absPath,
          content,
          startLine,
          startChar,
          endLine,
          endChar,
        ),
      );
    }
  }
  if (tasks.length === 0) return [];
  const out = await Promise.all(tasks);
  return out.filter((r): r is PluginCodeActionsResult => r !== null);
}
