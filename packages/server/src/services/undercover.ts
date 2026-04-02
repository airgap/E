/**
 * Undercover Mode Service
 *
 * Detects public repositories and scrubs internal references
 * from commits, PRs, and agent output.
 */

import { EventEmitter } from 'events';
import { execSync } from 'child_process';
import { nanoid } from 'nanoid';
import type { UndercoverState, UndercoverConfig, UndercoverWarning } from '@e/shared';
import {
  DEFAULT_UNDERCOVER_CONFIG,
  isLikelyPublicRemote,
  scrubInternalReferences,
  parseRemoteUrl,
} from '@e/shared';

class UndercoverService extends EventEmitter {
  private states = new Map<string, UndercoverState>();
  private config: UndercoverConfig = DEFAULT_UNDERCOVER_CONFIG;

  setConfig(config: Partial<UndercoverConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check a workspace and activate undercover mode if needed.
   * Called on workspace open and before commits/PRs.
   */
  check(workspacePath: string): UndercoverState {
    const existing = this.states.get(workspacePath);
    if (existing) return existing;

    const state: UndercoverState = {
      active: false,
      scrubbedCount: 0,
      warnings: [],
    };

    if (!this.config.autoDetect) {
      this.states.set(workspacePath, state);
      return state;
    }

    // Detect git remotes
    try {
      const remotes = execSync('git remote -v', {
        cwd: workspacePath,
        timeout: 5000,
      })
        .toString()
        .trim()
        .split('\n');

      for (const line of remotes) {
        const parts = line.split(/\s+/);
        if (parts.length < 2) continue;
        const url = parts[1];

        if (isLikelyPublicRemote(url)) {
          state.active = true;
          state.trigger = 'git_remote';
          state.detectedRemote = url;
          state.repoVisibility = 'public'; // heuristic; could be private on GH

          // Try to verify via gh CLI
          const parsed = parseRemoteUrl(url);
          if (parsed && parsed.host === 'github.com') {
            try {
              const visibility = execSync(
                `gh repo view ${parsed.repo} --json visibility -q '.visibility'`,
                { cwd: workspacePath, timeout: 5000 },
              )
                .toString()
                .trim()
                .toLowerCase();
              state.repoVisibility = visibility === 'public' ? 'public' : 'private';
              // Only activate for actually public repos
              if (visibility !== 'public') {
                state.active = false;
              }
            } catch {
              // gh CLI not available or auth failed — keep heuristic
            }
          }
          break;
        }
      }
    } catch {
      // Not a git repo or git not available
    }

    this.states.set(workspacePath, state);

    if (state.active) {
      this.emit('undercover_activated', {
        workspacePath,
        remote: state.detectedRemote,
        visibility: state.repoVisibility,
      });
    }

    return state;
  }

  /**
   * Manually activate undercover mode for a workspace.
   */
  activate(workspacePath: string): UndercoverState {
    const state = this.states.get(workspacePath) || {
      active: false,
      scrubbedCount: 0,
      warnings: [],
    };
    state.active = true;
    state.trigger = 'manual';
    this.states.set(workspacePath, state);
    return state;
  }

  /**
   * Deactivate undercover mode for a workspace.
   */
  deactivate(workspacePath: string): UndercoverState {
    const state = this.states.get(workspacePath) || {
      active: false,
      scrubbedCount: 0,
      warnings: [],
    };
    state.active = false;
    this.states.set(workspacePath, state);
    return state;
  }

  /**
   * Scrub text of internal references. Returns scrubbed text.
   * Only scrubs if undercover mode is active for the workspace.
   */
  scrub(workspacePath: string, text: string): string {
    const state = this.states.get(workspacePath);
    if (!state?.active) return text;

    const { scrubbed, matchCount } = scrubInternalReferences(text, this.config);
    state.scrubbedCount += matchCount;
    return scrubbed;
  }

  /**
   * Check text before a commit and issue a warning if internal refs detected.
   */
  checkCommitMessage(workspacePath: string, message: string): UndercoverWarning | null {
    const state = this.states.get(workspacePath);
    if (!state?.active || !this.config.warnOnCommit) return null;

    const { matchCount } = scrubInternalReferences(message, this.config);
    if (matchCount === 0) return null;

    const warning: UndercoverWarning = {
      id: nanoid(8),
      timestamp: Date.now(),
      type: 'commit',
      message: `Commit message contains ${matchCount} potentially internal reference(s) in a public repository`,
      context: message.slice(0, 100),
      dismissed: false,
    };

    state.warnings.push(warning);
    this.emit('undercover_warning', { workspacePath, warning });
    return warning;
  }

  /**
   * Check text before a PR and issue a warning if internal refs detected.
   */
  checkPRContent(workspacePath: string, title: string, body: string): UndercoverWarning | null {
    const state = this.states.get(workspacePath);
    if (!state?.active || !this.config.warnOnPR) return null;

    const combined = `${title}\n${body}`;
    const { matchCount } = scrubInternalReferences(combined, this.config);
    if (matchCount === 0) return null;

    const warning: UndercoverWarning = {
      id: nanoid(8),
      timestamp: Date.now(),
      type: 'pr',
      message: `PR content contains ${matchCount} potentially internal reference(s) in a public repository`,
      context: title,
      dismissed: false,
    };

    state.warnings.push(warning);
    this.emit('undercover_warning', { workspacePath, warning });
    return warning;
  }

  /**
   * Dismiss a warning.
   */
  dismissWarning(workspacePath: string, warningId: string): void {
    const state = this.states.get(workspacePath);
    if (!state) return;

    const warning = state.warnings.find((w) => w.id === warningId);
    if (warning) warning.dismissed = true;
  }

  getState(workspacePath: string): UndercoverState {
    return (
      this.states.get(workspacePath) || {
        active: false,
        scrubbedCount: 0,
        warnings: [],
      }
    );
  }

  isActive(workspacePath: string): boolean {
    return this.states.get(workspacePath)?.active || false;
  }
}

export const undercoverService = new UndercoverService();
