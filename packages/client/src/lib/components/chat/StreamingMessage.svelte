<script lang="ts">
  import type { MessageContent } from '@e/shared';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { renderMarkdownPartial } from '$lib/utils/markdown';
  import ThinkingBlock from './ThinkingBlock.svelte';
  import ToolCallBlock from './ToolCallBlock.svelte';
  import ToolApprovalDialog from './ToolApprovalDialog.svelte';

  import AgentGroup from './AgentGroup.svelte';
  import StreamingText from './StreamingText.svelte';
  import MessageAnimation from './MessageAnimation.svelte';
  import ToolCallTracker from './ToolCallTracker.svelte';
  import { throbberStore } from '$lib/stores/throbber.svelte';

  // Build a grouped view: top-level blocks + agent groups.
  // A "Task" tool_use block becomes an agent header, and all blocks
  // whose parentToolUseId matches its id are its children.
  interface GroupedItem {
    kind: 'block';
    block: MessageContent;
    index: number;
  }
  interface GroupedAgent {
    kind: 'agent';
    taskBlock: MessageContent & { type: 'tool_use' };
    children: MessageContent[];
    lastChildIndex: number;
  }
  type GroupedEntry = GroupedItem | GroupedAgent;

  let grouped = $derived.by(() => {
    const blocks = streamStore.contentBlocks;
    // Recalculate grouped view
    const entries: GroupedEntry[] = [];

    // Collect all agent task block IDs
    const agentIds = new Set<string>();
    for (const b of blocks) {
      if (
        b.type === 'tool_use' &&
        b.name === 'Task' &&
        !('parentToolUseId' in b && b.parentToolUseId)
      ) {
        agentIds.add(b.id);
      }
    }

    // Group children by parent
    const childrenMap = new Map<string, MessageContent[]>();
    const lastChildIndexMap = new Map<string, number>();
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const pid = 'parentToolUseId' in b ? (b as any).parentToolUseId : undefined;
      if (pid && agentIds.has(pid)) {
        if (!childrenMap.has(pid)) childrenMap.set(pid, []);
        childrenMap.get(pid)!.push(b);
        lastChildIndexMap.set(pid, i);
      }
    }

    // Build entries
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const pid = 'parentToolUseId' in b ? (b as any).parentToolUseId : undefined;
      if (pid && agentIds.has(pid)) {
        // Skip — rendered inside agent group
        continue;
      }
      if (b.type === 'tool_use' && agentIds.has(b.id)) {
        entries.push({
          kind: 'agent',
          taskBlock: b as MessageContent & { type: 'tool_use' },
          children: childrenMap.get(b.id) || [],
          lastChildIndex: lastChildIndexMap.get(b.id) ?? i,
        });
      } else {
        entries.push({ kind: 'block', block: b, index: i });
      }
    }

    return entries;
  });

  let totalBlocks = $derived(streamStore.contentBlocks.length);
</script>

<MessageAnimation>
  {#snippet children()}
    <div class="message assistant streaming">
      <div class="message-header">
        <span class="role-label">Claude</span>
        {#if settingsStore.streamingIndicator === 'dots'}
          <span class="streaming-indicator">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
          </span>
        {:else if settingsStore.streamingIndicator === 'spinner'}
          <span class="streaming-indicator">
            <span class="spinner"></span>
          </span>
        {:else if settingsStore.streamingIndicator === 'pulse'}
          <span class="streaming-indicator">
            <span class="pulse-orb"></span>
          </span>
        {/if}
      </div>

      <div class="message-body">
        <!-- Tool call tracker for progress visibility -->
        <ToolCallTracker />

        {#each grouped as entry}
          {#if entry.kind === 'agent'}
            <AgentGroup
              taskBlock={entry.taskBlock}
              children={entry.children}
              streaming={entry.lastChildIndex === totalBlocks - 1}
            />
          {:else if entry.block.type === 'thinking' && settingsStore.showThinkingBlocks}
            <ThinkingBlock
              content={entry.block.thinking}
              streaming={entry.index === totalBlocks - 1}
            />
          {:else if entry.block.type === 'text' && entry.block.text}
            {@const isStreaming = entry.index === totalBlocks - 1}
            <StreamingText text={entry.block.text} streaming={isStreaming} />
          {:else if entry.block.type === 'image'}
            <div class="message-image">
              {#if entry.block.source?.type === 'base64' && entry.block.source.data}
                <img
                  src="data:{entry.block.source.media_type};base64,{entry.block.source.data}"
                  alt="Attached image"
                  loading="lazy"
                  style="max-width: 100%; max-height: 400px; object-fit: contain; border-radius: var(--radius); border: 1px solid var(--border-secondary);"
                />
              {:else if entry.block.source?.type === 'url' && entry.block.source.url}
                <img
                  src={entry.block.source.url}
                  alt="Attached image"
                  loading="lazy"
                  style="max-width: 100%; max-height: 400px; object-fit: contain; border-radius: var(--radius); border: 1px solid var(--border-secondary);"
                />
              {/if}
            </div>
          {:else if entry.block.type === 'tool_use'}
            {@const hasResult = streamStore.toolResults.has(entry.block.id)}
            {@const toolResult = hasResult ? streamStore.toolResults.get(entry.block.id)! : null}
            {@const isLast = entry.index === totalBlocks - 1}
            <ToolCallBlock
              toolName={entry.block.name}
              input={entry.block.input}
              toolCallId={entry.block.id}
              result={toolResult
                ? {
                    content: toolResult.result,
                    is_error: toolResult.isError,
                  }
                : undefined}
              running={!hasResult && isLast}
              compact
            />
          {/if}
        {/each}

        {#each streamStore.pendingApprovals as approval}
          <ToolApprovalDialog
            toolCallId={approval.toolCallId}
            toolName={approval.toolName}
            input={approval.input}
            description={approval.description}
          />
        {/each}

        <!-- UserQuestionDialog is rendered in the chat-bottom-overlay (+page.svelte)
             so it sits above the message list and is always clickable -->
      </div>

      {#if throbberStore.visible}
        <span class="throbber-phrase">{throbberStore.phrase}</span>
      {/if}

      {#if settingsStore.streamingProgressBar !== 'none'}
        <div class="progress-bar {settingsStore.streamingProgressBar}" aria-hidden="true"></div>
      {/if}
    </div>
  {/snippet}
</MessageAnimation>

<style>
  .message {
    padding: 16px 28px;
    max-width: 900px;
    margin: 0 auto;
    animation: fadeIn 0.2s linear;
    border-radius: var(--radius-sm);
  }

  .message.assistant {
    background: var(--bg-message-assistant);
    margin-left: 28px;
    margin-right: 28px;
    position: relative;
    border-left: 2px solid var(--accent-primary);
  }
  /* Shield charge bar on active streaming */
  .message.assistant::before {
    content: '';
    position: absolute;
    left: -2px;
    top: 0;
    bottom: 0;
    width: 2px;
    background: linear-gradient(180deg, transparent, var(--accent-primary), transparent);
    background-size: 100% 200%;
    animation: shieldCharge 1.5s linear infinite;
  }

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
    color: var(--accent-secondary);
    text-shadow: var(--shadow-glow-sm);
  }

  .throbber-phrase {
    color: var(--text-secondary);
    font-style: italic;
    font-size: var(--fs-sm);
    opacity: 0.85;
    animation: phraseFadeIn 0.6s ease-out;
  }

  @keyframes phraseFadeIn {
    0% {
      opacity: 0;
      transform: translateY(3px);
    }
    100% {
      opacity: 0.85;
      transform: translateY(0);
    }
  }

  .streaming-indicator {
    display: flex;
    gap: 3px;
    align-items: center;
  }

  /* Dots variant */
  .dot {
    width: 4px;
    height: 4px;
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
    animation: hudPulse 1.2s infinite linear;
  }
  .dot:nth-child(1) {
    animation-delay: 0s;
  }
  .dot:nth-child(2) {
    animation-delay: 0.2s;
  }
  .dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes hudPulse {
    0%,
    100% {
      opacity: 0.2;
      transform: scale(0.8);
    }
    50% {
      opacity: 1;
      transform: scale(1);
      box-shadow: var(--shadow-glow);
    }
  }

  /* Spinner variant */
  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--border-secondary);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Pulse variant */
  .pulse-orb {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
    animation: pulseOrb 1.5s ease-in-out infinite;
  }
  @keyframes pulseOrb {
    0%,
    100% {
      opacity: 0.3;
      transform: scale(0.8);
      box-shadow: none;
    }
    50% {
      opacity: 1;
      transform: scale(1.2);
      box-shadow: var(--shadow-glow);
    }
  }

  .message-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .prose {
    line-height: 1.7;
    color: var(--text-primary);
    font-family: var(--font-family-sans);
    font-size: var(--font-size-sans);
    font-weight: 500;
  }

  /* Progress bar base */
  .progress-bar {
    width: 100%;
    height: 3px;
    margin-top: 8px;
    border-radius: var(--radius-sm);
  }

  /* Rainbow variant */
  .progress-bar.rainbow {
    background: linear-gradient(
      in oklab 90deg,
      oklch(var(--rainbow-l) 0.2 0),
      oklch(var(--rainbow-l) 0.2 60),
      oklch(var(--rainbow-l) 0.2 120),
      oklch(var(--rainbow-l) 0.2 180),
      oklch(var(--rainbow-l) 0.2 240),
      oklch(var(--rainbow-l) 0.2 300),
      oklch(var(--rainbow-l) 0.2 360)
    );
    background-size: 200% 100%;
    animation: rainbowSlide 2s linear infinite;
  }
  @keyframes rainbowSlide {
    0% {
      background-position: 0% 0%;
    }
    100% {
      background-position: 200% 0%;
    }
  }

  /* Accent variant */
  .progress-bar.accent {
    background: linear-gradient(90deg, transparent, var(--accent-primary), transparent);
    background-size: 200% 100%;
    animation: accentSlide 1.5s ease-in-out infinite;
  }
  @keyframes accentSlide {
    0% {
      background-position: -200% 0%;
    }
    100% {
      background-position: 200% 0%;
    }
  }

  /* Pulse variant */
  .progress-bar.pulse {
    background: var(--accent-primary);
    animation: barPulse 2s ease-in-out infinite;
  }
  @keyframes barPulse {
    0%,
    100% {
      opacity: 0.15;
    }
    50% {
      opacity: 0.6;
      box-shadow: 0 0 8px var(--accent-primary);
    }
  }

  /* ── Neon: breathing neon glow ── */
  .progress-bar.neon {
    background: var(--accent-primary);
    animation: neonBreathe 1.8s ease-in-out infinite;
  }
  @keyframes neonBreathe {
    0%,
    100% {
      opacity: 0.2;
      box-shadow: 0 0 2px var(--accent-primary);
    }
    50% {
      opacity: 1;
      box-shadow:
        0 0 12px var(--accent-primary),
        0 0 24px var(--accent-primary),
        0 0 4px #fff;
    }
  }

  /* ── Cylon: Knight Rider scanner ── */
  .progress-bar.cylon {
    background: transparent;
    position: relative;
    overflow: hidden;
  }
  .progress-bar.cylon::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 30%;
    height: 100%;
    background: linear-gradient(
      90deg,
      transparent,
      var(--accent-primary),
      var(--accent-primary),
      transparent
    );
    box-shadow:
      0 0 12px var(--accent-primary),
      0 0 4px var(--accent-primary);
    animation: cylonScan 1.4s ease-in-out infinite alternate;
  }
  @keyframes cylonScan {
    0% {
      left: -30%;
    }
    100% {
      left: 100%;
    }
  }

  /* ── Matrix: cascading digital green ── */
  .progress-bar.matrix {
    background: repeating-linear-gradient(
      90deg,
      #00220080 0px,
      #00ff41cc 1px,
      #00ff4166 2px,
      #00220080 4px
    );
    background-size: 200% 100%;
    animation: matrixRain 0.8s linear infinite;
    box-shadow:
      0 0 8px #00ff4199,
      0 0 3px #00ff41cc;
  }
  @keyframes matrixRain {
    0% {
      background-position: 0% 0%;
    }
    100% {
      background-position: -4px 0%;
    }
  }

  /* ── Comet: bright dot streaking across ── */
  .progress-bar.comet {
    background: transparent;
    position: relative;
    overflow: hidden;
  }
  .progress-bar.comet::after {
    content: '';
    position: absolute;
    top: 0;
    left: -10%;
    width: 10%;
    height: 100%;
    background: linear-gradient(
      90deg,
      transparent,
      var(--accent-primary) 60%,
      #fff 90%,
      transparent
    );
    box-shadow:
      0 0 8px var(--accent-primary),
      0 0 2px #fff;
    border-radius: 2px;
    animation: cometStreak 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  }
  @keyframes cometStreak {
    0% {
      left: -10%;
      opacity: 0;
    }
    10% {
      opacity: 1;
    }
    90% {
      opacity: 1;
    }
    100% {
      left: 110%;
      opacity: 0;
    }
  }

  /* ── Helix: double-strand interweave ── */
  .progress-bar.helix {
    background:
      repeating-linear-gradient(
        90deg,
        var(--accent-primary) 0px,
        transparent 2px,
        transparent 8px,
        var(--accent-primary) 10px
      ),
      repeating-linear-gradient(
        90deg,
        var(--accent-secondary) 4px,
        transparent 6px,
        transparent 12px,
        var(--accent-secondary) 14px
      );
    background-size:
      200% 100%,
      200% 100%;
    animation: helixSlide 1.5s linear infinite;
    opacity: 0.7;
  }
  @keyframes helixSlide {
    0% {
      background-position:
        0% 0%,
        0% 0%;
    }
    100% {
      background-position:
        20px 0%,
        -20px 0%;
    }
  }

  /* ── Fire: warm blaze gradient ── */
  .progress-bar.fire {
    background: linear-gradient(
      90deg,
      #ff440080,
      #ff880080,
      #ffcc0080,
      #ff660080,
      #ff220080,
      #ff880080
    );
    background-size: 300% 100%;
    animation: fireFlicker 1s ease-in-out infinite;
  }
  @keyframes fireFlicker {
    0% {
      background-position: 0% 0%;
      opacity: 0.6;
    }
    25% {
      opacity: 0.9;
    }
    50% {
      background-position: 150% 0%;
      opacity: 0.5;
    }
    75% {
      opacity: 1;
    }
    100% {
      background-position: 300% 0%;
      opacity: 0.6;
    }
  }

  /* ── Ocean: deep blue wave ── */
  .progress-bar.ocean {
    background: linear-gradient(
      90deg,
      #001a4d80,
      #0044aa80,
      #0088cc80,
      #00bbff80,
      #0066dd80,
      #001a4d80
    );
    background-size: 300% 100%;
    animation: oceanWave 3s ease-in-out infinite;
  }
  @keyframes oceanWave {
    0% {
      background-position: 0% 0%;
    }
    50% {
      background-position: 150% 0%;
    }
    100% {
      background-position: 300% 0%;
    }
  }

  /* ── Electric: crackling spark ── */
  .progress-bar.electric {
    background: transparent;
    position: relative;
    overflow: hidden;
  }
  .progress-bar.electric::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 100%;
    background: linear-gradient(
      90deg,
      transparent 0%,
      transparent 45%,
      var(--accent-primary) 48%,
      #fff 50%,
      var(--accent-primary) 52%,
      transparent 55%,
      transparent 100%
    );
    background-size: 200% 100%;
    animation: electricSpark 0.4s steps(3) infinite;
    box-shadow: 0 0 4px var(--accent-primary);
  }
  @keyframes electricSpark {
    0% {
      background-position: 0% 0%;
      opacity: 0.3;
    }
    33% {
      background-position: 80% 0%;
      opacity: 1;
    }
    66% {
      background-position: 160% 0%;
      opacity: 0.2;
    }
    100% {
      background-position: 200% 0%;
      opacity: 0.8;
    }
  }

  /* ── Candy: pastel barber pole ── */
  .progress-bar.candy {
    background: repeating-linear-gradient(
      -45deg,
      #ff88cc60,
      #ff88cc60 4px,
      #88ccff60 4px,
      #88ccff60 8px,
      #88ff8860 8px,
      #88ff8860 12px,
      #ffcc8860 12px,
      #ffcc8860 16px
    );
    background-size: 200% 100%;
    animation: candyScroll 1s linear infinite;
  }
  @keyframes candyScroll {
    0% {
      background-position: 0 0;
    }
    100% {
      background-position: 32px 0;
    }
  }

  /* ── Vapor: vaporwave aesthetic ── */
  .progress-bar.vapor {
    background: linear-gradient(
      90deg,
      #ff71ce80,
      #01cdfe80,
      #05ffa180,
      #b967ff80,
      #fffb9680,
      #ff71ce80
    );
    background-size: 300% 100%;
    animation: vaporDrift 5s ease-in-out infinite;
    filter: blur(0.3px) saturate(1.2);
  }
  @keyframes vaporDrift {
    0% {
      background-position: 0% 0%;
    }
    50% {
      background-position: 150% 0%;
    }
    100% {
      background-position: 300% 0%;
    }
  }

  @keyframes shieldCharge {
    0% {
      background-position: 0% 0%;
    }
    100% {
      background-position: 0% 100%;
    }
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
