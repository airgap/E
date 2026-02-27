<script lang="ts">
  import { voiceStore } from '$lib/stores/voice.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { onMount, untrack } from 'svelte';

  let isHoldingSpace = $state(false);
  let spaceKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  onMount(() => {
    // Load voice settings from store
    voiceStore.loadSettings({
      enabled: settingsStore.voiceMode !== 'disabled',
      mode: settingsStore.voiceMode,
      inputProvider: settingsStore.voiceInputProvider,
      wakeWord: settingsStore.voiceWakeWord,
      autoSpeak: settingsStore.voiceAutoSpeak,
      language: settingsStore.voiceLanguage,
    });

    // Set up keyboard handler for push-to-talk mode
    spaceKeyHandler = (e: KeyboardEvent) => {
      // Only handle space key if voice mode is enabled and not typing in a text field
      if (
        voiceStore.enabled &&
        voiceStore.mode === 'push-to-talk' &&
        e.code === 'Space' &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        if (!isHoldingSpace) {
          e.preventDefault();
          isHoldingSpace = true;
          voiceStore.startListening();
        }
      }
    };

    const spaceUpHandler = (e: KeyboardEvent) => {
      if (isHoldingSpace && e.code === 'Space') {
        e.preventDefault();
        isHoldingSpace = false;
        voiceStore.stopListening();
      }
    };

    window.addEventListener('keydown', spaceKeyHandler);
    window.addEventListener('keyup', spaceUpHandler);

    return () => {
      if (spaceKeyHandler) {
        window.removeEventListener('keydown', spaceKeyHandler);
      }
      window.removeEventListener('keyup', spaceUpHandler);
    };
  });

  function toggleVoiceMode() {
    if (!voiceStore.enabled) {
      // Enable voice mode with the configured mode from settings
      voiceStore.enable(
        settingsStore.voiceMode === 'disabled' ? 'push-to-talk' : settingsStore.voiceMode,
      );
    } else {
      voiceStore.disable();
    }
  }

  function handleClick() {
    if (voiceStore.mode === 'push-to-talk') {
      // Toggle listening for button click in push-to-talk mode
      voiceStore.toggleListening();
    } else {
      // Toggle voice mode on/off for always-on mode
      toggleVoiceMode();
    }
  }

  $effect(() => {
    // Sync voice mode changes back to settings
    // Read reactive deps first, then write inside untrack() to avoid
    // a read-write loop (settingsStore.update spreads state internally).
    const isEnabled = voiceStore.enabled;
    const currentMode = voiceStore.mode;
    untrack(() => {
      if (isEnabled) {
        settingsStore.update({ voiceMode: currentMode });
      } else {
        settingsStore.update({ voiceMode: 'disabled' });
      }
    });
  });
</script>

<div class="voice-wrapper">
  {#if voiceStore.interimTranscript}
    <div class="interim-preview">{voiceStore.interimTranscript}</div>
  {/if}
  <button
    class="btn-action voice-btn"
    class:listening={voiceStore.isListening}
    class:speaking={voiceStore.isSpeaking}
    class:processing={voiceStore.isProcessing}
    class:enabled={voiceStore.enabled}
    onclick={handleClick}
    disabled={!voiceStore.isSupported()}
    title={!voiceStore.isSupported()
      ? 'Voice input not supported in this browser'
      : voiceStore.isListening
        ? 'Stop listening'
        : voiceStore.enabled
          ? voiceStore.mode === 'push-to-talk'
            ? 'Start listening (or hold Space)'
            : 'Voice mode active'
          : 'Enable voice mode'}
    type="button"
  >
    {#if voiceStore.isListening}
      <div class="waveform">
        <span class="bar"></span>
        <span class="bar"></span>
        <span class="bar"></span>
      </div>
    {:else if voiceStore.isSpeaking}
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </svg>
    {:else}
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0" />
        <line x1="12" y1="17" x2="12" y2="21" />
        <line x1="9" y1="21" x2="15" y2="21" />
      </svg>
    {/if}
  </button>
</div>

<style>
  .voice-wrapper {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .voice-btn {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    transition: all 0.2s ease;
    border: 1px solid transparent;
  }

  .voice-btn:hover:not(:disabled) {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .voice-btn.enabled {
    color: var(--accent, #3b82f6);
  }

  .voice-btn.listening {
    color: #ef4444;
    background: color-mix(in srgb, #ef4444 10%, transparent);
    border-color: #ef4444;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .voice-btn.speaking {
    color: #10b981;
    background: color-mix(in srgb, #10b981 10%, transparent);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .voice-btn.processing {
    color: #f59e0b;
    opacity: 0.8;
  }

  .voice-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.7;
      transform: scale(1.05);
    }
  }

  .waveform {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 16px;
  }

  .bar {
    display: block;
    width: 3px;
    background: #ef4444;
    border-radius: 2px;
    animation: wave 0.8s ease-in-out infinite;
  }

  .bar:nth-child(1) {
    height: 6px;
    animation-delay: 0s;
  }

  .bar:nth-child(2) {
    height: 12px;
    animation-delay: 0.15s;
  }

  .bar:nth-child(3) {
    height: 6px;
    animation-delay: 0.3s;
  }

  @keyframes wave {
    0%,
    100% {
      transform: scaleY(1);
    }
    50% {
      transform: scaleY(1.8);
    }
  }

  .interim-preview {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-secondary, #1e1e2e);
    border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
    border-radius: 8px;
    padding: 6px 10px;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    white-space: nowrap;
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .interim-preview::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 5px solid transparent;
    border-top-color: var(--border, rgba(255, 255, 255, 0.1));
  }
</style>
