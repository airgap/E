import { theme } from '../ui/theme';
import { resolveOpenTarget, openTargetUrl, openBrowser } from '../../serve-and-open';

interface OpenOptions {
  /** Path to open. Omitted → current directory. */
  path?: string;
  /** Start the server but don't open a browser. */
  serve?: boolean;
}

/**
 * Default dev-CLI command: boot the E server and open the app in the browser
 * pointed at a file or directory.
 *
 *   e            → open the current directory as a workspace
 *   e <file>     → open the file
 *   e <dir>      → open the directory as a workspace
 *   e open --serve / e serve → run the server without opening a browser
 *
 * Mirrors the shipped standalone binary's behavior so dev and prod match.
 */
export async function runOpen(options: OpenOptions) {
  const headless = options.serve === true;
  const target = headless ? undefined : resolveOpenTarget(options.path);

  if (!process.env.PORT) process.env.PORT = '3002';

  // Boot the server (index.ts starts Bun.serve at module-eval time).
  await import('../../index');

  if (headless) return;

  const port = Number(process.env.PORT);
  const protocol = process.env.TLS_CERT ? 'https' : 'http';
  const base = `${protocol}://localhost:${port}`;
  const url = target ? openTargetUrl(base, target) : base;

  if (target) {
    console.log(
      theme.dim(`Opening ${target.kind === 'dir' ? 'workspace' : 'file'} ${target.path}…`),
    );
  }
  setTimeout(() => openBrowser(url), 500);
}
