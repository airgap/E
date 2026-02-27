<script lang="ts">
  import { commentaryStore } from '$lib/stores/commentary.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';

  let isActive = $derived(commentaryStore.isActive);
  let latestText = $derived(commentaryStore.commentaryText);
  let personality = $derived(commentaryStore.personality);

  /** Only show when commentary is active and there's something to display. */
  let visible = $derived(isActive && latestText.length > 0);

  const personalityLabels: Record<string, string> = {
    documentary_narrator: 'Narrator',
    technical_analyst: 'Analyst',
    comedic_observer: 'Comedy',
    project_lead: 'Lead',
    wizard: 'Wizard',
  };

  let personalityLabel = $derived(personalityLabels[personality ?? ''] ?? 'Commentary');
</script>

{#if visible}
  <button
    class="commentary-ticker"
    onclick={() => uiStore.setSidebarTab('commentary')}
    title="Click to open commentary panel"
  >
    <span class="ticker-dot"></span>
    <span class="ticker-personality">{personalityLabel}</span>
    <span class="ticker-text">{latestText}</span>
  </button>
{/if}

<style>
  .commentary-ticker {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 16px;
    background: color-mix(in srgb, var(--accent-primary) 6%, var(--bg-secondary));
    border-bottom: 1px solid var(--border-secondary);
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    cursor: pointer;
    overflow: hidden;
    flex-shrink: 0;
    width: 100%;
    text-align: left;
    transition: background var(--transition);
    position: relative;
    z-index: 9;
  }
  .commentary-ticker:hover {
    background: color-mix(in srgb, var(--accent-primary) 12%, var(--bg-secondary));
  }

  .ticker-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-primary);
    flex-shrink: 0;
    animation: tickerDotPulse 2s ease-in-out infinite;
  }
  @keyframes tickerDotPulse {
    0%,
    100% {
      opacity: 1;
      box-shadow: 0 0 4px var(--accent-primary);
    }
    50% {
      opacity: 0.5;
      box-shadow: none;
    }
  }

  .ticker-personality {
    font-weight: 700;
    color: var(--accent-primary);
    letter-spacing: var(--ht-label-spacing);
    text-transform: var(--ht-label-transform);
    flex-shrink: 0;
    font-size: var(--fs-xxs);
  }

  .ticker-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
    color: var(--text-tertiary);
    font-style: italic;
  }
</style>
