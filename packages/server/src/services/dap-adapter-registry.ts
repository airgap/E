/**
 * DAP Adapter Registry — metadata about supported Debug Adapter Protocol adapters.
 *
 * DAP adapters are external processes that speak DAP over stdio (length-prefixed JSON,
 * same framing as LSP). The registry tracks how to spawn each adapter and which
 * languages it handles. For v1, only Python (`debugpy`) is bundled; Node support
 * ships as installable because `vscode-js-debug` has a non-trivial install dance.
 */

import { existsSync } from 'fs';
import { join, resolve, sep } from 'path';
import { homedir } from 'os';
import { listPlugins } from './plugins';

/** Install hints shown in the UI when an adapter is unavailable. */
export interface AdapterInstallHint {
  /** Platform-agnostic human-readable instruction, e.g. "pip install debugpy". */
  instructions: string;
  /** Optional binary-download URL — populated when we can auto-install. */
  downloadUrl?: string;
}

export interface AdapterInfo {
  /** Unique id, e.g. "python" or "node". */
  id: string;
  /** Human label for the UI. */
  label: string;
  /** Languages this adapter can debug — maps `tab.language` values. */
  languages: string[];
  /** Shell command used to start the adapter. */
  command: string;
  /** Static args passed to the command (before any per-session args). */
  args: string[];
  /** Optional text shown when the adapter is missing from the system. */
  installHint?: AdapterInstallHint;
}

const HOME_BIN = join(homedir(), '.local', 'bin');

/**
 * Shell out to `command -v` to probe whether a binary is on PATH.
 * Synchronous Bun spawn so the check is cheap and blocking is fine for a one-shot boot probe.
 */
function commandExists(cmd: string): boolean {
  try {
    // Allow an absolute path to win immediately.
    if (cmd.startsWith('/')) return existsSync(cmd);
    const proc = Bun.spawnSync(['sh', '-c', `command -v ${cmd}`]);
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/** Registered adapters, defined statically so the set is predictable. */
const REGISTRY: AdapterInfo[] = [
  {
    id: 'python',
    label: 'Python (debugpy)',
    languages: ['python'],
    // debugpy.adapter speaks DAP on stdio when invoked this way.
    command: 'python3',
    args: ['-m', 'debugpy.adapter'],
    installHint: {
      instructions: 'Install debugpy: `pip install debugpy` or `python3 -m pip install debugpy`',
    },
  },
];

/**
 * Plugin-contributed adapters (LYK-1044). Resolved fresh on every call
 * so toggling a plugin's enabled flag immediately updates the picker.
 * Relative command paths are pinned inside the plugin install dir;
 * absolute commands are allowed (system-installed adapters) but only
 * when they resolve on the system PATH.
 */
function pluginAdapters(): AdapterInfo[] {
  const out: AdapterInfo[] = [];
  for (const p of listPlugins().filter((p) => p.enabled)) {
    for (const d of p.manifest.contributes?.debuggers ?? []) {
      let command = d.command;
      if (!command.startsWith('/')) {
        // Relative — pin inside the install dir.
        const r = resolve(p.installPath, command);
        const base = resolve(p.installPath);
        if (!r.startsWith(base + sep) && r !== base) continue;
        if (!existsSync(r)) continue;
        command = r;
      }
      out.push({
        id: d.id,
        label: d.label,
        languages: d.languages,
        command,
        args: d.args ?? [],
        ...(d.installHint ? { installHint: { instructions: d.installHint } } : {}),
      });
    }
  }
  return out;
}

export function listAdapters(): Array<AdapterInfo & { available: boolean }> {
  return [...REGISTRY, ...pluginAdapters()].map((a) => ({
    ...a,
    available: probeAvailability(a),
  }));
}

export function getAdapter(id: string): AdapterInfo | null {
  return REGISTRY.find((a) => a.id === id) ?? pluginAdapters().find((a) => a.id === id) ?? null;
}

/**
 * Cheap availability probe — checks the primary command is runnable.
 * Deeper probes (e.g. `python3 -c "import debugpy"`) are deferred to actual launch time;
 * they'd slow down the adapter list and the failure path is the same.
 */
function probeAvailability(a: AdapterInfo): boolean {
  if (!commandExists(a.command)) return false;
  // For python, also check the package is importable so users don't see a happy list
  // and then a cryptic ModuleNotFoundError on first debug.
  if (a.id === 'python') {
    try {
      const proc = Bun.spawnSync([a.command, '-c', 'import debugpy']);
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }
  return true;
}

// Export HOME_BIN so the manager can prepend it to PATH if needed.
export { HOME_BIN };
