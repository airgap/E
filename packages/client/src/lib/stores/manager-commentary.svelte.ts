import type { StreamCommentary } from '@e/shared';
import { getBaseUrl, getAuthToken } from '$lib/api/client';
import { spatialTts, type SpatialPosition } from '$lib/audio/spatial-tts';
import { commentaryTtsService, type CommentaryPersonality } from '$lib/services/commentary-tts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ManagerCommentaryEntry {
  text: string;
  timestamp: number;
  personality: string;
  workspaceId: string;
}

export interface WorkspaceCommentaryState {
  /** Last N commentary lines for display on workspace cards */
  entries: ManagerCommentaryEntry[];
  /** Whether this workspace's SSE connection is active */
  active: boolean;
  /** Whether the user has muted commentary for this workspace */
  muted: boolean;
  /** Error message, if any */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max commentary entries to keep per workspace (show last 3) */
const MAX_ENTRIES_PER_WORKSPACE = 3;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Multi-workspace commentary store for the Manager View.
 *
 * Unlike the single-workspace `commentaryStore`, this store manages
 * multiple simultaneous SSE connections — one per workspace — and keeps
 * a small rolling window of recent commentary entries for each.
 *
 * Integrates with the SpatialTtsEngine for experimental spatial audio
 * positioning across workspaces (disabled by default, opt-in).
 */
function createManagerCommentaryStore() {
  /** Per-workspace commentary state, keyed by workspaceId */
  let workspaceStates = $state<Record<string, WorkspaceCommentaryState>>({});

  /** Per-workspace AbortControllers for SSE connections */
  const controllers = new Map<string, AbortController>();

  /** Generation counters per workspace to prevent stale processing */
  const generations = new Map<string, number>();

  /** Which workspace's commentary is expanded (null = none) */
  let expandedWorkspaceId = $state<string | null>(null);

  /** Whether spatial audio is enabled (experimental, disabled by default) */
  let spatialAudioEnabled = $state(false);

  /** Whether TTS is enabled for the manager view */
  let ttsEnabled = $state(false);

  /** Current TTS volume (0-1) */
  let ttsVolume = $state(0.8);

  // ---- Internal helpers ----

  function ensureState(workspaceId: string): WorkspaceCommentaryState {
    if (!workspaceStates[workspaceId]) {
      workspaceStates[workspaceId] = {
        entries: [],
        active: false,
        muted: false,
        error: null,
      };
    }
    return workspaceStates[workspaceId];
  }

  /**
   * Speak commentary text with spatial audio positioning.
   * Uses the SpatialTtsEngine for browser TTS with pitch/rate differentiation.
   */
  function speakWithSpatialAudio(text: string, workspaceId: string, personality: string): void {
    if (!ttsEnabled) return;

    const wsState = workspaceStates[workspaceId];
    if (wsState?.muted) return;

    // Use commentary TTS service, passing workspaceId for spatial positioning.
    // When spatial audio is enabled, the TTS service delegates to the
    // SpatialTtsEngine internally for both browser and cloud providers.
    commentaryTtsService
      .speak(text, personality as CommentaryPersonality, workspaceId)
      .catch((err: unknown) => {
        console.error('[manager-commentary] TTS failed:', err);
      });
  }

  function processLine(workspaceId: string, line: string): void {
    if (!line.startsWith('data: ')) return;
    const data = line.slice(6).trim();
    if (!data) return;

    try {
      const event = JSON.parse(data) as StreamCommentary | { type: 'ping' };

      // Ignore keep-alive pings
      if (event.type === 'ping') return;

      if (event.type === 'commentary') {
        const commentary = event as StreamCommentary;
        const state = ensureState(workspaceId);

        const newEntry: ManagerCommentaryEntry = {
          text: commentary.text,
          timestamp: commentary.timestamp,
          personality: commentary.personality,
          workspaceId: commentary.workspaceId,
        };

        // Keep a rolling window of the last N entries
        const updated = [...state.entries, newEntry];
        if (updated.length > MAX_ENTRIES_PER_WORKSPACE) {
          updated.splice(0, updated.length - MAX_ENTRIES_PER_WORKSPACE);
        }

        // Trigger reactivity by reassigning the whole record
        workspaceStates = {
          ...workspaceStates,
          [workspaceId]: {
            ...state,
            entries: updated,
          },
        };

        // Speak with spatial positioning if TTS is enabled
        speakWithSpatialAudio(commentary.text, workspaceId, commentary.personality);
      }
    } catch {
      // Non-JSON or malformed line — skip
    }
  }

  return {
    // -- Getters --------------------------------------------------------

    /** Full state map for all workspaces */
    get states(): Record<string, WorkspaceCommentaryState> {
      return workspaceStates;
    },

    /** Which workspace's commentary is expanded (null = none) */
    get expandedWorkspaceId(): string | null {
      return expandedWorkspaceId;
    },

    /** Whether spatial audio is enabled (experimental) */
    get spatialAudioEnabled(): boolean {
      return spatialAudioEnabled;
    },

    /** Whether TTS is enabled for manager view */
    get ttsEnabled(): boolean {
      return ttsEnabled;
    },

    /** Current TTS volume */
    get ttsVolume(): number {
      return ttsVolume;
    },

    /** Get state for a specific workspace */
    getWorkspaceState(workspaceId: string): WorkspaceCommentaryState {
      return (
        workspaceStates[workspaceId] ?? {
          entries: [],
          active: false,
          muted: false,
          error: null,
        }
      );
    },

    /** Check if commentary is active for a workspace */
    isActive(workspaceId: string): boolean {
      return workspaceStates[workspaceId]?.active ?? false;
    },

    /** Get the latest commentary entries for a workspace */
    getEntries(workspaceId: string): ManagerCommentaryEntry[] {
      return workspaceStates[workspaceId]?.entries ?? [];
    },

    /** Get the spatial position for a workspace */
    getSpatialPosition(workspaceId: string): SpatialPosition | undefined {
      return spatialTts.getPosition(workspaceId);
    },

    // -- Actions --------------------------------------------------------

    // -- Spatial Audio Controls --

    /**
     * Enable or disable spatial audio (experimental).
     * Disabled by default — opt-in only.
     */
    setSpatialAudioEnabled(enabled: boolean) {
      spatialAudioEnabled = enabled;
      spatialTts.setEnabled(enabled);
    },

    /**
     * Enable or disable TTS for the manager view.
     */
    setTtsEnabled(enabled: boolean) {
      ttsEnabled = enabled;
      if (!enabled) {
        spatialTts.stopAll();
        commentaryTtsService.stop();
      }
    },

    /**
     * Set TTS volume for the manager view.
     */
    setTtsVolume(volume: number) {
      ttsVolume = Math.max(0, Math.min(1, volume));
      spatialTts.setVolume(ttsVolume);
      commentaryTtsService.setVolume(ttsVolume);
    },

    /**
     * Update spatial positions for all tracked workspaces.
     * Call this when the workspace list changes.
     */
    updateSpatialPositions(workspaceIds: string[]) {
      spatialTts.updateWorkspaces(workspaceIds);
    },

    /**
     * Start an SSE commentary connection for a workspace.
     */
    startCommentary(workspaceId: string, personality: string = 'technical_analyst') {
      // Tear down any existing connection for this workspace
      this.stopCommentary(workspaceId);

      const gen = (generations.get(workspaceId) ?? 0) + 1;
      generations.set(workspaceId, gen);

      const state = ensureState(workspaceId);
      workspaceStates = {
        ...workspaceStates,
        [workspaceId]: {
          ...state,
          active: true,
          error: null,
        },
      };

      const controller = new AbortController();
      controllers.set(workspaceId, controller);

      const headers: Record<string, string> = {};
      const token = getAuthToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const url = `${getBaseUrl()}/commentary/${encodeURIComponent(workspaceId)}?personality=${encodeURIComponent(personality)}`;

      // Fire-and-forget async SSE reader loop
      (async () => {
        try {
          const response = await fetch(url, {
            headers,
            signal: controller.signal,
          });

          if (!response.ok) {
            if (gen === generations.get(workspaceId)) {
              workspaceStates = {
                ...workspaceStates,
                [workspaceId]: {
                  ...ensureState(workspaceId),
                  active: false,
                  error: `HTTP ${response.status}`,
                },
              };
            }
            return;
          }

          const reader = response.body?.getReader();
          if (!reader) {
            if (gen === generations.get(workspaceId)) {
              workspaceStates = {
                ...workspaceStates,
                [workspaceId]: {
                  ...ensureState(workspaceId),
                  active: false,
                  error: 'No response body',
                },
              };
            }
            return;
          }

          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            // Check if superseded
            if (gen !== generations.get(workspaceId)) {
              reader.cancel().catch(() => {});
              return;
            }

            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              processLine(workspaceId, line);
            }
          }

          // Stream ended normally
          if (gen === generations.get(workspaceId)) {
            workspaceStates = {
              ...workspaceStates,
              [workspaceId]: {
                ...ensureState(workspaceId),
                active: false,
              },
            };
          }
        } catch (err) {
          if (gen !== generations.get(workspaceId)) return;

          if ((err as Error).name === 'AbortError') {
            workspaceStates = {
              ...workspaceStates,
              [workspaceId]: {
                ...ensureState(workspaceId),
                active: false,
              },
            };
          } else {
            workspaceStates = {
              ...workspaceStates,
              [workspaceId]: {
                ...ensureState(workspaceId),
                active: false,
                error: (err as Error).message,
              },
            };
          }
        }
      })();
    },

    /**
     * Stop the SSE connection for a workspace.
     */
    stopCommentary(workspaceId: string) {
      const gen = (generations.get(workspaceId) ?? 0) + 1;
      generations.set(workspaceId, gen);

      const controller = controllers.get(workspaceId);
      if (controller) {
        try {
          controller.abort();
        } catch {
          // Already aborted
        }
        controllers.delete(workspaceId);
      }

      const state = workspaceStates[workspaceId];
      if (state) {
        workspaceStates = {
          ...workspaceStates,
          [workspaceId]: {
            ...state,
            active: false,
            error: null,
          },
        };
      }
    },

    /**
     * Stop all SSE connections. Call this on component destroy.
     */
    stopAll() {
      for (const wsId of controllers.keys()) {
        this.stopCommentary(wsId);
      }
      // Stop all spatial and standard TTS playback
      spatialTts.stopAll();
      commentaryTtsService.stop();
    },

    /**
     * Toggle mute state for a workspace.
     * When muted, we stop the SSE connection.
     * When unmuted, we do NOT auto-start (caller should do that if desired).
     */
    setMuted(workspaceId: string, muted: boolean) {
      const state = ensureState(workspaceId);
      workspaceStates = {
        ...workspaceStates,
        [workspaceId]: {
          ...state,
          muted,
        },
      };

      if (muted) {
        this.stopCommentary(workspaceId);
      }
    },

    /**
     * Set or clear the expanded workspace.
     */
    setExpanded(workspaceId: string | null) {
      expandedWorkspaceId = workspaceId;
    },

    /**
     * Toggle expanded state for a workspace.
     */
    toggleExpanded(workspaceId: string) {
      expandedWorkspaceId = expandedWorkspaceId === workspaceId ? null : workspaceId;
    },
  };
}

export const managerCommentaryStore = createManagerCommentaryStore();

// ---------------------------------------------------------------------------
// HMR cleanup — abort all SSE readers when Vite hot-reloads this module
// ---------------------------------------------------------------------------
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    managerCommentaryStore.stopAll();
  });
}
