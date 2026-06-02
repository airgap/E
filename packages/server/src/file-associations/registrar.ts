// OS file-type registration for E (OPT-IN).
//
// Registration is reversible and per-user (no sudo). Linux is the fully
// supported path; macOS/Windows are stubbed for later.
//
// See packages/shared/src/file-associations.ts for the canonical list of
// extensions E can own.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CODE_FILE_ASSOCIATIONS, mimeTypeForExt } from '@e/shared';

export interface FileTypeRegistrationStatus {
  registered: boolean;
  supported: boolean;
  platform: string;
}

export interface FileTypeRegistrationResult {
  ok: boolean;
  message: string;
}

const DESKTOP_FILE_NAME = 'e.desktop';

function localShare(): string {
  return process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
}

function mimePackagesXmlPath(): string {
  return join(localShare(), 'mime', 'packages', 'e-code-files.xml');
}

function mimeDir(): string {
  return join(localShare(), 'mime');
}

function applicationsDir(): string {
  return join(localShare(), 'applications');
}

function desktopFilePath(): string {
  return join(applicationsDir(), DESKTOP_FILE_NAME);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** The canonical install dir the installer uses (`$E_INSTALL`, default `~/.e`). */
function installDir(): string {
  return process.env.E_INSTALL || join(homedir(), '.e');
}

/**
 * Returns the path to put in `Exec=`. Prefers the stable `<install>/bin/e`
 * symlink (which survives upgrades — the installer repoints it) over the
 * version-specific real binary, then `process.execPath`, then bare `e`.
 */
function resolveBinaryPath(): string {
  const symlink = join(installDir(), 'bin', process.platform === 'win32' ? 'e.exe' : 'e');
  if (existsSync(symlink)) return symlink;
  // For a `bun build --compile` binary, process.execPath is the binary itself.
  const exec = process.execPath;
  if (exec && !/[\\/](bun|node)$/.test(exec)) return exec;
  return 'e';
}

/**
 * Absolute path of the launcher icon, if one ships next to the binary.
 * `build-standalone.ts` stages `e.png` alongside the executable; the installer
 * symlinks `bin/e` at it, so resolve the real binary dir before looking.
 */
function resolveIconPath(): string | undefined {
  const candidates: string[] = [];
  const exec = process.execPath;
  if (exec && !/[\\/](bun|node)$/.test(exec)) candidates.push(exec);
  // Also look next to the installed binary (the `bin/e` symlink target), so the
  // icon is found even when this runs from the dev CLI (where execPath is bun).
  const bin = resolveBinaryPath();
  if (bin !== 'e') candidates.push(bin);
  for (const candidate of candidates) {
    try {
      const icon = join(dirname(realpathSync(candidate)), 'e.png');
      if (existsSync(icon)) return icon;
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

/** Runs a command, resolving with its exit code and captured stderr. */
function run(cmd: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', () => resolve({ code: 127, stderr: `${cmd} not found` }));
    child.on('close', (code) => resolve({ code: code ?? 0, stderr }));
  });
}

/** Returns true if `cmd` is on PATH. */
async function hasCommand(cmd: string): Promise<boolean> {
  // `command -v` is a shell builtin, so invoke it through a shell.
  const probe = await run('sh', ['-c', `command -v ${cmd}`]);
  if (probe.code === 0) return true;
  const which = await run('which', [cmd]);
  return which.code === 0;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Element type of CODE_FILE_ASSOCIATIONS (avoids a separate type import). */
type Assoc = (typeof CODE_FILE_ASSOCIATIONS)[number];

/**
 * Resolve a user-supplied list of extensions to known associations. Empty or
 * undefined means "all". Leading dots and case are normalized. Any extensions
 * that don't match a known type are returned in `unknown`.
 */
function resolveAssocs(exts?: string[]): { assocs: readonly Assoc[]; unknown: string[] } {
  if (!exts || exts.length === 0) return { assocs: CODE_FILE_ASSOCIATIONS, unknown: [] };
  const want = exts.map((e) => e.replace(/^\./, '').toLowerCase());
  const known = new Set(CODE_FILE_ASSOCIATIONS.map((a) => a.ext));
  const assocs = CODE_FILE_ASSOCIATIONS.filter((a) => want.includes(a.ext));
  const unknown = [...new Set(want)].filter((e) => !known.has(e));
  return { assocs, unknown };
}

/** The full set of code file types E can own (for `e list-file-types`). */
export function listFileTypes(): readonly Assoc[] {
  return CODE_FILE_ASSOCIATIONS;
}

function buildMimeXml(assocs: readonly Assoc[]): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">',
  ];
  for (const assoc of assocs) {
    const type = mimeTypeForExt(assoc.ext);
    lines.push(`  <mime-type type="${escapeXml(type)}">`);
    lines.push(`    <comment>${escapeXml(assoc.name)}</comment>`);
    lines.push(`    <glob pattern="*.${escapeXml(assoc.ext)}" weight="60"/>`);
    lines.push('  </mime-type>');
  }
  lines.push('</mime-info>');
  return lines.join('\n') + '\n';
}

/**
 * Build the `e.desktop` entry. A single file backs two features:
 *   - the applications-menu launcher (always; `e install-desktop`)
 *   - the code file-type handler (opt-in; `e register-file-types`)
 * When `fileHandler` is set, the entry takes a file argument (`%F`) and
 * advertises the code MIME types so it can be set as their default opener.
 */
function buildDesktopEntry(opts: { fileHandler: boolean; assocs?: readonly Assoc[] }): string {
  const icon = resolveIconPath();
  const lines = [
    '[Desktop Entry]',
    'Name=E',
    'GenericName=AI Coding Assistant',
    'Comment=Autonomous AI coding assistant',
    'Type=Application',
    `Exec=${resolveBinaryPath()}${opts.fileHandler ? ' %F' : ''}`,
    'Terminal=false',
    'Categories=Development;IDE;',
    'StartupNotify=true',
    'StartupWMClass=E',
    'NoDisplay=false',
  ];
  if (icon) lines.push(`Icon=${icon}`);
  if (opts.fileHandler) {
    const assocs = opts.assocs ?? CODE_FILE_ASSOCIATIONS;
    const mimeTypes = assocs.map((a) => mimeTypeForExt(a.ext)).join(';');
    lines.push(`MimeType=${mimeTypes};`);
  }
  lines.push('');
  return lines.join('\n');
}

/** True if an existing desktop entry already advertises the code MIME types. */
async function desktopEntryIsFileHandler(): Promise<boolean> {
  try {
    return /^MimeType=/m.test(await readFile(desktopFilePath(), 'utf8'));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Linux implementation
// ---------------------------------------------------------------------------

async function getStatusLinux(): Promise<FileTypeRegistrationStatus> {
  const registered =
    (await fileExists(mimePackagesXmlPath())) && (await fileExists(desktopFilePath()));
  return { registered, supported: true, platform: 'linux' };
}

async function registerLinux(assocs: readonly Assoc[]): Promise<FileTypeRegistrationResult> {
  if (!(await hasCommand('update-mime-database'))) {
    return {
      ok: false,
      message:
        'update-mime-database not found. Install shared-mime-info (e.g. `apt install shared-mime-info`) and retry.',
    };
  }

  const xmlPath = mimePackagesXmlPath();
  const deskPath = desktopFilePath();

  await mkdir(dirname(xmlPath), { recursive: true });
  await writeFile(xmlPath, buildMimeXml(assocs), 'utf8');

  const mimeRes = await run('update-mime-database', [mimeDir()]);
  if (mimeRes.code !== 0) {
    return {
      ok: false,
      message: `update-mime-database failed: ${mimeRes.stderr.trim() || mimeRes.code}`,
    };
  }

  await mkdir(dirname(deskPath), { recursive: true });
  await writeFile(deskPath, buildDesktopEntry({ fileHandler: true, assocs }), 'utf8');

  if (await hasCommand('update-desktop-database')) {
    await run('update-desktop-database', [applicationsDir()]);
  }

  if (!(await hasCommand('xdg-mime'))) {
    return {
      ok: true,
      message:
        'Registered MIME types and desktop entry, but xdg-mime is missing so E was not set as the default handler.',
    };
  }

  for (const assoc of assocs) {
    await run('xdg-mime', ['default', DESKTOP_FILE_NAME, mimeTypeForExt(assoc.ext)]);
  }

  const n = assocs.length;
  return {
    ok: true,
    message: `Registered ${n} file type${n === 1 ? '' : 's'} and set E as the default handler.`,
  };
}

async function unregisterLinux(): Promise<FileTypeRegistrationResult> {
  await rm(mimePackagesXmlPath(), { force: true });
  await rm(desktopFilePath(), { force: true });

  if (await hasCommand('update-mime-database')) {
    await run('update-mime-database', [mimeDir()]);
  }
  if (await hasCommand('update-desktop-database')) {
    await run('update-desktop-database', [applicationsDir()]);
  }

  return { ok: true, message: 'Unregistered E file types.' };
}

async function installAppLauncherLinux(): Promise<FileTypeRegistrationResult> {
  const deskPath = desktopFilePath();
  // Don't clobber file-type handling: if `register-file-types` already wrote a
  // handler entry, keep it a handler (still a valid launcher).
  const fileHandler = await desktopEntryIsFileHandler();

  await mkdir(dirname(deskPath), { recursive: true });
  await writeFile(deskPath, buildDesktopEntry({ fileHandler }), 'utf8');

  if (await hasCommand('update-desktop-database')) {
    await run('update-desktop-database', [applicationsDir()]);
  }

  return {
    ok: true,
    message: resolveIconPath()
      ? 'Added E to your applications menu.'
      : 'Added E to your applications menu (no icon found; it will show without one).',
  };
}

async function uninstallAppLauncherLinux(): Promise<FileTypeRegistrationResult> {
  await rm(desktopFilePath(), { force: true });
  if (await hasCommand('update-desktop-database')) {
    await run('update-desktop-database', [applicationsDir()]);
  }
  return { ok: true, message: 'Removed E from your applications menu.' };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getFileTypeRegistrationStatus(): Promise<FileTypeRegistrationStatus> {
  switch (process.platform) {
    case 'linux':
      return getStatusLinux();
    case 'darwin':
      // TODO(macos): implement via LSSetDefaultRoleHandlerForContentType /
      // Info.plist CFBundleDocumentTypes in the app bundle.
      return { registered: false, supported: false, platform: 'darwin' };
    case 'win32':
      // TODO(windows): implement via registry (HKCU\Software\Classes) +
      // assoc/ftype, then notify the shell with SHChangeNotify.
      return { registered: false, supported: false, platform: 'win32' };
    default:
      return { registered: false, supported: false, platform: process.platform };
  }
}

export async function registerFileTypes(exts?: string[]): Promise<FileTypeRegistrationResult> {
  const { assocs, unknown } = resolveAssocs(exts);
  if (unknown.length) {
    return { ok: false, message: `unknown file type(s): ${unknown.join(', ')}` };
  }
  if (assocs.length === 0) {
    return { ok: false, message: 'no file types selected' };
  }
  switch (process.platform) {
    case 'linux':
      return registerLinux(assocs);
    case 'darwin':
      // TODO(macos): see getFileTypeRegistrationStatus.
      return { ok: false, message: 'darwin registration not yet supported' };
    case 'win32':
      // TODO(windows): see getFileTypeRegistrationStatus.
      return { ok: false, message: 'win32 registration not yet supported' };
    default:
      return { ok: false, message: `${process.platform} registration not yet supported` };
  }
}

export async function unregisterFileTypes(): Promise<FileTypeRegistrationResult> {
  switch (process.platform) {
    case 'linux':
      return unregisterLinux();
    case 'darwin':
      // TODO(macos): see getFileTypeRegistrationStatus.
      return { ok: false, message: 'darwin registration not yet supported' };
    case 'win32':
      // TODO(windows): see getFileTypeRegistrationStatus.
      return { ok: false, message: 'win32 registration not yet supported' };
    default:
      return { ok: false, message: `${process.platform} registration not yet supported` };
  }
}

/**
 * Register E in the desktop application launcher (freedesktop `.desktop` entry).
 * Linux-only; on other platforms the launcher comes from the packaged app
 * bundle (Tauri/Electron), so this is a no-op that reports a clean skip — the
 * installer treats it as best-effort.
 */
export async function installAppLauncher(): Promise<FileTypeRegistrationResult> {
  switch (process.platform) {
    case 'linux':
      return installAppLauncherLinux();
    case 'darwin':
      return { ok: true, message: 'macOS uses the app bundle for the launcher; skipped.' };
    case 'win32':
      return { ok: true, message: 'Windows uses the Start Menu shortcut; skipped.' };
    default:
      return {
        ok: true,
        message: `applications-menu entry not supported on ${process.platform}; skipped.`,
      };
  }
}

/** Remove E's application-launcher entry. Linux-only; no-op elsewhere. */
export async function uninstallAppLauncher(): Promise<FileTypeRegistrationResult> {
  switch (process.platform) {
    case 'linux':
      return uninstallAppLauncherLinux();
    default:
      return { ok: true, message: `no applications-menu entry to remove on ${process.platform}.` };
  }
}
