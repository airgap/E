/**
 * Agent Sleep / Self-Resume Service
 *
 * Allows agents to checkpoint state and sleep until a trigger fires.
 * Supports timer, file change, webhook, git push, schedule, and manual triggers.
 */

import { nanoid } from 'nanoid';
import { watch, type FSWatcher } from 'fs';
import { getDb } from '../db/database';
import type { AgentCheckpoint, SleepWakeCondition, SleepConfig, SleepState } from '@e/shared';
import { DEFAULT_SLEEP_CONFIG } from '@e/shared';

class AgentSleepService {
  private static instance: AgentSleepService;
  private config: SleepConfig = { ...DEFAULT_SLEEP_CONFIG };
  private watchers = new Map<string, FSWatcher>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private expiryInterval?: ReturnType<typeof setInterval>;
  private wakeCallbacks = new Map<string, (checkpoint: AgentCheckpoint) => void>();

  static getInstance(): AgentSleepService {
    if (!AgentSleepService.instance) {
      AgentSleepService.instance = new AgentSleepService();
    }
    return AgentSleepService.instance;
  }

  init(): void {
    // Periodic expiry check
    this.expiryInterval = setInterval(
      () => {
        this.expireOldCheckpoints();
      },
      this.config.expiryCheckIntervalMinutes * 60 * 1000,
    );
  }

  /**
   * Put an agent to sleep with a checkpoint.
   */
  sleep(
    agentId: string,
    stateJson: string,
    wakeCondition: SleepWakeCondition,
    workspacePath: string,
    conversationId?: string,
    reason?: string,
  ): AgentCheckpoint {
    const db = getDb();
    const sleeping = db
      .query("SELECT COUNT(*) as c FROM agent_checkpoints WHERE state = 'sleeping'")
      .get() as any;
    if (sleeping.c >= this.config.maxSleepingAgents) {
      throw new Error(`Max sleeping agents (${this.config.maxSleepingAgents}) reached`);
    }

    const id = nanoid(12);
    const now = Date.now();
    const expiresAt = now + this.config.defaultExpiryHours * 60 * 60 * 1000;

    const checkpoint: AgentCheckpoint = {
      id,
      agentId,
      conversationId,
      stateJson,
      wakeCondition,
      state: 'sleeping',
      createdAt: now,
      expiresAt,
      workspacePath,
      reason,
    };

    db.query(
      `INSERT INTO agent_checkpoints (id, agent_id, conversation_id, state_json, wake_condition_json, state, workspace_path, reason, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'sleeping', ?, ?, ?, ?)`,
    ).run(
      id,
      agentId,
      conversationId || null,
      stateJson,
      JSON.stringify(wakeCondition),
      workspacePath,
      reason || null,
      now,
      expiresAt,
    );

    // Set up trigger
    this.setupTrigger(checkpoint);

    return checkpoint;
  }

  /**
   * Manually wake an agent.
   */
  wake(checkpointId: string): AgentCheckpoint | null {
    return this.resumeCheckpoint(checkpointId);
  }

  /**
   * Cancel a sleeping agent.
   */
  cancel(checkpointId: string): void {
    this.cleanupTrigger(checkpointId);
    const db = getDb();
    db.query("UPDATE agent_checkpoints SET state = 'cancelled' WHERE id = ?").run(checkpointId);
  }

  /**
   * Get a checkpoint by ID.
   */
  get(checkpointId: string): AgentCheckpoint | null {
    const db = getDb();
    const row = db.query('SELECT * FROM agent_checkpoints WHERE id = ?').get(checkpointId) as any;
    if (!row) return null;
    return this.rowToCheckpoint(row);
  }

  /**
   * List all checkpoints, optionally filtered by state.
   */
  list(state?: SleepState): AgentCheckpoint[] {
    const db = getDb();
    let query = 'SELECT * FROM agent_checkpoints';
    const params: any[] = [];
    if (state) {
      query += ' WHERE state = ?';
      params.push(state);
    }
    query += ' ORDER BY created_at DESC';
    const rows = db.query(query).all(...params) as any[];
    return rows.map(this.rowToCheckpoint);
  }

  /**
   * Register a callback for when an agent wakes.
   */
  onWake(checkpointId: string, callback: (checkpoint: AgentCheckpoint) => void): void {
    this.wakeCallbacks.set(checkpointId, callback);
  }

  private setupTrigger(checkpoint: AgentCheckpoint): void {
    const { wakeCondition } = checkpoint;

    switch (wakeCondition.trigger) {
      case 'timer':
        if (wakeCondition.delaySeconds) {
          this.timers.set(
            checkpoint.id,
            setTimeout(
              () => this.resumeCheckpoint(checkpoint.id),
              wakeCondition.delaySeconds * 1000,
            ),
          );
        }
        break;

      case 'file_change':
        if (wakeCondition.watchPatterns?.length) {
          try {
            const watcher = watch(
              checkpoint.workspacePath,
              { recursive: true },
              (_event, filename) => {
                if (!filename) return;
                const matches = wakeCondition.watchPatterns!.some((p) =>
                  filename.includes(p.replace('*', '')),
                );
                if (matches) this.resumeCheckpoint(checkpoint.id);
              },
            );
            this.watchers.set(checkpoint.id, watcher);
          } catch {}
        }
        break;

      case 'schedule':
        if (wakeCondition.wakeAt) {
          const wakeTime = new Date(wakeCondition.wakeAt).getTime();
          const delay = Math.max(0, wakeTime - Date.now());
          this.timers.set(
            checkpoint.id,
            setTimeout(() => this.resumeCheckpoint(checkpoint.id), delay),
          );
        }
        break;

      // webhook and git_push are externally triggered via wake()
      case 'webhook':
      case 'git_push':
      case 'manual':
        break;
    }
  }

  private resumeCheckpoint(checkpointId: string): AgentCheckpoint | null {
    this.cleanupTrigger(checkpointId);

    const db = getDb();
    const now = Date.now();
    db.query(
      "UPDATE agent_checkpoints SET state = 'resumed', resumed_at = ? WHERE id = ? AND state = 'sleeping'",
    ).run(now, checkpointId);

    const checkpoint = this.get(checkpointId);
    if (checkpoint) {
      const callback = this.wakeCallbacks.get(checkpointId);
      if (callback) {
        callback(checkpoint);
        this.wakeCallbacks.delete(checkpointId);
      }
    }
    return checkpoint;
  }

  private cleanupTrigger(checkpointId: string): void {
    const timer = this.timers.get(checkpointId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(checkpointId);
    }
    const watcher = this.watchers.get(checkpointId);
    if (watcher) {
      watcher.close();
      this.watchers.delete(checkpointId);
    }
  }

  private expireOldCheckpoints(): void {
    const db = getDb();
    const now = Date.now();
    const expired = db
      .query("SELECT id FROM agent_checkpoints WHERE state = 'sleeping' AND expires_at < ?")
      .all(now) as any[];

    for (const row of expired) {
      this.cleanupTrigger(row.id);
      db.query("UPDATE agent_checkpoints SET state = 'expired' WHERE id = ?").run(row.id);
    }
  }

  private rowToCheckpoint(row: any): AgentCheckpoint {
    return {
      id: row.id,
      agentId: row.agent_id,
      conversationId: row.conversation_id || undefined,
      stateJson: row.state_json,
      wakeCondition: JSON.parse(row.wake_condition_json),
      state: row.state,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      resumedAt: row.resumed_at || undefined,
      workspacePath: row.workspace_path,
      reason: row.reason || undefined,
    };
  }

  destroy(): void {
    if (this.expiryInterval) clearInterval(this.expiryInterval);
    for (const t of this.timers.values()) clearTimeout(t);
    for (const w of this.watchers.values()) w.close();
    this.timers.clear();
    this.watchers.clear();
  }
}

export const agentSleep = AgentSleepService.getInstance();
