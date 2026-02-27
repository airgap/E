<script lang="ts">
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { workspaceListStore } from '$lib/stores/projects.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { messageSyncStore } from '$lib/stores/message-sync.svelte';
  import { api } from '$lib/api/client';
  import { getReconnectionPromise, reconnectToConversation } from '$lib/api/sse';
  import { onMount } from 'svelte';

  let search = $state('');

  let filtered = $derived(
    conversationStore.list
      .filter((c) => {
        // Always filter by active workspace — workspace tabs handle workspace switching
        if (workspaceListStore.activeWorkspace) {
          return (
            c.workspaceId === workspaceListStore.activeWorkspaceId ||
            c.workspacePath === workspaceListStore.activeWorkspace.path
          );
        }
        return true;
      })
      .filter((c) => c.title.toLowerCase().includes(search.toLowerCase())),
  );

  /** Whether the draft placeholder should appear (new conversation, nothing typed yet). */
  let showDraft = $derived(conversationStore.draft !== null && !conversationStore.active);

  onMount(async () => {
    try {
      const res = await api.conversations.list();
      conversationStore.setList(res.data);

      // If a reconnection attempt is in progress, wait for it to complete
      // before deciding whether to auto-restore. This prevents a race where
      // we skip auto-restore because isStreaming is true (due to reconnecting),
      // but reconnection then fails, leaving no conversation loaded.
      if (streamStore.isReconnecting) {
        try {
          await getReconnectionPromise();
        } catch {
          // Reconnection failed — proceed with auto-restore below
        }
      }

      // Auto-restore the previously active conversation after page reload,
      // but skip if a stream reconnection successfully loaded a conversation
      // (calling streamStore.reset() would destroy its state).
      if (!conversationStore.active && !streamStore.isStreaming) {
        const savedId = workspaceStore.activeWorkspace?.snapshot.activeConversationId;
        if (savedId && res.data.some((c: any) => c.id === savedId)) {
          conversationStore.setLoading(true);
          try {
            // Use in-flight reference if an active stream is writing to this conversation
            const inflight = conversationStore.getInflight(savedId);
            if (inflight) {
              conversationStore.setActive({ ...inflight });
            } else {
              const convRes = await api.conversations.get(savedId);
              conversationStore.setActive(convRes.data);
            }
            // Subscribe to message sync for cross-device updates
            messageSyncStore.subscribe(savedId);
            streamStore.reset();
            // Check if the server has an active streaming session for this
            // conversation (e.g. a golem loop started between the initial
            // reconnect check and now). If so, connect to it.
            reconnectToConversation(savedId).catch(() => {});
          } finally {
            conversationStore.setLoading(false);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  });

  async function selectConversation(id: string) {
    // On mobile, even if the conversation is already active, switch to chat view
    // so the user can see it (they might be in the conversations panel)
    if (conversationStore.activeId === id) {
      if (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-mobile')) {
        uiStore.setMobileView('chat');
      }
      return;
    }
    conversationStore.clearDraft();
    conversationStore.setLoading(true);
    try {
      // If there's an active stream writing to this conversation, use its
      // in-flight reference instead of loading from DB. The DB won't have the
      // partial assistant response yet — it's only persisted on stream completion.
      const inflight = conversationStore.getInflight(id);
      if (inflight) {
        conversationStore.setActive({ ...inflight });
        // Subscribe to message sync even for in-flight conversations
        messageSyncStore.subscribe(id);
        primaryPaneStore.openConversation(inflight.id, inflight.title ?? 'Conversation');
      } else {
        const res = await api.conversations.get(id);
        conversationStore.setActive(res.data);
        // Subscribe to message sync for cross-device updates
        messageSyncStore.subscribe(id);
        // Explicitly open the conversation tab (bypasses the "don't override file/diff" guard
        // in PrimaryPane's reactive effect, which is meant for automatic updates, not user clicks)
        primaryPaneStore.openConversation(res.data.id, res.data.title ?? 'Conversation');

        // If no client-side stream is active, check the server for an active
        // streaming session for this conversation (e.g. from a golem loop or
        // another agent running in the background). If found, reconnect to it
        // so the user sees the live stream instead of a stale snapshot.
        if (!streamStore.isStreaming) {
          // Reset stale stream state first (before the async reconnection check),
          // then attempt to reconnect. The reconnect function will re-initialize
          // stream state if it finds an active session.
          streamStore.reset();
          reconnectToConversation(id).catch(() => {});
          return; // Skip the reset below — we already handled it
        }
      }
      // Only reset stream state if there's no active stream running.
      // If the stream IS running (for any conversation), preserve its state:
      //  - If the stream is for THIS conversation, we want to keep contentBlocks
      //    intact so StreamingMessage can display the in-progress response.
      //  - If the stream is for a DIFFERENT conversation, leave it running —
      //    it continues updating its target conversation in the background.
      // Resetting while a stream is active would wipe contentBlocks, causing
      // subsequent content_block_delta events to silently fail (idx out of bounds).
      if (!streamStore.isStreaming) {
        streamStore.reset();
      }
      // On mobile, switch to chat view so the user can see the conversation
      if (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-mobile')) {
        uiStore.setMobileView('chat');
      }
    } finally {
      conversationStore.setLoading(false);
    }
  }

  async function newConversation() {
    conversationStore.setActive(null);
    conversationStore.createDraft();
    // Explicitly open a "New chat" tab (the conversation→tab sync no longer auto-creates one)
    primaryPaneStore.openConversation(null, 'New chat');
    // Only reset if no active stream is running for another conversation
    if (!streamStore.isStreaming) {
      streamStore.reset();
    }
    // On mobile, switch to chat view so the user can see the new conversation
    if (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-mobile')) {
      uiStore.setMobileView('chat');
    }
    uiStore.focusChatInput();
  }

  async function deleteConversation(e: MouseEvent, id: string) {
    e.stopPropagation();
    await api.conversations.delete(id);
    conversationStore.removeConversation(id);
  }

  function formatDate(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
</script>

<div class="conv-list">
  <div class="conv-header">
    <input
      type="text"
      bind:value={search}
      placeholder="Search conversations..."
      class="search-input"
    />
    <button class="new-btn" onclick={newConversation} title="New conversation">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
  </div>
  <div class="conv-items">
    {#if showDraft}
      <div class="conv-item active draft">
        <div class="conv-title truncate">New conversation</div>
        <div class="conv-meta">
          <span>Now</span>
        </div>
      </div>
    {/if}
    {#each filtered as conv (conv.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="conv-item"
        class:active={conversationStore.activeId === conv.id}
        onclick={() => selectConversation(conv.id)}
        role="button"
        tabindex="0"
      >
        <div class="conv-title truncate">{conv.title}</div>
        <div class="conv-meta">
          <span>{formatDate(conv.updatedAt)}</span>
          <span>{conv.messageCount} msgs</span>
        </div>
        <button class="conv-delete" onclick={(e) => deleteConversation(e, conv.id)} title="Delete">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    {:else}
      {#if !showDraft}
        <div class="empty">
          {search ? 'No matching conversations' : 'No conversations yet'}
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .conv-list {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .conv-header {
    display: flex;
    gap: 6px;
    padding: 10px 10px 8px;
  }

  .search-input {
    flex: 1;
    font-size: var(--fs-base);
    font-weight: 600;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    letter-spacing: var(--ht-label-spacing);
  }
  .search-input:focus {
    border-color: var(--accent-primary);
    background: var(--bg-input);
    box-shadow: var(--shadow-glow-sm);
  }

  .new-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: var(--radius-sm);
    color: var(--accent-primary);
    transition: all var(--transition);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
  }
  .new-btn:hover {
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
    background: var(--bg-hover);
  }

  .conv-items {
    flex: 1;
    overflow-y: auto;
    padding: 4px 6px;
  }

  .conv-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: var(--ht-item-padding);
    border-radius: var(--radius-sm);
    transition: all var(--transition);
    position: relative;
    margin-bottom: 1px;
    cursor: pointer;
    border-left: var(--ht-item-indicator) solid transparent;
    overflow: hidden;
  }
  .conv-item:hover {
    background: var(--bg-hover);
    border-left-color: var(--border-primary);
  }
  .conv-item.active {
    background: var(--bg-active);
    border-left-color: var(--accent-primary);
    box-shadow: inset 0 0 20px var(--bg-hover);
  }

  /* ── Hypertheme list item variants ── */

  :global([data-hypertheme='ethereal']) .conv-item {
    border-left: none;
    border-radius: var(--radius);
    margin-bottom: 4px;
  }
  :global([data-hypertheme='ethereal']) .conv-item:hover {
    border-left: none;
    transform: translateX(2px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
  :global([data-hypertheme='ethereal']) .conv-item.active {
    border-left: none;
    box-shadow:
      0 2px 12px rgba(0, 0, 0, 0.15),
      inset 0 0 0 1px var(--border-primary);
  }

  :global([data-hypertheme='arcane']) .conv-item {
    border-left: 3px double transparent;
    margin-bottom: 2px;
  }
  :global([data-hypertheme='arcane']) .conv-item:hover {
    border-left-color: var(--border-primary);
  }
  :global([data-hypertheme='arcane']) .conv-item.active {
    border-left-color: var(--accent-primary);
    border: 1px solid var(--border-secondary);
    border-left: 3px double var(--accent-primary);
  }

  :global([data-hypertheme='study']) .conv-item {
    border-left: 3px solid transparent;
    margin-bottom: 0;
    border-bottom: 1px solid var(--border-secondary);
  }
  :global([data-hypertheme='study']) .conv-item:hover,
  :global([data-hypertheme='study']) .conv-item.prehover {
    border-left-color: var(--border-primary);
    background: rgba(228, 160, 60, 0.04);
  }
  :global([data-hypertheme='study']) .conv-item.active {
    border-left-color: var(--accent-primary);
    background: rgba(228, 160, 60, 0.06);
    box-shadow: 0 0 16px rgba(228, 160, 60, 0.04);
  }

  :global([data-hypertheme='astral']) .conv-item,
  :global([data-hypertheme='astral-midnight']) .conv-item {
    border-left: none;
    border-bottom: 1px solid var(--border-secondary);
    border-radius: 0;
    margin-bottom: 0;
  }
  :global([data-hypertheme='astral']) .conv-item:hover,
  :global([data-hypertheme='astral-midnight']) .conv-item:hover {
    border-left: none;
    border-bottom-color: var(--accent-primary);
  }
  :global([data-hypertheme='astral']) .conv-item.active,
  :global([data-hypertheme='astral-midnight']) .conv-item.active {
    border-left: none;
    border-bottom-color: var(--accent-primary);
  }

  .conv-item.draft .conv-title {
    font-style: italic;
    opacity: 0.7;
  }

  .conv-title {
    font-size: var(--fs-md);
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .conv-item.active .conv-title {
    color: var(--accent-primary);
    text-shadow: var(--shadow-glow-sm);
  }

  .conv-meta {
    display: flex;
    gap: 8px;
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    letter-spacing: var(--ht-label-spacing);
    font-weight: 600;
    text-transform: var(--ht-label-transform);
  }

  .conv-delete {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    display: none;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    border: 1px solid transparent;
    transition: all var(--transition);
  }
  .conv-item:hover .conv-delete {
    display: flex;
  }
  .conv-delete:hover {
    color: var(--accent-error);
    border-color: var(--accent-error);
    background: var(--bg-hover);
  }

  .empty {
    padding: 30px 20px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--fs-md);
    letter-spacing: var(--ht-label-spacing);
    font-weight: 600;
    text-transform: var(--ht-label-transform);
  }
</style>
