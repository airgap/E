import type { UserStory, StoryPriority } from '@e/shared';
import { loopStore } from './loop.svelte';
import { api } from '../api/client';

/**
 * Filter for the Work pane.
 * - 'all': show all stories grouped by parent
 * - 'standalone': show only standalone stories (no PRD)
 * - 'external': show only externally-linked stories
 * - string: a specific prdId
 */
export type WorkFilter = 'all' | 'standalone' | 'external' | (string & {});

/** Priority weight map — higher = more important */
const PRIORITY_WEIGHT: Record<StoryPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function createWorkStore() {
  let standaloneStories = $state<UserStory[]>([]);
  let activeFilter = $state<WorkFilter>('standalone');
  let loading = $state(false);
  /** When true, manual order is preserved; when false, priority auto-sort is active */
  let manualOrderOverride = $state(false);

  /**
   * Sort stories by priority (critical first) then by sortOrder within same priority.
   */
  function sortByPriority(stories: UserStory[]): UserStory[] {
    return [...stories].sort((a, b) => {
      const pa = PRIORITY_WEIGHT[a.priority] ?? 2;
      const pb = PRIORITY_WEIGHT[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      return a.sortOrder - b.sortOrder;
    });
  }

  return {
    // --- State getters ---
    get standaloneStories() {
      return standaloneStories;
    },
    get activeFilter() {
      return activeFilter;
    },
    get loading() {
      return loading;
    },
    get manualOrderOverride() {
      return manualOrderOverride;
    },

    // --- Delegate to loopStore for PRD data ---
    get prds() {
      return loopStore.prds;
    },
    get activeLoop() {
      return loopStore.activeLoop;
    },
    get isActive() {
      return loopStore.isActive;
    },

    // --- Filter ---
    setFilter(filter: WorkFilter) {
      activeFilter = filter;
      // If setting to a PRD, also update loopStore's selectedPrdId
      if (filter !== 'all' && filter !== 'standalone' && filter !== 'external') {
        loopStore.setSelectedPrdId(filter);
      } else {
        loopStore.setSelectedPrdId(null);
      }
    },

    // --- Filtered stories ---
    get filteredStories(): UserStory[] {
      if (activeFilter === 'standalone') return standaloneStories.filter((s) => !s.externalRef);
      if (activeFilter === 'external') return standaloneStories.filter((s) => !!s.externalRef);
      if (activeFilter === 'all') {
        const prdStories = loopStore.prds.flatMap((p) => p.stories || []);
        return [...standaloneStories, ...prdStories];
      }
      // Specific PRD
      const prd = loopStore.prds.find((p) => p.id === activeFilter);
      return prd?.stories || [];
    },

    get pendingStories() {
      const pending = this.filteredStories.filter((s) => s.status === 'pending');
      // Apply priority auto-sort unless user has manually reordered
      return manualOrderOverride ? pending : sortByPriority(pending);
    },
    get inProgressStories() {
      return this.filteredStories.filter((s) => s.status === 'in_progress');
    },
    get qaStories() {
      return this.filteredStories.filter((s) => s.status === 'qa');
    },
    get completedStories() {
      return this.filteredStories.filter((s) => s.status === 'completed');
    },
    get failedStories() {
      return this.filteredStories.filter((s) => s.status === 'failed');
    },
    get archivedStories() {
      return this.filteredStories.filter((s) => s.status === 'archived');
    },

    get standaloneCount() {
      return standaloneStories.length;
    },

    // --- External stories ---
    get externalStories() {
      return standaloneStories.filter((s) => !!s.externalRef);
    },
    get externalCount() {
      return standaloneStories.filter((s) => !!s.externalRef).length;
    },
    get hasExternalStories() {
      return standaloneStories.some((s) => !!s.externalRef);
    },

    // --- Is the current filter a PRD? ---
    get isPrdFilter() {
      return activeFilter !== 'all' && activeFilter !== 'standalone' && activeFilter !== 'external';
    },

    // --- Data loading ---
    async loadStandaloneStories(workspacePath: string) {
      loading = true;
      try {
        const res = await api.prds.listStandaloneStories(workspacePath);
        if (res.ok) {
          standaloneStories = res.data;
        }
      } finally {
        loading = false;
      }
    },

    // --- Standalone story CRUD ---
    async createStandaloneStory(workspacePath: string, title: string, description?: string) {
      const res = await api.prds.createStandaloneStory({
        workspacePath,
        title,
        description,
      });
      if (res.ok) {
        standaloneStories = [...standaloneStories, res.data];
      }
      return res;
    },

    async createStandaloneStories(
      workspacePath: string,
      tasks: Array<{ title: string; description?: string }>,
    ): Promise<{ created: number; failed: number }> {
      let created = 0;
      let failed = 0;
      const newStories: typeof standaloneStories = [];
      for (const task of tasks) {
        const res = await api.prds.createStandaloneStory({
          workspacePath,
          title: task.title,
          description: task.description,
        });
        if (res.ok) {
          newStories.push(res.data);
          created++;
        } else {
          failed++;
        }
      }
      if (newStories.length > 0) {
        standaloneStories = [...standaloneStories, ...newStories];
      }
      return { created, failed };
    },

    async updateStandaloneStory(storyId: string, updates: Record<string, any>) {
      const res = await api.prds.updateStandaloneStory(storyId, updates);
      if (res.ok) {
        standaloneStories = standaloneStories.map((s) =>
          s.id === storyId ? { ...s, ...res.data } : s,
        );
      }
      return res;
    },

    async deleteStandaloneStory(storyId: string) {
      const res = await api.prds.deleteStandaloneStory(storyId);
      if (res.ok) {
        standaloneStories = standaloneStories.filter((s) => s.id !== storyId);
      }
      return res;
    },

    async toggleResearchOnly(storyId: string, currentValue: boolean) {
      await this.updateStandaloneStory(storyId, { researchOnly: !currentValue });
    },

    async toggleStoryStatus(storyId: string, currentStatus: string, prdId: string | null) {
      const next =
        currentStatus === 'pending'
          ? 'in_progress'
          : currentStatus === 'in_progress'
            ? 'completed'
            : 'pending';

      if (prdId) {
        await api.prds.updateStory(prdId, storyId, { status: next });
        await loopStore.loadPrd(prdId);
      } else {
        await this.updateStandaloneStory(storyId, { status: next });
      }
    },

    async archiveStory(storyId: string, prdId: string | null) {
      if (prdId) {
        await api.prds.updateStory(prdId, storyId, { status: 'archived' });
        await loopStore.loadPrd(prdId);
      } else {
        await this.updateStandaloneStory(storyId, { status: 'archived' });
      }
    },

    async archiveAllCompleted(workspacePath: string) {
      const res = await api.prds.archiveAllCompleted(workspacePath);
      if (res.ok) {
        // Refresh standalone stories to reflect the change
        await this.loadStandaloneStories(workspacePath);
      }
      return res;
    },

    // Update a story from a loop event (used by SSE handler)
    updateStoryStatus(storyId: string, status: string) {
      standaloneStories = standaloneStories.map((s) =>
        s.id === storyId ? { ...s, status: status as any, updatedAt: Date.now() } : s,
      );
    },

    setStandaloneStories(stories: UserStory[]) {
      standaloneStories = stories;
    },

    // --- Reorder ---

    /**
     * Reorder pending stories via drag-and-drop.
     * This enables manual override and persists the new order to the server.
     */
    async reorderPendingStories(reorderedPending: UserStory[]) {
      manualOrderOverride = true;

      // Rebuild standaloneStories preserving non-pending stories in place
      // but replacing pending stories (non-external) with the new order
      const nonPendingNonExternal = standaloneStories.filter(
        (s) => s.status !== 'pending' || !!s.externalRef,
      );
      const allStories = [...nonPendingNonExternal, ...reorderedPending];

      // Update sortOrder locally based on new positions
      standaloneStories = allStories.map((s, i) => ({ ...s, sortOrder: i }));

      // Persist to server
      const storyIds = standaloneStories.map((s) => s.id);
      await api.prds.reorderStories(storyIds);
    },

    /**
     * Sort pending stories by priority automatically.
     * Disables manual override and persists the new order.
     */
    async sortByPriority() {
      manualOrderOverride = false;

      // Get pending non-external stories and sort by priority
      const pendingNonExternal = standaloneStories.filter(
        (s) => s.status === 'pending' && !s.externalRef,
      );
      const sorted = sortByPriority(pendingNonExternal);

      // Rebuild in a stable order: non-pending + sorted pending
      const nonPending = standaloneStories.filter((s) => s.status !== 'pending' || !!s.externalRef);
      const allStories = [...nonPending, ...sorted];

      // Update sortOrder based on new positions
      standaloneStories = allStories.map((s, i) => ({ ...s, sortOrder: i }));

      // Persist to server
      const storyIds = standaloneStories.map((s) => s.id);
      await api.prds.reorderStories(storyIds);
    },

    // --- External provider operations ---
    async importExternalIssues(
      provider: string,
      projectKey: string,
      workspacePath: string,
      issueIds?: string[],
      prdId?: string,
    ) {
      const res = await api.external.importIssues({
        provider,
        projectKey,
        workspacePath,
        issueIds,
        prdId,
      });
      if (res.ok) {
        // Refresh standalone stories to pick up the new imports
        await this.loadStandaloneStories(workspacePath);
      }
      return res;
    },

    async refreshExternalStory(storyId: string) {
      const res = await api.external.refreshStory(storyId);
      if (res.ok) {
        // Re-fetch the updated story
        const updated = standaloneStories.find((s) => s.id === storyId);
        if (updated?.workspacePath) {
          await this.loadStandaloneStories(updated.workspacePath);
        }
      }
      return res;
    },

    async refreshAllExternalStories(workspacePath: string) {
      const res = await api.external.refreshAll(workspacePath);
      if (res.ok) {
        await this.loadStandaloneStories(workspacePath);
      }
      return res;
    },
  };
}

export const workStore = createWorkStore();
