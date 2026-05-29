/**
 * plugin-tests.ts — command-source test discovery + runner (LYK-1054 / LYK-1055).
 *
 * Discovery:
 *   spawn `[…argv, workspaceRoot]` (no stdin) → JSON test tree.
 *   Aggregates across plugins (multiple frameworks coexist).
 *
 * Run:
 *   spawn `[…argv, workspaceRoot, testId1, testId2, …]` → newline-delimited
 *   JSON events. v1 buffers + returns at completion; streaming SSE plumbs
 *   in once LYK-1014 Test Explorer arrives.
 */
import { listPlugins } from './plugins';
import type { TestDiscoveryContribution, TestRunnerContribution, PluginManifest } from '@e/shared';
import { resolvePluginBinary, runPluginBinary } from './plugin-command-runner';

const STDOUT_CAP = 8 * 1024 * 1024;
const DISCOVERY_TIMEOUT_MS = 15000;
const RUN_TIMEOUT_MS = 5 * 60 * 1000;

export interface PluginTestNode {
  id: string;
  label: string;
  type: 'suite' | 'test';
  file?: string;
  line?: number;
  children?: PluginTestNode[];
}

export interface PluginTestDiscoveryResult {
  tree: PluginTestNode[];
  source: string;
}

function normalizeNode(raw: unknown): PluginTestNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (typeof r.label !== 'string') return null;
  if (r.type !== 'suite' && r.type !== 'test') return null;
  let children: PluginTestNode[] | undefined;
  if (Array.isArray(r.children)) {
    children = r.children.map(normalizeNode).filter((n): n is PluginTestNode => n !== null);
    if (children.length === 0) children = undefined;
  }
  return {
    id: r.id,
    label: r.label,
    type: r.type,
    file: typeof r.file === 'string' ? r.file : undefined,
    line: typeof r.line === 'number' ? r.line : undefined,
    children,
  };
}

async function discoverFromOne(
  manifest: PluginManifest,
  installPath: string,
  contrib: TestDiscoveryContribution,
  workspaceRoot: string,
): Promise<PluginTestDiscoveryResult | null> {
  if (contrib.source !== 'command' || !contrib.command?.length) return null;
  const bin = resolvePluginBinary(installPath, contrib.command[0]);
  if (!bin) return null;
  const r = await runPluginBinary({
    bin,
    cwd: installPath,
    argv: [...contrib.command.slice(1), workspaceRoot],
    timeoutMs: DISCOVERY_TIMEOUT_MS,
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
  const tree = parsed.map(normalizeNode).filter((n): n is PluginTestNode => n !== null);
  if (tree.length === 0) return null;
  return { tree, source: `plugin:${manifest.id}` };
}

export async function runTestDiscovery(
  workspaceRoot: string,
): Promise<PluginTestDiscoveryResult[]> {
  const plugins = listPlugins().filter((p) => p.enabled);
  if (plugins.length === 0) return [];
  const tasks: Array<Promise<PluginTestDiscoveryResult | null>> = [];
  for (const p of plugins) {
    for (const c of p.manifest.contributes?.testDiscovery ?? []) {
      tasks.push(discoverFromOne(p.manifest, p.installPath, c, workspaceRoot));
    }
  }
  if (tasks.length === 0) return [];
  const out = await Promise.all(tasks);
  return out.filter((r): r is PluginTestDiscoveryResult => r !== null);
}

// ── Runner ──

export type PluginTestEventType = 'start' | 'pass' | 'fail' | 'skip' | 'output' | 'done';

export interface PluginTestEvent {
  type: PluginTestEventType;
  testId?: string;
  message?: string;
  duration?: number;
}

export interface PluginTestRunResult {
  events: PluginTestEvent[];
  source: string;
}

function parseEventLine(line: string): PluginTestEvent | null {
  if (!line.trim()) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = r.type;
  if (
    type !== 'start' &&
    type !== 'pass' &&
    type !== 'fail' &&
    type !== 'skip' &&
    type !== 'output' &&
    type !== 'done'
  ) {
    return null;
  }
  return {
    type,
    testId: typeof r.testId === 'string' ? r.testId : undefined,
    message: typeof r.message === 'string' ? r.message : undefined,
    duration: typeof r.duration === 'number' ? r.duration : undefined,
  };
}

/** Live event callback (LYK-1055 streaming): fired per event as it arrives. */
export type PluginTestEventSink = (source: string, event: PluginTestEvent) => void;

async function runFromOne(
  manifest: PluginManifest,
  installPath: string,
  contrib: TestRunnerContribution,
  workspaceRoot: string,
  testIds: string[],
  onEvent?: PluginTestEventSink,
): Promise<PluginTestRunResult | null> {
  if (contrib.source !== 'command' || !contrib.command?.length) return null;
  const bin = resolvePluginBinary(installPath, contrib.command[0]);
  if (!bin) return null;
  const source = `plugin:${manifest.id}`;
  const events: PluginTestEvent[] = [];
  const r = await runPluginBinary({
    bin,
    cwd: installPath,
    argv: [...contrib.command.slice(1), workspaceRoot, ...testIds],
    timeoutMs: RUN_TIMEOUT_MS,
    stdoutCap: STDOUT_CAP,
    // Stream: parse + forward each event line as it arrives. We still
    // accumulate into `events` for the buffered return value, so the
    // non-streaming caller is unaffected.
    onLine: onEvent
      ? (line) => {
          const ev = parseEventLine(line);
          if (ev) {
            events.push(ev);
            onEvent(source, ev);
          }
        }
      : undefined,
  });
  if (!r) return null;
  // When not streaming, parse the buffered stdout now.
  if (!onEvent) {
    for (const line of r.stdout.split('\n')) {
      const ev = parseEventLine(line);
      if (ev) events.push(ev);
    }
  }
  if (events.length === 0) return null;
  return { events, source };
}

export async function runTestRunner(
  workspaceRoot: string,
  testIds: string[],
  onEvent?: PluginTestEventSink,
): Promise<PluginTestRunResult[]> {
  const plugins = listPlugins().filter((p) => p.enabled);
  if (plugins.length === 0) return [];
  const tasks: Array<Promise<PluginTestRunResult | null>> = [];
  for (const p of plugins) {
    for (const c of p.manifest.contributes?.testRunner ?? []) {
      tasks.push(runFromOne(p.manifest, p.installPath, c, workspaceRoot, testIds, onEvent));
    }
  }
  if (tasks.length === 0) return [];
  const out = await Promise.all(tasks);
  return out.filter((r): r is PluginTestRunResult => r !== null);
}
