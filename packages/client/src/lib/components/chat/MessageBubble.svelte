<script lang="ts">
  import type { Message, MessageContent } from '@e/shared';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { chirpEngine } from '$lib/audio/chirp-engine';
  import CodeBlock from './CodeBlock.svelte';
  import ThinkingBlock from './ThinkingBlock.svelte';
  import ToolCallBlock from './ToolCallBlock.svelte';
  import AgentGroupStatic from './AgentGroupStatic.svelte';
  import MessageAnimation from './MessageAnimation.svelte';
  import { renderMarkdown, renderMarkdownPartial } from '$lib/utils/markdown';
  import ProseBlock from './ProseBlock.svelte';
  import { ttsStore } from '$lib/services/tts.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { api } from '$lib/api/client';
  import ReplayModal from './ReplayModal.svelte';
  import ArtifactCard from './ArtifactCard.svelte';
  import { artifactsStore } from '$lib/stores/artifacts.svelte';
  import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
  import type { ContextMenuItem } from '$lib/components/ui/ContextMenu.svelte';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';

  let { message, conversationId, onEdit, onDelete, onFork } = $props<{
    message: Message;
    conversationId?: string;
    onEdit?: (messageId: string, newText: string) => void;
    onDelete?: (messageId: string) => void;
    onFork?: (messageId: string) => void;
  }>();

  // ── Edit state ──
  let editing = $state(false);
  let editText = $state('');
  let editTextarea = $state<HTMLTextAreaElement>();

  function getTextContent(): string {
    return (message.content as any[])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text as string)
      .join('\n\n');
  }

  /** True when this is a mid-stream nudge message (role=user, type=nudge) */
  let isNudge = $derived(
    message.role === 'user' &&
      (message.content as any[]).length > 0 &&
      (message.content as any[])[0]?.type === 'nudge',
  );

  /** The nudge text content */
  let nudgeText = $derived(isNudge ? (((message.content as any[])[0]?.text as string) ?? '') : '');

  /** True when this is a cross-session message from another agent */
  let isCrossSession = $derived(
    message.role === 'user' &&
      (message.content as any[]).length > 0 &&
      (message.content as any[])[0]?.type === 'cross_session',
  );

  /** The cross-session message data */
  let crossSessionData = $derived(isCrossSession ? (message.content as any[])[0] : null);

  function startEdit() {
    editText = getTextContent();
    editing = true;
    requestAnimationFrame(() => {
      if (editTextarea) {
        editTextarea.focus();
        editTextarea.style.height = 'auto';
        editTextarea.style.height = Math.min(editTextarea.scrollHeight, 400) + 'px';
      }
    });
  }

  function cancelEdit() {
    editing = false;
    editText = '';
  }

  function submitEdit() {
    const text = editText.trim();
    if (text && onEdit) {
      onEdit(message.id, text);
    }
    editing = false;
    editText = '';
  }

  // ── Snapshot restore state ──
  let restoringSnapshot = $state(false);

  async function handleRestore() {
    if (restoringSnapshot || message.role !== 'assistant') return;
    restoringSnapshot = true;
    try {
      const snapRes = await api.git.snapshotByMessage(message.id);
      if (snapRes.ok && snapRes.data) {
        await api.git.restoreSnapshot(snapRes.data.id);
        uiStore.toast('Snapshot restored successfully', 'success');
      } else {
        uiStore.toast('No snapshot found for this message', 'info');
      }
    } catch {
      uiStore.toast('Failed to restore snapshot', 'error');
    }
    restoringSnapshot = false;
  }

  // ── Replay state ──
  let showReplay = $state(false);

  // ── Context menu ──
  let showContextMenu = $state(false);
  let contextMenuX = $state(0);
  let contextMenuY = $state(0);

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    contextMenuX = e.clientX;
    contextMenuY = e.clientY;
    showContextMenu = true;
  }

  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');

  function uiClick() {
    if (settingsStore.soundEnabled) chirpEngine.uiClick();
  }

  function copyMessageText() {
    const text = getTextContent();
    if (text) navigator.clipboard.writeText(text);
    uiClick();
  }

  function copyMessageHtml() {
    const text = getTextContent();
    if (!text) return;
    // Copy as markdown
    navigator.clipboard.writeText(text);
    uiStore.toast('Copied as markdown', 'success');
  }

  let contextMenuItems = $derived<ContextMenuItem[]>([
    {
      label: 'Copy Message',
      shortcut: isMac ? '⌘C' : 'Ctrl+C',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
      action: copyMessageText,
    },
    {
      label: 'Copy as Markdown',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
      action: copyMessageHtml,
    },
    { kind: 'separator' },
    {
      label: 'Edit',
      shortcut: 'E',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
      action: startEdit,
    },
    {
      label: 'Fork from here',
      shortcut: 'F',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`,
      action: () => onFork?.(message.id),
    },
    ...(message.role === 'assistant'
      ? [
          {
            label: restoringSnapshot ? 'Restoring…' : 'Restore Snapshot',
            shortcut: 'R',
            disabled: restoringSnapshot,
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`,
            action: handleRestore,
          } as ContextMenuItem,
        ]
      : []),
    { kind: 'separator' },
    {
      label: 'Delete',
      shortcut: isMac ? '⌫' : 'Del',
      danger: true,
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`,
      action: () => onDelete?.(message.id),
    },
  ]);

  // ── Markdown rendering ──
  let renderedHtml = $state('');

  // Render user message text as markdown (single blob for user messages)
  $effect(() => {
    if (message.role !== 'user') {
      renderedHtml = '';
      return;
    }
    const textContent = getTextContent();
    if (textContent) {
      renderMarkdown(textContent).then((html) => {
        renderedHtml = html;
      });
    }
  });

  // Pre-render each text block's markdown for assistant messages
  let renderedTextBlocks = $state<Map<number, string>>(new Map());

  $effect(() => {
    if (message.role !== 'assistant') return;
    const blocks = message.content as any[];
    const promises: Array<{ idx: number; promise: Promise<string> }> = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type === 'text' && !b.parentToolUseId && b.text) {
        promises.push({ idx: i, promise: renderMarkdown(b.text) });
      }
    }
    Promise.all(promises.map(async (p) => ({ idx: p.idx, html: await p.promise }))).then(
      (results) => {
        const newMap = new Map<number, string>();
        for (const r of results) newMap.set(r.idx, r.html);
        renderedTextBlocks = newMap;
      },
    );
  });

  function getToolResults(content: any[]) {
    return content.filter((c: any) => c.type === 'tool_result');
  }

  // Group content blocks: top-level items + agent groups, preserving original order
  interface GroupedItem {
    kind: 'block';
    block: MessageContent;
    index: number;
  }
  interface GroupedAgent {
    kind: 'agent';
    taskBlock: MessageContent & { type: 'tool_use' };
    children: MessageContent[];
  }
  type GroupedEntry = GroupedItem | GroupedAgent;

  let grouped = $derived.by(() => {
    const blocks = message.content as any[];
    if (message.role !== 'assistant') return [];
    const entries: GroupedEntry[] = [];

    const agentIds = new Set<string>();
    for (const b of blocks) {
      if (b.type === 'tool_use' && b.name === 'Task' && !b.parentToolUseId) {
        agentIds.add(b.id);
      }
    }

    const childrenMap = new Map<string, MessageContent[]>();
    for (const b of blocks) {
      const pid = b.parentToolUseId;
      if (pid && agentIds.has(pid)) {
        if (!childrenMap.has(pid)) childrenMap.set(pid, []);
        childrenMap.get(pid)!.push(b);
      }
    }

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type === 'tool_result') continue;
      if (b.parentToolUseId && agentIds.has(b.parentToolUseId)) continue;
      if (b.type === 'tool_use' && agentIds.has(b.id)) {
        entries.push({
          kind: 'agent',
          taskBlock: b as MessageContent & { type: 'tool_use' },
          children: childrenMap.get(b.id) || [],
        });
      } else {
        entries.push({ kind: 'block', block: b, index: i });
      }
    }

    return entries;
  });

  // Image blocks in user messages (for displaying attached images)
  let userImageBlocks = $derived(
    message.role === 'user'
      ? (message.content as any[]).filter((b: any) => b.type === 'image')
      : [],
  );

  // Artifacts emitted by this message (looked up from artifacts store by message ID)
  let messageArtifacts = $derived(
    artifactsStore.artifacts.filter((a) => a.messageId === message.id),
  );
</script>

<!-- Shared context menu (keyboard-navigable, smart-positioned) -->
{#if showContextMenu}
  <ContextMenu
    items={contextMenuItems}
    x={contextMenuX}
    y={contextMenuY}
    onClose={() => {
      showContextMenu = false;
    }}
  />
{/if}

{#snippet messageHeader()}
  <div class="message-header">
    <span class="role-label">{message.role === 'user' ? 'You' : 'Claude'}</span>
    {#if message.isVoiceMessage}
      <span class="voice-badge" title="Voice input">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0" />
          <line x1="12" y1="17" x2="12" y2="21" />
          <line x1="9" y1="21" x2="15" y2="21" />
        </svg>
      </span>
    {/if}
    {#if message.model}
      <span class="model-label">{message.model.split('-').slice(1, 3).join(' ')}</span>
    {/if}
    <span class="timestamp">
      {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </span>
    {#if !editing}
      <div class="message-actions">
        <Tooltip content="Edit message" shortcut="E" placement="bottom">
          <button
            class="action-btn"
            aria-label="Edit"
            onclick={() => {
              startEdit();
              uiClick();
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path
                d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
              />
            </svg>
          </button>
        </Tooltip>
        <Tooltip content="Fork from here" shortcut="F" placement="bottom">
          <button
            class="action-btn"
            aria-label="Fork from here"
            onclick={() => {
              onFork?.(message.id);
              uiClick();
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle
                cx="6"
                cy="18"
                r="3"
              /><path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          </button>
        </Tooltip>
        {#if message.role === 'assistant'}
          <Tooltip
            content={restoringSnapshot ? 'Restoring…' : 'Restore snapshot'}
            shortcut="R"
            placement="bottom"
          >
            <button
              class="action-btn action-restore"
              aria-label={restoringSnapshot ? 'Restoring...' : 'Restore snapshot'}
              onclick={() => {
                handleRestore();
                uiClick();
              }}
              disabled={restoringSnapshot}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <polyline points="1 4 1 10 7 10"></polyline>
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
              </svg>
            </button>
          </Tooltip>
          <Tooltip
            content={ttsStore.currentId === message.id ? 'Stop reading' : 'Read aloud'}
            placement="bottom"
          >
            <button
              class="btn-icon"
              class:active={ttsStore.currentId === message.id}
              aria-label={ttsStore.currentId === message.id ? 'Stop reading' : 'Read aloud'}
              onclick={() => {
                const text = message.content
                  .filter((b: any) => b.type === 'text')
                  .map((b: any) => b.text)
                  .join(' ');
                ttsStore.toggle(text, message.id);
                uiClick();
              }}
            >
              {#if ttsStore.currentId === message.id}<svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  stroke="none"><rect x="4" y="4" width="16" height="16" rx="2" /></svg
                >{:else}<svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path
                    d="M19.07 4.93a10 10 0 0 1 0 14.14"
                  /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg
                >{/if}
            </button>
          </Tooltip>
          {#if conversationId}
            <Tooltip content="Replay session" placement="bottom">
              <button
                class="btn-icon"
                aria-label="Replay session"
                onclick={() => {
                  showReplay = true;
                  uiClick();
                }}
                ><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"
                  ><polygon points="5 3 19 12 5 21 5 3" /></svg
                ></button
              >
            </Tooltip>
          {/if}
        {/if}
        <Tooltip content="Delete message" placement="bottom">
          <button
            class="action-btn action-delete"
            aria-label="Delete message"
            onclick={() => {
              onDelete?.(message.id);
              uiClick();
            }}
          >
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
        </Tooltip>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet editUI()}
  <div class="edit-container">
    <textarea
      class="edit-textarea"
      bind:this={editTextarea}
      bind:value={editText}
      onkeydown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          submitEdit();
        }
        if (e.key === 'Escape') cancelEdit();
      }}
      oninput={() => {
        if (editTextarea) {
          editTextarea.style.height = 'auto';
          editTextarea.style.height = Math.min(editTextarea.scrollHeight, 400) + 'px';
        }
      }}
    ></textarea>
    <div class="edit-actions">
      <button class="edit-btn edit-cancel" onclick={cancelEdit}>Cancel</button>
      <button class="edit-btn edit-submit" onclick={submitEdit} disabled={!editText.trim()}
        >Save & Resend</button
      >
    </div>
  </div>
{/snippet}

{#if isCrossSession && crossSessionData}
  <!-- Cross-session message from another agent — displayed distinctly -->
  <div class="cross-session-bubble">
    <div class="cross-session-header">
      <span class="cross-session-icon">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M4 12h16M4 12l4-4M4 12l4 4M20 12l-4-4M20 12l-4 4"></path>
        </svg>
      </span>
      <span class="cross-session-label">Cross-Session</span>
      <span class="cross-session-from" title={crossSessionData.fromConversationId}>
        {crossSessionData.fromWorkspaceName}: {crossSessionData.fromConversationTitle}
        {#if crossSessionData.fromAgentProfile}
          <span class="cross-session-profile">({crossSessionData.fromAgentProfile})</span>
        {/if}
      </span>
      <span class="cross-session-time">
        {new Date(message.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
    </div>
    <div class="cross-session-content">{crossSessionData.text}</div>
  </div>
{:else if isNudge}
  <!-- Nudge messages rendered distinctly inline -->
  <div class="nudge-bubble">
    <span class="nudge-icon">
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
    </span>
    <span class="nudge-label-tag">Nudge</span>
    <span class="nudge-text">{nudgeText}</span>
    <span class="nudge-time"
      >{new Date(message.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })}</span
    >
  </div>
{:else if message.role === 'assistant'}
  <MessageAnimation>
    {#snippet children()}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="message"
        class:user={message.role === 'user'}
        class:assistant={message.role === 'assistant'}
        class:editing
        oncontextmenu={handleContextMenu}
      >
        {@render messageHeader()}

        <div class="message-body">
          {#if editing}
            {@render editUI()}
          {:else}
            {#each grouped as entry}
              {#if entry.kind === 'agent'}
                {#if settingsStore.showToolDetails}
                  <AgentGroupStatic
                    taskBlock={entry.taskBlock}
                    children={entry.children}
                    toolResults={getToolResults(message.content)}
                  />
                {/if}
              {:else if entry.block.type === 'text' && !entry.block.parentToolUseId}
                {@const html = renderedTextBlocks.get(entry.index)}
                {#if html}
                  <ProseBlock {html} />
                {:else if entry.block.text}
                  <!-- Synchronous fallback while async renderMarkdown() resolves -->
                  <div class="prose">{@html renderMarkdownPartial(entry.block.text)}</div>
                {/if}
              {:else if entry.block.type === 'thinking' && settingsStore.showThinkingBlocks}
                <ThinkingBlock content={entry.block.thinking} />
              {:else if entry.block.type === 'image'}
                {@const imgBlock = entry.block as import('@e/shared').ImageContent}
                <div class="message-image">
                  {#if imgBlock.source.type === 'base64' && imgBlock.source.data}
                    <img
                      src="data:{imgBlock.source.media_type};base64,{imgBlock.source.data}"
                      alt="Attached image"
                      loading="lazy"
                    />
                  {:else if imgBlock.source.type === 'url' && imgBlock.source.url}
                    <img src={imgBlock.source.url} alt="Attached image" loading="lazy" />
                  {/if}
                </div>
              {:else if entry.block.type === 'tool_use'}
                {#if settingsStore.showToolDetails}
                  {@const toolBlock = entry.block as import('@e/shared').ToolUseContent}
                  <ToolCallBlock
                    toolName={toolBlock.name}
                    input={toolBlock.input}
                    toolCallId={toolBlock.id}
                    result={getToolResults(message.content).find(
                      (r: any) => r.tool_use_id === toolBlock.id,
                    )}
                  />
                {/if}
              {/if}
            {/each}
            <!-- Artifacts emitted by this message -->
            {#if messageArtifacts.length > 0}
              <div class="message-artifacts">
                {#each messageArtifacts as artifact (artifact.id)}
                  <ArtifactCard {artifact} />
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      </div>
    {/snippet}
  </MessageAnimation>
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="message"
    class:user={message.role === 'user'}
    class:assistant={message.role === 'assistant'}
    class:editing
    oncontextmenu={handleContextMenu}
  >
    {@render messageHeader()}

    <div class="message-body">
      {#if editing}
        {@render editUI()}
      {:else}
        {#if userImageBlocks.length > 0}
          <div class="user-images">
            {#each userImageBlocks as imgBlock}
              <div class="message-image">
                {#if imgBlock.source?.type === 'base64' && imgBlock.source.data}
                  <img
                    src="data:{imgBlock.source.media_type};base64,{imgBlock.source.data}"
                    alt="Attached image"
                    loading="lazy"
                  />
                {:else if imgBlock.source?.type === 'url' && imgBlock.source.url}
                  <img src={imgBlock.source.url} alt="Attached image" loading="lazy" />
                {/if}
              </div>
            {/each}
          </div>
        {/if}
        {#if renderedHtml}
          <ProseBlock html={renderedHtml} />
        {/if}
      {/if}
    </div>
  </div>
{/if}

{#if showReplay && conversationId}
  <ReplayModal {conversationId} onClose={() => (showReplay = false)} />
{/if}

<style>
  .message {
    padding: var(--ht-msg-padding);
    margin: 0;
    animation: fadeIn 0.2s linear;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
    position: relative;
  }

  .message.user {
    background: var(--bg-message-user);
    margin-left: 28px;
    margin-right: 28px;
    margin-bottom: 2px;
    border-left: var(--ht-msg-border-width) var(--ht-msg-border-style) var(--border-primary);
  }
  .message.user:hover {
    background: var(--bg-hover);
    border-left-color: var(--accent-primary);
  }

  .message.assistant {
    background: var(--bg-message-assistant);
    margin-left: 28px;
    margin-right: 28px;
    margin-bottom: 2px;
    border-left: var(--ht-msg-border-width) var(--ht-msg-border-style) var(--border-secondary);
  }
  .message.assistant:hover {
    background: var(--bg-hover);
    border-left-color: var(--accent-primary);
  }

  .message.editing {
    border-left-color: var(--accent-primary);
  }

  /* ── Hypertheme message variants ── */

  /* Ethereal: no left border, floating card with glow halo */
  :global([data-hypertheme='ethereal']) .message {
    border-radius: var(--radius-lg);
    border-left: none !important;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  }
  :global([data-hypertheme='ethereal']) .message:hover {
    box-shadow:
      0 4px 20px rgba(0, 0, 0, 0.2),
      0 0 20px rgba(160, 120, 240, 0.06);
    transform: translateY(-1px);
  }

  /* Arcane: thick double left border, ornate feel */
  :global([data-hypertheme='arcane']) .message {
    border: 1px solid var(--border-secondary);
    border-left: 3px double var(--border-primary);
  }
  :global([data-hypertheme='arcane']) .message:hover {
    border-color: var(--border-primary);
    border-left-color: var(--accent-primary);
    box-shadow: inset 0 0 20px rgba(139, 92, 246, 0.04);
  }

  /* Study: warm ember glow, subtle left accent */
  :global([data-hypertheme='study']) .message {
    border: 1px solid var(--border-secondary);
    border-left: 3px solid var(--border-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }
  :global([data-hypertheme='study']) .message:hover,
  :global([data-hypertheme='study']) .message.prehover {
    border-left-color: var(--accent-primary);
    box-shadow:
      0 2px 12px rgba(0, 0, 0, 0.2),
      0 0 20px rgba(228, 160, 60, 0.06);
  }

  /* Astral: thin luminous top-border, clean geometric */
  :global([data-hypertheme='astral']) .message,
  :global([data-hypertheme='astral-midnight']) .message {
    border-left: none;
    border-top: 1px solid var(--border-secondary);
    border-bottom: none;
  }
  :global([data-hypertheme='astral']) .message.user,
  :global([data-hypertheme='astral-midnight']) .message.user {
    border-left: none;
    border-top-color: var(--border-primary);
  }
  :global([data-hypertheme='astral']) .message.assistant,
  :global([data-hypertheme='astral-midnight']) .message.assistant {
    border-left: none;
    border-top-color: var(--border-secondary);
  }
  :global([data-hypertheme='astral']) .message:hover,
  :global([data-hypertheme='astral-midnight']) .message:hover {
    border-top-color: var(--accent-primary);
    box-shadow: 0 0 15px rgba(140, 160, 220, 0.05);
  }

  /* ── Header ── */

  .message-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
    font-size: var(--fs-sm);
  }

  .role-label {
    font-weight: 700;
    font-size: var(--fs-base);
    letter-spacing: var(--ht-label-spacing);
    text-transform: var(--ht-label-transform);
  }
  .user .role-label {
    color: var(--accent-primary);
    text-shadow: var(--shadow-glow-sm);
  }
  .assistant .role-label {
    color: var(--accent-secondary);
    text-shadow: var(--shadow-glow-sm);
  }

  .voice-badge {
    display: inline-flex;
    align-items: center;
    color: var(--accent-primary);
    opacity: 0.7;
    margin-left: -4px;
  }

  .model-label {
    color: var(--text-tertiary);
    font-size: var(--fs-xxs);
    font-weight: 600;
    letter-spacing: var(--ht-label-spacing);
    padding: 1px 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    text-transform: var(--ht-label-transform);
  }

  .timestamp {
    color: var(--text-tertiary);
    margin-left: auto;
    font-size: var(--fs-xxs);
    font-family: var(--font-family);
    opacity: 0;
    transition: opacity var(--transition);
  }
  .message:hover .timestamp {
    opacity: 1;
  }

  /* ── Hover action buttons ── */

  .message-actions {
    display: none;
    align-items: center;
    gap: 2px;
    margin-left: 4px;
  }
  .message:hover .message-actions {
    display: flex;
  }
  .message:hover :global(.branch-btn) {
    opacity: 1;
  }

  .action-btn {
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    transition: all var(--transition);
    padding: 0;
  }
  .action-btn:hover {
    color: var(--accent-primary);
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }
  .action-delete:hover {
    color: var(--accent-error);
    border-color: var(--accent-error);
  }
  .action-restore:hover {
    color: var(--accent-warning);
    border-color: var(--accent-warning);
  }
  .action-restore:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-icon {
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    transition: all var(--transition);
    padding: 0;
    font-size: var(--fs-sm);
  }
  .btn-icon:hover {
    color: var(--accent-primary);
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }
  .btn-icon.active {
    color: var(--accent-primary);
  }

  /* ── Inline edit ── */

  .edit-container {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .edit-textarea {
    width: 100%;
    min-height: 60px;
    max-height: 400px;
    padding: 10px 12px;
    font-family: var(--font-family-sans);
    font-size: var(--font-size-sans);
    font-weight: 500;
    line-height: 1.6;
    background: var(--bg-input);
    border: 1px solid var(--accent-primary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    resize: vertical;
    outline: none;
  }
  .edit-textarea:focus {
    box-shadow: var(--shadow-glow-sm);
  }
  .edit-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .edit-btn {
    padding: 4px 14px;
    font-size: var(--fs-sm);
    font-weight: 600;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all var(--transition);
    letter-spacing: var(--ht-label-spacing);
  }
  .edit-cancel {
    background: transparent;
    border: 1px solid var(--border-primary);
    color: var(--text-secondary);
  }
  .edit-cancel:hover {
    border-color: var(--text-primary);
    color: var(--text-primary);
  }
  .edit-submit {
    background: var(--accent-primary);
    border: 1px solid var(--accent-primary);
    color: var(--bg-primary);
  }
  .edit-submit:hover:not(:disabled) {
    filter: brightness(1.1);
    box-shadow: var(--shadow-glow-sm);
  }
  .edit-submit:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  /* ── Body & prose ── */

  .message-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* ── Artifact cards in message body ── */
  .message-artifacts {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
  }

  /* ── Cross-session message bubble ── */
  .cross-session-bubble {
    margin: 6px 28px;
    padding: 8px 12px;
    background: color-mix(in srgb, var(--accent-warning, #f59e0b) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-warning, #f59e0b) 30%, transparent);
    border-left: 3px solid var(--accent-warning, #f59e0b);
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
    animation: fadeIn 0.15s linear;
  }

  .cross-session-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
    flex-wrap: wrap;
  }

  .cross-session-icon {
    color: var(--accent-warning, #f59e0b);
    opacity: 0.9;
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .cross-session-label {
    font-size: var(--fs-xxs);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent-warning, #f59e0b);
    opacity: 0.85;
    flex-shrink: 0;
  }

  .cross-session-from {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    font-weight: 500;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cross-session-profile {
    font-weight: 400;
    color: var(--text-tertiary);
    font-style: italic;
  }

  .cross-session-time {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .cross-session-content {
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.45;
  }

  /* ── Nudge message bubble ── */
  .nudge-bubble {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 4px 28px;
    padding: 5px 10px;
    background: color-mix(in srgb, var(--accent-primary) 6%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent);
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    animation: fadeIn 0.15s linear;
  }

  .nudge-icon {
    color: var(--accent-primary);
    opacity: 0.8;
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .nudge-label-tag {
    font-size: var(--fs-xxs);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent-primary);
    opacity: 0.75;
    flex-shrink: 0;
  }

  .nudge-text {
    flex: 1;
    color: var(--text-primary);
    font-style: italic;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .nudge-time {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    flex-shrink: 0;
    margin-left: 4px;
  }

  /* ── Image attachments ── */
  .message-image {
    margin: 4px 0;
  }
  .message-image img {
    max-width: 100%;
    max-height: 400px;
    object-fit: contain;
    border-radius: var(--radius);
    border: 1px solid var(--border-secondary);
    background: var(--bg-secondary);
    cursor: pointer;
    transition: border-color var(--transition);
  }
  .message-image img:hover {
    border-color: var(--accent-primary);
  }

  .user-images {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 4px;
  }
  .user-images .message-image img {
    max-height: 200px;
  }
</style>
