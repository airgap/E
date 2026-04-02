/**
 * Hooks System
 *
 * Loads .e/hooks.json and executes lifecycle hooks (preToolCall, postToolCall,
 * onStart, onEnd, onError). Used by CLI, stream routes, and webhook executor.
 *
 * Hook config file locations (first found wins):
 *   1. <workspace>/.e/hooks.json
 *   2. ~/.e/hooks.json
 *
 * Hook types:
 *   - preToolCall:  Runs before tool execution. Non-zero exit blocks the tool.
 *   - postToolCall: Runs after tool execution.
 *   - onStart:      Runs when a session starts.
 *   - onEnd:        Runs when a session ends.
 *   - onError:      Runs when an error occurs.
 *
 * Each hook entry:
 *   { match?: string, command: string }
 *   - match: Optional tool name filter (substring match against TOOL_NAME env var)
 *   - command: Shell command to execute. Receives context via environment variables.
 *
 * Environment variables available to hooks:
 *   TOOL_NAME, TOOL_ARGS, TOOL_RESULT, SESSION_ID, MODEL,
 *   ERROR_MESSAGE, WORKSPACE_PATH
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

export interface Hook {
  match?: string;
  command: string;
}

export interface HooksConfig {
  preToolCall?: Hook[];
  postToolCall?: Hook[];
  onStart?: Hook[];
  onEnd?: Hook[];
  onError?: Hook[];
}

/**
 * Load hooks configuration from workspace or global config.
 */
export function loadHooks(workspacePath?: string): HooksConfig {
  const candidates: string[] = [];
  if (workspacePath) {
    candidates.push(join(workspacePath, '.e', 'hooks.json'));
  }
  candidates.push(join(homedir(), '.e', 'hooks.json'));

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, 'utf-8'));
      } catch {}
    }
  }
  return {};
}

/**
 * Run a set of hooks with the given environment variables.
 * Returns true if all hooks succeeded, false if any hook exited non-zero.
 *
 * For preToolCall hooks, a false return means the tool should be blocked.
 */
export function runHooks(hooks: Hook[] | undefined, env: Record<string, string>): boolean {
  if (!hooks?.length) return true;
  for (const hook of hooks) {
    if (hook.match && !env.TOOL_NAME?.includes(hook.match)) continue;
    try {
      execSync(hook.command, {
        env: { ...process.env, ...env },
        stdio: 'pipe', // Don't inherit stdio in server context
        timeout: 30_000,
      });
    } catch {
      return false; // Non-zero exit blocks
    }
  }
  return true;
}
