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
  // SCSS is served by the same vscode-css-language-server — it switches mode by
  // the `languageId` ("scss") the client sends, so it must have its own registry
  // key to get a distinct instance + the right languageId. (Indented `.sass`
  // isn't supported by this server, so there's no `sass` entry — it's
  // highlight-only.)
  scss: {
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
  'parabun-ts': {
    command: 'parabun',
    args: ['run', '/raid/parabun/editors/lsp/parabun-lsp.ts', '--stdio'],
    systemInstallHint: 'ln -s /path/to/parabun/build/release/bun /usr/local/bin/parabun',
  },
  'parabun-tsx': {
    command: 'parabun',
    args: ['run', '/raid/parabun/editors/lsp/parabun-lsp.ts', '--stdio'],
    systemInstallHint: 'ln -s /path/to/parabun/build/release/bun /usr/local/bin/parabun',
  },
  'parabun-js': {
    command: 'parabun',
    args: ['run', '/raid/parabun/editors/lsp/parabun-lsp.ts', '--stdio'],
    systemInstallHint: 'ln -s /path/to/parabun/build/release/bun /usr/local/bin/parabun',
  },
  'parabun-jsx': {
    command: 'parabun',
    args: ['run', '/raid/parabun/editors/lsp/parabun-lsp.ts', '--stdio'],
    systemInstallHint: 'ln -s /path/to/parabun/build/release/bun /usr/local/bin/parabun',
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

// ── Plugin LSP overrides ───────────────────────────────────────────────
//
// Plugins that declare `lsp` contributions in their manifest register
// here at enable time. Overrides take precedence over the built-in
// REGISTRY so plugins can ship LSPs for languages we already know about
// (e.g. a custom typescript LSP) OR for entirely new languages.
//
// The map key is the language id; value carries the resolved absolute
// command + the source pluginId so we can unregister cleanly when the
// plugin is disabled or uninstalled.

interface PluginLspOverride {
  command: string;
  args: string[];
  pluginId: string;
}

const pluginLspOverrides = new Map<string, PluginLspOverride>();
/** Extension → language map contributed by plugins. */
const pluginExtensionToLanguage = new Map<string, string>();

export function registerPluginLsp(
  pluginId: string,
  language: string,
  command: string,
  args: string[],
  extensions: string[],
): void {
  pluginLspOverrides.set(language, { command, args, pluginId });
  for (const ext of extensions) {
    const norm = ext.startsWith('.') ? ext : `.${ext}`;
    pluginExtensionToLanguage.set(norm, language);
  }
}

export function unregisterPluginLsps(pluginId: string): string[] {
  const removedLanguages: string[] = [];
  for (const [lang, override] of pluginLspOverrides) {
    if (override.pluginId === pluginId) {
      pluginLspOverrides.delete(lang);
      removedLanguages.push(lang);
    }
  }
  // Drop extension mappings whose language is no longer registered.
  for (const [ext, lang] of pluginExtensionToLanguage) {
    if (!pluginLspOverrides.has(lang)) pluginExtensionToLanguage.delete(ext);
  }
  return removedLanguages;
}

/**
 * Find the language id for a file extension via plugin contributions.
 * Returns null when no plugin claims this extension.
 */
export function pluginLanguageForExtension(ext: string): string | null {
  const norm = ext.startsWith('.') ? ext : `.${ext}`;
  return pluginExtensionToLanguage.get(norm) ?? null;
}

/**
 * Look up the LSP command for a given language.
 * Resolves plugin overrides first, then ~/.e/lsp/node_modules/.bin/, then
 * system PATH.
 */
export function getLspCommand(language: string): { command: string; args: string[] } | null {
  // Plugin overrides win — they're the user's explicit registration.
  const override = pluginLspOverrides.get(language);
  if (override) return { command: override.command, args: override.args };

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
