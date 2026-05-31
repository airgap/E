/**
 * Shared "open a file or directory in the E app" helpers.
 *
 * Used by both entry points that can launch the GUI:
 *   - standalone.ts (the shipped `e` binary)
 *   - cli/main.ts   (the dev CLI's default `open` command)
 *
 * The flow is the same for both: resolve what the user asked to open (a file,
 * a directory, or — with no argument — the current directory), boot the
 * server, then open a browser at a URL carrying the target as a query param.
 * The client's file-association bridge drains that param and opens the file
 * (`?open=`) or directory-as-workspace (`?openDir=`).
 */
import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';

export interface OpenTarget {
  /** Absolute path to open. */
  path: string;
  kind: 'file' | 'dir';
}

/**
 * Resolve what to open from the first CLI argument.
 *
 *   undefined / flag  → the current working directory (bare `e` opens cwd)
 *   a path            → that file or directory
 *
 * Returns `undefined` if the resolved path doesn't exist or can't be stat'd,
 * so the caller falls back to plain server start.
 */
export function resolveOpenTarget(arg: string | undefined): OpenTarget | undefined {
  const raw = arg && !arg.startsWith('-') ? arg : process.cwd();
  if (!existsSync(raw)) return undefined;
  try {
    return { path: resolve(raw), kind: statSync(raw).isDirectory() ? 'dir' : 'file' };
  } catch {
    return undefined;
  }
}

/** Build the GUI URL that opens the given target (file or directory). */
export function openTargetUrl(baseUrl: string, target: OpenTarget): string {
  const param = target.kind === 'dir' ? 'openDir' : 'open';
  return `${baseUrl}/?${param}=${encodeURIComponent(target.path)}`;
}

/** Open `url` in the user's default browser. Best-effort — never throws. */
export function openBrowser(url: string): void {
  const platform = process.platform;
  // Single-quote the URL so shell metacharacters in the query string
  // (`?`, `&`, `=`) aren't glob-expanded or treated as job control.
  const q = `'${url.replace(/'/g, "'\\''")}'`;
  try {
    if (platform === 'darwin') {
      execSync(`open ${q}`);
    } else if (platform === 'win32') {
      // cmd.exe: `start` treats a quoted first token as a window title, so
      // pass an empty title first. cmd uses "" quoting, not '' .
      execSync(`start "" "${url}"`, { shell: 'cmd.exe' });
    } else {
      // Linux — try common launchers in order
      for (const cmd of ['xdg-open', 'sensible-browser', 'x-www-browser']) {
        try {
          execSync(`${cmd} ${q} &`);
          break;
        } catch {
          // try next
        }
      }
    }
  } catch {
    // Opening a browser is best-effort; never crash over it.
    console.log(`  → Open in browser: ${url}`);
  }
}
