<!--
  AmbientWeather.svelte — generative code "weather" (LYK-1112).

  A barely-there living texture over the whole window: a faint film grain plus a
  slow-drifting accent glow that wanders over minutes, so a long session never
  looks perfectly static. Pure CSS — no canvas, no rAF loop. Flag-gated
  (`ambientCodeWeather`), off by default. pointer-events:none.

  Distinct from the per-theme canvas AmbientBackground (sigils/motes/stars):
  this is theme-agnostic ambient drift that layers on top very subtly.
-->
<script lang="ts">
  import { featureFlags } from '$lib/stores/featureFlags.svelte';

  const enabled = $derived(featureFlags.enabled('ambientCodeWeather'));

  // Inline fractal-noise grain as a data URI so there's no asset to ship.
  const grain =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";
</script>

{#if enabled}
  <div class="weather grain" style="background-image: {grain};" aria-hidden="true"></div>
  <div class="weather glow" aria-hidden="true"></div>
{/if}

<style>
  .weather {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 9989;
  }

  .grain {
    opacity: 0.035;
    background-repeat: repeat;
    mix-blend-mode: overlay;
    animation: weather-grain 8s steps(6) infinite;
  }

  .glow {
    opacity: 0.5;
    mix-blend-mode: screen;
    background: radial-gradient(
      35vmax 35vmax at 50% 50%,
      color-mix(in srgb, var(--accent-primary) 9%, transparent),
      transparent 70%
    );
    /* Oversize the tile so background-position has room to wander. */
    background-size: 220% 220%;
    background-repeat: no-repeat;
    animation: weather-drift 90s ease-in-out infinite alternate;
  }

  /* Jitter the grain so it shimmers like film rather than sitting still. */
  @keyframes weather-grain {
    0% {
      transform: translate(0, 0);
    }
    20% {
      transform: translate(-3%, 2%);
    }
    40% {
      transform: translate(2%, -3%);
    }
    60% {
      transform: translate(-2%, -2%);
    }
    80% {
      transform: translate(3%, 1%);
    }
    100% {
      transform: translate(0, 0);
    }
  }

  /* Wander the glow slowly across the canvas over ~1.5 minutes. */
  @keyframes weather-drift {
    0% {
      background-position: 0% 0%;
      opacity: 0.35;
    }
    50% {
      background-position: 80% 60%;
      opacity: 0.6;
    }
    100% {
      background-position: 30% 90%;
      opacity: 0.4;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .grain,
    .glow {
      animation: none;
    }
  }
</style>
