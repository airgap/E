/**
 * Generate a UUID that works in non-secure contexts (HTTP on non-localhost).
 * crypto.randomUUID() requires a secure context (HTTPS or localhost),
 * so we fall back to a Math.random-based ID when unavailable.
 */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // Secure context required — fall through
    }
  }
  // Fallback: random hex string matching UUID-like format
  const h = () => Math.random().toString(16).slice(2, 10);
  return `${h()}${h()}-${h().slice(0, 4)}-4${h().slice(1, 4)}-${((8 + Math.random() * 4) | 0).toString(16)}${h().slice(1, 4)}-${h()}${h().slice(0, 4)}`;
}
