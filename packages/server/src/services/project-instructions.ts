/**
 * Project Instructions Loader
 *
 * Auto-discovers and loads project instruction files (E.md, CLAUDE.md,
 * .e/instructions.md) from the workspace directory tree and global config.
 * Used by CLI, stream routes, and webhook executor.
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { homedir } from 'os';

const INSTRUCTION_FILES = ['E.md', 'CLAUDE.md', '.e/instructions.md'];

/**
 * Load project instructions by walking up the directory tree from the
 * workspace root, then checking global ~/.e/instructions.md.
 *
 * Returns a tagged string suitable for injection into the system prompt,
 * or an empty string if no instruction files are found.
 */
export function loadProjectInstructions(workspacePath: string): string {
  const found: string[] = [];

  // 1. Walk up from workspace to filesystem root
  let dir = resolve(workspacePath);
  const visited = new Set<string>();
  while (dir && !visited.has(dir)) {
    visited.add(dir);
    for (const file of INSTRUCTION_FILES) {
      const p = join(dir, file);
      if (existsSync(p)) {
        try {
          const content = readFileSync(p, 'utf-8').trim();
          if (content) {
            found.push(`# [${file} from ${dir}]\n${content}`);
          }
        } catch {}
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 2. Global instructions
  const globalPath = join(homedir(), '.e', 'instructions.md');
  if (existsSync(globalPath)) {
    try {
      const content = readFileSync(globalPath, 'utf-8').trim();
      if (content) {
        found.push(`# [Global instructions]\n${content}`);
      }
    } catch {}
  }

  return found.length > 0
    ? `<project_instructions>\n${found.join('\n\n')}\n</project_instructions>`
    : '';
}
