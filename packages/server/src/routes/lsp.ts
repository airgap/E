import { Hono } from 'hono';
import { upgradeWebSocket } from '../ws';
import { getAvailableServers, getInstallInfo } from '../services/lsp-registry';
import { lspManager, encodeLspMessage } from '../services/lsp-instance-manager';
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { nanoid } from 'nanoid';
import type { BinaryDownloadInfo } from '../services/lsp-registry';

export const lspRoutes = new Hono();

const LSP_DIR = join(homedir(), '.e', 'lsp');

// REST: list available language servers
lspRoutes.get('/servers', async (c) => {
  const servers = await getAvailableServers();
  return c.json({ ok: true, data: servers });
});

/**
 * Resolve the binary download URL for the current platform.
 */
function resolveBinaryUrl(download: BinaryDownloadInfo): string | null {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'linux') return download.linux ?? null;
  if (platform === 'win32') return download.win32 ?? null;
  if (platform === 'darwin') {
    return arch === 'arm64' ? (download['darwin-arm64'] ?? null) : (download['darwin-x64'] ?? null);
  }
  return null;
}

/**
 * Download a zip, extract, and place the binary in ~/.e/lsp/bin/.
 */
async function installBinaryFromZip(url: string, commandName: string): Promise<void> {
  const binDir = join(LSP_DIR, 'bin');
  mkdirSync(binDir, { recursive: true });

  // Download to temp file
  const tmpZip = join(LSP_DIR, `_tmp_${commandName}.zip`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const arrayBuf = await res.arrayBuffer();
  await Bun.write(tmpZip, arrayBuf);

  // Extract using unzip
  const proc = Bun.spawn(['unzip', '-o', tmpZip, '-d', binDir], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const exitCode = await proc.exited;

  // Clean up zip
  try {
    const { unlinkSync } = await import('fs');
    unlinkSync(tmpZip);
  } catch {}

  if (exitCode !== 0) {
    const stderr = proc.stderr ? await new Response(proc.stderr).text() : '';
    throw new Error(`unzip failed (exit ${exitCode}): ${stderr.trim()}`);
  }

  // Make binary executable
  const binPath = join(binDir, commandName);
  if (existsSync(binPath)) {
    chmodSync(binPath, 0o755);
  }
}

// POST: install a language server into ~/.e/lsp/
// Requires X-Confirm-Install header — downloads and runs external binaries,
// so must be explicitly triggered by the UI (not by a cross-origin request).
lspRoutes.post('/install', async (c) => {
  const confirmed = c.req.header('X-Confirm-Install');
  if (!confirmed) {
    return c.json({ ok: false, error: 'LSP install requires X-Confirm-Install header' }, 400);
  }

  const body = await c.req.json<{ language: string }>();
  const { language } = body;

  if (!language || typeof language !== 'string' || language.length > 50) {
    return c.json({ ok: false, error: 'Invalid language parameter' }, 400);
  }

  const info = getInstallInfo(language);
  if (!info) {
    return c.json({ ok: false, error: `Unknown language: ${language}` }, 404);
  }

  // Binary download path
  if (info.binaryDownload) {
    const url = resolveBinaryUrl(info.binaryDownload);
    if (!url) {
      return c.json({ ok: false, error: `No binary available for this platform` }, 404);
    }

    try {
      await installBinaryFromZip(url, info.command);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, error: `Binary install failed: ${err}` }, 500);
    }
  }

  // npm install path
  if (info.npmPackage) {
    mkdirSync(LSP_DIR, { recursive: true });
    const pkgJsonPath = join(LSP_DIR, 'package.json');
    if (!existsSync(pkgJsonPath)) {
      writeFileSync(pkgJsonPath, JSON.stringify({ private: true }, null, 2));
    }

    const packages = info.npmPackage.split(' ');

    try {
      const proc = Bun.spawn(['npm', 'install', '--prefix', LSP_DIR, ...packages], {
        cwd: LSP_DIR,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await proc.exited;

      if (exitCode === 0) {
        return c.json({ ok: true });
      }

      const stderr = proc.stderr ? await new Response(proc.stderr).text() : '';
      return c.json(
        { ok: false, error: `npm install failed (exit ${exitCode}): ${stderr.trim()}` },
        500,
      );
    } catch (err) {
      return c.json({ ok: false, error: `Failed to run npm install: ${err}` }, 500);
    }
  }

  return c.json({ ok: false, error: `No install method available for language: ${language}` }, 404);
});

// GET: check which languages have managed installs in ~/.e/lsp/
lspRoutes.get('/install-status', async (c) => {
  const servers = await getAvailableServers();
  const npmBinDir = join(LSP_DIR, 'node_modules', '.bin');
  const binDir = join(LSP_DIR, 'bin');

  const installed: Record<string, boolean> = {};
  for (const server of servers) {
    if (server.installable) {
      installed[server.language] =
        existsSync(join(npmBinDir, server.command)) || existsSync(join(binDir, server.command));
    }
  }

  return c.json({ ok: true, data: installed });
});

// GET: LSP instance manager stats
lspRoutes.get('/instances', (c) => {
  return c.json({ ok: true, data: lspManager.getStats() });
});

// WebSocket: bridge between client and language server process.
// Uses the shared LspInstanceManager for per-(language, rootPath) keying.
// Worktrees naturally get distinct LSP instances via their unique rootPath.
lspRoutes.get(
  '/ws',
  upgradeWebSocket((c) => {
    const language = c.req.query('language') || '';
    const rootPath = c.req.query('rootPath') || '.';
    const clientId = nanoid(8);

    return {
      onOpen(_event, ws) {
        const client = {
          id: clientId,
          send: (data: string) => {
            try {
              ws.send(data);
            } catch {
              // WebSocket closed
            }
          },
        };

        const instance = lspManager.connect(language, rootPath, client);
        if (!instance) {
          ws.send(JSON.stringify({ error: `No language server for: ${language}` }));
          ws.close(1008, 'unsupported language');
          return;
        }
      },

      onMessage(event, _ws) {
        const data =
          typeof event.data === 'string'
            ? event.data
            : new TextDecoder().decode(event.data as ArrayBuffer);
        try {
          const msg = JSON.parse(data);
          lspManager.sendToLsp(language, rootPath, msg);
        } catch {
          // Ignore malformed messages
        }
      },

      onClose() {
        lspManager.disconnect(language, rootPath, clientId);
      },

      onError() {
        lspManager.disconnect(language, rootPath, clientId);
      },
    };
  }),
);
