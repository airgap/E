import { api } from '$lib/api/client';

export interface AgentDefinition {
  id: string;
  handle: string;
  name: string;
  description: string;
  icon: string;
  tagline?: string;
  transport: 'claude-cli' | 'provider';
  provider?: string;
  model?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  enabled: boolean;
  source: 'builtin' | 'user';
}

function createAgentRegistryStore() {
  let agents = $state<AgentDefinition[]>([]);
  let loaded = $state(false);
  let loading = $state(false);

  return {
    get agents() {
      return agents;
    },
    get loaded() {
      return loaded;
    },
    get loading() {
      return loading;
    },

    /** Look up an agent by handle (case-insensitive) among enabled entries. */
    byHandle(handle: string): AgentDefinition | null {
      const target = handle.toLowerCase();
      return agents.find((a) => a.enabled && a.handle.toLowerCase() === target) ?? null;
    },

    /**
     * Rank enabled agents by fuzzy-prefix match against `query` (the text the
     * user has typed after `@`). Exact handle prefix wins; name prefix next;
     * anything else at the bottom.
     */
    search(query: string, limit = 8): AgentDefinition[] {
      const q = query.toLowerCase();
      const scored = agents
        .filter((a) => a.enabled)
        .map((a) => {
          const handleIdx = a.handle.toLowerCase().indexOf(q);
          const nameIdx = a.name.toLowerCase().indexOf(q);
          if (handleIdx === 0) return { a, score: 0 };
          if (nameIdx === 0) return { a, score: 1 };
          if (handleIdx > 0) return { a, score: 2 };
          if (nameIdx > 0) return { a, score: 3 };
          return { a, score: 10 };
        })
        .filter((s) => q === '' || s.score < 10)
        .sort((a, b) => a.score - b.score || a.a.handle.localeCompare(b.a.handle));
      return scored.slice(0, limit).map((s) => s.a);
    },

    /** Fetch the list once per session. Safe to call repeatedly. */
    async ensureLoaded(): Promise<void> {
      if (loaded || loading) return;
      loading = true;
      try {
        const res = await api.agentsRegistry.list();
        if (res.ok) {
          agents = res.data;
          loaded = true;
        }
      } catch {
        // Non-fatal — the @-mention popup will just be empty.
      } finally {
        loading = false;
      }
    },
  };
}

export const agentRegistryStore = createAgentRegistryStore();
