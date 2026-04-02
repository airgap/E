/**
 * Auto-Memory Loader
 *
 * Reads ~/.e/memory/MEMORY.md and returns its content wrapped for system
 * prompt injection. Used by CLI, stream routes, and webhook executor.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Load the auto-memory index from ~/.e/memory/MEMORY.md.
 * Returns a tagged string for system prompt injection, or empty string.
 */
export function loadAutoMemory(): string {
  const memoryDir = join(homedir(), '.e', 'memory');
  const indexPath = join(memoryDir, 'MEMORY.md');
  if (!existsSync(indexPath)) return '';
  try {
    const content = readFileSync(indexPath, 'utf-8').trim();
    if (!content) return '';
    return `<auto_memory>\n${content}\n</auto_memory>`;
  } catch {
    return '';
  }
}
