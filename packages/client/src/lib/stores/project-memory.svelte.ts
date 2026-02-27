import type { WorkspaceMemory, MemoryCategory } from '@e/shared';
import { api } from '$lib/api/client';

function createWorkspaceMemoryStore() {
  let memories = $state<WorkspaceMemory[]>([]);
  let loading = $state(false);
  let currentWorkspacePath = $state<string | null>(null);
  let filterCategory = $state<MemoryCategory | 'all'>('all');

  const filtered = $derived(
    filterCategory === 'all' ? memories : memories.filter((m) => m.category === filterCategory),
  );

  const allCategories: MemoryCategory[] = [
    'convention',
    'decision',
    'preference',
    'pattern',
    'context',
    'architecture',
    'naming',
    'forbidden',
    'testing',
  ];

  const stats = $derived({
    total: memories.length,
    auto: memories.filter((m) => m.source === 'auto').length,
    manual: memories.filter((m) => m.source === 'manual').length,
    byCategory: Object.fromEntries(
      allCategories.map((cat) => [cat, memories.filter((m) => m.category === cat).length]),
    ),
  });

  return {
    get memories() {
      return filtered;
    },
    get allMemories() {
      return memories;
    },
    get loading() {
      return loading;
    },
    get stats() {
      return stats;
    },
    get filterCategory() {
      return filterCategory;
    },
    get currentWorkspacePath() {
      return currentWorkspacePath;
    },

    setFilter(cat: MemoryCategory | 'all') {
      filterCategory = cat;
    },

    async load(workspacePath: string) {
      currentWorkspacePath = workspacePath;
      loading = true;
      try {
        const res = await api.workspaceMemory.list(workspacePath);
        memories = res.data;
      } catch {
        memories = [];
      }
      loading = false;
    },

    async create(body: {
      workspacePath: string;
      category: MemoryCategory;
      key: string;
      content: string;
    }) {
      try {
        await api.workspaceMemory.create({ ...body, source: 'manual', confidence: 1.0 });
        if (currentWorkspacePath === body.workspacePath) {
          await this.load(body.workspacePath);
        }
        return true;
      } catch {
        return false;
      }
    },

    async update(id: string, body: Record<string, any>) {
      try {
        await api.workspaceMemory.update(id, body);
        if (currentWorkspacePath) await this.load(currentWorkspacePath);
        return true;
      } catch {
        return false;
      }
    },

    async remove(id: string) {
      try {
        await api.workspaceMemory.delete(id);
        memories = memories.filter((m) => m.id !== id);
        return true;
      } catch {
        return false;
      }
    },

    async search(q: string) {
      if (!currentWorkspacePath) return [];
      try {
        const res = await api.workspaceMemory.search(currentWorkspacePath, q);
        return res.data as WorkspaceMemory[];
      } catch {
        return [];
      }
    },

    async extractFromConversation(
      workspacePath: string,
      messages: Array<{ role: string; content: string }>,
    ) {
      try {
        const res = await api.workspaceMemory.extract(workspacePath, messages);
        if (res.data.created > 0 && currentWorkspacePath === workspacePath) {
          await this.load(workspacePath);
        }
        return res.data;
      } catch {
        return { extracted: 0, created: 0 };
      }
    },

    /** LLM-powered extraction from conversation messages (smarter than regex) */
    async extractWithLlm(
      workspacePath: string,
      messages: Array<{ role: string; content: string }>,
    ) {
      try {
        const res = await api.workspaceMemory.extractLlm(workspacePath, messages);
        if (res.data.created > 0 && currentWorkspacePath === workspacePath) {
          await this.load(workspacePath);
        }
        return res.data;
      } catch {
        return { extracted: 0, created: 0 };
      }
    },

    /** LLM-powered extraction from git commits */
    async extractFromCommits(
      workspacePath: string,
      commits: Array<{ message: string; files?: string[] }>,
    ) {
      try {
        const res = await api.workspaceMemory.extractCommits(workspacePath, commits);
        if (res.data.created > 0 && currentWorkspacePath === workspacePath) {
          await this.load(workspacePath);
        }
        return res.data;
      } catch {
        return { extracted: 0, created: 0 };
      }
    },

    /** Get version history for a memory entry */
    async getVersionHistory(id: string) {
      try {
        const res = await api.workspaceMemory.versions(id);
        return res.data ?? [];
      } catch {
        return [];
      }
    },

    /** All available categories */
    get categories(): MemoryCategory[] {
      return allCategories;
    },
  };
}

export const workspaceMemoryStore = createWorkspaceMemoryStore();
