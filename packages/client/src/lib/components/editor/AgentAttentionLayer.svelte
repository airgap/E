<!--
  AgentAttentionLayer.svelte — connective "attention" line to the agent's focus (LYK-1095).

  While the agent is working, draws a soft curve from the chat/activity side of the
  window to the exact code line it's currently touching, plus a pulsing marker on
  the line. The editor publishes the line's live screen position (editorStore
  .agentAttentionPoint); this overlay just draws to it. Flag-gated
  (`agentAttentionLines`), off by default. pointer-events:none.

  Note: the chat-side anchor is the lower-left activity corner (a stable,
  layout-agnostic origin) rather than the exact message bubble — a faithful
  message-anchored line would need the chat to expose per-message coordinates.
-->
<script lang="ts">
  import { editorStore } from '$lib/stores/editor.svelte';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { featureFlags } from '$lib/stores/featureFlags.svelte';

  let vw = $state(0);
  let vh = $state(0);
  $effect(() => {
    const update = () => {
      vw = window.innerWidth;
      vh = window.innerHeight;
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  });

  const show = $derived(
    featureFlags.enabled('agentAttentionLines') &&
      streamStore.isStreaming &&
      !!editorStore.agentAttentionPoint,
  );

  const path = $derived.by(() => {
    const p = editorStore.agentAttentionPoint;
    if (!p) return '';
    const sx = 60;
    const sy = vh - 90; // lower-left activity corner
    const c1x = sx + (p.x - sx) * 0.35;
    const c1y = sy;
    const c2x = p.x - 140;
    const c2y = p.y;
    return `M ${sx} ${sy} C ${c1x} ${c1y} ${c2x} ${c2y} ${p.x} ${p.y}`;
  });
</script>

{#if show}
  {@const p = editorStore.agentAttentionPoint}
  <svg class="attn" width={vw} height={vh} viewBox="0 0 {vw} {vh}" aria-hidden="true">
    <path class="attn-line" d={path} />
    {#if p}
      <circle class="attn-dot" cx={p.x} cy={p.y} r="5" />
      <circle class="attn-pulse" cx={p.x} cy={p.y} r="5" />
    {/if}
  </svg>
{/if}

<style>
  .attn {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 9994;
  }
  .attn-line {
    fill: none;
    stroke: var(--accent-primary);
    stroke-width: 2;
    opacity: 0.55;
    stroke-dasharray: 7 6;
    animation: attn-flow 0.9s linear infinite;
  }
  .attn-dot {
    fill: var(--accent-primary);
  }
  .attn-pulse {
    fill: none;
    stroke: var(--accent-primary);
    stroke-width: 2;
    transform-origin: center;
    transform-box: fill-box;
    animation: attn-ping 1.4s ease-out infinite;
  }
  @keyframes attn-flow {
    to {
      stroke-dashoffset: -13;
    }
  }
  @keyframes attn-ping {
    0% {
      transform: scale(1);
      opacity: 0.8;
    }
    100% {
      transform: scale(3.4);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .attn-line,
    .attn-pulse {
      animation: none;
    }
  }
</style>
