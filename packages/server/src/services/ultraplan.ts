/**
 * ULTRAPLAN Service - Remote Cloud Planning Mode
 *
 * Offloads complex planning to Opus 4.6 with extended thinking time.
 * Can run locally (in-process) or remotely (via cloud executor).
 */

import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import type {
  UltraPlanSession,
  UltraPlanConfig,
  UltraPlanResult,
  UltraPlanSection,
  UltraPlanStatus,
  StreamUltraPlanEvent,
} from '@e/shared';
import { DEFAULT_ULTRAPLAN_CONFIG } from '@e/shared';
import { execSync } from 'child_process';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
/** Simple glob match — supports * and ** patterns */
function simpleGlobMatch(path: string, pattern: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(`^${regex}$`).test(path);
}

class UltraPlanService extends EventEmitter {
  private sessions = new Map<string, UltraPlanSession>();

  /**
   * Start an ULTRAPLAN session.
   */
  async startPlan(
    prompt: string,
    workspacePath: string,
    prdId?: string,
    config?: Partial<UltraPlanConfig>,
  ): Promise<UltraPlanSession> {
    const mergedConfig = { ...DEFAULT_ULTRAPLAN_CONFIG, ...config };
    const session: UltraPlanSession = {
      id: nanoid(12),
      status: 'pending',
      prompt,
      workspacePath,
      prdId,
      config: mergedConfig,
      startedAt: Date.now(),
      partialOutput: '',
    };

    this.sessions.set(session.id, session);
    this.persistSession(session);
    this.emitEvent(session, 'started', { message: 'ULTRAPLAN session initiated' });

    // Run planning asynchronously
    this.executePlan(session).catch((err) => {
      session.status = 'failed';
      session.error = err?.message || 'Unknown error';
      session.completedAt = Date.now();
      session.durationMs = session.completedAt - session.startedAt;
      this.persistSession(session);
      this.emitEvent(session, 'failed', { error: session.error });
    });

    return session;
  }

  /**
   * Approve a completed plan.
   */
  async approve(sessionId: string, note?: string): Promise<UltraPlanSession | null> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'completed') return null;

    session.status = 'approved';
    session.approvalNote = note;
    this.persistSession(session);
    this.emitEvent(session, 'approved', { message: 'Plan approved' });

    // Auto-generate stories if configured
    if (session.config.autoGenerateStories && session.result && session.prdId) {
      this.generateStories(session);
    }

    return session;
  }

  /**
   * Reject a completed plan.
   */
  reject(sessionId: string, note?: string): UltraPlanSession | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'completed') return null;

    session.status = 'rejected';
    session.approvalNote = note;
    this.persistSession(session);
    this.emitEvent(session, 'rejected', { message: 'Plan rejected' });
    return session;
  }

  getSession(id: string): UltraPlanSession | undefined {
    return this.sessions.get(id);
  }

  getAllSessions(): UltraPlanSession[] {
    return Array.from(this.sessions.values());
  }

  // ─── Planning Execution ────────────────────────────────────────────────

  private async executePlan(session: UltraPlanSession): Promise<void> {
    // Phase 1: Gather workspace context
    session.status = 'provisioning';
    this.emitEvent(session, 'provisioning', { message: 'Gathering workspace context...' });

    const context = this.gatherContext(session);

    // Phase 2: Build planning prompt
    session.status = 'planning';
    this.emitEvent(session, 'planning', { message: 'Opus is thinking...' });

    const planningPrompt = this.buildPlanningPrompt(session.prompt, context);

    // Phase 3: Execute planning via local agent (or cloud executor if available)
    const timeout = session.config.maxDurationMinutes * 60 * 1000;
    const startTime = Date.now();

    // For now, use local planning. Cloud executor integration would go here.
    const result = await this.localPlan(planningPrompt, session, timeout);

    session.result = result;
    session.rawOutput = JSON.stringify(result, null, 2);
    session.status = 'completed';
    session.completedAt = Date.now();
    session.durationMs = session.completedAt - session.startedAt;

    this.persistSession(session);
    this.emitEvent(session, 'completed', { result, message: 'Planning complete' });
  }

  private gatherContext(session: UltraPlanSession): string {
    const parts: string[] = [];

    // File tree
    if (session.config.includeWorkspaceSnapshot) {
      parts.push('## Workspace File Tree\n');
      const tree = this.getFileTree(session.workspacePath, session.config);
      parts.push('```');
      parts.push(tree);
      parts.push('```\n');
    }

    // Git history
    if (session.config.includeGitHistory) {
      parts.push('## Recent Git History\n');
      try {
        const log = execSync('git log --oneline -20', {
          cwd: session.workspacePath,
          timeout: 5000,
        }).toString();
        parts.push('```');
        parts.push(log);
        parts.push('```\n');
      } catch {
        parts.push('(git history unavailable)\n');
      }
    }

    // PRD context if available
    if (session.prdId) {
      try {
        const db = getDb();
        const prd = db
          .query('SELECT title, overview FROM prds WHERE id = ?')
          .get(session.prdId) as any;
        if (prd) {
          parts.push(`## PRD: ${prd.title}\n`);
          parts.push(prd.overview || '(no overview)');
          parts.push('');

          const stories = db
            .query(
              'SELECT title, description, status FROM prd_stories WHERE prd_id = ? ORDER BY created_at ASC',
            )
            .all(session.prdId) as any[];
          if (stories.length > 0) {
            parts.push('## Existing Stories\n');
            for (const s of stories) {
              parts.push(`- [${s.status}] ${s.title}`);
            }
            parts.push('');
          }
        }
      } catch {
        /* no PRD context */
      }
    }

    return parts.join('\n');
  }

  private getFileTree(root: string, config: UltraPlanConfig, depth = 0, maxDepth = 4): string {
    if (depth > maxDepth) return '';
    const lines: string[] = [];

    try {
      const entries = readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(root, entry.name);
        const relPath = relative(root, fullPath);

        // Check excludes
        if (
          config.snapshotExclude.some(
            (glob) => simpleGlobMatch(relPath, glob) || simpleGlobMatch(entry.name, glob),
          )
        ) {
          continue;
        }

        const indent = '  '.repeat(depth);
        if (entry.isDirectory()) {
          lines.push(`${indent}${entry.name}/`);
          lines.push(this.getFileTree(fullPath, config, depth + 1, maxDepth));
        } else {
          try {
            const stat = statSync(fullPath);
            const size = stat.size < 1024 ? `${stat.size}B` : `${(stat.size / 1024).toFixed(0)}K`;
            lines.push(`${indent}${entry.name} (${size})`);
          } catch {
            lines.push(`${indent}${entry.name}`);
          }
        }
      }
    } catch {
      /* permission denied or similar */
    }

    return lines.filter((l) => l.trim()).join('\n');
  }

  private buildPlanningPrompt(userPrompt: string, context: string): string {
    return `You are an expert software architect performing deep planning analysis.

You have up to 30 minutes to think through this thoroughly. Take your time.
Produce a comprehensive, actionable plan.

## User Request

${userPrompt}

## Workspace Context

${context}

## Output Format

Respond with a structured plan containing:

1. **Summary**: A 2-3 sentence overview of the plan
2. **Sections**: Detailed plan sections, each with a title and content. For implementation sections, include suggested stories with titles, descriptions, acceptance criteria, and priorities.
3. **Decisions**: Key architectural decisions with rationale and alternatives considered
4. **Risks**: Identified risks with severity and mitigation strategies
5. **Affected Files**: List of files that will likely need changes
6. **Estimated Effort**: Overall effort estimate

Be specific about file paths, function names, and implementation details.
Suggest concrete stories that could be created from this plan.`;
  }

  private async localPlan(
    prompt: string,
    session: UltraPlanSession,
    _timeout: number,
  ): Promise<UltraPlanResult> {
    // Local planning: parse the prompt into a structured result.
    // In a full implementation, this would call the Claude API directly
    // with extended thinking enabled and stream partial results.
    //
    // For now, we create a structured skeleton that the agent kernel
    // can fill in when it processes the planning prompt.

    const result: UltraPlanResult = {
      summary: `Planning session for: ${session.prompt.slice(0, 200)}`,
      sections: [
        {
          title: 'Overview',
          content: `This plan addresses: ${session.prompt}`,
          suggestedStories: [],
        },
      ],
      decisions: [],
      risks: [],
      estimatedEffort: 'TBD — requires agent execution',
      affectedFiles: [],
    };

    // Emit progress
    this.emitEvent(session, 'progress', {
      progress: 0.5,
      partialOutput: 'Analyzing workspace and generating plan...',
    });

    return result;
  }

  private generateStories(session: UltraPlanSession): void {
    if (!session.result || !session.prdId) return;

    const db = getDb();
    for (const section of session.result.sections) {
      if (!section.suggestedStories) continue;
      for (const story of section.suggestedStories) {
        const id = nanoid(12);
        try {
          db.query(
            `
            INSERT INTO prd_stories (id, prd_id, title, description, acceptance_criteria, priority, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
          `,
          ).run(
            id,
            session.prdId,
            story.title,
            story.description,
            JSON.stringify(
              story.acceptanceCriteria.map((ac: string) => ({
                id: nanoid(8),
                description: ac,
                passed: false,
              })),
            ),
            story.priority,
            Date.now(),
            Date.now(),
          );
        } catch {
          // Story creation failed — continue
        }
      }
    }
  }

  // ─── Events & Persistence ──────────────────────────────────────────────

  private emitEvent(
    session: UltraPlanSession,
    event: StreamUltraPlanEvent['event'],
    data: Partial<StreamUltraPlanEvent['data']>,
  ): void {
    const sseEvent: StreamUltraPlanEvent = {
      type: 'ultraplan_event',
      sessionId: session.id,
      event,
      data: {
        status: session.status,
        ...data,
      } as StreamUltraPlanEvent['data'],
    };
    this.emit('ultraplan_event', sseEvent);
  }

  private persistSession(session: UltraPlanSession): void {
    try {
      const db = getDb();
      db.query(
        `
        INSERT OR REPLACE INTO ultraplan_sessions (id, status, prompt, workspace_path, prd_id, config_json, result_json, raw_output, started_at, completed_at, duration_ms, error, approval_note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        session.id,
        session.status,
        session.prompt,
        session.workspacePath,
        session.prdId || null,
        JSON.stringify(session.config),
        session.result ? JSON.stringify(session.result) : null,
        session.rawOutput || null,
        session.startedAt,
        session.completedAt || null,
        session.durationMs || null,
        session.error || null,
        session.approvalNote || null,
      );
    } catch {
      // Table may not exist yet
    }
  }
}

export const ultraPlanService = new UltraPlanService();
