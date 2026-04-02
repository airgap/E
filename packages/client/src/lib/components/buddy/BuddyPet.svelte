<script lang="ts">
  import { api } from '$lib/api/client';
  import { BUDDY_SPECIES, type BuddyState, type BuddySpecies } from '@e/shared';

  let buddy = $state<BuddyState | null>(null);
  let species = $state<BuddySpecies | null>(null);
  let frame = $state(0);
  let showTooltip = $state(false);
  let animTimer: ReturnType<typeof setInterval> | null = null;

  async function loadBuddy() {
    try {
      const res = await api.buddy.get();
      if (res.ok) {
        buddy = res.buddy;
        species = res.species || BUDDY_SPECIES.find((s) => s.id === res.buddy.speciesId) || null;
      }
    } catch {
      // Feature may not be enabled
    }
  }

  function startAnimation() {
    if (animTimer) return;
    animTimer = setInterval(() => {
      if (species) {
        frame = (frame + 1) % species.frames.length;
      }
    }, 800);
  }

  function stopAnimation() {
    if (animTimer) {
      clearInterval(animTimer);
      animTimer = null;
    }
  }

  async function interact(type: 'pat' | 'feed' | 'play') {
    try {
      const res = await api.buddy.interact(type);
      if (res.ok) buddy = res.buddy;
    } catch {}
  }

  function getCurrentFrame(): string {
    if (!species || !buddy) return '';
    if (buddy.mood === 'sleepy') return species.sleepFrame;
    if (buddy.mood === 'happy' || buddy.mood === 'excited') return species.happyFrame;
    return species.frames[frame] || species.frames[0];
  }

  $effect(() => {
    loadBuddy();
    startAnimation();

    // Periodic tick every 5 minutes
    const tickInterval = setInterval(
      async () => {
        try {
          const res = await api.buddy.tick();
          if (res.ok) buddy = res.buddy;
        } catch {}
      },
      5 * 60 * 1000,
    );

    return () => {
      stopAnimation();
      clearInterval(tickInterval);
    };
  });
</script>

{#if buddy && species}
  <div
    class="buddy-container"
    role="button"
    tabindex="0"
    onmouseenter={() => (showTooltip = true)}
    onmouseleave={() => (showTooltip = false)}
    onclick={() => interact('pat')}
    onkeydown={(e) => e.key === 'Enter' && interact('pat')}
    style="--buddy-color: {species.color}"
  >
    <span class="buddy-sprite" class:shiny={buddy.isShiny}>
      {getCurrentFrame()}
    </span>

    {#if showTooltip}
      <div class="buddy-tooltip">
        <div class="buddy-name">
          {buddy.soul.name}
          {#if buddy.isShiny}<span class="shiny-badge">✦</span>{/if}
        </div>
        <div class="buddy-species">{species.name} ({species.rarity})</div>
        <div class="buddy-stats">
          <span>Energy: {buddy.energy}%</span>
          <span>Happy: {buddy.happiness}%</span>
        </div>
        <div class="buddy-personality">{buddy.soul.personality}</div>
        <div class="buddy-catchphrase">"{buddy.soul.catchphrase}"</div>
        <div class="buddy-actions">
          <button
            onclick={(e) => {
              e.stopPropagation();
              interact('feed');
            }}>Feed</button
          >
          <button
            onclick={(e) => {
              e.stopPropagation();
              interact('play');
            }}>Play</button
          >
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .buddy-container {
    position: relative;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    padding: 0 6px;
    font-family: monospace;
    user-select: none;
  }

  .buddy-sprite {
    color: var(--buddy-color);
    font-size: 12px;
    transition: transform 0.2s;
  }

  .buddy-sprite:hover {
    transform: scale(1.2);
  }

  .buddy-sprite.shiny {
    text-shadow:
      0 0 4px var(--buddy-color),
      0 0 8px var(--buddy-color);
    animation: shimmer 2s ease-in-out infinite;
  }

  @keyframes shimmer {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.7;
    }
  }

  .buddy-tooltip {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: var(--ht-bg-secondary, #1a1a2e);
    border: 1px solid var(--ht-border, #333);
    border-radius: var(--ht-radius, 6px);
    padding: 8px 12px;
    min-width: 180px;
    z-index: 100;
    font-size: 11px;
    line-height: 1.4;
    color: var(--ht-text-primary, #e0e0e0);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    pointer-events: auto;
  }

  .buddy-name {
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 2px;
  }

  .shiny-badge {
    color: gold;
    margin-left: 4px;
  }

  .buddy-species {
    color: var(--ht-text-secondary, #888);
    font-size: 10px;
    margin-bottom: 4px;
  }

  .buddy-stats {
    display: flex;
    gap: 8px;
    font-size: 10px;
    color: var(--ht-text-secondary, #888);
    margin-bottom: 4px;
  }

  .buddy-personality {
    font-style: italic;
    font-size: 10px;
    margin-bottom: 2px;
  }

  .buddy-catchphrase {
    font-size: 10px;
    color: var(--buddy-color);
    margin-bottom: 6px;
  }

  .buddy-actions {
    display: flex;
    gap: 4px;
  }

  .buddy-actions button {
    padding: 2px 8px;
    font-size: 10px;
    background: var(--ht-bg-tertiary, #2a2a3e);
    color: var(--ht-text-primary, #e0e0e0);
    border: 1px solid var(--ht-border, #444);
    border-radius: var(--ht-radius-sm, 3px);
    cursor: pointer;
  }

  .buddy-actions button:hover {
    background: var(--ht-bg-hover, #3a3a4e);
  }
</style>
