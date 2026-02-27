<script lang="ts">
  let { onTranscript } = $props<{ onTranscript: (text: string) => void }>();

  const SpeechRecognition =
    typeof window !== 'undefined'
      ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : null;

  const supported = !!SpeechRecognition;

  let recording = $state(false);
  let interimText = $state('');
  let recognition: any = null;

  function startRecording() {
    if (!supported) return;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }
      interimText = interim;
      if (final) {
        interimText = '';
        recording = false;
        recognition = null;
        onTranscript(final.trim());
      }
    };

    recognition.onerror = () => {
      recording = false;
      interimText = '';
      recognition = null;
    };

    recognition.onend = () => {
      recording = false;
      interimText = '';
      recognition = null;
    };

    recognition.start();
    recording = true;
  }

  function stopRecording() {
    if (recognition) {
      recognition.stop();
    }
    recording = false;
    interimText = '';
    recognition = null;
  }

  function toggle() {
    if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  }
</script>

<div class="voice-wrapper">
  {#if interimText}
    <div class="interim-preview">{interimText}</div>
  {/if}
  <button
    class="btn-action voice-btn"
    class:recording
    onclick={toggle}
    disabled={!supported}
    title={!supported
      ? 'Voice input not supported in this browser'
      : recording
        ? 'Stop recording'
        : 'Voice input'}
    type="button"
  >
    {#if recording}
      <div class="waveform">
        <span class="bar"></span>
        <span class="bar"></span>
        <span class="bar"></span>
      </div>
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
    transition: color 0.15s ease;
  }

  .voice-btn:hover:not(:disabled) {
    color: var(--text-secondary);
  }

  .voice-btn.recording {
    color: #ef4444;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .voice-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.6;
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
