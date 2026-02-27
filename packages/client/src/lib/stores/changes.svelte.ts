/**
 * Change tracking store — records file modifications during agent/streaming
 * execution and provides a structured summary for review.
 */

export interface FileChange {
  path: string;
  toolName: string;
  toolCallId: string;
  timestamp: number;
  /** Snapshot of file content before the change (if available) */
  before?: string;
  /** Snippet from the tool input showing what was changed */
  summary: string;
  /** Agent's reasoning for why this change was made */
  reasoning?: string;
}

export interface ChangeGroup {
  path: string;
  changes: FileChange[];
  linesAdded: number;
  linesRemoved: number;
  status: 'pending' | 'accepted' | 'rejected';
}

function createChangesStore() {
  let changes = $state<FileChange[]>([]);
  let groups = $state<ChangeGroup[]>([]);
  let tracking = $state(false);
  let visible = $state(false);

  function computeGroups() {
    const byPath = new Map<string, FileChange[]>();
    for (const c of changes) {
      const arr = byPath.get(c.path) || [];
      arr.push(c);
      byPath.set(c.path, arr);
    }
    groups = Array.from(byPath.entries()).map(([path, fileChanges]) => {
      // Estimate lines changed from summaries
      let added = 0;
      let removed = 0;
      for (const c of fileChanges) {
        const lines = c.summary.split('\n').length;
        if (c.toolName === 'Write' || c.toolName === 'write_file' || c.toolName === 'create_file') {
          added += lines;
        } else if (
          c.toolName === 'Edit' ||
          c.toolName === 'str_replace_editor' ||
          c.toolName === 'edit_file'
        ) {
          // Rough estimate: equal parts add/remove for edits
          added += Math.ceil(lines / 2);
          removed += Math.floor(lines / 2);
        }
      }
      // Preserve existing status if group already exists
      const existing = groups.find((g) => g.path === path);
      return {
        path,
        changes: fileChanges,
        linesAdded: added,
        linesRemoved: removed,
        status: existing?.status ?? ('pending' as const),
      };
    });
  }

  return {
    get changes() {
      return changes;
    },
    get groups() {
      return groups;
    },
    get tracking() {
      return tracking;
    },
    get visible() {
      return visible;
    },
    get hasChanges() {
      return changes.length > 0;
    },
    get stats() {
      const totalFiles = groups.length;
      const totalAdded = groups.reduce((s, g) => s + g.linesAdded, 0);
      const totalRemoved = groups.reduce((s, g) => s + g.linesRemoved, 0);
      const pending = groups.filter((g) => g.status === 'pending').length;
      const accepted = groups.filter((g) => g.status === 'accepted').length;
      const rejected = groups.filter((g) => g.status === 'rejected').length;
      return { totalFiles, totalAdded, totalRemoved, pending, accepted, rejected };
    },

    startTracking() {
      tracking = true;
      changes = [];
      groups = [];
    },

    stopTracking() {
      tracking = false;
      if (changes.length > 0) {
        visible = true;
      }
    },

    recordChange(change: Omit<FileChange, 'timestamp'>) {
      if (!tracking) return;
      changes = [...changes, { ...change, timestamp: Date.now() }];
      computeGroups();
    },

    setGroupStatus(path: string, status: 'accepted' | 'rejected') {
      groups = groups.map((g) => (g.path === path ? { ...g, status } : g));
    },

    acceptAll() {
      groups = groups.map((g) => ({ ...g, status: 'accepted' as const }));
    },

    dismiss() {
      visible = false;
    },

    clear() {
      changes = [];
      groups = [];
      visible = false;
      tracking = false;
    },
  };
}

export const changesStore = createChangesStore();
