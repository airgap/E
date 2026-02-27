/**
 * Store for proactive AI warnings — tracks per-file warnings from
 * the AI proactive review system and dismissed state.
 */

import { api } from '$lib/api/client';

export interface ProactiveWarning {
  line: number;
  message: string;
  severity: 'info' | 'warning' | 'error';
  category: string;
}

interface FileWarnings {
  warnings: ProactiveWarning[];
  fetchedAt: number;
  fetching: boolean;
}

function createProactiveWarningsStore() {
  // Map<filePath, FileWarnings>
  let warningsMap = $state<Map<string, FileWarnings>>(new Map());
  // Set of dismissed warning keys: "filePath:line:message"
  let dismissed = $state<Set<string>>(new Set());

  function dismissKey(filePath: string, warning: ProactiveWarning): string {
    return `${filePath}:${warning.line}:${warning.message}`;
  }

  return {
    /**
     * Get active (non-dismissed) warnings for a file.
     */
    getWarnings(filePath: string): ProactiveWarning[] {
      const entry = warningsMap.get(filePath);
      if (!entry) return [];
      return entry.warnings.filter((w) => !dismissed.has(dismissKey(filePath, w)));
    },

    /**
     * Whether a file is currently being analyzed.
     */
    isFetching(filePath: string): boolean {
      return warningsMap.get(filePath)?.fetching ?? false;
    },

    /**
     * Request a proactive review for a file's content.
     * Debounced externally by the CM6 extension (5s after last edit).
     */
    async analyze(filePath: string, content: string, language?: string): Promise<void> {
      // Mark as fetching
      const existing = warningsMap.get(filePath);
      const next = new Map(warningsMap);
      next.set(filePath, {
        warnings: existing?.warnings ?? [],
        fetchedAt: existing?.fetchedAt ?? 0,
        fetching: true,
      });
      warningsMap = next;

      try {
        const res = await api.review.proactive(content, filePath, language);
        if (res.ok && res.data?.warnings) {
          const updated = new Map(warningsMap);
          updated.set(filePath, {
            warnings: res.data.warnings,
            fetchedAt: Date.now(),
            fetching: false,
          });
          warningsMap = updated;
        } else {
          const updated = new Map(warningsMap);
          updated.set(filePath, {
            warnings: [],
            fetchedAt: Date.now(),
            fetching: false,
          });
          warningsMap = updated;
        }
      } catch {
        // Silently fail — proactive warnings are non-critical
        const updated = new Map(warningsMap);
        const current = updated.get(filePath);
        if (current) {
          updated.set(filePath, { ...current, fetching: false });
          warningsMap = updated;
        }
      }
    },

    /**
     * Dismiss a specific warning (session-scoped, not persisted).
     */
    dismiss(filePath: string, warning: ProactiveWarning) {
      dismissed = new Set([...dismissed, dismissKey(filePath, warning)]);
    },

    /**
     * Clear all warnings for a file.
     */
    clear(filePath: string) {
      const next = new Map(warningsMap);
      next.delete(filePath);
      warningsMap = next;
    },

    /**
     * Clear all dismissed warnings (reset).
     */
    resetDismissed() {
      dismissed = new Set();
    },
  };
}

export const proactiveWarningsStore = createProactiveWarningsStore();
