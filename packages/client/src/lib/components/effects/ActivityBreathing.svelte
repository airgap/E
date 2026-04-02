<script lang="ts">
  /**
   * ActivityBreathing — sets `data-activity` on <html> based on stream state.
   *
   * CSS rules in app.css use this attribute to modulate border glows, shadows,
   * and animation timing across the entire UI. The effect is subtle: idle has
   * a barely-perceptible 6s breathing cycle, streaming is brighter and faster,
   * thinking is deep and slow, tool-pending is staccato, error flashes then decays.
   *
   * Zero DOM — pure reactive side-effect, like StreamAudio.svelte.
   */
  import { getContext, onDestroy } from 'svelte';
  import { STREAM_CONTEXT_KEY, streamStore } from '$lib/stores/stream.svelte';

  const stream = getContext<typeof streamStore>(STREAM_CONTEXT_KEY);

  $effect(() => {
    const status = stream.status;
    const isThinking = stream.partialThinking.length > 0;

    let activity: string;
    switch (status) {
      case 'connecting':
        activity = 'connecting';
        break;
      case 'streaming':
        activity = isThinking ? 'thinking' : 'streaming';
        break;
      case 'tool_pending':
        activity = 'tool-pending';
        break;
      case 'error':
        activity = 'error';
        break;
      default:
        activity = 'idle';
        break;
    }

    document.documentElement.dataset.activity = activity;
  });

  onDestroy(() => {
    delete document.documentElement.dataset.activity;
  });
</script>
