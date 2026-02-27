import { api } from '$lib/api/client';
import type { AgentNote, AgentNoteCategory } from '@e/shared';

function createAgentNotesStore() {
  let notes = $state<AgentNote[]>([]);
  let loading = $state(false);
  let currentWorkspacePath = $state<string | null>(null);
  let filterCategory = $state<AgentNoteCategory | 'all' | 'unread'>('all');
  let unreadCount = $state(0);

  return {
    get notes() {
      return notes;
    },
    get loading() {
      return loading;
    },
    get currentWorkspacePath() {
      return currentWorkspacePath;
    },
    get filterCategory() {
      return filterCategory;
    },
    get unreadCount() {
      return unreadCount;
    },

    /** All notes filtered by current filter */
    get filteredNotes(): AgentNote[] {
      if (filterCategory === 'all') return notes;
      if (filterCategory === 'unread') return notes.filter((n) => n.status === 'unread');
      return notes.filter((n) => n.category === filterCategory);
    },

    /** Count of notes */
    get count(): number {
      return notes.length;
    },

    /** Load all agent notes for a workspace */
    async load(workspacePath: string) {
      if (loading && currentWorkspacePath === workspacePath) return;
      currentWorkspacePath = workspacePath;
      loading = true;
      try {
        const res = await api.agentNotes.list(workspacePath);
        if (res.ok) {
          notes = res.data;
          unreadCount = notes.filter((n) => n.status === 'unread').length;
        }
      } catch (err) {
        console.error('[agent-notes] Failed to load:', err);
      } finally {
        loading = false;
      }
    },

    /** Refresh unread count (lightweight, no full reload) */
    async refreshUnreadCount(workspacePath: string) {
      try {
        const res = await api.agentNotes.unreadCount(workspacePath);
        if (res.ok) {
          unreadCount = res.data.count;
        }
      } catch {
        /* non-critical */
      }
    },

    /** Called when a new agent note arrives via SSE stream */
    addFromStream(note: AgentNote) {
      // Add to the front regardless of which workspace is active
      // (notes panel will filter by workspace)
      if (note.workspacePath !== currentWorkspacePath) return;
      const exists = notes.some((n) => n.id === note.id);
      if (!exists) {
        notes = [note, ...notes];
        if (note.status === 'unread') {
          unreadCount++;
        }
      }
    },

    /** Set filter category */
    setFilter(category: AgentNoteCategory | 'all' | 'unread') {
      filterCategory = category;
    },

    /** Mark a single note as read */
    async markAsRead(id: string) {
      const note = notes.find((n) => n.id === id);
      if (!note || note.status !== 'unread') return;
      try {
        const res = await api.agentNotes.update(id, { status: 'read' });
        if (res.ok) {
          notes = notes.map((n) => (n.id === id ? { ...n, status: 'read' as const } : n));
          unreadCount = Math.max(0, unreadCount - 1);
        }
      } catch (err) {
        console.error('[agent-notes] Failed to mark as read:', err);
      }
    },

    /** Mark all notes as read */
    async markAllAsRead() {
      if (!currentWorkspacePath) return;
      try {
        const res = await api.agentNotes.markRead(currentWorkspacePath);
        if (res.ok) {
          notes = notes.map((n) => (n.status === 'unread' ? { ...n, status: 'read' as const } : n));
          unreadCount = 0;
        }
      } catch (err) {
        console.error('[agent-notes] Failed to mark all as read:', err);
      }
    },

    /** Archive a note */
    async archive(id: string) {
      try {
        const res = await api.agentNotes.update(id, { status: 'archived' });
        if (res.ok) {
          const note = notes.find((n) => n.id === id);
          if (note?.status === 'unread') {
            unreadCount = Math.max(0, unreadCount - 1);
          }
          notes = notes.filter((n) => n.id !== id);
        }
      } catch (err) {
        console.error('[agent-notes] Failed to archive:', err);
      }
    },

    /** Delete a note */
    async remove(id: string) {
      try {
        const note = notes.find((n) => n.id === id);
        await api.agentNotes.delete(id);
        notes = notes.filter((n) => n.id !== id);
        if (note?.status === 'unread') {
          unreadCount = Math.max(0, unreadCount - 1);
        }
      } catch (err) {
        console.error('[agent-notes] Failed to delete:', err);
      }
    },

    /** Clear the store when switching workspaces */
    clear() {
      notes = [];
      currentWorkspacePath = null;
      unreadCount = 0;
    },
  };
}

export const agentNotesStore = createAgentNotesStore();
