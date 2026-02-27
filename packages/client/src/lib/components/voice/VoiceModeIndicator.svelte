<script lang="ts">
  import { voiceStore } from '$lib/stores/voice.svelte';

  function getStateIcon() {
    if (voiceStore.isSpeaking) {
      return '🔊'; // Speaking
    } else if (voiceStore.isListening) {
      return '🎤'; // Listening
    } else if (voiceStore.isProcessing) {
      return '⏳'; // Processing
    } else {
      return '⭕'; // Idle
    }
  }

  function getStateLabel() {
    if (voiceStore.isSpeaking) {
      return 'Speaking';
    } else if (voiceStore.isListening) {
      return voiceStore.mode === 'always-on'
        ? `Listening for "${voiceStore.wakeWord}"`
        : 'Listening';
    } else if (voiceStore.isProcessing) {
      return 'Processing';
    } else {
      return voiceStore.mode === 'always-on' ? 'Wake Word Active' : 'Voice Ready';
    }
  }

  function getModeLabel() {
    switch (voiceStore.mode) {
      case 'push-to-talk':
        return 'Push to Talk';
      case 'always-on':
        return 'Always On';
      default:
        return 'Disabled';
    }
  }
</script>

{#if voiceStore.enabled}
  <div
    class="voice-indicator"
    class:listening={voiceStore.isListening}
    class:speaking={voiceStore.isSpeaking}
    class:processing={voiceStore.isProcessing}
  >
    <span class="voice-icon" title={getStateLabel()}>
      {getStateIcon()}
    </span>
    <span class="voice-label">
      {getModeLabel()}
      {#if voiceStore.interimTranscript}
        <span class="interim">"{voiceStore.interimTranscript}"</span>
      {/if}
    </span>
  </div>
{/if}

<style>
  .voice-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: var(--bg-secondary);
    border-radius: 4px;
    font-size: var(--fs-sm);
    color: var(--text-tertiary);
    transition: all 0.2s ease;
    border: 1px solid transparent;
  }

  .voice-indicator.listening {
    color: var(--accent, #3b82f6);
    border-color: var(--accent, #3b82f6);
    background: color-mix(in srgb, var(--accent, #3b82f6) 10%, transparent);
  }

  .voice-indicator.speaking {
    color: #10b981;
    border-color: #10b981;
    background: color-mix(in srgb, #10b981 10%, transparent);
  }

  .voice-indicator.processing {
    color: #f59e0b;
    border-color: #f59e0b;
    background: color-mix(in srgb, #f59e0b 10%, transparent);
  }

  .voice-icon {
    font-size: 14px;
    line-height: 1;
    animation: none;
  }

  .listening .voice-icon,
  .speaking .voice-icon {
    animation: pulse 1.5s ease-in-out infinite;
  }

  .processing .voice-icon {
    animation: spin 1s linear infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.7;
      transform: scale(1.1);
    }
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .voice-label {
    font-size: var(--fs-xs);
    font-weight: 500;
    white-space: nowrap;
  }

  .interim {
    margin-left: 6px;
    font-style: italic;
    opacity: 0.7;
    max-width: 200px;
    display: inline-block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: middle;
  }
</style>
