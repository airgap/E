/**
 * Text-to-Speech Service for Commentary
 *
 * Provides TTS functionality using:
 * - Web Speech API (browser, fallback)
 * - ElevenLabs API (optional, higher quality)
 * - Google Cloud TTS API (optional, higher quality)
 *
 * Assigns different voices to different commentary personalities.
 *
 * When spatial audio is enabled (experimental), cloud TTS audio is routed
 * through the SpatialTtsEngine's StereoPannerNode so each workspace gets a
 * distinct left/center/right position.  Browser TTS uses subtle pitch/rate
 * offsets as a perceptual substitute (since SpeechSynthesis cannot be
 * routed through Web Audio).
 */

import { spatialTts } from '$lib/audio/spatial-tts';

export type TtsProvider = 'browser' | 'elevenlabs' | 'google';
export type CommentaryPersonality =
  | 'documentary_narrator'
  | 'technical_analyst'
  | 'comedic_observer'
  | 'project_lead'
  | 'wizard';

// ---------------------------------------------------------------------------
// Voice Mappings
// ---------------------------------------------------------------------------

/** Map personalities to preferred Web Speech API voice names */
const BROWSER_VOICE_MAP: Record<CommentaryPersonality, string[]> = {
  documentary_narrator: [
    'Google UK English Male',
    'Microsoft George',
    'Oliver',
    'Daniel (Enhanced)',
  ],
  technical_analyst: ['Google US English Female', 'Microsoft Zira', 'Samantha', 'Karen'],
  comedic_observer: ['Google UK English Female', 'Microsoft Hazel', 'Victoria', 'Moira'],
  project_lead: ['Google US English Male', 'Microsoft Mark', 'Alex', 'Fred'],
  wizard: ['Microsoft George', 'Google UK English Male', 'Daniel (Enhanced)', 'Oliver'],
};

/** ElevenLabs voice IDs for each personality */
const ELEVENLABS_VOICE_MAP: Record<CommentaryPersonality, string> = {
  documentary_narrator: '2EiwWnXFnvU5JabPnv8n', // Clyde
  technical_analyst: 'EXAVITQu4vr4xnSDxMaL', // Sarah
  comedic_observer: 'ThT5KcBeYPX3keUQqHPh', // Dorothy
  project_lead: 'VR6AewLTigWG4xSOukaG', // Arnold
  wizard: 'N2lVS1w4EtoT3dr4eOWO', // Callum (deep, mature, gravelly — Gandalf-like)
};

/** Google TTS voice names for each personality */
const GOOGLE_VOICE_MAP: Record<CommentaryPersonality, string> = {
  documentary_narrator: 'en-GB-Neural2-B',
  technical_analyst: 'en-US-Neural2-F',
  comedic_observer: 'en-GB-Neural2-A',
  project_lead: 'en-US-Neural2-J',
  wizard: 'en-GB-Neural2-D', // Deep British male voice — mystical, Gandalf-like
};

// ---------------------------------------------------------------------------
// TTS Service
// ---------------------------------------------------------------------------

export interface TtsOptions {
  provider: TtsProvider;
  volume: number; // 0-1
  elevenLabsApiKey?: string;
  googleApiKey?: string;
}

export class CommentaryTtsService {
  private provider: TtsProvider = 'browser';
  private volume: number = 0.8;
  private elevenLabsApiKey?: string;
  private googleApiKey?: string;
  private synth: SpeechSynthesis | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private isPaused = false;
  private isMuted = false;

  constructor(options: Partial<TtsOptions> = {}) {
    this.provider = options.provider ?? 'browser';
    this.volume = options.volume ?? 0.8;
    this.elevenLabsApiKey = options.elevenLabsApiKey;
    this.googleApiKey = options.googleApiKey;

    // Initialize Web Speech API
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
    }
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  setProvider(provider: TtsProvider): void {
    this.provider = provider;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));

    // Update current utterance volume if speaking
    if (this.currentUtterance) {
      this.currentUtterance.volume = this.volume;
    }

    // Update audio element volume if playing
    if (this.audioElement) {
      this.audioElement.volume = this.volume;
    }
  }

  setApiKeys(elevenLabsApiKey?: string, googleApiKey?: string): void {
    this.elevenLabsApiKey = elevenLabsApiKey;
    this.googleApiKey = googleApiKey;
  }

  // -------------------------------------------------------------------------
  // Playback Control
  // -------------------------------------------------------------------------

  pause(): void {
    this.isPaused = true;

    if (this.synth && this.synth.speaking) {
      this.synth.pause();
    }

    if (this.audioElement && !this.audioElement.paused) {
      this.audioElement.pause();
    }
  }

  resume(): void {
    this.isPaused = false;

    if (this.synth && this.synth.paused) {
      this.synth.resume();
    }

    if (this.audioElement && this.audioElement.paused) {
      this.audioElement.play().catch((err) => {
        console.error('[commentary-tts] Failed to resume audio:', err);
      });
    }
  }

  stop(): void {
    this.isPaused = false;

    if (this.synth) {
      this.synth.cancel();
    }

    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.currentTime = 0;
      this.audioElement = null;
    }

    this.currentUtterance = null;
  }

  mute(): void {
    this.isMuted = true;
    this.stop();
  }

  unmute(): void {
    this.isMuted = false;
  }

  // -------------------------------------------------------------------------
  // Speech Synthesis
  // -------------------------------------------------------------------------

  /**
   * Speak the given text using the appropriate voice for the personality.
   * Automatically selects the best provider based on configuration.
   *
   * When `workspaceId` is provided and spatial audio is enabled, cloud TTS
   * audio is routed through the spatial engine for stereo panning, and
   * browser TTS gets subtle pitch/rate offsets for perceptual differentiation.
   */
  async speak(
    text: string,
    personality: CommentaryPersonality,
    workspaceId?: string,
  ): Promise<void> {
    if (this.isMuted || this.isPaused) return;

    // Stop any current speech
    this.stop();

    const useSpatial = workspaceId !== undefined && spatialTts.isEnabled();

    try {
      switch (this.provider) {
        case 'elevenlabs':
          if (this.elevenLabsApiKey) {
            const blob = await this.fetchElevenLabsBlob(text, personality);
            if (useSpatial) {
              await spatialTts.playAudioBlob(blob, workspaceId);
            } else {
              await this.playAudioBlob(blob);
            }
          } else {
            console.warn(
              '[commentary-tts] ElevenLabs API key not configured, falling back to browser TTS',
            );
            this.speakBrowserSpatial(text, personality, workspaceId);
          }
          break;

        case 'google':
          if (this.googleApiKey) {
            const blob = await this.fetchGoogleBlob(text, personality);
            if (useSpatial) {
              await spatialTts.playAudioBlob(blob, workspaceId);
            } else {
              await this.playAudioBlob(blob);
            }
          } else {
            console.warn(
              '[commentary-tts] Google API key not configured, falling back to browser TTS',
            );
            this.speakBrowserSpatial(text, personality, workspaceId);
          }
          break;

        case 'browser':
        default:
          this.speakBrowserSpatial(text, personality, workspaceId);
          break;
      }
    } catch (err) {
      console.error('[commentary-tts] Speech failed:', err);
      // Fallback to browser TTS on error
      if (this.provider !== 'browser') {
        console.warn('[commentary-tts] Falling back to browser TTS');
        this.speakBrowserSpatial(text, personality, workspaceId);
      }
    }
  }

  /**
   * Speak using Web Speech API, optionally with spatial voice modifiers.
   *
   * When spatial audio is enabled and a workspaceId is provided, the
   * SpatialTtsEngine applies subtle pitch/rate offsets so concurrent
   * workspace commentators sound perceptually different (since
   * SpeechSynthesis cannot be routed through Web Audio for true panning).
   */
  private speakBrowserSpatial(
    text: string,
    personality: CommentaryPersonality,
    workspaceId: string | undefined,
  ): void {
    if (!this.synth) {
      console.error('[commentary-tts] Web Speech API not available');
      return;
    }

    const basePitch = this.getPitch(personality);
    const baseRate = this.getRate(personality);
    const voice = this.selectBrowserVoice(personality);

    // If spatial audio is enabled and we have a workspaceId, delegate to
    // the spatial engine which applies per-workspace pitch/rate offsets.
    if (workspaceId && spatialTts.isEnabled()) {
      spatialTts.speakBrowser(text, workspaceId, basePitch, baseRate, voice);
      return;
    }

    // Non-spatial path
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = this.volume;
    utterance.rate = baseRate;
    utterance.pitch = basePitch;

    if (voice) {
      utterance.voice = voice;
    }

    utterance.onerror = (event) => {
      console.error('[commentary-tts] Speech error:', event);
    };

    this.currentUtterance = utterance;
    this.synth.speak(utterance);
  }

  // -------------------------------------------------------------------------
  // Cloud TTS — Blob Fetchers
  // -------------------------------------------------------------------------

  /**
   * Fetch audio blob from ElevenLabs API (does NOT play it).
   */
  private async fetchElevenLabsBlob(
    text: string,
    personality: CommentaryPersonality,
  ): Promise<Blob> {
    if (!this.elevenLabsApiKey) {
      throw new Error('ElevenLabs API key not configured');
    }

    const voiceId = ELEVENLABS_VOICE_MAP[personality];
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': this.elevenLabsApiKey,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}`);
    }

    return response.blob();
  }

  /**
   * Fetch audio blob from Google Cloud TTS API (does NOT play it).
   */
  private async fetchGoogleBlob(text: string, personality: CommentaryPersonality): Promise<Blob> {
    if (!this.googleApiKey) {
      throw new Error('Google API key not configured');
    }

    const voiceName = GOOGLE_VOICE_MAP[personality];
    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.googleApiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: { text },
        voice: {
          languageCode: 'en-US',
          name: voiceName,
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: this.getRate(personality),
          pitch: this.getPitch(personality) - 1, // Google uses -20 to 20 scale
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Google TTS API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const audioContent = data.audioContent; // Base64 encoded

    // Convert base64 to blob
    const byteCharacters = atob(audioContent);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: 'audio/mpeg' });
  }

  /**
   * Play an audio blob (used for cloud TTS)
   */
  private async playAudioBlob(blob: Blob): Promise<void> {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = this.volume;

    this.audioElement = audio;

    return new Promise((resolve, reject) => {
      audio.onended = () => {
        URL.revokeObjectURL(url);
        this.audioElement = null;
        resolve();
      };

      audio.onerror = (err) => {
        URL.revokeObjectURL(url);
        this.audioElement = null;
        reject(err);
      };

      audio.play().catch(reject);
    });
  }

  // -------------------------------------------------------------------------
  // Voice Selection Helpers
  // -------------------------------------------------------------------------

  /**
   * Select the best available browser voice for a personality
   */
  private selectBrowserVoice(personality: CommentaryPersonality): SpeechSynthesisVoice | null {
    if (!this.synth) return null;

    const voices = this.synth.getVoices();
    if (voices.length === 0) return null;

    const preferredNames = BROWSER_VOICE_MAP[personality];

    // Try to find a preferred voice
    for (const name of preferredNames) {
      const voice = voices.find((v) => v.name.includes(name));
      if (voice) return voice;
    }

    // Fallback: find any English voice
    const englishVoice = voices.find((v) => v.lang.startsWith('en'));
    if (englishVoice) return englishVoice;

    // Last resort: use the first available voice
    return voices[0];
  }

  /**
   * Get speaking rate for a personality (0.1 - 10, default 1)
   */
  private getRate(personality: CommentaryPersonality): number {
    switch (personality) {
      case 'documentary_narrator':
        return 0.9; // Slow, thoughtful
      case 'technical_analyst':
        return 1.0; // Normal
      case 'comedic_observer':
        return 1.05; // Slightly faster
      case 'project_lead':
        return 0.95; // Authoritative, measured
      case 'wizard':
        return 0.82; // Slow, deliberate, ancient cadence
      default:
        return 1.0;
    }
  }

  /**
   * Get pitch for a personality (0 - 2, default 1)
   */
  private getPitch(personality: CommentaryPersonality): number {
    switch (personality) {
      case 'documentary_narrator':
        return 0.9; // Lower pitch for gravitas
      case 'technical_analyst':
        return 1.0; // Normal
      case 'comedic_observer':
        return 1.05; // Slightly higher
      case 'project_lead':
        return 0.95; // Lower, authoritative
      case 'wizard':
        return 0.78; // Deep, rumbling, Gandalf-like gravitas
      default:
        return 1.0;
    }
  }

  /**
   * Get available browser voices (for UI display)
   */
  getAvailableVoices(): SpeechSynthesisVoice[] {
    if (!this.synth) return [];
    return this.synth.getVoices();
  }

  /**
   * Check if a provider is available
   */
  isProviderAvailable(provider: TtsProvider): boolean {
    switch (provider) {
      case 'browser':
        return !!this.synth;
      case 'elevenlabs':
        return !!this.elevenLabsApiKey;
      case 'google':
        return !!this.googleApiKey;
      default:
        return false;
    }
  }
}

// Create a singleton instance
export const commentaryTtsService = new CommentaryTtsService();
