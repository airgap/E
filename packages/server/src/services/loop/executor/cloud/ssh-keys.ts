// ---------------------------------------------------------------------------
// Ephemeral SSH Key Manager
// ---------------------------------------------------------------------------
// Generates per-instance SSH key pairs. Private keys are held exclusively
// in coordinator memory and never written to disk or persisted.
// ---------------------------------------------------------------------------

import type { EphemeralSSHKeyPair } from '@e/shared';
import { randomBytes, createHash, generateKeyPairSync } from 'crypto';

/**
 * In-memory store for ephemeral SSH key pairs.
 * Private keys are NEVER persisted to disk — they exist only in process memory.
 *
 * Acceptance Criterion 4: Ephemeral SSH key pair generated per instance;
 * private key held only in coordinator memory.
 */
export class SSHKeyManager {
  /** Map of instance ID → SSH key pair (held in memory only). */
  private keys = new Map<string, EphemeralSSHKeyPair>();

  /**
   * Generate a new ephemeral SSH key pair for a cloud instance.
   * Uses Ed25519 for modern, fast, secure keys.
   *
   * @param instanceId — the instance this key is bound to
   * @returns The generated key pair
   */
  generateKeyPair(instanceId: string): EphemeralSSHKeyPair {
    // Generate Ed25519 key pair
    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });

    // Convert PEM public key to SSH format for authorized_keys
    const sshPublicKey = pemToSshPublicKey(publicKey, `e-golem-${instanceId}`);

    // Generate fingerprint
    const fingerprint = createHash('sha256')
      .update(publicKey)
      .digest('hex')
      .match(/.{2}/g)!
      .join(':');

    const keyPair: EphemeralSSHKeyPair = {
      publicKey: sshPublicKey,
      privateKey,
      fingerprint: `SHA256:${fingerprint}`,
      generatedAt: new Date().toISOString(),
      instanceId,
    };

    this.keys.set(instanceId, keyPair);
    return keyPair;
  }

  /**
   * Get the SSH key pair for an instance.
   * Returns null if no key exists (already cleaned up or never generated).
   */
  getKeyPair(instanceId: string): EphemeralSSHKeyPair | null {
    return this.keys.get(instanceId) ?? null;
  }

  /**
   * Get just the private key for SSH connections to an instance.
   * Returns null if no key exists.
   */
  getPrivateKey(instanceId: string): string | null {
    return this.keys.get(instanceId)?.privateKey ?? null;
  }

  /**
   * Destroy the key pair for an instance.
   * Called during instance teardown to ensure private keys don't linger.
   */
  destroyKeyPair(instanceId: string): boolean {
    const key = this.keys.get(instanceId);
    if (key) {
      // Overwrite private key in memory before deletion (best-effort scrub)
      const scrubbed = randomBytes(key.privateKey.length).toString('base64');
      (key as { privateKey: string }).privateKey = scrubbed;
      this.keys.delete(instanceId);
      return true;
    }
    return false;
  }

  /**
   * Destroy all stored key pairs.
   * Called during coordinator shutdown.
   */
  destroyAll(): void {
    for (const instanceId of this.keys.keys()) {
      this.destroyKeyPair(instanceId);
    }
  }

  /**
   * Get the count of stored key pairs.
   */
  get size(): number {
    return this.keys.size;
  }

  /**
   * List instance IDs that have stored key pairs.
   */
  listInstances(): string[] {
    return Array.from(this.keys.keys());
  }
}

/**
 * Convert a PEM-encoded public key to SSH authorized_keys format.
 * This is a simplified conversion for Ed25519 keys.
 */
function pemToSshPublicKey(pemPublicKey: string, comment: string): string {
  // Extract the base64-encoded key data from PEM
  const lines = pemPublicKey
    .split('\n')
    .filter((line) => !line.startsWith('-----') && line.trim().length > 0);
  const derBase64 = lines.join('');
  const derBuffer = Buffer.from(derBase64, 'base64');

  // For Ed25519, the DER-encoded SPKI has a fixed prefix before the 32-byte key.
  // The SSH format is: "ssh-ed25519" + base64(length-prefixed-type + length-prefixed-key)
  const keyType = 'ssh-ed25519';
  const keyTypeBytes = Buffer.from(keyType, 'ascii');

  // Extract the raw 32-byte Ed25519 public key from the DER structure.
  // Ed25519 SPKI DER: 30 2a 30 05 06 03 2b 65 70 03 21 00 <32 bytes>
  // The last 32 bytes are the raw key.
  const rawKey = derBuffer.subarray(derBuffer.length - 32);

  // Build the SSH wire format: uint32(len) + type + uint32(len) + key
  const typeLen = Buffer.alloc(4);
  typeLen.writeUInt32BE(keyTypeBytes.length);
  const keyLen = Buffer.alloc(4);
  keyLen.writeUInt32BE(rawKey.length);

  const sshBlob = Buffer.concat([
    new Uint8Array(typeLen),
    new Uint8Array(keyTypeBytes),
    new Uint8Array(keyLen),
    new Uint8Array(rawKey),
  ]);
  return `${keyType} ${sshBlob.toString('base64')} ${comment}`;
}

/** Singleton SSH key manager. */
export const sshKeyManager = new SSHKeyManager();
