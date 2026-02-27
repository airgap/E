<script lang="ts">
  import MessageList from '$lib/components/chat/MessageList.svelte';
  import ChatInput from '$lib/components/input/ChatInput.svelte';
  import ChangeSummary from '$lib/components/chat/ChangeSummary.svelte';
  import UserQuestionDialog from '$lib/components/chat/UserQuestionDialog.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import { onMount } from 'svelte';

  const pageTitle = $derived.by(() => {
    const base = conversationStore.active?.title ?? 'E';
    if (loopStore.isRunning) {
      const progress =
        loopStore.totalStories > 0
          ? ` ${loopStore.completedStories}/${loopStore.totalStories}`
          : '';
      return `⚡ Golem${progress} — ${base}`;
    }
    if (loopStore.isPaused) {
      return `⏸ Golem Paused — ${base}`;
    }
    return base;
  });

  let chatPage: HTMLDivElement;
  let bottomOverlay: HTMLDivElement;

  onMount(() => {
    if (!bottomOverlay) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        chatPage?.style.setProperty('--input-overlay-h', `${h}px`);
      }
    });
    ro.observe(bottomOverlay);
    return () => ro.disconnect();
  });
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<div class="chat-page" bind:this={chatPage}>
  <MessageList />
  <div class="chat-bottom-overlay" bind:this={bottomOverlay}>
    {#each streamStore.pendingQuestions as pq (pq.toolCallId)}
      <div class="question-overlay-item">
        <UserQuestionDialog question={pq} />
      </div>
    {/each}
    <ChangeSummary />
    <ChatInput />
  </div>
</div>

<style>
  .chat-page {
    position: relative;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .chat-bottom-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 2;
    pointer-events: none;
  }

  .chat-bottom-overlay > :global(*) {
    pointer-events: auto;
  }

  .question-overlay-item {
    position: relative;
    z-index: 10;
    margin: 0 28px 8px;
  }
</style>
