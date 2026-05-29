/**
 * Plugin registry index format.
 *
 * A registry is a single JSON document hosted at any URL the user / admin
 * configures (Settings → Plugins → "Registry URL"). The document is a
 * flat list of {RegistryEntry}; E fetches it, caches with a TTL, and
 * surfaces entries in the Plugins "Browse" tab.
 *
 * Format:
 *
 *   {
 *     "$schema": "https://script.dev/e-plugin-registry/v1",
 *     "entries": [
 *       {
 *         "id": "example-plugin",
 *         "version": "1.2.3",
 *         "displayName": "Example",
 *         "description": "...",
 *         "author": "Some Dev",
 *         "homepage": "https://github.com/.../tree/main",
 *         "license": "MIT",
 *         "zipUrl": "https://.../example-plugin-1.2.3.zip",
 *         "sha256": "abc123…",  // optional; when present the server verifies before install
 *         "tags": ["lsp", "side-pane"]
 *       }
 *     ]
 *   }
 *
 * Versioning: bump `$schema` if the entry shape changes incompatibly so
 * old clients can detect + warn instead of mis-parsing.
 */

export interface PluginRegistryEntry {
  id: string;
  version: string;
  displayName: string;
  description?: string;
  author?: string;
  homepage?: string;
  license?: string;
  /** Absolute https URL to the plugin .zip. */
  zipUrl: string;
  /**
   * Hex sha256 of the zip bytes. When present, the server verifies the
   * downloaded bytes before extraction. Optional but strongly encouraged
   * for any registry the user doesn't fully trust.
   */
  sha256?: string;
  /** Free-form discovery tags ("lsp", "side-pane", "diagnostics", …). */
  tags?: string[];
  /**
   * Marks this entry as a pre-release (LYK-1060). The Update flow skips
   * pre-release entries unless the user has opted in for that plugin id.
   * Browse surfaces a "Pre-release" badge on the row.
   */
  prerelease?: boolean;
}

export interface PluginRegistry {
  $schema?: string;
  entries: PluginRegistryEntry[];
}
