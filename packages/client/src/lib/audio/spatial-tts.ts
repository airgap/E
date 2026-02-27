/**
 * Spatial Audio TTS Engine (Experimental)
 *
 * Provides spatial audio differentiation for multi-workspace TTS commentary.
 * Disabled by default — users must opt in via the Manager View.
 *
 * ## How it works
 *
 * **Browser TTS (SpeechSynthesis):**
 * The Web Speech API does not expose a raw audio stream, so true stereo
 * panning is not possible. Instead we use _perceptual differentiation_:
 * - Slight pitch offsets per workspace (e.g. left = lower, right = higher)
 * - Slight rate offsets per workspace
 * - Volume balance (attenuate one ear cannot be done, but we log the
 *   intended position for debugging)
 *
 * **Cloud TTS (ElevenLabs / Google):**
 * Cloud providers return raw audio blobs that CAN be routed through the
 * Web Audio API. When cloud TTS is active AND spatial audio is enabled,
 * the audio blob is decoded into an AudioBuffer, run through a
 * StereoPannerNode, and played with real left/right positioning.
 *
 * ## Position assignment
 *
 * | Workspaces | Positions                           |
 * |------------|-------------------------------------|
 * | 1          | Center (pan = 0)                    |
 * | 2          | Left (-1), Right (+1)               |
 * | 3          | Left (-1), Center (0), Right (+1)   |
 * | 4+         | Evenly spread from -1 to +1         |
 *
 * Pan values follow the Web Audio StereoPannerNode convention: -1 = full
 * left, 0 = center, +1 = full right.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpatialPosition {
  /** Stereo pan value: -1 (left) to +1 (right) */
  pan: number;
  /** Human-readable label */
  label: string;
}

interface ActivePlayback {
  workspaceId: string;
  /** Browser TTS utterance (if using browser provider) */
  utterance?: SpeechSynthesisUtterance;
  /** Audio source node for cloud TTS */
  sourceNode?: AudioBufferSourceNode;
  /** Panner node for cloud TTS */
  pannerNode?: StereoPannerNode;
  /** Gain node for volume control */
  gainNode?: GainNode;
}

// ---------------------------------------------------------------------------
// Position Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate stereo pan positions for a set of workspaces.
 * Returns a Map of workspaceId -> SpatialPosition.
 */
export function calculateSpatialPositions(workspaceIds: string[]): Map<string, SpatialPosition> {
  const positions = new Map<string, SpatialPosition>();
  const count = workspaceIds.length;

  if (count === 0) return positions;

  const labels = [
    'Far Left',
    'Left',
    'Center-Left',
    'Center',
    'Center-Right',
    'Right',
    'Far Right',
  ];

  for (let i = 0; i < count; i++) {
    let pan: number;
    let label: string;

    if (count === 1) {
      pan = 0;
      label = 'Center';
    } else if (count === 2) {
      pan = i === 0 ? -0.8 : 0.8;
      label = i === 0 ? 'Left' : 'Right';
    } else if (count === 3) {
      const pans = [-1, 0, 1];
      pan = pans[i];
      label = ['Left', 'Center', 'Right'][i];
    } else {
      // Distribute evenly from -1 to +1
      pan = count > 1 ? -1 + (2 * i) / (count - 1) : 0;
      // Pick a descriptive label
      if (pan < -0.5) label = 'Left';
      else if (pan < -0.1) label = 'Center-Left';
      else if (pan <= 0.1) label = 'Center';
      else if (pan <= 0.5) label = 'Center-Right';
      else label = 'Right';
    }

    positions.set(workspaceIds[i], { pan, label });
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Pitch / Rate offsets for browser TTS differentiation
// ---------------------------------------------------------------------------

/**
 * Returns slight pitch and rate offsets based on pan position.
 * This helps users distinguish workspace voices when true stereo panning
 * is unavailable (browser TTS).
 *
 * Left workspaces get slightly lower pitch/rate; right get slightly higher.
 */
export function getSpatialVoiceModifiers(pan: number): { pitchOffset: number; rateOffset: number } {
  // Map pan (-1..+1) to small offsets
  // pitch: -0.08 .. +0.08 (very subtle)
  // rate:  -0.04 .. +0.04 (very subtle)
  return {
    pitchOffset: pan * 0.08,
    rateOffset: pan * 0.04,
  };
}

// ---------------------------------------------------------------------------
// SpatialTtsEngine
// ---------------------------------------------------------------------------

class SpatialTtsEngine {
  private audioContext: AudioContext | null = null;
  private activePlaybacks = new Map<string, ActivePlayback>();
  private workspacePositions = new Map<string, SpatialPosition>();
  private enabled = false;
  private masterVolume = 1.0;

  // ---- Initialization ----

  /**
   * Initialize the Web Audio API context.
   * Must be called after a user gesture (browser autoplay policy).
   */
  initialize(): void {
    if (this.audioContext) return;

    try {
      this.audioContext = new AudioContext();
      console.log('[spatial-tts] AudioContext initialized, state:', this.audioContext.state);
    } catch (err) {
      console.error('[spatial-tts] Failed to create AudioContext:', err);
    }
  }

  /**
   * Resume the AudioContext if suspended (required after page load).
   */
  async resume(): Promise<void> {
    if (!this.audioContext) {
      this.initialize();
    }

    if (this.audioContext?.state === 'suspended') {
      try {
        await this.audioContext.resume();
        console.log('[spatial-tts] AudioContext resumed');
      } catch (err) {
        console.error('[spatial-tts] Failed to resume AudioContext:', err);
      }
    }
  }

  // ---- Configuration ----

  /** Enable or disable spatial audio positioning. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      this.initialize();
    } else {
      this.stopAll();
    }
    console.log('[spatial-tts] Spatial audio', enabled ? 'enabled' : 'disabled');
  }

  /** Whether spatial audio is currently enabled. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** Set master volume (0.0 to 1.0). */
  setVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));

    // Update any active gain nodes
    for (const playback of this.activePlaybacks.values()) {
      if (playback.gainNode) {
        playback.gainNode.gain.value = this.masterVolume;
      }
    }
  }

  // ---- Workspace Position Management ----

  /**
   * Recalculate positions when the workspace list changes.
   * Call this whenever workspaces are added/removed from the manager view.
   */
  updateWorkspaces(workspaceIds: string[]): void {
    this.workspacePositions = calculateSpatialPositions(workspaceIds);

    if (this.workspacePositions.size > 0) {
      console.log(
        '[spatial-tts] Updated positions:',
        Array.from(this.workspacePositions.entries())
          .map(([id, pos]) => `${id.slice(0, 8)}: ${pos.label} (pan=${pos.pan.toFixed(2)})`)
          .join(', '),
      );
    }
  }

  /** Get the spatial position assigned to a workspace. */
  getPosition(workspaceId: string): SpatialPosition | undefined {
    return this.workspacePositions.get(workspaceId);
  }

  /** Get all workspace positions (for UI display). */
  getAllPositions(): Map<string, SpatialPosition> {
    return new Map(this.workspacePositions);
  }

  // ---- Browser TTS (SpeechSynthesis) ----

  /**
   * Speak text using browser SpeechSynthesis with spatial differentiation.
   *
   * Since browser TTS cannot be routed through Web Audio API for true panning,
   * we apply subtle pitch/rate offsets based on the workspace's position to
   * help the listener differentiate between simultaneous commentators.
   */
  speakBrowser(
    text: string,
    workspaceId: string,
    basePitch: number = 1.0,
    baseRate: number = 1.0,
    voice?: SpeechSynthesisVoice | null,
  ): void {
    if (!('speechSynthesis' in window)) {
      console.warn('[spatial-tts] SpeechSynthesis not available');
      return;
    }

    // Stop any existing playback for this workspace
    this.stopWorkspace(workspaceId);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = this.masterVolume;

    // Apply spatial voice modifiers if enabled
    const position = this.workspacePositions.get(workspaceId);
    if (this.enabled && position) {
      const mods = getSpatialVoiceModifiers(position.pan);
      utterance.pitch = Math.max(0.1, Math.min(2, basePitch + mods.pitchOffset));
      utterance.rate = Math.max(0.1, Math.min(10, baseRate + mods.rateOffset));
    } else {
      utterance.pitch = basePitch;
      utterance.rate = baseRate;
    }

    if (voice) {
      utterance.voice = voice;
    }

    const playback: ActivePlayback = { workspaceId, utterance };
    this.activePlaybacks.set(workspaceId, playback);

    utterance.onend = () => this.cleanupPlayback(workspaceId);
    utterance.onerror = () => this.cleanupPlayback(workspaceId);

    window.speechSynthesis.speak(utterance);

    if (this.enabled && position) {
      console.log(
        `[spatial-tts] Browser TTS for ${workspaceId.slice(0, 8)} at ${position.label}` +
          ` (pitch=${utterance.pitch.toFixed(2)}, rate=${utterance.rate.toFixed(2)})`,
      );
    }
  }

  // ---- Cloud TTS (Audio Blob via Web Audio API) ----

  /**
   * Play an audio blob (from ElevenLabs, Google TTS, etc.) with real
   * stereo panning through the Web Audio API.
   *
   * If spatial audio is disabled or unavailable, falls back to a plain
   * HTMLAudioElement.
   */
  async playAudioBlob(blob: Blob, workspaceId: string): Promise<void> {
    // Stop any existing playback for this workspace
    this.stopWorkspace(workspaceId);

    const position = this.workspacePositions.get(workspaceId);

    // Use Web Audio API path if spatial audio is enabled and context is ready
    if (this.enabled && position && this.audioContext) {
      await this.resume();

      try {
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;

        // Create StereoPannerNode for L/R positioning
        const panner = this.audioContext.createStereoPanner();
        panner.pan.value = position.pan;

        // Create GainNode for volume control
        const gain = this.audioContext.createGain();
        gain.gain.value = this.masterVolume;

        // Connect: source -> panner -> gain -> destination
        source.connect(panner);
        panner.connect(gain);
        gain.connect(this.audioContext.destination);

        const playback: ActivePlayback = {
          workspaceId,
          sourceNode: source,
          pannerNode: panner,
          gainNode: gain,
        };
        this.activePlaybacks.set(workspaceId, playback);

        source.onended = () => this.cleanupPlayback(workspaceId);

        source.start(0);

        console.log(
          `[spatial-tts] Cloud TTS for ${workspaceId.slice(0, 8)} at ${position.label}` +
            ` (pan=${position.pan.toFixed(2)})`,
        );
        return;
      } catch (err) {
        console.warn('[spatial-tts] Web Audio decode failed, falling back to HTMLAudio:', err);
        // Fall through to HTMLAudioElement
      }
    }

    // Fallback: plain audio element (no spatial positioning)
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = this.masterVolume;

    return new Promise<void>((resolve, reject) => {
      audio.onended = () => {
        URL.revokeObjectURL(url);
        this.cleanupPlayback(workspaceId);
        resolve();
      };
      audio.onerror = (err) => {
        URL.revokeObjectURL(url);
        this.cleanupPlayback(workspaceId);
        reject(err);
      };
      audio.play().catch(reject);
    });
  }

  // ---- Playback Control ----

  /** Stop playback for a specific workspace. */
  stopWorkspace(workspaceId: string): void {
    const playback = this.activePlaybacks.get(workspaceId);
    if (!playback) return;

    // Stop browser TTS utterance
    // NOTE: speechSynthesis.cancel() stops ALL utterances — this is a browser
    // limitation. For multi-workspace browser TTS, utterances are queued so
    // cancelling is disruptive. We mark it as cleaned up.
    if (playback.utterance && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    // Stop Web Audio source
    if (playback.sourceNode) {
      try {
        playback.sourceNode.stop();
      } catch {
        // Already stopped
      }
    }

    this.cleanupPlayback(workspaceId);
  }

  /** Stop all active playback. */
  stopAll(): void {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    for (const workspaceId of [...this.activePlaybacks.keys()]) {
      const playback = this.activePlaybacks.get(workspaceId);
      if (playback?.sourceNode) {
        try {
          playback.sourceNode.stop();
        } catch {
          // Already stopped
        }
      }
      this.cleanupPlayback(workspaceId);
    }
  }

  /** Check if a workspace is currently playing. */
  isSpeaking(workspaceId: string): boolean {
    return this.activePlaybacks.has(workspaceId);
  }

  // ---- Cleanup ----

  private cleanupPlayback(workspaceId: string): void {
    const playback = this.activePlaybacks.get(workspaceId);
    if (!playback) return;

    if (playback.sourceNode) {
      try {
        playback.sourceNode.disconnect();
      } catch {
        /* ok */
      }
    }
    if (playback.pannerNode) {
      try {
        playback.pannerNode.disconnect();
      } catch {
        /* ok */
      }
    }
    if (playback.gainNode) {
      try {
        playback.gainNode.disconnect();
      } catch {
        /* ok */
      }
    }

    this.activePlaybacks.delete(workspaceId);
  }

  /** Tear down the engine entirely. */
  destroy(): void {
    this.stopAll();
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.workspacePositions.clear();
    this.enabled = false;
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const spatialTts = new SpatialTtsEngine();
