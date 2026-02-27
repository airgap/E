/**
 * change-preview.svelte.ts — Store for multi-file change preview.
 *
 * Manages a "preview plan" of proposed file changes with per-file and
 * per-hunk accept/reject controls. Used when AI proposes changes to
 * multiple files that the user should review before applying.
 */

import { api } from '$lib/api/client';
import { uuid } from '$lib/utils/uuid';

// ── Types ──

export type FileStatus = 'pending' | 'accepted' | 'rejected';
export type HunkStatus = 'pending' | 'accepted' | 'rejected';

export interface PreviewHunk {
  id: string;
  /** Raw hunk header (@@ -a,b +c,d @@) */
  header: string;
  /** Lines in this hunk (including +, -, and context) */
  lines: string[];
  status: HunkStatus;
}

export interface PreviewFile {
  path: string;
  before: string;
  after: string;
  /** Raw unified diff content for this file */
  diffContent: string;
  /** Parsed hunks with individual status */
  hunks: PreviewHunk[];
  status: FileStatus;
  /** Lines added (derived from diff) */
  linesAdded: number;
  /** Lines removed (derived from diff) */
  linesRemoved: number;
}

export interface ChangePreviewPlan {
  id: string;
  /** Human-readable summary of the changes */
  summary: string;
  files: PreviewFile[];
  createdAt: number;
}

// ── Diff Helpers ──

function parseHunks(diffContent: string): PreviewHunk[] {
  const hunks: PreviewHunk[] = [];
  const lines = diffContent.split('\n');
  let current: PreviewHunk | null = null;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current) hunks.push(current);
      current = { id: uuid(), header: line, lines: [], status: 'pending' };
    } else if (current) {
      // Skip meta lines
      if (
        line.startsWith('diff ') ||
        line.startsWith('index ') ||
        line.startsWith('--- ') ||
        line.startsWith('+++ ')
      ) {
        continue;
      }
      current.lines.push(line);
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

function countStats(diffContent: string): { added: number; removed: number } {
  const lines = diffContent.split('\n');
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.startsWith('+') && !l.startsWith('+++')) added++;
    if (l.startsWith('-') && !l.startsWith('---')) removed++;
  }
  return { added, removed };
}

/**
 * Generate a unified diff between before and after content.
 * This is a simple line-based diff (not a real Myers diff),
 * suitable for display purposes.
 */
function generateSimpleDiff(path: string, before: string, after: string): string {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');

  // Simple: show entire file as removed then added (for files where
  // we only have before/after content, not a real diff from git)
  const diffLines: string[] = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
  ];

  for (const l of beforeLines) {
    diffLines.push(`-${l}`);
  }
  for (const l of afterLines) {
    diffLines.push(`+${l}`);
  }

  return diffLines.join('\n');
}

// ── Store ──

function createChangePreviewStore() {
  let plan = $state<ChangePreviewPlan | null>(null);
  let selectedFilePath = $state<string | null>(null);

  return {
    get plan() {
      return plan;
    },
    get hasPlan() {
      return plan !== null;
    },
    get selectedFilePath() {
      return selectedFilePath;
    },
    get selectedFile(): PreviewFile | null {
      if (!plan || !selectedFilePath) return null;
      return plan.files.find((f) => f.path === selectedFilePath) ?? null;
    },
    get stats() {
      if (!plan) return { total: 0, pending: 0, accepted: 0, rejected: 0 };
      return {
        total: plan.files.length,
        pending: plan.files.filter((f) => f.status === 'pending').length,
        accepted: plan.files.filter((f) => f.status === 'accepted').length,
        rejected: plan.files.filter((f) => f.status === 'rejected').length,
      };
    },

    /** Create a new preview plan from file changes. */
    createPlan(
      summary: string,
      files: Array<{ path: string; before: string; after: string; diffContent?: string }>,
    ): string {
      const id = uuid();
      const previewFiles: PreviewFile[] = files.map((f) => {
        const diff = f.diffContent || generateSimpleDiff(f.path, f.before, f.after);
        const stats = countStats(diff);
        return {
          path: f.path,
          before: f.before,
          after: f.after,
          diffContent: diff,
          hunks: parseHunks(diff),
          status: 'pending' as FileStatus,
          linesAdded: stats.added,
          linesRemoved: stats.removed,
        };
      });

      plan = {
        id,
        summary,
        files: previewFiles,
        createdAt: Date.now(),
      };

      selectedFilePath = previewFiles[0]?.path ?? null;
      return id;
    },

    /** Select a file in the preview panel. */
    selectFile(path: string) {
      selectedFilePath = path;
    },

    /** Accept a specific file. */
    acceptFile(path: string) {
      if (!plan) return;
      const file = plan.files.find((f) => f.path === path);
      if (file) {
        file.status = 'accepted';
        // Also accept all its hunks
        for (const h of file.hunks) {
          h.status = 'accepted';
        }
      }
    },

    /** Reject a specific file. */
    rejectFile(path: string) {
      if (!plan) return;
      const file = plan.files.find((f) => f.path === path);
      if (file) {
        file.status = 'rejected';
        // Also reject all its hunks
        for (const h of file.hunks) {
          h.status = 'rejected';
        }
      }
    },

    /** Accept a specific hunk. */
    acceptHunk(filePath: string, hunkId: string) {
      if (!plan) return;
      const file = plan.files.find((f) => f.path === filePath);
      if (!file) return;
      const hunk = file.hunks.find((h) => h.id === hunkId);
      if (hunk) hunk.status = 'accepted';
      // Update file status based on hunk statuses
      this._updateFileStatus(file);
    },

    /** Reject a specific hunk. */
    rejectHunk(filePath: string, hunkId: string) {
      if (!plan) return;
      const file = plan.files.find((f) => f.path === filePath);
      if (!file) return;
      const hunk = file.hunks.find((h) => h.id === hunkId);
      if (hunk) hunk.status = 'rejected';
      this._updateFileStatus(file);
    },

    /** Accept all pending files. */
    acceptAll() {
      if (!plan) return;
      for (const file of plan.files) {
        if (file.status === 'pending') {
          file.status = 'accepted';
          for (const h of file.hunks) {
            if (h.status === 'pending') h.status = 'accepted';
          }
        }
      }
    },

    /** Reject all pending files. */
    rejectAll() {
      if (!plan) return;
      for (const file of plan.files) {
        if (file.status === 'pending') {
          file.status = 'rejected';
          for (const h of file.hunks) {
            if (h.status === 'pending') h.status = 'rejected';
          }
        }
      }
    },

    /**
     * Apply all accepted files. Writes accepted file content to disk.
     * Returns the number of files applied.
     */
    async applyAccepted(): Promise<number> {
      if (!plan) return 0;
      let applied = 0;

      for (const file of plan.files) {
        if (file.status !== 'accepted') continue;

        try {
          await api.files.write(file.path, file.after);
          applied++;
        } catch (err) {
          console.error(`Failed to write ${file.path}:`, err);
        }
      }

      // Clear the plan after applying
      plan = null;
      selectedFilePath = null;
      return applied;
    },

    /** Discard the entire plan without applying. */
    discard() {
      plan = null;
      selectedFilePath = null;
    },

    /** Internal: update file status based on hunk statuses. */
    _updateFileStatus(file: PreviewFile) {
      const all = file.hunks;
      if (all.length === 0) return;

      const allAccepted = all.every((h) => h.status === 'accepted');
      const allRejected = all.every((h) => h.status === 'rejected');

      if (allAccepted) file.status = 'accepted';
      else if (allRejected) file.status = 'rejected';
      else file.status = 'pending';
    },
  };
}

export const changePreviewStore = createChangePreviewStore();
