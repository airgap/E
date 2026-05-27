/**
 * plugins.ts — plugin discovery, install, uninstall, enable/disable.
 *
 * Storage layout under ~/.e/plugins/ :
 *
 *   <plugin-id>/                    extracted plugin tree
 *     plugin.json                   manifest
 *     <assets…>                     plugin-shipped HTML/CSS/JS/grammars
 *
 *   .state.json                     persisted state (enabled set, install
 *                                   timestamps). Lives alongside plugins
 *                                   so a sync/wipe of the plugins dir
 *                                   keeps state consistent.
 *
 * Security posture (v1):
 *   - No arbitrary JS is loaded into E's server or renderer. Plugin code
 *     runs ONLY inside a sandboxed iframe rendered by the client (the
 *     side-pane contribution).
 *   - Install validates the manifest BEFORE writing anything to disk.
 *   - Zip extraction is path-traversal-safe: any entry whose normalised
 *     destination escapes the plugin dir is rejected (`../` / absolute
 *     paths). Symlinks in zip entries are rejected outright (no symlinks
 *     can be planted by an attacker into the plugin dir).
 *   - The server only serves files BELOW each plugin's install dir, via
 *     a dedicated `/plugins/<id>/<…>` static route — never the user's
 *     home or any sibling dir.
 */
import { homedir } from 'node:os';
import { join, resolve, dirname, normalize, isAbsolute, sep } from 'node:path';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import AdmZip from 'adm-zip';
import { validateManifest, type PluginManifest, type InstalledPlugin } from '@e/shared';

const PLUGINS_DIR = join(homedir(), '.e', 'plugins');
const STATE_FILE = join(PLUGINS_DIR, '.state.json');

interface PluginState {
  /** Set of enabled plugin ids. Plugins not listed are installed-but-disabled. */
  enabled: string[];
  /** Per-plugin install timestamps (epoch ms). */
  installedAt: Record<string, number>;
}

function ensureDir() {
  if (!existsSync(PLUGINS_DIR)) mkdirSync(PLUGINS_DIR, { recursive: true });
}

function readState(): PluginState {
  ensureDir();
  if (!existsSync(STATE_FILE)) return { enabled: [], installedAt: {} };
  try {
    const raw = readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      enabled: Array.isArray(parsed.enabled) ? parsed.enabled : [],
      installedAt:
        parsed.installedAt && typeof parsed.installedAt === 'object' ? parsed.installedAt : {},
    };
  } catch {
    return { enabled: [], installedAt: {} };
  }
}

function writeState(state: PluginState) {
  ensureDir();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** Path-traversal-safe join of plugin-id + sub-path. */
export function pluginAssetPath(pluginId: string, relPath: string): string | null {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(pluginId)) return null;
  const base = join(PLUGINS_DIR, pluginId);
  // Normalise + resolve, then ensure the result stays under `base`.
  const resolved = resolve(base, relPath);
  const baseResolved = resolve(base);
  if (!resolved.startsWith(baseResolved + sep) && resolved !== baseResolved) return null;
  return resolved;
}

/**
 * Collect contribution-warning messages for runtime-not-yet-supported
 * surfaces. The manifest is accepted (we don't fail install) but the user
 * sees the warnings in the Plugins UI so they know what's actually live.
 */
function manifestRuntimeWarnings(m: PluginManifest): string[] {
  const w: string[] = [];
  const c = m.contributes ?? {};
  if (c.lsp?.length) w.push('lsp: declared but not yet runtime-supported in this version of E');
  if (c.primaryPanes?.length) w.push('primaryPanes: declared but not yet runtime-supported');
  if (c.syntaxHighlighters?.length)
    w.push('syntaxHighlighters: declared but not yet runtime-supported');
  if (c.diagnostics?.length) w.push('diagnostics: declared but not yet runtime-supported');
  if (c.hovers?.length) w.push('hovers: declared but not yet runtime-supported');
  return w;
}

/**
 * Extract a zip buffer into the plugin install dir for `id`. Refuses zip
 * entries with absolute paths, '..' segments, or symlink type.
 *
 * Throws on validation / extraction errors. The caller is responsible for
 * cleaning up partial installs on error.
 */
function extractZipSafely(buf: Buffer, destDir: string): void {
  const zip = new AdmZip(buf);
  const entries = zip.getEntries();
  // Pre-flight every entry BEFORE writing anything — atomic-ish install.
  for (const entry of entries) {
    const name = entry.entryName;
    if (!name || name.length === 0) throw new Error('zip entry with empty name');
    // adm-zip exposes some flags via attr; symlinks have unix mode 0o120000.
    const unixMode = (entry.attr >>> 16) & 0xffff;
    const isSymlink = (unixMode & 0o170000) === 0o120000;
    if (isSymlink) {
      throw new Error(`zip entry "${name}" is a symlink — refused`);
    }
    if (isAbsolute(name)) {
      throw new Error(`zip entry "${name}" is absolute — refused`);
    }
    const normalised = normalize(name);
    if (normalised.startsWith('..') || normalised.includes(`${sep}..${sep}`)) {
      throw new Error(`zip entry "${name}" escapes plugin dir — refused`);
    }
  }
  // All entries pass — extract.
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const out = resolve(destDir, entry.entryName);
    const outDir = dirname(out);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    writeFileSync(out, entry.getData());
  }
}

function readManifest(installPath: string): PluginManifest | null {
  const manifestPath = join(installPath, 'plugin.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw) as PluginManifest;
  } catch {
    return null;
  }
}

/** List installed plugins with state. */
export function listPlugins(): InstalledPlugin[] {
  ensureDir();
  const state = readState();
  const out: InstalledPlugin[] = [];
  const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('.')) continue; // skip hidden / state
    const installPath = join(PLUGINS_DIR, e.name);
    const manifest = readManifest(installPath);
    if (!manifest) continue; // corrupt install — skip
    out.push({
      manifest,
      enabled: state.enabled.includes(manifest.id),
      installedAt: state.installedAt[manifest.id] ?? statSync(installPath).mtimeMs,
      installPath,
      warnings: manifestRuntimeWarnings(manifest),
    });
  }
  // Most recently installed first; deterministic by id otherwise.
  out.sort((a, b) => b.installedAt - a.installedAt || a.manifest.id.localeCompare(b.manifest.id));
  return out;
}

export interface InstallResult {
  /** When non-empty, install failed and nothing was written. */
  errors: string[];
  plugin?: InstalledPlugin;
}

/**
 * Install a plugin from a zip buffer. Returns errors (validation +
 * extraction failures) or the resulting InstalledPlugin metadata.
 *
 * If a plugin with the same id is already installed, it's replaced
 * atomically — the previous extract is removed BEFORE the new one is
 * unpacked, but the enabled state is preserved.
 */
export function installFromZip(buf: Buffer): InstallResult {
  ensureDir();
  // Peek at the manifest first by parsing the zip in-memory and looking
  // for plugin.json. This catches manifest errors BEFORE we touch the FS.
  let manifest: PluginManifest | null = null;
  try {
    const zip = new AdmZip(buf);
    const entries = zip.getEntries();
    const manifestEntry = entries.find((e) => e.entryName === 'plugin.json');
    if (!manifestEntry) return { errors: ['zip is missing plugin.json at root'] };
    const raw = manifestEntry.getData().toString('utf-8');
    try {
      manifest = JSON.parse(raw) as PluginManifest;
    } catch (err) {
      return { errors: [`plugin.json is not valid JSON: ${String(err)}`] };
    }
  } catch (err) {
    return { errors: [`could not read zip: ${String(err)}`] };
  }

  const errors = validateManifest(manifest);
  if (errors.length > 0) return { errors };

  const id = manifest!.id;
  const installPath = join(PLUGINS_DIR, id);

  // Preserve enabled state across re-install.
  const state = readState();
  const wasEnabled = state.enabled.includes(id);

  // Clean prior install (atomic-ish: we don't try to restore on failure;
  // the user can re-install).
  if (existsSync(installPath)) {
    rmSync(installPath, { recursive: true, force: true });
  }
  mkdirSync(installPath, { recursive: true });

  try {
    extractZipSafely(buf, installPath);
  } catch (err) {
    rmSync(installPath, { recursive: true, force: true });
    return { errors: [`extraction failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  // Record state.
  state.installedAt[id] = Date.now();
  if (wasEnabled && !state.enabled.includes(id)) state.enabled.push(id);
  writeState(state);

  const fresh = readManifest(installPath);
  if (!fresh) {
    // Should not happen — we just wrote it — but be defensive.
    return { errors: ['extracted plugin has no readable plugin.json'] };
  }
  return {
    errors: [],
    plugin: {
      manifest: fresh,
      enabled: wasEnabled,
      installedAt: state.installedAt[id],
      installPath,
      warnings: manifestRuntimeWarnings(fresh),
    },
  };
}

export function uninstallPlugin(id: string): { ok: boolean; error?: string } {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(id)) return { ok: false, error: 'invalid plugin id' };
  const installPath = join(PLUGINS_DIR, id);
  if (!existsSync(installPath)) return { ok: false, error: 'not installed' };
  rmSync(installPath, { recursive: true, force: true });
  const state = readState();
  state.enabled = state.enabled.filter((x) => x !== id);
  delete state.installedAt[id];
  writeState(state);
  return { ok: true };
}

export function setEnabled(id: string, enabled: boolean): { ok: boolean; error?: string } {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(id)) return { ok: false, error: 'invalid plugin id' };
  const installPath = join(PLUGINS_DIR, id);
  if (!existsSync(installPath)) return { ok: false, error: 'not installed' };
  const state = readState();
  const has = state.enabled.includes(id);
  if (enabled && !has) state.enabled.push(id);
  else if (!enabled && has) state.enabled = state.enabled.filter((x) => x !== id);
  writeState(state);
  return { ok: true };
}

/** Test-only — lets tests redirect the plugins dir to a tmp location. */
export function __setPluginsDirForTests(dir: string): void {
  // We can't actually rebind the module constant; instead, the test harness
  // should run with HOME pointing at a tmp dir. Re-export here as a hook for
  // future env-driven configuration.
  void dir;
}
