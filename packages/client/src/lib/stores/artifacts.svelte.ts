import { api } from '$lib/api/client';
import type { Artifact } from '@e/shared';

function createArtifactsStore() {
  let artifacts = $state<Artifact[]>([]);
  let loading = $state(false);
  let currentConversationId = $state<string | null>(null);

  return {
    get artifacts() {
      return artifacts;
    },
    get loading() {
      return loading;
    },
    get currentConversationId() {
      return currentConversationId;
    },

    /** All pinned artifacts for the current conversation */
    get pinned(): Artifact[] {
      return artifacts.filter((a) => a.pinned);
    },

    /** Count of artifacts */
    get count(): number {
      return artifacts.length;
    },

    /** Load all artifacts for a conversation */
    async load(conversationId: string) {
      if (loading || currentConversationId === conversationId) return;
      currentConversationId = conversationId;
      loading = true;
      try {
        const res = await api.artifacts.list(conversationId);
        if (res.ok) {
          artifacts = res.data;
        }
      } catch (err) {
        console.error('[artifacts] Failed to load:', err);
      } finally {
        loading = false;
      }
    },

    /** Called when a new artifact arrives via SSE stream */
    addFromStream(artifact: Artifact) {
      // Only add if it belongs to the current conversation
      if (artifact.conversationId !== currentConversationId) return;
      // Avoid duplicates
      const exists = artifacts.some((a) => a.id === artifact.id);
      if (!exists) {
        artifacts = [artifact, ...artifacts];
      }
    },

    /** Toggle pin state for an artifact */
    async togglePin(id: string) {
      const artifact = artifacts.find((a) => a.id === id);
      if (!artifact) return;
      try {
        const res = await api.artifacts.pin(id, !artifact.pinned);
        if (res.ok) {
          artifacts = artifacts.map((a) => (a.id === id ? res.data : a));
        }
      } catch (err) {
        console.error('[artifacts] Failed to toggle pin:', err);
      }
    },

    /** Delete an artifact */
    async remove(id: string) {
      try {
        await api.artifacts.delete(id);
        artifacts = artifacts.filter((a) => a.id !== id);
      } catch (err) {
        console.error('[artifacts] Failed to delete:', err);
      }
    },

    /** Clear the store when switching conversations */
    clear() {
      artifacts = [];
      currentConversationId = null;
    },
  };
}

export const artifactsStore = createArtifactsStore();
