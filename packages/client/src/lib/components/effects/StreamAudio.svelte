<script lang="ts">
  /**
   * StreamAudio — bridges Claude stream events to generative audio chirps.
   *
   * Mounts once in +layout.svelte. Uses $effect to watch streamStore state
   * and fires the appropriate chirp for each event transition.
   *
   * Audio is only initialised after the first user gesture (browser autoplay
   * policy). Chirps are silenced when settingsStore.soundEnabled is false.
   */
  import { getContext, onMount } from 'svelte';
  import { STREAM_CONTEXT_KEY, streamStore, type StreamStatus } from '$lib/stores/stream.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { chirpEngine } from '$lib/audio/chirp-engine';
  import { desktopNotifications } from '$lib/notifications/desktop-notifications';

  const stream = getContext<typeof streamStore>(STREAM_CONTEXT_KEY);

  // --- Track previous state to detect transitions ---
  let prevStatus = $state<StreamStatus>('idle');
  let prevBlockCount = $state(0);
  let prevThinkingLen = $state(0);
  let prevTextLen = $state(0);
  let prevToolResultCount = $state(0);
  let prevApprovalCount = $state(0);
  let prevQuestionCount = $state(0);
  /** True once we've seen partialText go non-empty this stream — guards against
   *  firing message_stop on the initial empty→empty no-op. */
  let hadText = false;
  /** toolCallId → toolName, built as tool_use blocks arrive */
  const toolNames = new Map<string, string>();

  // Unlock AudioContext on first user gesture (browser autoplay policy).
  // A single pointer/key event is enough — the handler removes itself after firing.
  onMount(() => {
    const unlock = () => {
      chirpEngine.unlock();
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, { capture: true, once: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true, once: true, passive: true });
  });

  // Keep master volume in sync with settings
  $effect(() => {
    chirpEngine.setVolume(settingsStore.soundEnabled ? settingsStore.soundVolume / 100 : 0);
  });

  // Keep sound style in sync with settings
  $effect(() => {
    chirpEngine.setStyle(settingsStore.soundStyle);
  });

  // Keep reverb in sync with visual style
  $effect(() => {
    if (settingsStore.soundEnabled) {
      chirpEngine.setReverb(settingsStore.visualStyle);
    } else {
      chirpEngine.clearReverb();
    }
  });

  function chirp(event: Parameters<typeof chirpEngine.chirp>[0]) {
    if (!settingsStore.soundEnabled) return;
    chirpEngine.chirp(event);
  }

  $effect(() => {
    const status = stream.status as StreamStatus;
    const blocks = stream.contentBlocks as any[];
    const toolResults = stream.toolResults as Map<string, any>;
    const approvals = stream.pendingApprovals as any[];
    const questions = stream.pendingQuestions as any[];
    const partialText: string = stream.partialText;
    const partialThinking: string = stream.partialThinking;

    // --- Status transitions ---
    if (status !== prevStatus) {
      if (status === 'connecting' && prevStatus === 'idle') {
        chirp('message_start');
        hadText = false;
      } else if (status === 'error') {
        chirp('error');
        // Desktop notification for failure/error
        if (settingsStore.notifyOnFailure) {
          desktopNotifications.notify({
            title: 'Error occurred',
            body: stream.error || 'The stream encountered an error',
            event: 'story_failed',
            data: { conversationId: stream.conversationId ?? undefined },
          });
          if (document.hidden && settingsStore.soundEnabled) {
            chirpEngine.playNotificationMelody('error');
          }
        }
      } else if (status === 'cancelled') {
        chirp('cancelled');
      }
      prevStatus = status;
    }

    // --- New content blocks ---
    if (blocks.length > prevBlockCount) {
      const newBlocks = blocks.slice(prevBlockCount);
      for (const block of newBlocks) {
        if (block.type === 'text') {
          chirp('text_start');
        } else if (block.type === 'thinking') {
          chirp('thinking_start');
        } else if (block.type === 'tool_use') {
          // Register name for result lookup, then chirp with tool-specific sound
          if (block.id && block.name) toolNames.set(block.id, block.name);
          if (settingsStore.soundEnabled) chirpEngine.toolStart(block.name ?? '');
          chirpEngine.trackToolCall();
        }
      }
      prevBlockCount = blocks.length;
    }

    // --- Streaming text deltas ---
    if (partialText.length > prevTextLen && status === 'streaming') {
      chirp('text_delta');
      prevTextLen = partialText.length;
      hadText = true;
    }
    // partialText clears to '' on message_stop — fire the stop sound here so it
    // works regardless of whether status stays tool_pending or drops to idle.
    if (partialText.length === 0 && prevTextLen > 0) {
      if (hadText) {
        chirp('message_stop');
        // Desktop notification for completion
        if (settingsStore.notifyOnCompletion) {
          desktopNotifications.notify({
            title: 'Response complete',
            body: 'Claude has finished responding',
            event: 'story_completed',
            data: { conversationId: stream.conversationId ?? undefined },
          });
          if (document.hidden && settingsStore.soundEnabled) {
            chirpEngine.playNotificationMelody('completion');
          }
        }
      }
      prevTextLen = 0;
      hadText = false;
    }

    // Reset thinking tracker
    if (partialThinking.length === 0 && prevThinkingLen > 0) {
      prevThinkingLen = 0;
    } else {
      prevThinkingLen = partialThinking.length;
    }

    // --- Tool results ---
    const resultCount = toolResults.size;
    if (resultCount > prevToolResultCount) {
      // Find the newly added entry
      const entries = Array.from(toolResults.entries());
      const [newestId, newest] = entries[entries.length - 1];
      if (newest?.isError) {
        chirp('tool_result_error');
      } else if (settingsStore.soundEnabled) {
        chirpEngine.toolResultOk(toolNames.get(newestId) ?? '');
      }
      prevToolResultCount = resultCount;
    }
    if (resultCount === 0 && prevToolResultCount > 0) {
      prevToolResultCount = 0;
      toolNames.clear();
    }

    // --- Approval / question requests ---
    if (approvals.length > prevApprovalCount) {
      chirp('tool_approval');
      // Desktop notification for pending approval
      if (settingsStore.notifyOnApproval) {
        const latest = approvals[approvals.length - 1];
        desktopNotifications.approvalNeeded(latest?.toolName, {
          conversationId: stream.conversationId ?? undefined,
        });
        if (document.hidden && settingsStore.soundEnabled) {
          chirpEngine.playNotificationMelody('approval');
        }
      }
      prevApprovalCount = approvals.length;
    }
    if (approvals.length === 0) prevApprovalCount = 0;

    if (questions.length > prevQuestionCount) {
      chirp('user_question');
      prevQuestionCount = questions.length;
    }
    if (questions.length === 0) prevQuestionCount = 0;

    // Reset block counter when stream resets (new message)
    if (blocks.length === 0 && prevBlockCount > 0) {
      prevBlockCount = 0;
      hadText = false;
      toolNames.clear();
    }
  });
</script>

<!-- No visual output; purely reactive audio side-effects -->
