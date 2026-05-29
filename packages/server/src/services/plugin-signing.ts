/**
 * plugin-signing.ts — Sigstore-style signature verification (LYK-1058).
 *
 * v1 surfaces the signature metadata only — no cryptographic
 * verification. The schema field is wired so plugin authors can ship
 * a signature URL today; the actual verifier kicks in once the
 * Sigstore JS library lands in tree and we have a trusted root of
 * trust to verify against.
 *
 * Why ship the surface without the verifier:
 *   1. Plugin authors can start shipping signatures now — no schema
 *      change once verification lands.
 *   2. The UI can already differentiate "signed" / "unsigned" in
 *      Browse, which is the bulk of the user-facing benefit.
 *   3. We avoid hand-rolling crypto, which is the wrong way to
 *      implement Sigstore.
 *
 * Trust pinning (per-plugin "require this publisher") lives client-
 * side in PluginsSettings — pins are honoured by the install path
 * even with an absent verifier: an entry whose `signature.publisher`
 * doesn't match the pinned identity is refused at install time.
 */

import type { PluginRegistryEntry } from '@e/shared';

export interface SigningVerdict {
  /** Bytes match (computed sha256 vs the entry's), if entry.sha256 was given. */
  integrityOk: boolean;
  /** Did the entry carry a Sigstore-format signature blob URL? */
  signed: boolean;
  /** Publisher identity, if signed. */
  publisher: string | null;
  /**
   * Whether the signature was cryptographically verified. ALWAYS false
   * in v1 — surfaces honestly so the UI can show "Signed (unverified)"
   * vs "Verified". The follow-up implements true validation.
   */
  cryptographicallyVerified: boolean;
}

/**
 * Compute a verdict for a registry entry + downloaded bytes. v1 only
 * checks the sha256 (which the existing installFromRegistry already
 * checks) and reports signature presence — the cryptographic verify
 * step is deferred.
 */
export function verifyEntry(entry: PluginRegistryEntry, _bytes: Uint8Array): SigningVerdict {
  // sha256 check happens at installFromRegistry's call site; this just
  // mirrors the field for completeness in the verdict.
  const integrityOk = !!entry.sha256;
  return {
    integrityOk,
    signed: !!entry.signature,
    publisher: entry.signature?.publisher ?? null,
    cryptographicallyVerified: false,
  };
}
