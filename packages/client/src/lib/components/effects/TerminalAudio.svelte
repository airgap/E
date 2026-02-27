<script lang="ts">
  /**
   * TerminalAudio — bridges terminal events to generative audio chirps.
   *
   * Watches terminalStore for command completions, rich content appearance,
   * and progress milestones. Fires appropriate chirps for each event.
   *
   * Mounts once in +layout.svelte alongside StreamAudio.
   */
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { chirpEngine } from '$lib/audio/chirp-engine';

  // --- Track previous state to detect transitions ---

  /** Map of blockId → exitCode for already-seen completions */
  let seenExitCodes = $state(new Map<string, number>());
  /** Set of blockIds that have already triggered rich_appear */
  let seenRichBlocks = $state(new Set<string>());
  /** Set of blockIds that have already triggered progress_complete */
  let seenProgressComplete = $state(new Set<string>());
  /** Last progress milestone fired per block (25, 50, 75) */
  let lastMilestone = $state(new Map<string, number>());

  function chirp(event: Parameters<typeof chirpEngine.chirp>[0]) {
    if (!settingsStore.soundEnabled) return;
    chirpEngine.chirp(event);
  }

  // Watch command block completions
  $effect(() => {
    const allBlocks = terminalStore.commandBlocksMap;

    for (const [_sessionId, blocks] of allBlocks) {
      for (const block of blocks) {
        if (block.exitCode === null) continue;
        if (seenExitCodes.has(block.id)) continue;

        // New completion detected
        seenExitCodes.set(block.id, block.exitCode);
        if (block.exitCode === 0) {
          chirp('command_success');
        } else {
          chirp('command_fail');
        }
      }
    }
  });

  // Watch rich content appearance
  $effect(() => {
    const richMap = terminalStore.richContentMap;

    for (const [blockId, entries] of richMap) {
      if (seenRichBlocks.has(blockId)) continue;
      if (entries.length === 0) continue;

      // Skip if only progress entries (those are background updates, not "data appearing")
      const hasNonProgress = entries.some((e) => e.contentType !== 'progress');
      if (!hasNonProgress) continue;

      seenRichBlocks.add(blockId);
      chirp('rich_appear');
    }
  });

  // Watch progress milestones and completion
  $effect(() => {
    const richMap = terminalStore.richContentMap;

    for (const [blockId, entries] of richMap) {
      const progressEntry = entries.find((e) => e.contentType === 'progress');
      if (!progressEntry) continue;

      try {
        const data = JSON.parse(progressEntry.data) as { percent: number };
        const pct = data.percent;

        // Check for completion
        if (pct >= 100 && !seenProgressComplete.has(blockId)) {
          seenProgressComplete.add(blockId);
          chirp('progress_complete');
          continue;
        }

        // Check for milestones (25, 50, 75)
        const prevMilestone = lastMilestone.get(blockId) ?? 0;
        const currentMilestone = Math.floor(pct / 25) * 25;
        if (currentMilestone > prevMilestone && currentMilestone < 100) {
          lastMilestone.set(blockId, currentMilestone);
          if (settingsStore.soundEnabled) {
            chirpEngine.progressMilestone(pct);
          }
        }
      } catch {
        // Invalid progress data
      }
    }
  });
</script>

<!-- No visual output; purely reactive audio side-effects -->
