/**
 * E CLI — High-Fidelity TUI Theme (V5 Gutter)
 */

import chalk from 'chalk';
import gradient from 'gradient-string';
import boxen from 'boxen';

const eGradient = gradient(['#00DBDE', '#FC00FF']); // Cyan to Magenta

export const theme = {
  // Brand & Banners
  banner: (version: string) => {
    const logo = [
      'EE         EE',
      'E EEEEEEEEE E',
      '  EEEEEEEEE',
      '  EEE',
      '  EEE',
      '  EEEEEEEE',
      '  EEEEEEEE',
      '  EEE',
      '  EEE',
      '  EEEEEEEEE',
      'E EEEEEEEEE E',
      'EE         EE',
    ];

    const info = [
      '',
      `${chalk.bold.white(' E AGENT PLATFORM ')}`,
      `${chalk.dim(' ──────────────── ')}`,
      `${chalk.cyan(' Version: ')} ${chalk.white(version)}`,
      `${chalk.cyan(' Engine:  ')} ${chalk.white('Bun ' + Bun.version)}`,
      `${chalk.cyan(' Models:  ')} ${chalk.white('Gemini / Claude')}`,
      `${chalk.cyan(' Mode:    ')} ${chalk.white('Autonomous Agent')}`,
      '',
      `${chalk.italic.gray(' Powered by Google Gemini 2.0 ')}`,
    ];

    const maxLogoWidth = Math.max(...logo.map((l) => l.length));
    const combined = logo
      .map((line, i) => {
        const paddedLogo = line.padEnd(maxLogoWidth, ' ');
        const infoLine = info[i] || '';
        return eGradient(paddedLogo) + '    ' + infoLine;
      })
      .join('\n');

    return `\n${combined}\n`;
  },

  brand: (s: string) => eGradient(s),
  version: (v: string) => chalk.dim(`v${v}`),

  // Modifiers
  bold: (s: string) => chalk.bold(s),
  dim: (s: string) => chalk.dim(s),
  italic: (s: string) => chalk.italic(s),
  cyan: (s: string) => chalk.cyan(s),
  magenta: (s: string) => chalk.magenta(s),
  yellow: (s: string) => chalk.yellow(s),

  // Gutter System
  gutter: {
    line: (depth: number) =>
      depth === 0 ? chalk.dim('│ ') : ' '.repeat(depth * 2) + chalk.magenta('│ '),
    connector: (depth: number) =>
      depth === 0 ? chalk.dim('├─') : ' '.repeat(depth * 2) + chalk.magenta('├─'),
    end: (depth: number) =>
      depth === 0 ? chalk.dim('└─') : ' '.repeat(depth * 2) + chalk.magenta('└─'),
    blank: (depth: number) => (depth === 0 ? '  ' : ' '.repeat(depth * 2) + '  '),
  },

  // Roles
  user: (s: string) => `${chalk.bold.cyan('❯ ')}${s}`,
  assistant: (s: string) => chalk.bgCyan.black.bold(` E `) + ` `,
  system: (s: string) => chalk.dim(`[system] ${s}`),

  // Tools
  toolHeader: (name: string) => chalk.bold.yellow(`⚡ ${name}`),
  toolInput: (input: string) => chalk.gray(input),
  toolResult: (res: string) => chalk.green(`✓ ${res}`),
  toolError: (err: string) => chalk.red(`✘ ${err}`),

  // Status Bar
  status: (model: string, sessionId: string) => {
    const parts = [
      chalk.bgBlue.white.bold(` MODEL `) + ` ${chalk.blue(model)}`,
      chalk.bgMagenta.white.bold(` SESSION `) + ` ${chalk.magenta(sessionId.slice(0, 8))}`,
    ];
    return `\n${parts.join('  ')}\n`;
  },

  // UI Elements
  divider: () => chalk.dim('━'.repeat(process.stdout.columns || 50)),
  prompt: (s: string) => `${chalk.bold.cyan('❯ ')}${s}`,
  error: (s: string) => chalk.bold.red(`Error: ${s}`),
  warning: (s: string) => chalk.bold.yellow(`⚠ ${s}`),
  success: (s: string) => chalk.bold.green(`✓ ${s}`),
  info: (s: string) => chalk.bold.blue(`ℹ ${s}`),
};

export function clearLine() {
  process.stdout.write('\x1b[2K\r');
}
