/**
 * hook-config.ts — generates the temporary settings.json that wires Claude
 * Code's PreToolUse hook to E's hook script for inline edit approval.
 *
 * The settings file is regenerated per session so each session sees the
 * current server port + auth token. We DO NOT write into `~/.claude/` (which
 * would be sticky and affect non-E claude usage); we use a temp file and
 * point `claude --settings` at it.
 */
import { mkdtempSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve as resolvePath } from 'path';

let hookScriptPathCached: string | null = null;
/**
 * Locate the PreToolUse hook script on disk. Tried in order:
 *   1. $E_HOOK_SCRIPT_PATH (escape hatch, e.g. for packaged builds)
 *   2. `<repo>/scripts/claude-pretooluse-hook.ts` relative to a few cwd guesses
 *   3. Same path under the directory of this source file (works in dev)
 * Returns null if nothing exists; caller skips hook installation in that case.
 */
function locateHookScript(): string | null {
  if (hookScriptPathCached && existsSync(hookScriptPathCached)) return hookScriptPathCached;
  const env = process.env.E_HOOK_SCRIPT_PATH;
  const candidates: string[] = [];
  if (env) candidates.push(env);
  candidates.push(resolvePath(process.cwd(), 'scripts', 'claude-pretooluse-hook.ts'));
  candidates.push(resolvePath(process.cwd(), '..', '..', 'scripts', 'claude-pretooluse-hook.ts'));
  candidates.push(
    resolvePath(__dirname, '..', '..', '..', '..', 'scripts', 'claude-pretooluse-hook.ts'),
  );
  for (const p of candidates) {
    if (existsSync(p)) {
      hookScriptPathCached = p;
      return p;
    }
  }
  return null;
}

export interface HookConfig {
  /** Path to the settings.json — pass to claude via --settings <path>. */
  settingsPath: string;
  /** Env to merge into the spawned CLI's environment. */
  env: Record<string, string>;
}

/**
 * Build the per-session hook settings file + env additions. Returns null if
 * the hook script can't be found (caller proceeds without inline-edit gating
 * rather than failing the session).
 */
export function generateHookConfig(opts: { port: number; token: string }): HookConfig | null {
  const scriptPath = locateHookScript();
  if (!scriptPath) {
    console.warn(
      '[hook-config] PreToolUse hook script not found; inline edit approval disabled for this session.',
    );
    return null;
  }

  // The CLI invokes the hook as a command — use `bun <script>` so we don't
  // rely on the script's shebang surviving execv (e.g. on macOS the script
  // may live on a different mount with noexec).
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [
            {
              type: 'command',
              command: `bun ${JSON.stringify(scriptPath).slice(1, -1)}`,
            },
          ],
        },
      ],
    },
  };

  const dir = mkdtempSync(join(tmpdir(), 'e-hook-'));
  const settingsPath = join(dir, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  return {
    settingsPath,
    env: {
      E_HOOK_PORT: String(opts.port),
      E_HOOK_TOKEN: opts.token,
    },
  };
}
