/**
 * formatter-detector.ts — Detect available formatters for a workspace.
 *
 * Checks for config files (.prettierrc, pyproject.toml, rustfmt.toml, etc.)
 * and determines which formatter to use for each language.
 */

import { existsSync } from 'fs';
import { join } from 'path';

export interface FormatterInfo {
  /** Formatter name (e.g. 'prettier', 'black', 'rustfmt') */
  name: string;
  /** Shell command to run the formatter */
  command: string;
  /** Arguments (file path appended at the end) */
  args: string[];
  /** Languages this formatter supports */
  languages: string[];
}

/** Config file patterns that indicate a formatter is configured. */
const FORMATTER_CONFIGS: Array<{
  files: string[];
  formatter: FormatterInfo;
}> = [
  {
    files: [
      '.prettierrc',
      '.prettierrc.json',
      '.prettierrc.yml',
      '.prettierrc.yaml',
      '.prettierrc.js',
      '.prettierrc.cjs',
      '.prettierrc.mjs',
      'prettier.config.js',
      'prettier.config.cjs',
      'prettier.config.mjs',
    ],
    formatter: {
      name: 'prettier',
      command: 'npx',
      args: ['prettier', '--write'],
      languages: ['javascript', 'typescript', 'css', 'html', 'json', 'yaml', 'markdown', 'svelte'],
    },
  },
  {
    files: ['.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', 'eslint.config.js'],
    formatter: {
      name: 'eslint',
      command: 'npx',
      args: ['eslint', '--fix'],
      languages: ['javascript', 'typescript', 'svelte'],
    },
  },
  {
    files: ['biome.json', 'biome.jsonc'],
    formatter: {
      name: 'biome',
      command: 'npx',
      args: ['@biomejs/biome', 'format', '--write'],
      languages: ['javascript', 'typescript', 'json', 'css'],
    },
  },
  {
    files: ['rustfmt.toml', '.rustfmt.toml'],
    formatter: {
      name: 'rustfmt',
      command: 'rustfmt',
      args: [],
      languages: ['rust'],
    },
  },
];

/** Always-available formatters (no config file needed). */
const BUILTIN_FORMATTERS: Record<string, FormatterInfo> = {
  go: {
    name: 'gofmt',
    command: 'gofmt',
    args: ['-w'],
    languages: ['go'],
  },
  python: {
    name: 'black',
    command: 'python3',
    args: ['-m', 'black', '-q'],
    languages: ['python'],
  },
};

/**
 * Detect which formatters are available for a workspace.
 */
export function detectFormatters(workspacePath: string): FormatterInfo[] {
  const formatters: FormatterInfo[] = [];
  const seen = new Set<string>();

  // Check config-based formatters
  for (const entry of FORMATTER_CONFIGS) {
    for (const file of entry.files) {
      if (existsSync(join(workspacePath, file))) {
        if (!seen.has(entry.formatter.name)) {
          seen.add(entry.formatter.name);
          formatters.push(entry.formatter);
        }
        break;
      }
    }
  }

  // Add built-in formatters
  for (const [, info] of Object.entries(BUILTIN_FORMATTERS)) {
    if (!seen.has(info.name)) {
      seen.add(info.name);
      formatters.push(info);
    }
  }

  return formatters;
}

/**
 * Find the best formatter for a given language in a workspace.
 */
export function findFormatterForLanguage(
  workspacePath: string,
  language: string,
): FormatterInfo | null {
  const formatters = detectFormatters(workspacePath);
  return formatters.find((f) => f.languages.includes(language)) ?? null;
}
