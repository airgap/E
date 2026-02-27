import { nanoid } from 'nanoid';
import { getDb } from '../../../db/database';
import { claudeManager } from '../../claude-process';
import { runAllQualityChecks, ensureDependencies } from '../../quality-checker';
import { resolveWorkspacePath } from '../../worktree-service';
import type {
  GolemExecutor,
  ExecutionContext,
  ExecutionResult,
  ExecutorStatus,
  ExecutorCapabilities,
  ExecutionStatus,
  QualityCheckResult,
} from '@e/shared';

/**
 * Local worktree executor — runs stories on the local machine using
 * the existing worktree + Claude agent infrastructure.
 *
 * This is the first GolemExecutor implementation, wrapping the execution
 * logic that was previously inline in LoopRunner.run().
 */
export class LocalWorktreeExecutor implements GolemExecutor {
  readonly type = 'local-worktree';
  readonly name = 'Local Worktree';

  /** Track active executions for cancellation and status queries. */
  private activeExecutions = new Map<
    string,
    {
      cancelled: boolean;
      status: ExecutorStatus;
      sessionId: string | null;
      startedAt: number;
    }
  >();

  canExecute(context: ExecutionContext): boolean {
    // Local executor can handle any context where the repo is a local path
    // (not a remote URL like https:// or git://)
    return (
      !context.repoUrl.startsWith('https://') &&
      !context.repoUrl.startsWith('git://') &&
      !context.repoUrl.startsWith('ssh://')
    );
  }

  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const startTime = Date.now();
    const logs: string[] = [];
    const tag = `[local-executor:${context.executionId}]`;

    // Register this execution
    this.activeExecutions.set(context.executionId, {
      cancelled: false,
      status: {
        status: 'executing',
        executionId: context.executionId,
        message: 'Starting execution',
        progress: 0,
        timestamp: Date.now(),
      },
      sessionId: null,
      startedAt: startTime,
    });

    try {
      const log = (msg: string) => {
        logs.push(msg);
        console.log(`${tag} ${msg}`);
      };

      // Check for cancellation
      const isCancelled = () => this.activeExecutions.get(context.executionId)?.cancelled ?? false;

      // --- Step 1: Resolve CWD ---
      const storyCwd = resolveWorkspacePath(context.workspacePath, context.storyId);
      log(`Resolved CWD: ${storyCwd}`);

      if (isCancelled()) return this.cancelledResult(context, startTime, logs);

      // --- Step 2: Ensure dependencies in worktree ---
      if (storyCwd !== context.workspacePath) {
        log('Ensuring dependencies in worktree...');
        await ensureDependencies(storyCwd);
      }

      if (isCancelled()) return this.cancelledResult(context, startTime, logs);

      // --- Step 3: Create conversation ---
      this.updateExecutionStatus(context.executionId, 'executing', 'Creating conversation', 10);
      const conversationId = nanoid();
      const now = Date.now();
      const db = getDb();

      db.query(
        `INSERT INTO conversations (id, title, model, system_prompt, workspace_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        conversationId,
        `[Loop] ${context.storyTitle}`,
        context.llmConfig.model,
        context.systemPrompt || null,
        context.workspacePath,
        now,
        now,
      );

      log(`Created conversation: ${conversationId}`);

      // Add user message to conversation
      db.query(
        `INSERT INTO messages (id, conversation_id, role, content, timestamp)
         VALUES (?, ?, 'user', ?, ?)`,
      ).run(
        nanoid(),
        conversationId,
        JSON.stringify([{ type: 'text', text: context.prompt }]),
        now,
      );

      if (isCancelled()) return this.cancelledResult(context, startTime, logs, conversationId);

      // --- Step 4: Spawn Claude session ---
      this.updateExecutionStatus(context.executionId, 'executing', 'Spawning agent', 20);
      let agentResult = '';
      let agentError: string | null = null;
      let sessionId: string | null = null;
      const AGENT_TIMEOUT_MS = context.resourceConstraints.maxDurationMs;

      try {
        sessionId = await claudeManager.createSession(conversationId, {
          model: context.llmConfig.model,
          workspacePath: storyCwd,
          effort: context.llmConfig.effort,
          systemPrompt: context.systemPrompt,
        });

        // Track session for potential cancellation
        const execution = this.activeExecutions.get(context.executionId);
        if (execution) {
          execution.sessionId = sessionId;
        }

        log(`Spawned agent session: ${sessionId}`);

        // --- Step 5: Read stream with timeout ---
        this.updateExecutionStatus(context.executionId, 'executing', 'Agent implementing', 30);
        const stream = await claudeManager.sendMessage(sessionId, context.prompt);
        const reader = stream.getReader();

        const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), AGENT_TIMEOUT_MS),
        );
        let timedOut = false;

        while (true) {
          if (isCancelled()) {
            try {
              reader.cancel();
            } catch {
              /* best effort */
            }
            return this.cancelledResult(context, startTime, logs, conversationId, sessionId);
          }

          const result = await Promise.race([reader.read(), timeoutPromise]);
          if (result.done) {
            if (!result.value && agentResult.length === 0) {
              timedOut = true;
            }
            break;
          }
          agentResult += new TextDecoder().decode(result.value);
        }

        if (timedOut) {
          agentError = `Agent timed out after ${AGENT_TIMEOUT_MS / 1000}s with no output`;
          log(`Agent timeout for story ${context.storyId}`);
          try {
            reader.cancel();
          } catch {
            /* best effort */
          }
        }
      } catch (err) {
        agentError = String(err);
        log(`Agent error for story ${context.storyId}: ${agentError}`);
      }

      if (isCancelled()) {
        return this.cancelledResult(context, startTime, logs, conversationId, sessionId);
      }

      // --- Step 6: Run quality checks ---
      this.updateExecutionStatus(context.executionId, 'executing', 'Running quality checks', 70);
      let qualityResults: QualityCheckResult[] = [];
      const checksToRun = context.qualityChecks.filter((c) => c.enabled);

      if (checksToRun.length > 0) {
        log('Running quality checks...');
        qualityResults = await runAllQualityChecks(checksToRun, context.workspacePath, {
          storyId: context.storyId,
        });
        log(
          `Quality checks complete: ${qualityResults.filter((qr) => qr.passed).length}/${qualityResults.length} passed`,
        );
      }

      // --- Determine result status ---
      const requiredChecksFailed = qualityResults.some((qr) => {
        const checkConfig = checksToRun.find((c) => c.id === qr.checkId);
        return checkConfig?.required && !qr.passed;
      });
      const hasAgentError = !!agentError;

      let status: ExecutionStatus;
      if (hasAgentError && agentError?.includes('timed out')) {
        status = 'timeout';
      } else if (hasAgentError || requiredChecksFailed) {
        status = 'failure';
      } else {
        status = 'success';
      }

      this.updateExecutionStatus(context.executionId, 'idle', `Completed: ${status}`, 100);

      const duration = Date.now() - startTime;
      log(`Execution completed in ${duration}ms with status: ${status}`);

      return {
        status,
        branchName: null, // Branch management is handled by the runner/worktree service
        commitSha: null, // Committing is handled by the runner after result evaluation
        logs,
        duration,
        costMetadata: {
          model: context.llmConfig.model,
        },
        agentOutput: agentResult,
        agentError,
        qualityResults,
        conversationId,
        agentId: sessionId,
      };
    } finally {
      // Clean up execution tracking
      this.activeExecutions.delete(context.executionId);
    }
  }

  async cancel(executionId: string): Promise<void> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) return;

    execution.cancelled = true;
    execution.status = {
      status: 'idle',
      executionId,
      message: 'Cancelled',
      progress: null,
      timestamp: Date.now(),
    };

    console.log(`[local-executor] Cancelled execution: ${executionId}`);
  }

  getStatus(executionId?: string): ExecutorStatus {
    if (executionId) {
      const execution = this.activeExecutions.get(executionId);
      if (execution) {
        return execution.status;
      }
      return {
        status: 'idle',
        executionId,
        message: 'Execution not found or already completed',
        progress: null,
        timestamp: Date.now(),
      };
    }

    // Executor-level status
    const activeCount = this.activeExecutions.size;
    return {
      status: activeCount > 0 ? 'busy' : 'idle',
      executionId: null,
      message: activeCount > 0 ? `${activeCount} active execution(s)` : 'Ready',
      progress: null,
      timestamp: Date.now(),
    };
  }

  getCapabilities(): ExecutorCapabilities {
    return {
      supportsLocal: true,
      supportsRemote: false,
      supportsWorktrees: true,
      maxConcurrency: 1,
      supportedModels: [], // empty = all models supported
      supportsQualityChecks: true,
      supportsAutoCommit: true,
    };
  }

  // --- Private helpers ---

  private updateExecutionStatus(
    executionId: string,
    status: ExecutorStatus['status'],
    message: string,
    progress: number | null,
  ): void {
    const execution = this.activeExecutions.get(executionId);
    if (execution) {
      execution.status = {
        status,
        executionId,
        message,
        progress,
        timestamp: Date.now(),
      };
    }
  }

  private cancelledResult(
    context: ExecutionContext,
    startTime: number,
    logs: string[],
    conversationId: string | null = null,
    agentId: string | null = null,
  ): ExecutionResult {
    return {
      status: 'cancelled',
      branchName: null,
      commitSha: null,
      logs: [...logs, 'Execution cancelled'],
      duration: Date.now() - startTime,
      agentOutput: '',
      agentError: 'Execution was cancelled',
      qualityResults: [],
      conversationId,
      agentId,
    };
  }
}
