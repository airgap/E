#!/usr/bin/env bun
/**
 * claude-pretooluse-hook.ts
 *
 * PreToolUse hook script for E. Claude Code spawns this on every Edit/Write/
 * MultiEdit (matchers defined in the settings.json E writes per session); it
 * blocks until E's local server returns a permissionDecision, which lets the
 * agent ACTUALLY pause for the user to approve/reject the edit before the
 * file is mutated. Without a blocking PreToolUse hook, the CLI runs the tool
 * concurrently with E's UI dialog and the approval is purely cosmetic.
 *
 * Protocol (Claude Code hook contract):
 *   - stdin: JSON  { session_id, transcript_path, tool_name, tool_input, ... }
 *   - stdout: JSON { hookSpecificOutput: { hookEventName, permissionDecision,
 *                    permissionDecisionReason? } }
 *   - exit 0 always; permissionDecision='deny' is how we block the tool.
 *
 * Environment:
 *   - E_HOOK_PORT — port of E's local server. If absent we allow (so this
 *     script never breaks a session run outside of E).
 *   - E_HOOK_TOKEN — opaque shared secret added as Authorization: Bearer to
 *     defeat any other process on localhost from impersonating E's hook.
 */

function allow(reason = 'no E server reachable; default-allow') {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

const port = process.env.E_HOOK_PORT;
const token = process.env.E_HOOK_TOKEN ?? '';
if (!port) allow('E_HOOK_PORT not set');

let raw: string;
try {
  raw = await Bun.file('/dev/stdin').text();
} catch {
  allow('failed to read hook input from stdin');
}

let payload: unknown;
try {
  payload = JSON.parse(raw!);
} catch {
  allow('hook input was not valid JSON');
}

try {
  const res = await fetch(`http://127.0.0.1:${port}/api/hooks/pretooluse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    // Long-poll: the server holds the request until the user decides. No
    // explicit timeout — if the user never answers, the hook blocks. The
    // server is responsible for emitting a timeout decision if it wants one.
  });
  if (!res.ok) allow(`E server returned ${res.status}; default-allow`);
  const decision = await res.json();
  // Expected shape: { hookSpecificOutput: {...} }. Pass through as-is so any
  // server-side message / reason flows back to Claude Code unchanged.
  console.log(JSON.stringify(decision));
  process.exit(0);
} catch (err) {
  allow(`E server unreachable: ${err}`);
}
