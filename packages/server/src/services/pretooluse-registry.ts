/**
 * pretooluse-registry.ts — in-process registry for held PreToolUse hook
 * requests.
 *
 * The hook script (scripts/claude-pretooluse-hook.ts) POSTs to
 * /api/hooks/pretooluse with the hook payload and BLOCKS on the response.
 * That POST handler `await register(...)`s a Promise here; the resolve
 * function is parked in `pending` keyed by the synthetic request id. When the
 * user clicks Allow/Deny in the UI, the client POSTs to
 * /api/hooks/pretooluse-respond and that calls `resolveRequest(id, decision)`
 * which fulfils the Promise — the original handler then responds to the hook
 * script, which finally lets Claude Code unblock.
 *
 * Single source of truth so a future SSE-resume or websocket can plug into
 * the same approval mechanism without each route reinventing the bookkeeping.
 */

export interface PreToolUseHookInput {
  session_id?: string;
  transcript_path?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface PreToolUseHookOutput {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'allow' | 'deny';
    permissionDecisionReason?: string;
  };
}

export interface PendingPreToolUse {
  /** Synthetic id we hand to the UI to refer to this request. */
  requestId: string;
  /** Claude Code session id (from hookInput.session_id). */
  claudeSessionId: string | null;
  /** Tool name + raw inputs (file_path/old_string/new_string/...) for the UI. */
  toolName: string;
  toolInput: Record<string, unknown>;
  /** When the hook script first arrived (for stale-cleanup later). */
  createdAt: number;
  /** Resolved when the user (or server policy) decides. */
  resolve: (output: PreToolUseHookOutput) => void;
}

const pending = new Map<string, PendingPreToolUse>();

/**
 * Counter for synthetic request ids — Claude hook input doesn't carry a
 * tool_use_id, so we mint our own per-pending entry.
 */
let seq = 0;
function nextId(): string {
  seq += 1;
  return `ptu_${Date.now().toString(36)}_${seq.toString(36)}`;
}

/**
 * Register a new pending PreToolUse request. Returns the registered entry
 * (caller can read `requestId` to forward to the UI) and a Promise that
 * resolves with the hook output decision once the user (or a policy) responds.
 */
export function register(input: PreToolUseHookInput): {
  entry: PendingPreToolUse;
  decision: Promise<PreToolUseHookOutput>;
} {
  const requestId = nextId();
  let resolveFn!: (output: PreToolUseHookOutput) => void;
  const decision = new Promise<PreToolUseHookOutput>((res) => {
    resolveFn = res;
  });
  const entry: PendingPreToolUse = {
    requestId,
    claudeSessionId: typeof input.session_id === 'string' ? input.session_id : null,
    toolName: typeof input.tool_name === 'string' ? input.tool_name : 'unknown',
    toolInput: (input.tool_input as Record<string, unknown>) ?? {},
    createdAt: Date.now(),
    resolve: resolveFn,
  };
  pending.set(requestId, entry);
  return { entry, decision };
}

/**
 * Resolve a pending request with the given decision. Returns true if the id
 * was known, false otherwise (e.g. a stale UI click after the hook timed out).
 */
export function resolveRequest(
  requestId: string,
  decision: 'allow' | 'deny',
  reason?: string,
): boolean {
  const entry = pending.get(requestId);
  if (!entry) return false;
  pending.delete(requestId);
  entry.resolve({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      ...(reason ? { permissionDecisionReason: reason } : {}),
    },
  });
  return true;
}

/** For inspection / debugging — never mutate the returned array. */
export function listPending(): PendingPreToolUse[] {
  return [...pending.values()];
}

/**
 * Sweep entries older than `maxAgeMs` and auto-resolve them as `allow` (so a
 * crashed UI never leaves a Claude session hanging forever). Caller decides
 * the policy via the maxAgeMs argument.
 */
export function reapStale(maxAgeMs: number): number {
  const cutoff = Date.now() - maxAgeMs;
  let reaped = 0;
  for (const [id, entry] of pending) {
    if (entry.createdAt < cutoff) {
      pending.delete(id);
      entry.resolve({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: `auto-allowed after ${maxAgeMs}ms timeout (no UI response)`,
        },
      });
      reaped += 1;
    }
  }
  return reaped;
}
