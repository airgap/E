/**
 * E CLI — Input Handler
 */

import * as readline from 'readline/promises';
import { theme } from './theme';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'fs';

const HISTORY_DIR = join(homedir(), '.e');
const HISTORY_FILE = join(HISTORY_DIR, 'history');

export async function promptUser(promptText = ''): Promise<string> {
  if (!existsSync(HISTORY_DIR)) {
    mkdirSync(HISTORY_DIR, { recursive: true });
  }

  const history: string[] = [];
  if (existsSync(HISTORY_FILE)) {
    history.push(...readFileSync(HISTORY_FILE, 'utf-8').split('\n').filter(Boolean).slice(-100));
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    history,
    historySize: 100,
  });

  try {
    const prompt = theme.prompt(promptText);
    const answer = await rl.question(prompt);
    const trimmed = answer.trim();
    if (trimmed) {
      appendFileSync(HISTORY_FILE, trimmed + '\n');
    }
    return trimmed;
  } finally {
    rl.close();
  }
}
