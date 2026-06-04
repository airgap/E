<!--
  EditorAudio.svelte — editor sound design, non-keystroke part (LYK-1110).

  Mounts once in +layout. Plays a pass/fail tone via the chirp engine when a new
  test run lands. (Keystroke clicks live in CodeEditor's update listener, next to
  the edits that trigger them.) Flag-gated (`ambientSound`) and gated by the
  global sound toggle; the keystroke path shares the same gates.
-->
<script lang="ts">
  import { testResultsStore } from '$lib/stores/test-results.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { featureFlags } from '$lib/stores/featureFlags.svelte';
  import { chirpEngine } from '$lib/audio/chirp-engine';

  // Plain (non-reactive) so writing it never re-triggers the effect.
  let prevRun: unknown = undefined;
  let primed = false;

  $effect(() => {
    const run = testResultsStore.latestRun;
    const summary = testResultsStore.summary;
    // Prime on first observation (persisted runs load at startup) so we don't
    // chime for a run the user didn't just trigger.
    if (!primed) {
      prevRun = run;
      primed = true;
      return;
    }
    if (run && run !== prevRun) {
      if (featureFlags.enabled('ambientSound') && settingsStore.soundEnabled) {
        chirpEngine.chirp((summary?.failed ?? 0) > 0 ? 'command_fail' : 'command_success');
      }
    }
    prevRun = run;
  });
</script>
