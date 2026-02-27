import type { AgentProfile, AgentProfileCreateInput, AgentProfileUpdateInput } from '@e/shared';
import { BUILT_IN_PROFILES } from '@e/shared';
import { api } from '$lib/api/client';

function createProfilesStore() {
  let profiles = $state<AgentProfile[]>([...BUILT_IN_PROFILES]);
  let loading = $state(false);
  let activeProfileId = $state<string>('write'); // Default to Write profile

  return {
    get profiles() {
      return profiles;
    },
    get loading() {
      return loading;
    },
    get activeProfileId() {
      return activeProfileId;
    },
    get activeProfile(): AgentProfile | undefined {
      return profiles.find((p) => p.id === activeProfileId);
    },

    setActiveProfileId(id: string) {
      activeProfileId = id;
      // Persist to localStorage so it survives refreshes
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('e-active-profile', id);
      }
    },

    /** Cycle to next profile (for keyboard shortcut). */
    cycleProfile() {
      const idx = profiles.findIndex((p) => p.id === activeProfileId);
      const next = profiles[(idx + 1) % profiles.length];
      if (next) {
        this.setActiveProfileId(next.id);
      }
    },

    async load() {
      loading = true;
      try {
        const res = await api.profiles.list();
        if (res.ok) {
          profiles = res.data;
        }
      } catch (e) {
        console.warn('[profilesStore] Failed to load profiles:', e);
        // Fall back to built-ins
        profiles = [...BUILT_IN_PROFILES];
      } finally {
        loading = false;
      }

      // Restore last active profile from localStorage
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('e-active-profile');
        if (saved && profiles.some((p) => p.id === saved)) {
          activeProfileId = saved;
        }
      }
    },

    async create(input: AgentProfileCreateInput): Promise<AgentProfile> {
      const res = await api.profiles.create(input);
      if (!res.ok) throw new Error('Failed to create profile');
      profiles = [...profiles, res.data];
      return res.data;
    },

    async update(id: string, input: AgentProfileUpdateInput): Promise<AgentProfile> {
      const res = await api.profiles.update(id, input);
      if (!res.ok) throw new Error('Failed to update profile');
      profiles = profiles.map((p) => (p.id === id ? res.data : p));
      return res.data;
    },

    async delete(id: string): Promise<void> {
      await api.profiles.delete(id);
      profiles = profiles.filter((p) => p.id !== id);
      // If deleted profile was active, fall back to Write
      if (activeProfileId === id) {
        this.setActiveProfileId('write');
      }
    },
  };
}

export const profilesStore = createProfilesStore();
