<script lang="ts">
  /**
   * Read-only viewer for a Claude Code conversation. Loaded into
   * claudeCodeHistoryStore.viewing by the trigger button in
   * ClaudeCodeSection; this modal renders it.
   *
   * Two affordances:
   *   - Close (ESC / X / backdrop click)
   *   - 'Continue in E' — creates a new E conversation seeded with the CC
   *     history as a system-prefix context (one paragraph per message).
   *     Lightweight v1; full provider-aware resume is future work.
   */
  import { uiStore } from '$lib/stores/ui.svelte';
  import { claudeCodeHistoryStore } from '$lib/stores/claude-code-history.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { draftsStore } from '$lib/stores/drafts.svelte';

  function close() {
    uiStore.closeModal();
    claudeCodeHistoryStore.clearViewing();
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  /**
   * Build a single big text block summarising the CC conversation so it
   * can be dropped into a new E conversation as a context preface. Truncate
   * very long bodies so we don't blow the LLM context window — users who
   * want the full history can still scroll the viewer.
   */
  function buildPreface(): string {
    const conv = claudeCodeHistoryStore.viewing;
    if (!conv) return '';
    const MAX_PER = 800;
    const lines: string[] = [`# Previous Claude Code conversation: ${conv.title}`, ''];
    for (const m of conv.messages) {
      const role = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System';
      const body = m.text.length > MAX_PER ? m.text.slice(0, MAX_PER) + '…' : m.text;
      lines.push(`## ${role}\n${body}`);
    }
    return lines.join('\n\n');
  }

  async function continueInE() {
    const preface = buildPreface();
    if (!preface) return;
    // Spin up a fresh E conversation and drop the preface into the input
    // as a starter. The user can edit before sending.
    conversationStore.setActive(null);
    conversationStore.createDraft();
    // ChatInput reads its initial value from draftsStore keyed by the
    // current conversation id; saving against null (draft scope) is what
    // a brand-new-conversation flow expects.
    draftsStore.save(null, preface);
    close();
    uiStore.focusChatInput();
  }
</script>

<svelte:window onkeydown={onKey} />

<div
  class="backdrop"
  role="presentation"
  onclick={onBackdropClick}
  onkeydown={(e) => e.key === 'Escape' && close()}
>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="cc-viewer-title">
    <header class="head">
      {#if claudeCodeHistoryStore.viewing}
        <h2 id="cc-viewer-title" class="title">
          {claudeCodeHistoryStore.viewing.title}
        </h2>
        <span class="badge">Claude Code · read-only</span>
      {:else}
        <h2 id="cc-viewer-title" class="title">Loading…</h2>
      {/if}
      <button class="x" onclick={close} aria-label="Close" title="Close (Esc)">×</button>
    </header>

    <div class="body">
      {#if claudeCodeHistoryStore.viewingLoading}
        <div class="state">Loading conversation…</div>
      {:else if claudeCodeHistoryStore.viewingError}
        <div class="state error">Error: {claudeCodeHistoryStore.viewingError}</div>
      {:else if claudeCodeHistoryStore.viewing}
        {@const conv = claudeCodeHistoryStore.viewing}
        {#if conv.messages.length === 0}
          <div class="state">This conversation has no text messages.</div>
        {:else}
          <ol class="messages">
            {#each conv.messages as msg, i (i)}
              <li class="msg" data-role={msg.role}>
                <div class="role">{msg.role}</div>
                <pre class="text">{msg.text}</pre>
              </li>
            {/each}
          </ol>
        {/if}
      {/if}
    </div>

    <footer class="foot">
      <button class="btn-secondary" onclick={close}>Close</button>
      <button
        class="btn-primary"
        onclick={continueInE}
        disabled={!claudeCodeHistoryStore.viewing ||
          claudeCodeHistoryStore.viewing.messages.length === 0}
        title="Start a new E conversation seeded with this history"
      >
        Continue in E →
      </button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 24px;
  }
  .modal {
    background: var(--bg-secondary, #1e1e1e);
    color: var(--text-primary, #d4d4d4);
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
    border-radius: 6px;
    width: min(880px, 100%);
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
  }
  .title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: var(--bg-tertiary, rgba(255, 255, 255, 0.06));
    color: var(--text-secondary, #aaa);
    padding: 2px 8px;
    border-radius: 8px;
  }
  .x {
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    color: var(--text-secondary, #aaa);
    font-size: 18px;
    cursor: pointer;
    border-radius: 4px;
  }
  .x:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.06));
    color: var(--text-primary, #d4d4d4);
  }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 8px 14px;
  }
  .state {
    padding: 24px;
    text-align: center;
    color: var(--text-tertiary, #888);
  }
  .state.error {
    color: var(--fg-danger, #e06c75);
  }

  .messages {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .msg {
    padding: 8px 10px;
    border-radius: 4px;
    background: var(--bg-primary, rgba(255, 255, 255, 0.02));
    border-left: 3px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
  }
  .msg[data-role='user'] {
    border-left-color: var(--accent-fg, #4ec1f5);
  }
  .msg[data-role='assistant'] {
    border-left-color: var(--fg-success, #98c379);
  }
  .msg[data-role='system'] {
    border-left-color: var(--text-tertiary, #888);
    opacity: 0.7;
  }
  .role {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-secondary, #aaa);
    margin-bottom: 4px;
  }
  .text {
    margin: 0;
    font-family: var(--font-family, ui-monospace, monospace);
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
  }
  .btn-secondary,
  .btn-primary {
    padding: 6px 14px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
    background: transparent;
    color: var(--text-primary, #d4d4d4);
  }
  .btn-secondary:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.06));
  }
  .btn-primary {
    background: var(--accent-bg, #0e639c);
    border-color: var(--accent-bg, #0e639c);
    color: white;
  }
  .btn-primary:hover:not(:disabled) {
    background: var(--accent-bg-hover, #1177bb);
  }
  .btn-primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
