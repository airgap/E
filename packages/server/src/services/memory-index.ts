/**
 * MEMORY.md Index Pattern
 *
 * Maintains a MEMORY.md index file in workspace/project directories.
 * Each memory entry is a separate .md file with frontmatter, and
 * MEMORY.md acts as a table of contents linking to them.
 *
 * Pattern from Claude Code's auto-memory system.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, basename } from 'path';

export interface MemoryEntry {
  name: string;
  description: string;
  type: 'user' | 'feedback' | 'project' | 'reference';
  filename: string;
  content: string;
}

const MEMORY_DIR_NAME = '.e/memory';
const INDEX_FILE = 'MEMORY.md';

/**
 * Ensure the memory directory exists.
 */
function ensureMemoryDir(workspacePath: string): string {
  const memDir = join(workspacePath, MEMORY_DIR_NAME);
  mkdirSync(memDir, { recursive: true });
  return memDir;
}

/**
 * Parse frontmatter from a memory file.
 */
function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: match[2].trim() };
}

/**
 * Read all memory entries from a workspace.
 */
export function readMemoryEntries(workspacePath: string): MemoryEntry[] {
  const memDir = join(workspacePath, MEMORY_DIR_NAME);
  if (!existsSync(memDir)) return [];

  const entries: MemoryEntry[] = [];
  const files = readdirSync(memDir).filter((f) => f.endsWith('.md') && f !== INDEX_FILE);

  for (const file of files) {
    try {
      const raw = readFileSync(join(memDir, file), 'utf-8');
      const { meta, body } = parseFrontmatter(raw);
      entries.push({
        name: meta.name || file.replace('.md', ''),
        description: meta.description || '',
        type: (meta.type as MemoryEntry['type']) || 'project',
        filename: file,
        content: body,
      });
    } catch {
      // Skip unreadable files
    }
  }

  return entries;
}

/**
 * Write a memory entry and update the index.
 */
export function writeMemoryEntry(
  workspacePath: string,
  entry: Omit<MemoryEntry, 'filename'>,
): MemoryEntry {
  const memDir = ensureMemoryDir(workspacePath);
  const slug = entry.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const filename = `${entry.type}_${slug}.md`;

  const fileContent = `---
name: ${entry.name}
description: ${entry.description}
type: ${entry.type}
---

${entry.content}
`;

  writeFileSync(join(memDir, filename), fileContent);
  rebuildIndex(workspacePath);

  return { ...entry, filename };
}

/**
 * Update an existing memory entry.
 */
export function updateMemoryEntry(
  workspacePath: string,
  filename: string,
  updates: Partial<Omit<MemoryEntry, 'filename'>>,
): MemoryEntry | null {
  const memDir = join(workspacePath, MEMORY_DIR_NAME);
  const filePath = join(memDir, filename);
  if (!existsSync(filePath)) return null;

  const raw = readFileSync(filePath, 'utf-8');
  const { meta, body } = parseFrontmatter(raw);

  const updated: MemoryEntry = {
    name: updates.name || meta.name || filename.replace('.md', ''),
    description: updates.description || meta.description || '',
    type: (updates.type || meta.type || 'project') as MemoryEntry['type'],
    filename,
    content: updates.content || body,
  };

  const fileContent = `---
name: ${updated.name}
description: ${updated.description}
type: ${updated.type}
---

${updated.content}
`;

  writeFileSync(filePath, fileContent);
  rebuildIndex(workspacePath);

  return updated;
}

/**
 * Delete a memory entry.
 */
export function deleteMemoryEntry(workspacePath: string, filename: string): boolean {
  const filePath = join(workspacePath, MEMORY_DIR_NAME, filename);
  if (!existsSync(filePath)) return false;

  unlinkSync(filePath);
  rebuildIndex(workspacePath);
  return true;
}

/**
 * Rebuild the MEMORY.md index from all entries.
 */
export function rebuildIndex(workspacePath: string): void {
  const memDir = ensureMemoryDir(workspacePath);
  const entries = readMemoryEntries(workspacePath);

  // Group by type
  const grouped = new Map<string, MemoryEntry[]>();
  for (const entry of entries) {
    const list = grouped.get(entry.type) || [];
    list.push(entry);
    grouped.set(entry.type, list);
  }

  const lines: string[] = ['# E Project Memory', ''];

  const typeOrder = ['user', 'feedback', 'project', 'reference'];
  const typeLabels: Record<string, string> = {
    user: 'User Context',
    feedback: 'Feedback & Guidance',
    project: 'Project State',
    reference: 'External References',
  };

  for (const type of typeOrder) {
    const list = grouped.get(type);
    if (!list?.length) continue;

    lines.push(`## ${typeLabels[type] || type}`);
    for (const entry of list) {
      const hook = entry.description || entry.content.split('\n')[0].slice(0, 100);
      lines.push(`- [${entry.name}](${entry.filename}) — ${hook}`);
    }
    lines.push('');
  }

  writeFileSync(join(memDir, INDEX_FILE), lines.join('\n'));
}

/**
 * Read the MEMORY.md index contents.
 */
export function readIndex(workspacePath: string): string {
  const indexPath = join(workspacePath, MEMORY_DIR_NAME, INDEX_FILE);
  if (!existsSync(indexPath)) return '';
  return readFileSync(indexPath, 'utf-8');
}
