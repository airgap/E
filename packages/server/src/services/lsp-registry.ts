/**
 * Registry of known language servers and their CLI commands.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface BinaryDownloadInfo {
  linux?: string;
  'darwin-arm64'?: string;
  'darwin-x64'?: string;
  win32?: string;
}

export interface LspServerEntry {
  language: string;
  command: string;
  args: string[];
  available: boolean;
  installable: boolean;
  npmPackage?: string;
  binaryDownload?: BinaryDownloadInfo;
  systemInstallHint?: string;
}

interface LspRegistryEntry {
  command: string;
  args: string[];
  npmPackage?: string;
  binaryDownload?: BinaryDownloadInfo;
  systemInstallHint?: string;
}

const REGISTRY: Record<string, LspRegistryEntry> = {
  typescript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    npmPackage: 'typescript-language-server typescript',
  },
  javascript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    npmPackage: 'typescript-language-server typescript',
  },
  python: {
    command: 'pyright-langserver',
    args: ['--stdio'],
    npmPackage: 'pyright',
  },
  rust: {
    command: 'rust-analyzer',
    args: [],
    systemInstallHint: 'rustup component add rust-analyzer',
  },
  go: {
    command: 'gopls',
    args: ['serve'],
    systemInstallHint: 'go install golang.org/x/tools/gopls@latest',
  },
  css: {
    command: 'vscode-css-language-server',
    args: ['--stdio'],
    npmPackage: 'vscode-langservers-extracted',
  },
  html: {
    command: 'vscode-html-language-server',
    args: ['--stdio'],
    npmPackage: 'vscode-langservers-extracted',
  },
  json: {
    command: 'vscode-json-language-server',
    args: ['--stdio'],
    npmPackage: 'vscode-langservers-extracted',
  },
  svelte: {
    command: 'svelteserver',
    args: ['--stdio'],
    npmPackage: 'svelte-language-server',
  },
  shell: {
    command: 'bash-language-server',
    args: ['start'],
    npmPackage: 'bash-language-server',
  },
  yaml: {
    command: 'yaml-language-server',
    args: ['--stdio'],
    npmPackage: 'yaml-language-server',
  },
  xml: {
    command: 'lemminx',
    args: [],
    binaryDownload: {
      linux:
        'https://github.com/redhat-developer/vscode-xml/releases/download/0.29.0/lemminx-linux.zip',
      'darwin-arm64':
        'https://github.com/redhat-developer/vscode-xml/releases/download/0.29.0/lemminx-osx-aarch_64.zip',
      'darwin-x64':
        'https://github.com/redhat-developer/vscode-xml/releases/download/0.29.0/lemminx-osx-x86_64.zip',
      win32:
        'https://github.com/redhat-developer/vscode-xml/releases/download/0.29.0/lemminx-win32.zip',
    },
  },
};

/** Base directory for managed LSP installs */
const LSP_DIR = join(homedir(), '.e', 'lsp');

/**
 * Look up the LSP command for a given language.
 * Resolves from ~/.e/lsp/node_modules/.bin/ first, then system PATH.
 */
export function getLspCommand(language: string): { command: string; args: string[] } | null {
  const entry = REGISTRY[language];
  if (!entry) return null;

  // Try managed npm install
  const managedNpmBin = join(LSP_DIR, 'node_modules', '.bin', entry.command);
  if (existsSync(managedNpmBin)) {
    return { command: managedNpmBin, args: entry.args };
  }

  // Try managed binary download
  const managedBin = join(LSP_DIR, 'bin', entry.command);
  if (existsSync(managedBin)) {
    return { command: managedBin, args: entry.args };
  }

  // Fall back to system PATH
  if (Bun.which(entry.command)) {
    return { command: entry.command, args: entry.args };
  }

  return null;
}

/**
 * Get install metadata for a language.
 */
export function getInstallInfo(language: string): LspRegistryEntry | null {
  return REGISTRY[language] ?? null;
}

/**
 * Check which language servers are available on the system.
 */
export async function getAvailableServers(): Promise<LspServerEntry[]> {
  const results: LspServerEntry[] = [];
  const seen = new Set<string>();

  for (const [language, entry] of Object.entries(REGISTRY)) {
    // Deduplicate availability check by command
    const key = entry.command;
    let available: boolean;
    if (seen.has(key)) {
      available = results.find((r) => r.command === key)?.available ?? false;
    } else {
      // Check managed npm install, managed binary, then system PATH
      const managedNpmBin = join(LSP_DIR, 'node_modules', '.bin', entry.command);
      const managedBin = join(LSP_DIR, 'bin', entry.command);
      available =
        existsSync(managedNpmBin) || existsSync(managedBin) || Bun.which(entry.command) !== null;
    }
    seen.add(key);

    results.push({
      language,
      command: entry.command,
      args: entry.args,
      available,
      installable: !!(entry.npmPackage || entry.binaryDownload),
      npmPackage: entry.npmPackage,
      binaryDownload: entry.binaryDownload,
      systemInstallHint: entry.systemInstallHint,
    });
  }

  return results;
}
