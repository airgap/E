import type { StreamCanvasUpdate } from '@e/shared';
import { api } from '$lib/api/client';

export interface CanvasState {
  id: string;
  contentType: 'html' | 'svg' | 'mermaid' | 'table';
  content: string;
  title?: string;
  conversationId: string;
  lastUpdated: number;
}

function createCanvasStore() {
  let canvases = $state<CanvasState[]>([]);
  let currentConversationId = $state<string | null>(null);

  return {
    get canvases() {
      return canvases;
    },

    get currentConversationId() {
      return currentConversationId;
    },

    /** Get canvases for the current conversation */
    get current(): CanvasState[] {
      if (!currentConversationId) return [];
      return canvases.filter((c) => c.conversationId === currentConversationId);
    },

    /** Handle canvas update from SSE stream */
    handleUpdate(event: StreamCanvasUpdate) {
      const existing = canvases.find((c) => c.id === event.canvasId);

      if (existing) {
        // Update existing canvas
        canvases = canvases.map((c) =>
          c.id === event.canvasId
            ? {
                ...c,
                contentType: event.contentType,
                content: event.content,
                title: event.title || c.title,
                lastUpdated: Date.now(),
              }
            : c,
        );
      } else {
        // Add new canvas
        canvases = [
          ...canvases,
          {
            id: event.canvasId,
            contentType: event.contentType,
            content: event.content,
            title: event.title,
            conversationId: event.conversationId,
            lastUpdated: Date.now(),
          },
        ];
      }
    },

    /** Load canvases for a conversation — fetches from server API */
    async setConversation(conversationId: string | null) {
      currentConversationId = conversationId;

      if (!conversationId) return;

      // Hydrate from server
      try {
        const res = await api.canvas.list(conversationId);
        if (res.ok && Array.isArray(res.data)) {
          for (const cv of res.data) {
            const existing = canvases.find((c) => c.id === cv.id);
            if (!existing) {
              canvases = [
                ...canvases,
                {
                  id: cv.id,
                  contentType: cv.contentType,
                  content: cv.content,
                  title: cv.title,
                  conversationId: cv.conversationId || conversationId,
                  lastUpdated: cv.lastUpdated || Date.now(),
                },
              ];
            }
          }
        }
      } catch {
        // Server may not support canvas API yet — fail silently
      }
    },

    /** Push canvas content directly via REST API */
    async push(opts: {
      contentType: 'html' | 'svg' | 'mermaid' | 'table';
      content: string;
      title?: string;
      canvasId?: string;
    }) {
      const conversationId = currentConversationId;
      try {
        const res = await api.canvas.push({
          content_type: opts.contentType,
          content: opts.content,
          title: opts.title,
          canvas_id: opts.canvasId,
          conversation_id: conversationId || undefined,
        });
        if (res.ok && res.canvasEvent) {
          // Inject directly into local state
          this.handleUpdate(res.canvasEvent);
        }
        return res;
      } catch (err) {
        console.error('[canvasStore] push failed:', err);
        throw err;
      }
    },

    /** Clear all canvases for a conversation */
    clearConversation(conversationId: string) {
      canvases = canvases.filter((c) => c.conversationId !== conversationId);
    },

    /** Clear all canvases */
    clear() {
      canvases = [];
      currentConversationId = null;
    },

    /** Get a specific canvas by ID */
    getById(canvasId: string): CanvasState | undefined {
      return canvases.find((c) => c.id === canvasId);
    },

    /** Remove a canvas */
    remove(canvasId: string) {
      canvases = canvases.filter((c) => c.id !== canvasId);
    },
  };
}

export const canvasStore = createCanvasStore();
