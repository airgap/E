// OS file-type registration for E (OPT-IN).
//
// Registration is reversible and per-user (no sudo). Linux is the fully
// supported path; macOS/Windows are stubbed for later.
//
// See packages/shared/src/file-associations.ts for the canonical list of
// extensions E can own.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm, access } from 'node:fs/promises';
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

/** Returns the absolute path of the running `e` binary, or `'e'` as a fallback. */
function resolveBinaryPath(): string {
  // For a `bun build --compile` binary, process.execPath is the binary itself.
  const exec = process.execPath;
  if (exec && !/[\\/](bun|node)$/.test(exec)) return exec;
  return 'e';
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

function buildMimeXml(): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">',
  ];
  for (const assoc of CODE_FILE_ASSOCIATIONS) {
    const type = mimeTypeForExt(assoc.ext);
    lines.push(`  <mime-type type="${escapeXml(type)}">`);
    lines.push(`    <comment>${escapeXml(assoc.name)}</comment>`);
    lines.push(`    <glob pattern="*.${escapeXml(assoc.ext)}" weight="60"/>`);
    lines.push('  </mime-type>');
  }
  lines.push('</mime-info>');
  return lines.join('\n') + '\n';
}

function buildDesktopEntry(): string {
  const mimeTypes = CODE_FILE_ASSOCIATIONS.map((a) => mimeTypeForExt(a.ext)).join(';');
  return [
    '[Desktop Entry]',
    'Name=E',
    'Type=Application',
    `Exec=${resolveBinaryPath()} %F`,
    'Terminal=false',
    'Categories=Development;TextEditor;',
    'NoDisplay=false',
    `MimeType=${mimeTypes};`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Linux implementation
// ---------------------------------------------------------------------------

async function getStatusLinux(): Promise<FileTypeRegistrationStatus> {
  const registered =
    (await fileExists(mimePackagesXmlPath())) && (await fileExists(desktopFilePath()));
  return { registered, supported: true, platform: 'linux' };
}

async function registerLinux(): Promise<FileTypeRegistrationResult> {
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
  await writeFile(xmlPath, buildMimeXml(), 'utf8');

  const mimeRes = await run('update-mime-database', [mimeDir()]);
  if (mimeRes.code !== 0) {
    return {
      ok: false,
      message: `update-mime-database failed: ${mimeRes.stderr.trim() || mimeRes.code}`,
    };
  }

  await mkdir(dirname(deskPath), { recursive: true });
  await writeFile(deskPath, buildDesktopEntry(), 'utf8');

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

  for (const assoc of CODE_FILE_ASSOCIATIONS) {
    await run('xdg-mime', ['default', DESKTOP_FILE_NAME, mimeTypeForExt(assoc.ext)]);
  }

  return {
    ok: true,
    message: `Registered ${CODE_FILE_ASSOCIATIONS.length} file types and set E as the default handler.`,
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

export async function registerFileTypes(): Promise<FileTypeRegistrationResult> {
  switch (process.platform) {
    case 'linux':
      return registerLinux();
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
