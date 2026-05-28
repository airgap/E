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
import { registerPluginLsp, unregisterPluginLsps } from './lsp-registry';
import { lspManager } from './lsp-instance-manager';

// PLUGINS_DIR is mutable so tests can redirect storage to a tmp location.
// Bun's homedir() doesn't respect $HOME env changes (reads from /etc/passwd),
// so a HOME-swap-based test isolation strategy silently leaks into the
// real ~/.e/plugins. The real seam is the explicit override below.
let PLUGINS_DIR = join(homedir(), '.e', 'plugins');
let STATE_FILE = join(PLUGINS_DIR, '.state.json');

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
  // lsp + primaryPanes + diagnostics + hovers are runtime-supported.
  if (c.syntaxHighlighters?.length)
    w.push('syntaxHighlighters: declared but not yet runtime-supported');
  // Hovers with source='lsp' need a matching lsp contribution, same shape as diagnostics.
  for (const h of c.hovers ?? []) {
    if (
      h.source === 'lsp' &&
      !(c.lsp ?? []).some((l) => (h.languages ?? []).includes(l.language))
    ) {
      w.push(
        `hovers: source='lsp' for language ${(h.languages ?? []).join(',') || '?'} needs a matching lsp contribution`,
      );
    }
  }
  // Diagnostics with source='lsp' rely on the LSP being wired (which it
  // is when the plugin also declares an `lsp` contribution); we flag the
  // mismatch so the user understands why nothing shows up.
  for (const d of c.diagnostics ?? []) {
    if (
      d.source === 'lsp' &&
      !(c.lsp ?? []).some((l) => (d.languages ?? []).includes(l.language))
    ) {
      w.push(
        `diagnostics: source='lsp' for language ${(d.languages ?? []).join(',') || '?'} needs a matching lsp contribution`,
      );
    }
    if (d.source === 'command' && !d.pattern) {
      w.push("diagnostics: source='command' requires a 'pattern' regex");
    }
  }
  return w;
}

// ── LSP activate / deactivate ──────────────────────────────────────────
//
// Plugin LSPs are registered with lsp-registry on enable (and on server
// startup for already-enabled plugins). The actual LSP subprocess is
// NOT spawned eagerly — lsp-instance-manager spawns lazily on the first
// `connect()` for that language, so plugins with LSPs that never see a
// matching file open never pay the spawn cost.
//
// On disable / uninstall we deactivate + kill any running instance so
// the binary state isn't orphaned.

function activatePluginLsps(manifest: PluginManifest, installPath: string): void {
  const lsp = manifest.contributes?.lsp ?? [];
  for (const entry of lsp) {
    const argv = entry.command;
    if (!argv || argv.length === 0) continue;
    // First argv entry is the binary, relative to the plugin install
    // dir. Resolve once at registration time so changes to PWD don't
    // affect lookups later.
    const binRel = argv[0];
    const binAbs = resolve(installPath, binRel);
    if (!existsSync(binAbs)) {
      console.warn(
        `[plugin ${manifest.id}] lsp binary not found: ${binAbs} — skipping registration`,
      );
      continue;
    }
    registerPluginLsp(manifest.id, entry.language, binAbs, argv.slice(1), entry.extensions);
  }
}

function deactivatePluginLsps(pluginId: string): void {
  const removed = unregisterPluginLsps(pluginId);
  for (const lang of removed) {
    lspManager.shutdownForLanguage(lang);
  }
}

/**
 * Walk enabled plugins on server boot and register their LSP
 * contributions. Call once at startup so users who had plugins enabled
 * before this restart pick them up without re-toggling.
 */
export function activateEnabledPluginsOnStartup(): void {
  ensureDir();
  const state = readState();
  for (const id of state.enabled) {
    const installPath = join(PLUGINS_DIR, id);
    const manifest = readManifest(installPath);
    if (manifest) activatePluginLsps(manifest, installPath);
  }
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
  // the user can re-install). Tear down any LSP registrations from the
  // prior install BEFORE removing files — the binary path may move after
  // re-extraction, and any in-flight subprocess pointing at the old path
  // needs to die before the new one is registered.
  if (existsSync(installPath)) {
    deactivatePluginLsps(id);
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
  // Re-activate LSP registrations if the plugin was (still is) enabled.
  if (wasEnabled) activatePluginLsps(fresh, installPath);
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
  // Tear down any runtime registrations BEFORE removing files, so a
  // late LSP spawn attempt can't race the rm.
  deactivatePluginLsps(id);
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
  // Activate / deactivate runtime registrations to match the new state.
  // Read the manifest here so we don't pay another disk hit in the enable
  // path when the caller already has it.
  if (enabled) {
    const manifest = readManifest(installPath);
    if (manifest) activatePluginLsps(manifest, installPath);
  } else {
    deactivatePluginLsps(id);
  }
  return { ok: true };
}

/**
 * Test-only — redirect the plugins dir to a tmp location. Tests call this
 * in beforeEach with a fresh mkdtempSync path so the real ~/.e/plugins is
 * untouched and tests can rely on a clean baseline.
 *
 * Also clears the in-memory LSP override registry so a prior test's
 * registration doesn't leak across files.
 */
export function __setPluginsDirForTests(dir: string): void {
  PLUGINS_DIR = dir;
  STATE_FILE = join(PLUGINS_DIR, '.state.json');
}

export function __getPluginsDirForTests(): string {
  return PLUGINS_DIR;
}
