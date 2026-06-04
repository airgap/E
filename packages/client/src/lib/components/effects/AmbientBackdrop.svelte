<!--
  AmbientBackdrop.svelte — status-reactive ambient backdrop (LYK-1111).

  A whisper-quiet, full-viewport overlay that reflects workspace state:
    - agent thinking/streaming → a slow accent shimmer
    - tests failing            → a faint red edge vignette
    - calm/passing             → nothing

  Flag-gated (`ambientBackdrop`), off by default. pointer-events:none so it
  never intercepts input. Layers are independent, so "thinking while a prior
  run is failing" shows both.
-->
<script lang="ts">
  import { streamStore } from '$lib/stores/stream.svelte';
  import { testResultsStore } from '$lib/stores/test-results.svelte';
  import { featureFlags } from '$lib/stores/featureFlags.svelte';

  const enabled = $derived(featureFlags.enabled('ambientBackdrop'));
  const thinking = $derived(streamStore.isStreaming);
  const failing = $derived((testResultsStore.summary?.failed ?? 0) > 0);
</script>

{#if enabled}
  {#if thinking}
    <div class="ambient-backdrop thinking" aria-hidden="true"></div>
  {/if}
  {#if failing}
    <div class="ambient-backdrop failing" aria-hidden="true"></div>
  {/if}
{/if}

<style>
  .ambient-backdrop {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 9990;
    opacity: 0;
    animation: ambient-fade-in 0.8s ease forwards;
  }

  .thinking {
    background: radial-gradient(
      circle at 50% 118%,
      color-mix(in srgb, var(--accent-primary) 14%, transparent),
      transparent 62%
    );
    animation:
      ambient-fade-in 0.8s ease forwards,
      ambient-shimmer 4.5s ease-in-out infinite;
  }

  .failing {
    box-shadow: inset 0 0 200px 36px
      color-mix(in srgb, var(--accent-error, #e74c3c) 20%, transparent);
  }

  @keyframes ambient-fade-in {
    to {
      opacity: 1;
    }
  }

  @keyframes ambient-shimmer {
    0%,
    100% {
      opacity: 0.55;
    }
    50% {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ambient-backdrop {
      animation: ambient-fade-in 0.8s ease forwards;
    }
    .thinking {
      opacity: 0.7;
    }
  }
</style>
