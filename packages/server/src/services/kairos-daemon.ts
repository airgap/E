/**
 * KAIROS Daemon Service
 *
 * Always-on autonomous daemon for golems. Watches the workspace,
 * acts on events, and runs on its own schedule.
 */

import { EventEmitter } from 'events';
import { watch } from 'fs';
import type { FSWatcher } from 'fs';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import type {
  KairosState,
  KairosConfig,
  KairosAction,
  KairosWatchEvent,
  KairosStatus,
  StreamKairosEvent,
} from '@e/shared';
import { DEFAULT_KAIROS_CONFIG } from '@e/shared';
import { formatKairosResult } from './brief-formatter';

class KairosDaemon extends EventEmitter {
  private daemons = new Map<string, KairosState>();
  private watchers = new Map<string, FSWatcher>();
  private intervals = new Map<string, ReturnType<typeof setInterval>>();
  private cooldowns = new Map<string, number>();

  /**
   * Start a KAIROS daemon for a workspace.
   */
  start(golemId: string, workspacePath: string, config?: Partial<KairosConfig>): KairosState {
    const id = nanoid(12);
    const mergedConfig: KairosConfig = { ...DEFAULT_KAIROS_CONFIG, ...config };

    const state: KairosState = {
      id,
      golemId,
      workspacePath,
      status: 'starting',
      config: mergedConfig,
      startedAt: Date.now(),
      actionsThisHour: 0,
      consecutiveErrors: 0,
      totalActions: 0,
      recentActions: [],
    };

    this.daemons.set(id, state);
    this.persistState(state);

    // Set up file watcher
    if (
      mergedConfig.watch.events.includes('file_change') ||
      mergedConfig.watch.events.includes('todo_added')
    ) {
      this.startFileWatcher(state);
    }

    // Set up scheduled interval
    if (mergedConfig.watch.events.includes('schedule')) {
      const interval = setInterval(
        () => this.handleEvent(id, 'schedule'),
        mergedConfig.watch.scheduleIntervalMinutes * 60 * 1000,
      );
      this.intervals.set(id, interval);
    }

    // Set up hourly action counter reset
    const hourlyReset = setInterval(
      () => {
        const s = this.daemons.get(id);
        if (s) s.actionsThisHour = 0;
      },
      60 * 60 * 1000,
    );
    this.intervals.set(`${id}_hourly`, hourlyReset);

    state.status = 'running';
    this.emitEvent(state, 'started', 'KAIROS daemon activated');
    return state;
  }

  /**
   * Stop a daemon.
   */
  stop(daemonId: string): void {
    const state = this.daemons.get(daemonId);
    if (!state) return;

    // Clean up watchers and intervals
    const watcher = this.watchers.get(daemonId);
    if (watcher) {
      watcher.close();
      this.watchers.delete(daemonId);
    }

    for (const [key, interval] of this.intervals) {
      if (key.startsWith(daemonId)) {
        clearInterval(interval);
        this.intervals.delete(key);
      }
    }

    state.status = 'stopped';
    this.persistState(state);
    this.emitEvent(state, 'stopped', 'KAIROS daemon deactivated');
    this.daemons.delete(daemonId);
  }

  /**
   * Pause a daemon (keeps state, stops watching).
   */
  pause(daemonId: string): void {
    const state = this.daemons.get(daemonId);
    if (!state || state.status !== 'running') return;

    state.status = 'paused';
    this.persistState(state);
    this.emitEvent(state, 'paused', 'KAIROS daemon paused');
  }

  /**
   * Resume a paused daemon.
   */
  resume(daemonId: string): void {
    const state = this.daemons.get(daemonId);
    if (!state || state.status !== 'paused') return;

    state.status = 'running';
    this.persistState(state);
    this.emitEvent(state, 'started', 'KAIROS daemon resumed');
  }

  /**
   * Get state for a daemon.
   */
  getState(daemonId: string): KairosState | undefined {
    return this.daemons.get(daemonId);
  }

  /**
   * Get all active daemons.
   */
  getAllDaemons(): KairosState[] {
    return Array.from(this.daemons.values());
  }

  /**
   * Handle a watch event.
   */
  private async handleEvent(
    daemonId: string,
    event: KairosWatchEvent,
    detail?: string,
  ): Promise<void> {
    const state = this.daemons.get(daemonId);
    if (!state || state.status !== 'running') return;

    // Check cooldown
    const lastAction = this.cooldowns.get(daemonId) || 0;
    if (Date.now() - lastAction < state.config.watch.cooldownSeconds * 1000) return;

    // Check circuit breaker
    if (state.actionsThisHour >= state.config.maxActionsPerHour) return;

    // Format the description through brief mode
    const rawDescription = detail || `${event} detected`;
    const { formatted } = formatKairosResult(rawDescription, state.config.outputMode);

    const action: KairosAction = {
      id: nanoid(8),
      event,
      description: formatted || rawDescription,
      timestamp: Date.now(),
    };

    state.actionsThisHour++;
    state.totalActions++;
    state.lastActionAt = Date.now();
    state.recentActions = [...state.recentActions.slice(-19), action];
    this.cooldowns.set(daemonId, Date.now());

    this.emitEvent(state, 'action_taken', action.description, action);
    this.persistState(state);
  }

  private startFileWatcher(state: KairosState): void {
    try {
      const watcher = watch(state.workspacePath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const ignored = state.config.watch.ignorePatterns.some((p) => {
          const pattern = p.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
          return new RegExp(pattern).test(filename);
        });
        if (ignored) return;

        this.handleEvent(state.id, 'file_change', `File changed: ${filename}`);
      });
      this.watchers.set(state.id, watcher);
    } catch {
      // File watching not supported or permission denied
      state.consecutiveErrors++;
    }
  }

  private emitEvent(
    state: KairosState,
    event: StreamKairosEvent['event'],
    message: string,
    action?: KairosAction,
  ): void {
    const sseEvent: StreamKairosEvent = {
      type: 'kairos_event',
      daemonId: state.id,
      event,
      data: {
        message,
        action,
        status: state.status,
        actionsThisHour: state.actionsThisHour,
      },
    };
    this.emit('kairos_event', sseEvent);
  }

  private persistState(state: KairosState): void {
    try {
      const db = getDb();
      db.query(
        `
        INSERT OR REPLACE INTO kairos_daemons (id, golem_id, workspace_path, status, config, state_json, started_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        state.id,
        state.golemId,
        state.workspacePath,
        state.status,
        JSON.stringify(state.config),
        JSON.stringify(state),
        state.startedAt,
        Date.now(),
      );
    } catch {
      // Table may not exist yet during startup
    }
  }
}

export const kairosDaemon = new KairosDaemon();
