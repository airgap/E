/**
 * plugin-registry.ts — fetch + cache the plugin registry index, and
 * install a plugin from a registry entry by downloading its zip.
 *
 * Registry URL is configurable per-server via the E_PLUGIN_REGISTRY env
 * var, OR — for the typical user flow — settable from the client via
 * setRegistryUrl(). Stored on disk so a restart preserves it.
 *
 * Security:
 *   - Only `https:` URLs are accepted for both the index and zipUrl
 *     entries. Plain http and file:// are refused before any fetch.
 *   - When a registry entry carries a sha256, the downloaded zip is
 *     hashed and compared before being handed to installFromZip.
 *   - installFromZip itself runs the same path-traversal/symlink
 *     defences we ship for direct upload installs.
 *
 * Caching:
 *   - The fetched index is cached in-memory and written to
 *     ~/.e/plugins/.registry-cache.json with the fetch timestamp.
 *   - Default TTL: 1 hour. Callers asking for the index inside the TTL
 *     get the cached value; outside the TTL we re-fetch.
 *   - A `force` flag bypasses the cache for an explicit "Refresh" click
 *     in the UI.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { installFromZip, type InstallResult } from './plugins';
import type { PluginRegistry, PluginRegistryEntry } from '@e/shared';

// PLUGINS_DIR is mutable so tests can redirect storage. Bun's homedir()
// doesn't respect $HOME, so HOME-swap-based isolation silently writes to
// the real ~/.e/plugins. The explicit override is the real seam — and we
// also derive cache/config from a getter so they pick up the new base.
let PLUGINS_DIR = join(homedir(), '.e', 'plugins');
const cacheFile = () => join(PLUGINS_DIR, '.registry-cache.json');
const configFile = () => join(PLUGINS_DIR, '.registry-config.json');

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

interface RegistryCache {
  url: string;
  fetchedAt: number;
  index: PluginRegistry;
}

interface RegistryConfig {
  url: string | null;
}

function ensureDir() {
  if (!existsSync(PLUGINS_DIR)) mkdirSync(PLUGINS_DIR, { recursive: true });
}

function readConfig(): RegistryConfig {
  ensureDir();
  // Env var beats persisted config so admins can pin a registry on a
  // managed deployment without depending on UI state.
  const envUrl = process.env.E_PLUGIN_REGISTRY?.trim();
  if (envUrl) return { url: envUrl };
  if (!existsSync(configFile())) return { url: null };
  try {
    const raw = readFileSync(configFile(), 'utf-8');
    const parsed = JSON.parse(raw);
    return { url: typeof parsed.url === 'string' ? parsed.url : null };
  } catch {
    return { url: null };
  }
}

function writeConfig(cfg: RegistryConfig) {
  ensureDir();
  writeFileSync(configFile(), JSON.stringify(cfg, null, 2));
}

function readCache(): RegistryCache | null {
  if (!existsSync(cacheFile())) return null;
  try {
    const raw = readFileSync(cacheFile(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.url !== 'string' ||
      typeof parsed.fetchedAt !== 'number' ||
      !parsed.index ||
      !Array.isArray(parsed.index.entries)
    ) {
      return null;
    }
    return parsed as RegistryCache;
  } catch {
    return null;
  }
}

function writeCache(cache: RegistryCache) {
  ensureDir();
  writeFileSync(cacheFile(), JSON.stringify(cache, null, 2));
}

// ── Public API ─────────────────────────────────────────────────────────

export function getRegistryUrl(): string | null {
  return readConfig().url;
}

export function setRegistryUrl(url: string | null): { ok: boolean; error?: string } {
  if (url !== null) {
    if (typeof url !== 'string') return { ok: false, error: 'url must be a string or null' };
    if (!/^https:\/\//.test(url)) {
      return { ok: false, error: 'registry url must use https://' };
    }
  }
  writeConfig({ url });
  // Invalidate cache so the next fetch hits the new URL.
  if (existsSync(cacheFile())) {
    try {
      writeFileSync(cacheFile(), '');
    } catch {
      /* best-effort cache purge */
    }
  }
  return { ok: true };
}

/**
 * Validate a parsed registry document against the v1 shape. Returns a list
 * of error strings; empty means the document is acceptable.
 */
function validateRegistry(doc: unknown): string[] {
  const errors: string[] = [];
  if (!doc || typeof doc !== 'object') return ['registry must be a JSON object'];
  const d = doc as Record<string, unknown>;
  if (!Array.isArray(d.entries)) {
    return ['registry.entries must be an array'];
  }
  for (let i = 0; i < d.entries.length; i++) {
    const e = d.entries[i] as Record<string, unknown> | null;
    if (!e || typeof e !== 'object') {
      errors.push(`entries[${i}]: not an object`);
      continue;
    }
    if (typeof e.id !== 'string') errors.push(`entries[${i}].id: must be a string`);
    if (typeof e.version !== 'string') errors.push(`entries[${i}].version: must be a string`);
    if (typeof e.displayName !== 'string')
      errors.push(`entries[${i}].displayName: must be a string`);
    if (typeof e.zipUrl !== 'string') errors.push(`entries[${i}].zipUrl: must be a string`);
    else if (!/^https:\/\//.test(e.zipUrl)) errors.push(`entries[${i}].zipUrl: must use https://`);
    if (
      e.sha256 !== undefined &&
      (typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(e.sha256))
    ) {
      errors.push(`entries[${i}].sha256: must be a 64-char hex string when present`);
    }
  }
  return errors;
}

export interface FetchResult {
  ok: boolean;
  index?: PluginRegistry;
  fetchedAt?: number;
  /** True when the answer came from cache. */
  fromCache?: boolean;
  errors?: string[];
}

export async function fetchRegistry(opts: { force?: boolean } = {}): Promise<FetchResult> {
  const cfg = readConfig();
  if (!cfg.url) {
    return { ok: false, errors: ['no registry url configured'] };
  }
  if (!/^https:\/\//.test(cfg.url)) {
    return { ok: false, errors: ['registry url must use https://'] };
  }

  // Return cached when fresh + URL matches + force not requested.
  const cache = readCache();
  if (
    !opts.force &&
    cache &&
    cache.url === cfg.url &&
    Date.now() - cache.fetchedAt < DEFAULT_TTL_MS
  ) {
    return { ok: true, index: cache.index, fetchedAt: cache.fetchedAt, fromCache: true };
  }

  let res: Response;
  try {
    res = await fetch(cfg.url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    return {
      ok: false,
      errors: [`fetch failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  if (!res.ok) {
    return { ok: false, errors: [`registry returned HTTP ${res.status}`] };
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (err) {
    return {
      ok: false,
      errors: [`registry was not valid JSON: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const validation = validateRegistry(parsed);
  if (validation.length > 0) return { ok: false, errors: validation };

  const index = parsed as PluginRegistry;
  const fetchedAt = Date.now();
  writeCache({ url: cfg.url, fetchedAt, index });
  return { ok: true, index, fetchedAt, fromCache: false };
}

/**
 * Download a registry entry's zip and install it. Verifies sha256 when
 * present, then hands the bytes to installFromZip — which runs the same
 * manifest validation + path-traversal defence as direct upload installs.
 */
export async function installFromRegistry(entry: PluginRegistryEntry): Promise<InstallResult> {
  if (!/^https:\/\//.test(entry.zipUrl)) {
    return { errors: ['zipUrl must use https://'] };
  }
  let res: Response;
  try {
    res = await fetch(entry.zipUrl);
  } catch (err) {
    return {
      errors: [`download failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  if (!res.ok) {
    return { errors: [`download returned HTTP ${res.status}`] };
  }
  const buf = Buffer.from(await res.arrayBuffer());

  if (entry.sha256) {
    const got = createHash('sha256').update(buf).digest('hex');
    if (got.toLowerCase() !== entry.sha256.toLowerCase()) {
      return {
        errors: [`sha256 mismatch — expected ${entry.sha256}, got ${got}. Refusing to install.`],
      };
    }
  }

  return installFromZip(buf);
}

/**
 * Test-only — redirect plugin storage to a tmp dir. Must MIRROR the call
 * made to plugins.ts's `__setPluginsDirForTests` so installFromZip writes
 * to the same place readCache/writeCache read from.
 */
export function __setPluginsDirForTests(dir: string): void {
  PLUGINS_DIR = dir;
}

/** Test-only purge of the on-disk cache + config. */
export function __resetRegistryStateForTests(): void {
  try {
    if (existsSync(cacheFile())) writeFileSync(cacheFile(), '');
    if (existsSync(configFile())) writeFileSync(configFile(), JSON.stringify({ url: null }));
  } catch {
    /* best-effort */
  }
}
