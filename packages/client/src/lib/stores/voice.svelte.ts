/**
 * Voice Mode Store
 *
 * Manages bidirectional voice interaction:
 * - Voice input (speech-to-text) via Web Speech API or Whisper
 * - Voice output (text-to-speech) via existing TTS infrastructure
 * - Wake word detection for hands-free interaction
 * - Push-to-talk mode for controlled input
 */

import {
  VoiceInputService,
  type VoiceInputMode,
  type VoiceInputProvider,
  type VoiceInputState,
} from '$lib/services/voice-input';
import { commentaryTtsService } from '$lib/services/commentary-tts';
import { ttsStore } from '$lib/services/tts.svelte';

export type VoiceMode = 'disabled' | 'push-to-talk' | 'always-on';

interface VoiceSettings {
  enabled: boolean;
  mode: VoiceMode;
  inputProvider: VoiceInputProvider;
  wakeWord: string;
  autoSpeak: boolean;
  language: string;
  whisperApiKey?: string;
}

function createVoiceStore() {
  // State
  let enabled = $state(false);
  let mode = $state<VoiceMode>('push-to-talk');
  let state = $state<VoiceInputState>('idle');
  let interimTranscript = $state('');
  let lastTranscript = $state('');
  let isWakeWordTriggered = $state(false);
  let error = $state<string | null>(null);

  // Settings
  let inputProvider = $state<VoiceInputProvider>('browser');
  let wakeWord = $state('Hey E');
  let autoSpeak = $state(false);
  let language = $state('en-US');
  let whisperApiKey = $state<string | undefined>(undefined);

  // Voice input service
  let voiceService: VoiceInputService | null = null;

  // Callbacks for onTranscript - set by the consumer (e.g., ChatInput)
  let transcriptCallback: ((text: string, isWakeWord: boolean) => void) | null = null;

  /**
   * Initialize the voice input service
   */
  function initService() {
    if (voiceService) {
      voiceService.stop();
    }

    voiceService = new VoiceInputService(
      {
        onTranscript: (text: string, isWakeWord: boolean) => {
          lastTranscript = text;
          isWakeWordTriggered = isWakeWord;
          interimTranscript = '';

          // Call the registered callback
          if (transcriptCallback) {
            transcriptCallback(text, isWakeWord);
          }
        },
        onInterimTranscript: (text: string) => {
          interimTranscript = text;
        },
        onStateChange: (newState: VoiceInputState) => {
          state = newState;
        },
        onError: (err: string) => {
          error = err;
          console.error('[voice-store] Error:', err);
        },
      },
      {
        provider: inputProvider,
        mode: mode === 'always-on' ? 'always-on' : 'push-to-talk',
        wakeWord,
        autoSpeak,
        language,
        whisperApiKey,
      },
    );
  }

  return {
    // -- Getters --

    get enabled() {
      return enabled;
    },

    get mode() {
      return mode;
    },

    get state() {
      return state;
    },

    get interimTranscript() {
      return interimTranscript;
    },

    get lastTranscript() {
      return lastTranscript;
    },

    get isWakeWordTriggered() {
      return isWakeWordTriggered;
    },

    get error() {
      return error;
    },

    get isListening() {
      return state === 'listening';
    },

    get isProcessing() {
      return state === 'processing';
    },

    get isSpeaking() {
      return state === 'speaking';
    },

    get wakeWord() {
      return wakeWord;
    },

    get inputProvider() {
      return inputProvider;
    },

    get autoSpeak() {
      return autoSpeak;
    },

    // -- Actions --

    /**
     * Enable voice mode with the specified mode
     */
    enable(voiceMode: VoiceMode = 'push-to-talk') {
      if (voiceMode === 'disabled') {
        this.disable();
        return;
      }

      enabled = true;
      mode = voiceMode;
      error = null;

      initService();

      // Start listening immediately for always-on mode
      if (mode === 'always-on') {
        this.startListening();
      }
    },

    /**
     * Disable voice mode and stop listening
     */
    disable() {
      enabled = false;
      this.stopListening();

      if (voiceService) {
        voiceService.stop();
        voiceService = null;
      }

      state = 'idle';
      interimTranscript = '';
      error = null;
    },

    /**
     * Start listening (push-to-talk or manual trigger)
     */
    async startListening() {
      if (!enabled || !voiceService) {
        console.warn('[voice-store] Voice mode not enabled');
        return;
      }

      error = null;
      await voiceService.start();
    },

    /**
     * Stop listening
     */
    stopListening() {
      if (voiceService) {
        voiceService.stop();
      }
      state = 'idle';
      interimTranscript = '';
    },

    /**
     * Toggle listening state (for push-to-talk button)
     */
    async toggleListening() {
      if (state === 'listening') {
        this.stopListening();
      } else {
        await this.startListening();
      }
    },

    /**
     * Set the transcript callback (called when speech is recognized)
     */
    setTranscriptCallback(callback: (text: string, isWakeWord: boolean) => void) {
      transcriptCallback = callback;
    },

    /**
     * Update voice settings
     */
    updateSettings(settings: Partial<VoiceSettings>) {
      if (settings.inputProvider !== undefined) {
        inputProvider = settings.inputProvider;
      }
      if (settings.wakeWord !== undefined) {
        wakeWord = settings.wakeWord;
      }
      if (settings.autoSpeak !== undefined) {
        autoSpeak = settings.autoSpeak;
      }
      if (settings.language !== undefined) {
        language = settings.language;
      }
      if (settings.whisperApiKey !== undefined) {
        whisperApiKey = settings.whisperApiKey;
      }

      // Reinitialize service with new settings
      if (voiceService) {
        voiceService.updateOptions({
          provider: inputProvider,
          mode: mode === 'always-on' ? 'always-on' : 'push-to-talk',
          wakeWord,
          autoSpeak,
          language,
          whisperApiKey,
        });
      }
    },

    /**
     * Speak text using TTS (for agent responses)
     */
    speak(text: string) {
      state = 'speaking';

      // Use the simple TTS store for agent responses
      ttsStore.speak(text, 'agent-response');

      // Reset state when done (we'll need to track this better)
      setTimeout(() => {
        if (state === 'speaking') {
          state = 'idle';
        }
      }, text.length * 50); // Rough estimate based on text length
    },

    /**
     * Stop speaking
     */
    stopSpeaking() {
      ttsStore.stop();
      state = 'idle';
    },

    /**
     * Check if voice input is supported in this browser
     */
    isSupported(): boolean {
      if (!voiceService) {
        initService();
      }
      return voiceService?.isSupported() ?? false;
    },

    /**
     * Load settings from storage
     */
    loadSettings(settings: Partial<VoiceSettings>) {
      if (settings.enabled) {
        this.enable(settings.mode ?? 'push-to-talk');
      }
      this.updateSettings(settings);
    },
  };
}

export const voiceStore = createVoiceStore();

// HMR cleanup
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    voiceStore.disable();
  });
}
