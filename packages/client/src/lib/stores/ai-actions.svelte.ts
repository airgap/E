/**
 * ai-actions.svelte.ts — Store for inline AI code actions.
 *
 * Tracks pending and completed AI actions triggered from the editor
 * context menu. Manages request lifecycle and result display.
 */

import { api } from '$lib/api/client';

// ── Types ──

export type ActionType =
  | 'explain'
  | 'optimize'
  | 'generate-test'
  | 'simplify'
  | 'fix-diagnostic'
  | 'document'
  | 'custom';

export interface AiAction {
  id: string;
  action: ActionType;
  code: string;
  filePath?: string;
  language?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  result?: string;
  error?: string;
  timestamp: number;
}

// ── Store ──

function createAiActionsStore() {
  let actions = $state<AiAction[]>([]);
  let activeActionId = $state<string | null>(null);

  /** Generate a simple unique ID */
  function genId(): string {
    return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  return {
    get actions() {
      return actions;
    },
    get activeAction(): AiAction | null {
      if (!activeActionId) return null;
      return actions.find((a) => a.id === activeActionId) ?? null;
    },
    get isRunning(): boolean {
      return actions.some((a) => a.status === 'running');
    },

    /** Execute an AI code action */
    async run(
      action: ActionType,
      code: string,
      options?: {
        filePath?: string;
        language?: string;
        diagnosticMessage?: string;
        customPrompt?: string;
      },
    ): Promise<AiAction> {
      const id = genId();
      const entry: AiAction = {
        id,
        action,
        code,
        filePath: options?.filePath,
        language: options?.language,
        status: 'running',
        timestamp: Date.now(),
      };

      actions = [entry, ...actions].slice(0, 50); // Keep last 50
      activeActionId = id;

      try {
        const resp = await api.ai.codeAction(code, action, options);
        const result = resp.data.result;

        actions = actions.map((a) =>
          a.id === id ? { ...a, status: 'completed' as const, result } : a,
        );

        return { ...entry, status: 'completed', result };
      } catch (err: any) {
        const error = err?.message || 'AI action failed';
        actions = actions.map((a) => (a.id === id ? { ...a, status: 'error' as const, error } : a));

        return { ...entry, status: 'error', error };
      }
    },

    /** Clear the active action result */
    clearActive() {
      activeActionId = null;
    },

    /** Dismiss a specific action */
    dismiss(id: string) {
      if (activeActionId === id) activeActionId = null;
      actions = actions.filter((a) => a.id !== id);
    },

    /** Clear all actions */
    clearAll() {
      actions = [];
      activeActionId = null;
    },
  };
}

export const aiActionsStore = createAiActionsStore();
