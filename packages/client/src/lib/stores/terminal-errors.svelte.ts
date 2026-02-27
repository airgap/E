/**
 * terminal-errors.svelte.ts — Reactive store for terminal error locations.
 *
 * Tracks error locations parsed from failed command outputs, keyed by
 * command block ID. Used by CommandBlockOverlay to show "Jump to error"
 * buttons and optionally by the editor to display terminal-sourced
 * diagnostics inline.
 */

import type { ErrorLocation } from '$lib/services/error-location-parser';

function createTerminalErrorsStore() {
  /** Map of blockId → parsed error locations */
  let errorMap = $state<Map<string, ErrorLocation[]>>(new Map());

  /** Counter to trigger reactivity (maps don't trigger $derived on mutation) */
  let version = $state(0);

  return {
    /** Get error locations for a specific command block */
    getErrors(blockId: string): ErrorLocation[] {
      // Access version to ensure reactivity
      void version;
      return errorMap.get(blockId) ?? [];
    },

    /** Check if a block has any detected errors */
    hasErrors(blockId: string): boolean {
      void version;
      return (errorMap.get(blockId)?.length ?? 0) > 0;
    },

    /** Get the first error for a block (most useful for "jump to first error") */
    getFirstError(blockId: string): ErrorLocation | null {
      void version;
      const errors = errorMap.get(blockId);
      return errors?.[0] ?? null;
    },

    /** Get error count for a block */
    getErrorCount(blockId: string): number {
      void version;
      return errorMap.get(blockId)?.length ?? 0;
    },

    /** Store parsed errors for a command block */
    setErrors(blockId: string, errors: ErrorLocation[]) {
      if (errors.length === 0) {
        errorMap.delete(blockId);
      } else {
        errorMap.set(blockId, errors);
      }
      version++;
    },

    /** Clear errors for a specific block */
    clearBlock(blockId: string) {
      if (errorMap.has(blockId)) {
        errorMap.delete(blockId);
        version++;
      }
    },

    /** Clear all stored errors */
    clearAll() {
      errorMap.clear();
      version++;
    },

    /** Get all error locations across all blocks for a specific file */
    getErrorsForFile(filePath: string): ErrorLocation[] {
      void version;
      const results: ErrorLocation[] = [];
      for (const errors of errorMap.values()) {
        for (const err of errors) {
          if (err.file === filePath) {
            results.push(err);
          }
        }
      }
      return results;
    },
  };
}

export const terminalErrorsStore = createTerminalErrorsStore();
