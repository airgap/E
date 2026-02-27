/**
 * Merge conflicts store — tracks conflicted files across the workspace
 * and manages AI-assisted merge resolution.
 */

import { api } from '$lib/api/client';
import { gitStore } from '$lib/stores/git.svelte';
import type { ConflictRegion } from '$lib/components/editor/extensions/merge-conflict';

export interface ConflictFile {
  path: string;
  /** Number of conflict regions detected in the file */
  conflictCount: number;
  /** Whether an AI merge is in progress for this file */
  aiMerging: boolean;
}

function createMergeConflictsStore() {
  let conflictFiles = $state<ConflictFile[]>([]);
  let aiMergeLoading = $state<string | null>(null); // file path currently being AI-merged

  // Derive from gitStore: files with 'UU' or 'U' status indicate conflicts
  // The git status 'U' prefix indicates unmerged paths (conflicts)
  const detectedConflicts = $derived(
    gitStore.fileStatuses.filter(
      (f) =>
        f.status === 'UU' ||
        f.status === 'AA' ||
        f.status === 'DD' ||
        f.status === 'AU' ||
        f.status === 'UA' ||
        f.status === 'DU' ||
        f.status === 'UD',
    ),
  );

  const hasConflicts = $derived(detectedConflicts.length > 0);
  const conflictCount = $derived(detectedConflicts.length);

  function updateConflictFile(path: string, count: number) {
    const existing = conflictFiles.find((f) => f.path === path);
    if (existing) {
      existing.conflictCount = count;
    } else {
      conflictFiles = [...conflictFiles, { path, conflictCount: count, aiMerging: false }];
    }
  }

  function removeConflictFile(path: string) {
    conflictFiles = conflictFiles.filter((f) => f.path !== path);
  }

  function setAiMerging(path: string, merging: boolean) {
    aiMergeLoading = merging ? path : null;
    const file = conflictFiles.find((f) => f.path === path);
    if (file) {
      file.aiMerging = merging;
    }
  }

  /**
   * Request AI-assisted merge for a specific conflict region in a file.
   * Sends the file content + conflict context to the LLM and returns merged text.
   */
  async function requestAiMerge(
    workspacePath: string,
    filePath: string,
    region: ConflictRegion,
    fileContent: string,
  ): Promise<{ ok: boolean; mergedText?: string; error?: string }> {
    setAiMerging(filePath, true);
    try {
      const res = await api.git.aiMerge(workspacePath, filePath, fileContent, region);
      if (res.ok && res.data?.mergedText) {
        return { ok: true, mergedText: res.data.mergedText };
      }
      return { ok: false, error: res.error || 'AI merge failed' };
    } catch (err) {
      return { ok: false, error: String(err) };
    } finally {
      setAiMerging(filePath, false);
    }
  }

  function clear() {
    conflictFiles = [];
    aiMergeLoading = null;
  }

  return {
    get conflictFiles() {
      return conflictFiles;
    },
    get detectedConflicts() {
      return detectedConflicts;
    },
    get hasConflicts() {
      return hasConflicts;
    },
    get conflictCount() {
      return conflictCount;
    },
    get aiMergeLoading() {
      return aiMergeLoading;
    },
    updateConflictFile,
    removeConflictFile,
    setAiMerging,
    requestAiMerge,
    clear,
  };
}

export const mergeConflictsStore = createMergeConflictsStore();
