/**
 * hook-token.ts — opaque shared secret the PreToolUse hook script must send
 * as `Authorization: Bearer <token>` when calling /api/hooks/pretooluse.
 *
 * Generated once at startup. The manager passes the value to spawned Claude
 * Code instances via the E_HOOK_TOKEN env var; only the hook script
 * launched by that CLI knows it, so any other localhost process trying to
 * impersonate the hook is rejected.
 *
 * Lives in its own module so both hooks.ts (route) and manager.ts (spawner)
 * can read it without creating an import cycle.
 */
export const HOOK_TOKEN = (() => {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
})();
