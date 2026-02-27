<script lang="ts">
  let { data } = $props<{ data: string }>();

  interface ProgressData {
    percent: number;
    label: string;
    speed?: string;
  }

  const parsed = $derived.by((): ProgressData | null => {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  });

  const barColor = $derived.by(() => {
    if (!parsed) return 'var(--accent-primary, #00b4ff)';
    if (parsed.percent >= 100) return 'var(--accent-secondary, #00ff88)';
    return 'var(--accent-primary, #00b4ff)';
  });
</script>

{#if parsed}
  <div class="progress-wrapper">
    <div class="progress-info">
      <span class="progress-label">{parsed.label}</span>
      <span class="progress-pct">{Math.round(parsed.percent)}%</span>
      {#if parsed.speed}
        <span class="progress-speed">{parsed.speed}</span>
      {/if}
    </div>
    <div class="progress-track">
      <div
        class="progress-fill"
        class:complete={parsed.percent >= 100}
        class:active={parsed.percent > 0 && parsed.percent < 100}
        style="width: {Math.min(100, parsed.percent)}%; background: {barColor}"
      ></div>
    </div>
  </div>
{/if}

<style>
  .progress-wrapper {
    padding: 4px 0;
  }

  .progress-info {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 2px 0;
    font-size: var(--fs-sans-xxs);
  }

  .progress-label {
    flex: 1;
    color: var(--text-secondary, #8b949e);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .progress-pct {
    color: var(--text-primary, #c9d1d9);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .progress-speed {
    color: var(--text-tertiary, #6e7681);
  }

  .progress-track {
    height: 4px;
    border-radius: var(--ht-radius-sm, 2px);
    background: color-mix(in srgb, var(--text-tertiary, #6e7681) 15%, transparent);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    border-radius: var(--ht-radius-sm, 2px);
    transition:
      width 0.3s ease,
      background 0.3s ease;
    position: relative;
  }

  /* Active shimmer — moving highlight across the bar */
  .progress-fill.active {
    background-image: linear-gradient(
      90deg,
      transparent 0%,
      color-mix(in srgb, white 20%, transparent) 50%,
      transparent 100%
    );
    background-size: 200% 100%;
    animation: progress-shimmer 1.5s ease-in-out infinite;
  }

  @keyframes progress-shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  /* Complete — green with glow pulse */
  .progress-fill.complete {
    background: var(--accent-secondary, #00ff88) !important;
    animation: progress-complete-glow 0.6s ease-out;
  }

  @keyframes progress-complete-glow {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-secondary, #00ff88) 50%, transparent);
    }
    50% {
      box-shadow: 0 0 8px 2px color-mix(in srgb, var(--accent-secondary, #00ff88) 40%, transparent);
    }
    100% {
      box-shadow: none;
    }
  }
</style>
