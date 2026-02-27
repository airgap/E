<script lang="ts">
  import { renderMarkdownPartial } from '$lib/utils/markdown';
  import { settingsStore } from '$lib/stores/settings.svelte';

  interface Props {
    text: string;
    streaming?: boolean;
  }

  let { text, streaming = false }: Props = $props();

  const cursorChars: Record<string, string> = {
    block: '\u258A',
    line: '|',
    underscore: '_',
  };

  // Render text directly — no intermediate $state needed.
  // CSS handles the streaming animation.
</script>

<div class="streaming-text-wrapper" class:active={streaming}>
  <div class="prose" class:streaming>
    {@html renderMarkdownPartial(text)}
  </div>
  {#if streaming && settingsStore.streamingCursor !== 'none'}
    <span class="cursor {settingsStore.streamingCursor}"
      >{cursorChars[settingsStore.streamingCursor]}</span
    >
  {/if}
</div>

<style>
  .streaming-text-wrapper {
    position: relative;
    display: inline-block;
  }

  .streaming-text-wrapper.active .prose {
    display: inline;
  }

  /* Streaming text reveal animation */
  .prose.streaming {
    animation: textPulseIn 0.2s ease-out;
    position: relative;
  }

  /* Add a subtle glow wave effect to streaming text */
  .prose.streaming::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(90deg, transparent 0%, var(--bg-hover) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: textGlowWave 1.5s ease-in-out infinite;
    pointer-events: none;
    z-index: 1;
  }

  .cursor {
    display: inline-block;
    margin-left: 2px;
    color: var(--accent-primary);
    animation:
      cursorBlink 0.8s step-end infinite,
      cursorGlow 2s ease-in-out infinite;
    text-shadow: var(--shadow-glow);
    font-weight: bold;
  }
  .cursor.line {
    font-weight: 300;
    margin-left: 0;
  }
  .cursor.underscore {
    vertical-align: baseline;
    margin-left: 0;
  }

  @keyframes textPulseIn {
    0% {
      opacity: 0.7;
      transform: translateY(2px);
      filter: blur(1px);
    }
    100% {
      opacity: 1;
      transform: translateY(0);
      filter: blur(0);
    }
  }

  @keyframes textGlowWave {
    0% {
      background-position: -200% 0;
    }
    100% {
      background-position: 200% 0;
    }
  }

  @keyframes cursorBlink {
    0%,
    50% {
      opacity: 1;
    }
    51%,
    100% {
      opacity: 0;
    }
  }

  @keyframes cursorGlow {
    0%,
    100% {
      text-shadow: var(--shadow-glow-sm);
      transform: scaleY(1);
    }
    50% {
      text-shadow: var(--shadow-glow);
      transform: scaleY(1.1);
    }
  }

  .prose {
    line-height: 1.7;
    color: var(--text-primary);
    font-family: var(--font-family-sans);
    font-size: var(--font-size-sans);
    font-weight: 500;
    position: relative;
    z-index: 2;
  }

  /* Streaming code preview — lightweight, replaced by CodeBlock after stream ends */
  .prose :global(.streaming-code-preview) {
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    overflow: hidden;
    margin: 8px 0;
    font-size: var(--fs-base);
  }
  .prose :global(.streaming-code-header) {
    padding: 4px 10px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-primary);
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--accent-primary);
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
  }
  .prose :global(.streaming-code-body) {
    padding: 10px 14px;
    margin: 0;
    background: var(--bg-code, var(--bg-secondary));
    font-family: var(--font-family);
    font-size: var(--fs-base);
    line-height: 1.5;
    overflow-x: auto;
    white-space: pre;
  }

  /* Inline code */
  .prose :global(code) {
    font-family: var(--font-family);
    font-size: 0.875em;
    background: color-mix(in srgb, var(--accent-primary) 8%, var(--bg-tertiary));
    color: var(--accent-primary);
    padding: 1px 5px;
    border-radius: 4px;
    border: 1px solid color-mix(in srgb, var(--accent-primary) 20%, transparent);
  }
</style>
