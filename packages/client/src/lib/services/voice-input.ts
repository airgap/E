/**
 * Voice Input Service
 *
 * Provides speech-to-text functionality using:
 * - Web Speech API (browser-native, real-time)
 * - Whisper API (optional, higher accuracy)
 *
 * Supports both push-to-talk and always-on listening modes with wake word detection.
 */

export type VoiceInputProvider = 'browser' | 'whisper';
export type VoiceInputMode = 'push-to-talk' | 'always-on';
export type VoiceInputState = 'idle' | 'listening' | 'processing' | 'speaking';

export interface VoiceInputOptions {
  provider: VoiceInputProvider;
  mode: VoiceInputMode;
  wakeWord: string;
  autoSpeak: boolean;
  language: string;
  whisperApiKey?: string;
}

export interface VoiceInputCallback {
  onTranscript: (text: string, isWakeWord: boolean) => void;
  onInterimTranscript?: (text: string) => void;
  onStateChange?: (state: VoiceInputState) => void;
  onError?: (error: string) => void;
}

/**
 * Web Speech API wrapper
 */
class WebSpeechRecognizer {
  private recognition: any = null;
  private isListening = false;
  private callbacks: VoiceInputCallback;
  private options: VoiceInputOptions;

  constructor(callbacks: VoiceInputCallback, options: VoiceInputOptions) {
    this.callbacks = callbacks;
    this.options = options;
  }

  start(): void {
    if (!this.isSupported()) {
      this.callbacks.onError?.('Web Speech API not supported in this browser');
      return;
    }

    if (this.isListening) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = this.options.mode === 'always-on';
    this.recognition.interimResults = true;
    this.recognition.lang = this.options.language;

    this.recognition.onstart = () => {
      this.isListening = true;
      this.callbacks.onStateChange?.('listening');
    };

    this.recognition.onresult = (event: any) => {
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

      // Emit interim results
      if (interim && this.callbacks.onInterimTranscript) {
        this.callbacks.onInterimTranscript(interim);
      }

      // Process final results
      if (final) {
        const trimmed = final.trim();

        // Check for wake word in always-on mode
        if (this.options.mode === 'always-on') {
          const isWakeWord = this.detectWakeWord(trimmed);
          if (isWakeWord) {
            // Extract command after wake word
            const command = this.extractCommand(trimmed);
            if (command) {
              this.callbacks.onTranscript(command, true);
            }
          }
        } else {
          // Push-to-talk mode - return all text
          this.callbacks.onTranscript(trimmed, false);
        }
      }
    };

    this.recognition.onerror = (event: any) => {
      console.error('[voice-input] Speech recognition error:', event.error);
      this.callbacks.onError?.(event.error);

      // Auto-restart for always-on mode
      if (this.options.mode === 'always-on' && event.error !== 'aborted') {
        setTimeout(() => {
          if (this.isListening) {
            this.start();
          }
        }, 1000);
      }
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.callbacks.onStateChange?.('idle');

      // Auto-restart for always-on mode
      if (this.options.mode === 'always-on') {
        setTimeout(() => {
          this.start();
        }, 100);
      }
    };

    this.recognition.start();
  }

  stop(): void {
    if (this.recognition) {
      this.isListening = false;
      this.recognition.stop();
      this.recognition = null;
    }
    this.callbacks.onStateChange?.('idle');
  }

  isSupported(): boolean {
    return !!(
      typeof window !== 'undefined' &&
      ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    );
  }

  private detectWakeWord(text: string): boolean {
    const lowerText = text.toLowerCase();
    const lowerWakeWord = this.options.wakeWord.toLowerCase();

    // Check if text starts with wake word (with some fuzzy matching)
    return lowerText.startsWith(lowerWakeWord) || lowerText.includes(lowerWakeWord);
  }

  private extractCommand(text: string): string {
    const lowerText = text.toLowerCase();
    const lowerWakeWord = this.options.wakeWord.toLowerCase();

    const index = lowerText.indexOf(lowerWakeWord);
    if (index === -1) return text;

    // Extract everything after the wake word
    return text.slice(index + this.options.wakeWord.length).trim();
  }
}

/**
 * Whisper API wrapper (for future implementation)
 */
class WhisperRecognizer {
  private callbacks: VoiceInputCallback;
  private options: VoiceInputOptions;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];

  constructor(callbacks: VoiceInputCallback, options: VoiceInputOptions) {
    this.callbacks = callbacks;
    this.options = options;
  }

  async start(): Promise<void> {
    if (!this.options.whisperApiKey) {
      this.callbacks.onError?.('Whisper API key not configured');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream);

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        this.audioChunks = [];

        await this.transcribeWithWhisper(audioBlob);
      };

      this.mediaRecorder.start();
      this.callbacks.onStateChange?.('listening');
    } catch (error) {
      this.callbacks.onError?.(`Microphone access denied: ${error}`);
    }
  }

  stop(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      this.mediaRecorder.stream.getTracks().forEach((track) => track.stop());
    }
    this.callbacks.onStateChange?.('idle');
  }

  isSupported(): boolean {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  private async transcribeWithWhisper(audioBlob: Blob): Promise<void> {
    this.callbacks.onStateChange?.('processing');

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.webm');

      // Use server-side transcription endpoint (keeps API key secure)
      const language = this.options.language.split('-')[0]; // e.g., 'en-US' -> 'en'
      const response = await fetch(`/api/voice/transcribe?language=${language}`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error((errorData as any).error || `Transcription failed: ${response.status}`);
      }

      const data = await response.json();
      const text = ((data as any).data?.text || '').trim();

      if (!text) {
        this.callbacks.onError?.('No transcription returned');
        return;
      }

      if (this.options.mode === 'always-on') {
        const isWakeWord = this.detectWakeWord(text);
        if (isWakeWord) {
          const command = this.extractCommand(text);
          if (command) {
            this.callbacks.onTranscript(command, true);
          }
        }
      } else {
        this.callbacks.onTranscript(text, false);
      }
    } catch (error) {
      this.callbacks.onError?.(`Whisper transcription failed: ${error}`);
    } finally {
      this.callbacks.onStateChange?.('idle');
    }
  }

  private detectWakeWord(text: string): boolean {
    const lowerText = text.toLowerCase();
    const lowerWakeWord = this.options.wakeWord.toLowerCase();
    return lowerText.startsWith(lowerWakeWord) || lowerText.includes(lowerWakeWord);
  }

  private extractCommand(text: string): string {
    const lowerText = text.toLowerCase();
    const lowerWakeWord = this.options.wakeWord.toLowerCase();
    const index = lowerText.indexOf(lowerWakeWord);
    if (index === -1) return text;
    return text.slice(index + this.options.wakeWord.length).trim();
  }
}

/**
 * Main Voice Input Service
 */
export class VoiceInputService {
  private recognizer: WebSpeechRecognizer | WhisperRecognizer | null = null;
  private options: VoiceInputOptions;
  private callbacks: VoiceInputCallback;

  constructor(callbacks: VoiceInputCallback, options: Partial<VoiceInputOptions> = {}) {
    this.callbacks = callbacks;
    this.options = {
      provider: options.provider ?? 'browser',
      mode: options.mode ?? 'push-to-talk',
      wakeWord: options.wakeWord ?? 'Hey E',
      autoSpeak: options.autoSpeak ?? false,
      language: options.language ?? 'en-US',
      whisperApiKey: options.whisperApiKey,
    };
  }

  updateOptions(options: Partial<VoiceInputOptions>): void {
    this.options = { ...this.options, ...options };

    // Recreate recognizer if provider changed
    if (this.recognizer) {
      this.stop();
    }
  }

  async start(): Promise<void> {
    if (this.recognizer) {
      return; // Already started
    }

    this.callbacks.onStateChange?.('listening');

    if (this.options.provider === 'whisper') {
      this.recognizer = new WhisperRecognizer(this.callbacks, this.options);
      await this.recognizer.start();
    } else {
      this.recognizer = new WebSpeechRecognizer(this.callbacks, this.options);
      this.recognizer.start();
    }
  }

  stop(): void {
    if (this.recognizer) {
      this.recognizer.stop();
      this.recognizer = null;
    }
  }

  isSupported(): boolean {
    if (this.options.provider === 'whisper') {
      return new WhisperRecognizer(this.callbacks, this.options).isSupported();
    } else {
      return new WebSpeechRecognizer(this.callbacks, this.options).isSupported();
    }
  }

  isListening(): boolean {
    return this.recognizer !== null;
  }
}
