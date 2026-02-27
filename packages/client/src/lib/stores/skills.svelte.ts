/**
 * Skills Marketplace Store
 *
 * Manages skill browsing, installation, activation, and creation state.
 */
import { api } from '$lib/api/client';
import type {
  SkillSummary,
  SkillCategory,
  SkillSortBy,
  MarketplaceSkill,
  SkillBrowseResponse,
} from '@e/shared';

function createSkillsStore() {
  // Browse state
  let skills = $state<SkillSummary[]>([]);
  let total = $state(0);
  let loading = $state(false);
  let error = $state<string | null>(null);

  // Filters
  let searchQuery = $state('');
  let selectedCategory = $state<SkillCategory | 'all'>('all');
  let sortBy = $state<SkillSortBy>('popularity');
  let tierFilter = $state<'all' | 'bundled' | 'managed' | 'workspace'>('all');
  let page = $state(1);
  let pageSize = $state(50);

  // Detail view
  let selectedSkill = $state<MarketplaceSkill | null>(null);
  let detailLoading = $state(false);

  // Installed skills
  let installedSkills = $state<SkillSummary[]>([]);
  let installedLoading = $state(false);

  // Create flow
  let creating = $state(false);

  // Updates
  let updates = $state<Array<{ skillId: string; currentVersion: string; latestVersion: string }>>(
    [],
  );

  return {
    // Getters
    get skills() {
      return skills;
    },
    get total() {
      return total;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    get searchQuery() {
      return searchQuery;
    },
    get selectedCategory() {
      return selectedCategory;
    },
    get sortBy() {
      return sortBy;
    },
    get tierFilter() {
      return tierFilter;
    },
    get page() {
      return page;
    },
    get pageSize() {
      return pageSize;
    },
    get selectedSkill() {
      return selectedSkill;
    },
    get detailLoading() {
      return detailLoading;
    },
    get installedSkills() {
      return installedSkills;
    },
    get installedLoading() {
      return installedLoading;
    },
    get creating() {
      return creating;
    },
    get updates() {
      return updates;
    },

    get activatedSkills() {
      return installedSkills.filter((s) => s.activated);
    },

    // Actions
    setSearchQuery(q: string) {
      searchQuery = q;
    },
    setCategory(cat: SkillCategory | 'all') {
      selectedCategory = cat;
      page = 1;
    },
    setSortBy(sort: SkillSortBy) {
      sortBy = sort;
    },
    setTierFilter(tier: 'all' | 'bundled' | 'managed' | 'workspace') {
      tierFilter = tier;
      page = 1;
    },
    setPage(p: number) {
      page = p;
    },
    clearSelection() {
      selectedSkill = null;
    },

    async browse(workspacePath?: string) {
      loading = true;
      error = null;
      try {
        const res = await api.skillsRegistry.browse({
          query: searchQuery || undefined,
          category: selectedCategory !== 'all' ? selectedCategory : undefined,
          sortBy,
          tier: tierFilter !== 'all' ? tierFilter : undefined,
          page,
          pageSize,
          workspacePath,
        });
        if (res.ok) {
          const data = res.data as SkillBrowseResponse;
          skills = data.skills;
          total = data.total;
        }
      } catch (e) {
        error = e instanceof Error ? e.message : 'Failed to browse skills';
      } finally {
        loading = false;
      }
    },

    async loadInstalled(workspacePath?: string) {
      installedLoading = true;
      try {
        const res = await api.skillsRegistry.installed(workspacePath);
        if (res.ok) {
          installedSkills = res.data as SkillSummary[];
        }
      } catch {
        installedSkills = [];
      } finally {
        installedLoading = false;
      }
    },

    async viewSkill(id: string, workspacePath?: string) {
      detailLoading = true;
      try {
        const res = await api.skillsRegistry.getSkill(id, workspacePath);
        if (res.ok) {
          selectedSkill = res.data as MarketplaceSkill;
        }
      } catch (e) {
        console.warn('Failed to load skill details:', e);
      } finally {
        detailLoading = false;
      }
    },

    async install(
      skillId: string,
      opts?: { tier?: string; workspacePath?: string; pinnedVersion?: string },
    ) {
      try {
        const res = await api.skillsRegistry.install(skillId, opts);
        if (res.ok) {
          // Update local state
          skills = skills.map((s) =>
            s.id === skillId ? { ...s, installed: true, activated: true } : s,
          );
          // Reload installed
          if (opts?.workspacePath) {
            await this.loadInstalled(opts.workspacePath);
          }
          return true;
        }
      } catch {
        return false;
      }
      return false;
    },

    async uninstall(skillId: string, workspacePath?: string) {
      try {
        const res = await api.skillsRegistry.uninstall(skillId, workspacePath);
        if (res.ok) {
          skills = skills.map((s) =>
            s.id === skillId ? { ...s, installed: false, activated: false } : s,
          );
          installedSkills = installedSkills.filter((s) => s.id !== skillId);
          if (selectedSkill?.metadata.id === skillId) {
            selectedSkill = { ...selectedSkill, installed: false, activated: false };
          }
          return true;
        }
      } catch {
        return false;
      }
      return false;
    },

    async activate(skillId: string, activated: boolean, workspacePath?: string) {
      try {
        const res = await api.skillsRegistry.activate(skillId, activated, workspacePath);
        if (res.ok) {
          skills = skills.map((s) => (s.id === skillId ? { ...s, activated } : s));
          installedSkills = installedSkills.map((s) =>
            s.id === skillId ? { ...s, activated } : s,
          );
          if (selectedSkill?.metadata.id === skillId) {
            selectedSkill = { ...selectedSkill, activated };
          }
          return true;
        }
      } catch {
        return false;
      }
      return false;
    },

    async createSkill(input: {
      name: string;
      description: string;
      category?: string;
      tags?: string[];
      promptTemplate?: string;
      rules?: string[];
      requiredTools?: string[];
      requiredMcpServers?: string[];
      workspacePath?: string;
    }) {
      creating = true;
      try {
        const res = await api.skillsRegistry.create(input);
        if (res.ok) {
          // Reload installed
          if (input.workspacePath) {
            await this.loadInstalled(input.workspacePath);
          }
          return res.data;
        }
        return null;
      } catch {
        return null;
      } finally {
        creating = false;
      }
    },

    async pinVersion(skillId: string, pinnedVersion?: string) {
      try {
        await api.skillsRegistry.pinVersion(skillId, pinnedVersion);
        return true;
      } catch {
        return false;
      }
    },

    async checkUpdates() {
      try {
        const res = await api.skillsRegistry.checkUpdates();
        if (res.ok) {
          updates = res.data.updates;
          return updates;
        }
      } catch {
        // Ignore
      }
      return [];
    },

    async suggest(query: string) {
      try {
        const res = await api.skillsRegistry.suggest(query);
        if (res.ok) {
          return res.data;
        }
      } catch {
        // Ignore
      }
      return [];
    },
  };
}

export const skillsStore = createSkillsStore();
