/**
 * Command History store — aggregates terminal command blocks across all sessions,
 * adds starring/search, and provides a unified history view.
 */

import { terminalStore } from '$lib/stores/terminal.svelte';
import type { TerminalCommandBlock } from '@e/shared';

export interface CommandHistoryEntry {
  /** Original block ID */
  blockId: string;
  /** Session ID this command belongs to */
  sessionId: string;
  /** The command text */
  command: string;
  /** Exit code (null if still running) */
  exitCode: number | null;
  /** When the command started (ms) */
  startedAt: number;
  /** When the command finished (ms, 0 if running) */
  finishedAt: number;
  /** Whether the user has starred this command */
  starred: boolean;
}

const STARRED_STORAGE_KEY = 'e-command-history-starred';

function loadStarred(): Set<string> {
  try {
    const raw = localStorage.getItem(STARRED_STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
}

function saveStarred(starred: Set<string>) {
  try {
    localStorage.setItem(STARRED_STORAGE_KEY, JSON.stringify([...starred]));
  } catch {}
}

function createCommandHistoryStore() {
  let starred = $state(loadStarred());
  let searchQuery = $state('');
  let filterStatus = $state<'all' | 'success' | 'failed' | 'starred'>('all');

  /** Aggregate all command blocks from all terminal sessions into a flat list. */
  const allEntries = $derived.by(() => {
    const entries: CommandHistoryEntry[] = [];
    const map = terminalStore.commandBlocksMap;

    for (const [sessionId, blocks] of map) {
      for (const block of blocks) {
        if (!block.commandText.trim()) continue; // Skip empty commands
        entries.push({
          blockId: block.id,
          sessionId,
          command: block.commandText,
          exitCode: block.exitCode,
          startedAt: block.startedAt,
          finishedAt: block.finishedAt,
          starred: starred.has(block.id),
        });
      }
    }

    // Sort by most recent first
    entries.sort((a, b) => b.startedAt - a.startedAt);
    return entries;
  });

  /** Filtered entries based on search query and status filter. */
  const filteredEntries = $derived.by(() => {
    let result = allEntries;

    // Filter by status
    if (filterStatus === 'success') {
      result = result.filter((e) => e.exitCode === 0);
    } else if (filterStatus === 'failed') {
      result = result.filter((e) => e.exitCode !== null && e.exitCode !== 0);
    } else if (filterStatus === 'starred') {
      result = result.filter((e) => e.starred);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((e) => e.command.toLowerCase().includes(q));
    }

    return result;
  });

  function toggleStar(blockId: string) {
    const next = new Set(starred);
    if (next.has(blockId)) {
      next.delete(blockId);
    } else {
      next.add(blockId);
    }
    starred = next;
    saveStarred(next);
  }

  function setSearch(query: string) {
    searchQuery = query;
  }

  function setFilter(filter: 'all' | 'success' | 'failed' | 'starred') {
    filterStatus = filter;
  }

  return {
    get allEntries() {
      return allEntries;
    },
    get filteredEntries() {
      return filteredEntries;
    },
    get searchQuery() {
      return searchQuery;
    },
    get filterStatus() {
      return filterStatus;
    },
    toggleStar,
    setSearch,
    setFilter,
  };
}

export const commandHistoryStore = createCommandHistoryStore();
