// ---------------------------------------------------------------------------
// Golem Runner — core execution logic for headless golem runs
// ---------------------------------------------------------------------------
// Orchestrates the full lifecycle: clone → install → agent → checks → commit → push → report
// ---------------------------------------------------------------------------

import { mkdtemp, rm, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import type {
  GolemSpec,
  GolemRunStatus,
  GolemRunPhase,
  GolemExitCodeValue,
  QualityCheckConfig,
  QualityCheckResult,
  StoryResultReport,
} from '@e/shared';
import { GolemExitCode, GOLEM_DEFAULTS } from '@e/shared';
import { GolemLogger } from './logger.js';
import { GolemHealthServer } from './health.js';
import { CoordinatorClient } from './coordinator-client.js';
import {
  shallowClone,
  createBranch,
  commitChanges,
  pushBranch,
  configureGitUser,
  hasChanges,
} from './git-ops.js';

/**
 * Result of a golem run.
 */
export interface GolemRunResult {
  exitCode: GolemExitCodeValue;
  branchName: string | null;
  commitSha: string | null;
  qualityResults: QualityCheckResult[];
  agentOutput: string;
  error: string | null;
  duration: number;
}

/**
 * Headless golem runner — drives a single story execution end-to-end.
 */
export class GolemRunner {
  private spec: GolemSpec;
  private logger: GolemLogger;
  private healthServer: GolemHealthServer | null = null;
  private coordinator: CoordinatorClient | null = null;
  private phase: GolemRunPhase = 'initializing';
  private startTime = Date.now();
  private workDir = '';
  private branchName: string;
  private commitSha: string | null = null;
  private qualityResults: QualityCheckResult[] = [];
  private agentOutput = '';
  private cancelled = false;
  private active = true;
  private logLines: string[] = [];

  constructor(spec: GolemSpec) {
    this.spec = spec;
    this.branchName = `${GOLEM_DEFAULTS.branchPrefix}${spec.story.storyId}`;

    // Resolve executor ID
    if (!spec.executorId) {
      spec.executorId = `golem-${crypto.randomUUID().slice(0, 8)}`;
    }

    // Resolve machine ID
    if (!spec.machineId) {
      spec.machineId = this.getHostname();
    }

    this.logger = new GolemLogger(spec.executorId, spec.story.storyId);
  }

  /**
   * Run the full golem execution lifecycle.
   * Returns an exit code reflecting the result.
   */
  async run(): Promise<GolemRunResult> {
    const startTime = Date.now();

    try {
      // --- Initialize ---
      this.setPhase('initializing');
      this.logger.info('init', 'Headless golem starting', {
        storyId: this.spec.story.storyId,
        repoUrl: this.spec.repoUrl,
        branch: this.spec.branch,
        model: this.spec.llm.model,
        executorId: this.spec.executorId,
        machineId: this.spec.machineId,
      });

      // Connect WebSocket for log streaming if configured
      if (this.spec.logStreamUrl) {
        this.logger.connectWebSocket(this.spec.logStreamUrl);
      }

      // Start health check server
      const healthPort = this.spec.healthPort ?? GOLEM_DEFAULTS.healthPort;
      if (healthPort > 0) {
        this.healthServer = new GolemHealthServer(() => this.getStatus());
        const actualPort = this.healthServer.start(healthPort);
        this.logger.info('init', `Health server listening on port ${actualPort}`);
      }

      // Initialize coordinator client if URL provided
      if (this.spec.coordinatorUrl) {
        this.coordinator = new CoordinatorClient(this.spec.coordinatorUrl, this.logger);
      }

      // --- Claim story from coordinator (if connected) ---
      if (this.coordinator) {
        await this.claimStory();
      }

      // --- Clone repository ---
      this.setPhase('cloning');
      this.workDir = this.spec.workDir || (await mkdtemp(join(tmpdir(), 'golem-')));
      const cloneTarget = this.spec.workDir ? this.workDir : join(this.workDir, 'repo');
      if (!this.spec.workDir) {
        await shallowClone(this.spec.repoUrl, this.spec.branch, cloneTarget, this.logger);
        this.workDir = cloneTarget;
      }

      if (this.cancelled) return this.cancelledResult(startTime);

      // Configure git user for commits
      await configureGitUser(this.workDir);

      // Create result branch
      await createBranch(this.workDir, this.branchName, this.logger);

      // --- Install dependencies ---
      this.setPhase('installing');
      await this.installDependencies();

      if (this.cancelled) return this.cancelledResult(startTime);

      // --- Start heartbeat ---
      if (this.coordinator) {
        this.coordinator.startHeartbeat(
          this.spec.story.storyId,
          this.spec.executorId!,
          GOLEM_DEFAULTS.heartbeatIntervalMs,
        );
      }

      // --- Run agent loop ---
      this.setPhase('running_agent');
      const timeoutMs = this.spec.timeoutMs ?? GOLEM_DEFAULTS.timeoutMs;
      const agentResult = await this.runAgent(timeoutMs);

      if (this.cancelled) return this.cancelledResult(startTime);

      if (agentResult.timedOut) {
        // Handle timeout — commit WIP and report
        this.logger.warn('agent', 'Agent timed out');
        await this.commitWipAndPush(startTime, 'timeout');
        return {
          exitCode: GolemExitCode.TIMEOUT,
          branchName: this.branchName,
          commitSha: this.commitSha,
          qualityResults: [],
          agentOutput: agentResult.output,
          error: `Agent timed out after ${timeoutMs}ms`,
          duration: Date.now() - startTime,
        };
      }

      if (agentResult.error) {
        this.logger.error('agent', `Agent error: ${agentResult.error}`);
      }

      // --- Run quality checks ---
      this.setPhase('running_checks');

      // Stage all changes before quality checks to ensure Nx cache is invalidated
      if (await hasChanges(this.workDir)) {
        this.logger.info('quality_check', 'Staging all changes before quality checks');
        try {
          await Bun.spawn(['git', 'add', '-A'], { cwd: this.workDir, stdout: 'ignore', stderr: 'pipe' }).exited;
        } catch (err) {
          this.logger.warn('quality_check', `Failed to stage changes: ${String(err)}`);
        }
      }

      const checks = this.spec.qualityChecks?.filter((c) => c.enabled) ?? [];
      if (checks.length > 0) {
        this.qualityResults = await this.runQualityChecks(checks);
      }

      // Determine outcome
      const requiredChecksFailed = this.qualityResults.some((qr) => {
        const checkConfig = checks.find((c) => c.id === qr.checkId);
        return checkConfig?.required && !qr.passed;
      });

      const hasError = !!agentResult.error;
      let exitCode: GolemExitCodeValue;
      let resultStatus: StoryResultReport['status'];

      if (hasError && agentResult.error?.includes('timed out')) {
        exitCode = GolemExitCode.TIMEOUT;
        resultStatus = 'timeout';
      } else if (hasError || requiredChecksFailed) {
        exitCode = GolemExitCode.STORY_FAILURE;
        resultStatus = 'failure';
      } else {
        exitCode = GolemExitCode.SUCCESS;
        resultStatus = 'success';
      }

      // --- Commit and push ---
      const autoCommit = this.spec.autoCommit !== false;
      const autoPush = this.spec.autoPush !== false;

      if (autoCommit && (await hasChanges(this.workDir))) {
        this.setPhase('committing');
        const msg =
          exitCode === GolemExitCode.SUCCESS
            ? `feat: implement ${this.spec.story.title}\n\nStory: ${this.spec.story.storyId}\nGolem: ${this.spec.executorId}`
            : `wip: partial implementation of ${this.spec.story.title}\n\nStory: ${this.spec.story.storyId}\nGolem: ${this.spec.executorId}\nStatus: ${resultStatus}`;

        this.commitSha = await commitChanges(this.workDir, msg, this.logger);
      }

      if (autoPush && this.commitSha) {
        this.setPhase('pushing');
        try {
          await pushBranch(this.workDir, this.branchName, this.logger, true);
        } catch (err) {
          this.logger.error('push', `Push failed: ${String(err)}`);
          // Push failure is not fatal — the work is still committed locally
        }
      }

      // --- Report result to coordinator ---
      this.setPhase('reporting');
      if (this.coordinator) {
        await this.reportResult(resultStatus, agentResult.output, agentResult.error);
      }

      // --- Done ---
      this.setPhase(exitCode === GolemExitCode.SUCCESS ? 'completed' : 'failed');
      this.active = false;

      const passedCount = this.qualityResults.filter((qr) => qr.passed).length;
      this.logger.info('report', `Execution complete: ${resultStatus}`, {
        exitCode,
        duration: Date.now() - startTime,
        qualityChecks: `${passedCount}/${this.qualityResults.length} passed`,
        branchName: this.branchName,
        commitSha: this.commitSha,
      });

      return {
        exitCode,
        branchName: this.branchName,
        commitSha: this.commitSha,
        qualityResults: this.qualityResults,
        agentOutput: agentResult.output,
        error: agentResult.error,
        duration: Date.now() - startTime,
      };
    } catch (err) {
      // Infrastructure failure
      const errMsg = String(err);
      this.logger.fatal(this.phase as any, `Infrastructure failure: ${errMsg}`);
      this.active = false;
      this.setPhase('failed');

      // Try to report failure to coordinator
      if (this.coordinator) {
        try {
          await this.reportResult('failure', '', errMsg);
        } catch {
          // Best effort
        }
      }

      return {
        exitCode: GolemExitCode.INFRA_FAILURE,
        branchName: null,
        commitSha: null,
        qualityResults: [],
        agentOutput: '',
        error: errMsg,
        duration: Date.now() - startTime,
      };
    } finally {
      this.cleanup();
    }
  }

  /**
   * Handle graceful shutdown (SIGTERM).
   * Commits work-in-progress, pushes partial branch, reports cancellation.
   */
  async shutdown(): Promise<void> {
    if (this.cancelled) return;
    this.cancelled = true;
    this.logger.info('shutdown', 'Graceful shutdown initiated (SIGTERM)');

    try {
      await this.commitWipAndPush(this.startTime, 'cancelled');
    } catch (err) {
      this.logger.error('shutdown', `Shutdown cleanup failed: ${String(err)}`);
    }

    this.active = false;
    this.setPhase('cancelled');
  }

  /**
   * Get the current run status.
   */
  getStatus(): GolemRunStatus {
    return {
      phase: this.phase,
      storyId: this.spec.story.storyId,
      executorId: this.spec.executorId!,
      startedAt: new Date(this.startTime).toISOString(),
      elapsedMs: Date.now() - this.startTime,
      qualityResults: this.qualityResults,
      active: this.active,
      branchName: this.branchName,
      commitSha: this.commitSha ?? undefined,
      error: undefined,
    };
  }

  // --- Private methods ---

  private setPhase(phase: GolemRunPhase): void {
    this.phase = phase;
  }

  private getHostname(): string {
    try {
      const proc = Bun.spawnSync(['hostname'], { stdout: 'pipe', stderr: 'pipe' });
      return proc.stdout.toString().trim() || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Claim a story from the coordinator.
   */
  private async claimStory(): Promise<void> {
    if (!this.coordinator) return;

    this.logger.info('init', 'Claiming story from coordinator', {
      storyId: this.spec.story.storyId,
      coordinatorUrl: this.spec.coordinatorUrl,
    });

    const result = await this.coordinator.claimStory({
      storyId: this.spec.story.storyId,
      executorId: this.spec.executorId!,
      executorType: 'headless-golem',
      machineId: this.spec.machineId!,
      assignedBranch: this.branchName,
    });

    if (!result.claimed) {
      throw new Error(`Failed to claim story: ${result.reason}`);
    }

    this.logger.info('init', 'Story claimed successfully', {
      leaseExpiresAt: result.leaseExpiresAt,
    });
  }

  /**
   * Install dependencies in the working directory.
   */
  private async installDependencies(): Promise<void> {
    const packageJsonPath = join(this.workDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      this.logger.info('install', 'No package.json found, skipping dependency installation');
      return;
    }

    const nodeModulesPath = join(this.workDir, 'node_modules');
    if (existsSync(nodeModulesPath)) {
      this.logger.info('install', 'node_modules already exists, skipping install');
      return;
    }

    this.logger.info('install', 'Installing dependencies...');

    // Detect package manager
    const hasLockBun =
      existsSync(join(this.workDir, 'bun.lock')) || existsSync(join(this.workDir, 'bun.lockb'));
    const hasLockNpm = existsSync(join(this.workDir, 'package-lock.json'));
    const hasLockYarn = existsSync(join(this.workDir, 'yarn.lock'));
    const hasLockPnpm = existsSync(join(this.workDir, 'pnpm-lock.yaml'));

    let cmd: string[];
    if (hasLockBun) {
      cmd = ['bun', 'install', '--frozen-lockfile'];
    } else if (hasLockPnpm) {
      cmd = ['pnpm', 'install', '--frozen-lockfile'];
    } else if (hasLockYarn) {
      cmd = ['yarn', 'install', '--frozen-lockfile'];
    } else if (hasLockNpm) {
      cmd = ['npm', 'ci'];
    } else {
      cmd = ['bun', 'install'];
    }

    const proc = Bun.spawn(cmd, {
      cwd: this.workDir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      const output = (stdout + '\n' + stderr).trim();
      this.logger.error(
        'install',
        `Dependency installation failed (exit ${exitCode}): ${output.slice(0, 1000)}`,
      );
      throw new Error(`Dependency installation failed: ${output.slice(0, 500)}`);
    }

    this.logger.info('install', 'Dependencies installed successfully');
  }

  /**
   * Run the agent to implement the story using a proper tool-use agentic loop.
   * The agent can read/write files, run bash commands, and search the codebase.
   */
  private async runAgent(
    timeoutMs: number,
  ): Promise<{ output: string; error: string | null; timedOut: boolean }> {
    const prompt = this.buildPrompt();
    const model = this.spec.llm.model || GOLEM_DEFAULTS.model;
    const systemPrompt = this.spec.llm.systemPrompt || this.buildSystemPrompt();

    this.logger.info('agent', 'Starting agent execution', {
      model,
      timeoutMs,
      promptLength: prompt.length,
    });

    // Resolve API key — spec > env var > Claude Code OAuth credentials file
    let apiKey = this.spec.llm.apiKey || process.env.ANTHROPIC_API_KEY;
    let authToken: string | undefined;

    if (!apiKey) {
      try {
        const { readFileSync } = await import('fs');
        const { join: pathJoin } = await import('path');
        const { homedir: getHome } = await import('os');
        const credPath = pathJoin(getHome(), '.claude', '.credentials.json');
        const creds = JSON.parse(readFileSync(credPath, 'utf-8'));
        authToken = creds?.claudeAiOauth?.accessToken;
        if (!authToken) throw new Error('no token in credentials file');
        this.logger.info('agent', 'Using Claude Code OAuth credentials');
      } catch {
        throw new Error(
          'No Anthropic API key found. Set ANTHROPIC_API_KEY env var or provide llm.apiKey in spec.',
        );
      }
    }

    // Build Anthropic client
    const clientOpts: ConstructorParameters<typeof Anthropic>[0] = {};
    if (apiKey) clientOpts.apiKey = apiKey;
    if (authToken) clientOpts.authToken = authToken;
    if (process.env.ANTHROPIC_API_URL) clientOpts.baseURL = process.env.ANTHROPIC_API_URL;
    const client = new Anthropic(clientOpts);

    // Conversation history
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];

    let output = '';
    let timedOut = false;
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const maxTurns = Number(process.env.GOLEM_MAX_TURNS || '50');
      let turnCount = 0;

      while (turnCount < maxTurns) {
        if (this.cancelled) break;
        if (Date.now() - startTime > timeoutMs) {
          timedOut = true;
          break;
        }

        turnCount++;
        this.logger.debug('agent', `Agent turn ${turnCount}/${maxTurns}`);

        const response = await client.messages.create(
          {
            model,
            max_tokens: 8192,
            system: systemPrompt,
            tools: this.buildAgentTools(),
            messages,
          },
          { signal: controller.signal },
        );

        // Append assistant response to history
        messages.push({ role: 'assistant', content: response.content });

        // Collect text output from this turn
        const textBlocks = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        if (textBlocks) {
          output = textBlocks; // keep last assistant text as the final output
          this.logger.debug('agent', textBlocks.slice(0, 500));
        }

        // Done when the model stops calling tools
        if (response.stop_reason === 'end_turn') break;

        // Execute tool calls
        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        if (toolUseBlocks.length === 0) break;

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const toolBlock of toolUseBlocks) {
          this.logger.info('agent', `Tool: ${toolBlock.name}`, {
            input: JSON.stringify(toolBlock.input).slice(0, 200),
          });

          try {
            const result = await this.executeAgentTool(
              toolBlock.name,
              toolBlock.input as Record<string, unknown>,
            );
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolBlock.id,
              content: result,
            });
          } catch (err) {
            this.logger.warn('agent', `Tool error (${toolBlock.name}): ${String(err)}`);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolBlock.id,
              content: `Error: ${String(err)}`,
              is_error: true,
            });
          }
        }

        messages.push({ role: 'user', content: toolResults });
      }

      if (timedOut) {
        return { output, error: `Agent timed out after ${timeoutMs}ms`, timedOut: true };
      }
      if (this.cancelled) {
        return { output, error: 'Execution cancelled', timedOut: false };
      }

      this.agentOutput = output;
      this.logger.info('agent', 'Agent execution completed', {
        outputLength: output.length,
        turns: turnCount,
      });
      return { output, error: null, timedOut: false };
    } catch (err) {
      if (timedOut || (err instanceof Error && err.name === 'AbortError')) {
        return {
          output: this.agentOutput,
          error: `Agent timed out after ${timeoutMs}ms`,
          timedOut: true,
        };
      }
      return { output: '', error: String(err), timedOut: false };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Build the tool definitions for the agent's tool-use loop.
   * These give the agent file read/write, bash execution, and search capabilities.
   */
  private buildAgentTools(): Anthropic.Tool[] {
    return [
      {
        name: 'view_file',
        description:
          'Read the contents of a file. Use this to understand existing code before making changes. Returns content with line numbers.',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'File path relative to the repo root' },
            start_line: {
              type: 'number',
              description: 'Starting line number (1-indexed, optional)',
            },
            end_line: { type: 'number', description: 'Ending line number (optional)' },
          },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: 'Create a new file or completely overwrite an existing file with new content.',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'File path relative to the repo root' },
            content: { type: 'string', description: 'Full content to write to the file' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'edit_file',
        description:
          'Make a targeted replacement in an existing file. The old_text must match exactly (including whitespace and indentation). Use view_file first to see the exact text.',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'File path relative to the repo root' },
            old_text: {
              type: 'string',
              description: 'Exact text to replace (must appear exactly once in the file)',
            },
            new_text: { type: 'string', description: 'Replacement text' },
          },
          required: ['path', 'old_text', 'new_text'],
        },
      },
      {
        name: 'run_bash',
        description:
          'Execute a shell command in the repo root directory. Use for running builds, tests, git commands, installing packages, etc. Returns stdout + stderr and exit code.',
        input_schema: {
          type: 'object' as const,
          properties: {
            command: { type: 'string', description: 'Shell command to execute' },
            timeout_ms: {
              type: 'number',
              description: 'Timeout in milliseconds (default: 60000)',
            },
          },
          required: ['command'],
        },
      },
      {
        name: 'list_directory',
        description: 'List files and directories at a given path.',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: {
              type: 'string',
              description: 'Directory path relative to repo root (default: ".")',
            },
          },
          required: [],
        },
      },
      {
        name: 'search_text',
        description:
          'Search for a text pattern in files (like grep -r). Returns matching lines with file paths and line numbers.',
        input_schema: {
          type: 'object' as const,
          properties: {
            pattern: { type: 'string', description: 'Text or regex pattern to search for' },
            path: {
              type: 'string',
              description: 'File or directory to search in (default: repo root)',
            },
            case_insensitive: {
              type: 'boolean',
              description: 'Case-insensitive search (default: false)',
            },
          },
          required: ['pattern'],
        },
      },
      {
        name: 'find_files',
        description:
          'Find files matching a glob pattern. Skips node_modules, .git, and dist by default.',
        input_schema: {
          type: 'object' as const,
          properties: {
            pattern: {
              type: 'string',
              description: 'Glob pattern (e.g. "**/*.ts", "src/**/*.svelte", "*.json")',
            },
            directory: {
              type: 'string',
              description: 'Base directory relative to repo root (default: ".")',
            },
          },
          required: ['pattern'],
        },
      },
      {
        name: 'ask_human',
        description:
          'Ask the human user for clarification or guidance when you are genuinely blocked and cannot make reasonable progress without their input. Use sparingly — only when truly necessary. Execution pauses until the user responds (up to 30 minutes). Do NOT use this for minor ambiguity; make a reasonable decision instead.',
        input_schema: {
          type: 'object' as const,
          properties: {
            question: {
              type: 'string',
              description: 'The specific question to ask. Be precise and concise.',
            },
            context: {
              type: 'string',
              description:
                'Optional background context to help the user understand the situation and answer effectively.',
            },
          },
          required: ['question'],
        },
      },
    ];
  }

  /**
   * Execute a single agent tool call.
   * All file paths are resolved relative to workDir and validated for traversal.
   */
  private async executeAgentTool(name: string, input: Record<string, unknown>): Promise<string> {
    // Resolve a path relative to workDir, blocking traversal outside it
    const resolveSafe = (p: string): string => {
      const abs = resolve(this.workDir, p);
      if (!abs.startsWith(this.workDir + '/') && abs !== this.workDir) {
        throw new Error(`Path traversal blocked: '${p}' resolves outside repo root`);
      }
      return abs;
    };

    switch (name) {
      // ------------------------------------------------------------------
      // view_file — read a file with optional line range
      // ------------------------------------------------------------------
      case 'view_file': {
        const filePath = resolveSafe(String(input.path));
        const raw = await Bun.file(filePath).text();
        const lines = raw.split('\n');
        const start = input.start_line ? Number(input.start_line) - 1 : 0;
        const end = input.end_line ? Number(input.end_line) : lines.length;
        return lines
          .slice(start, end)
          .map((l, i) => `${start + i + 1}\t${l}`)
          .join('\n');
      }

      // ------------------------------------------------------------------
      // write_file — create/overwrite a file
      // ------------------------------------------------------------------
      case 'write_file': {
        const filePath = resolveSafe(String(input.path));
        const content = String(input.content ?? '');
        await Bun.write(filePath, content);
        return `Written: ${input.path} (${content.length} bytes)`;
      }

      // ------------------------------------------------------------------
      // edit_file — targeted string replacement
      // ------------------------------------------------------------------
      case 'edit_file': {
        const filePath = resolveSafe(String(input.path));
        const original = await Bun.file(filePath).text();
        const oldText = String(input.old_text ?? '');
        const newText = String(input.new_text ?? '');

        if (!original.includes(oldText)) {
          throw new Error(
            `old_text not found in ${input.path}. ` +
              `Use view_file to see the exact current content, then retry with the exact text.`,
          );
        }

        // Replace only the first occurrence (safest for precise edits)
        const updated = original.replace(oldText, newText);
        await Bun.write(filePath, updated);
        return `Edited: ${input.path}`;
      }

      // ------------------------------------------------------------------
      // run_bash — execute a shell command
      // ------------------------------------------------------------------
      case 'run_bash': {
        const command = String(input.command ?? '');
        const timeout = Number(input.timeout_ms ?? 60_000);

        const proc = Bun.spawn(['bash', '-c', command], {
          cwd: this.workDir,
          stdout: 'pipe',
          stderr: 'pipe',
          env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
        });

        let procTimedOut = false;
        const procTimeoutId = setTimeout(() => {
          procTimedOut = true;
          proc.kill();
        }, timeout);

        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        clearTimeout(procTimeoutId);

        const combined = [stdout, stderr ? `[stderr]\n${stderr}` : '']
          .filter(Boolean)
          .join('\n')
          .trim()
          .slice(0, 15_000);

        return [
          `exit_code: ${exitCode}`,
          procTimedOut ? '[TIMED OUT]' : null,
          combined || '(no output)',
        ]
          .filter(Boolean)
          .join('\n');
      }

      // ------------------------------------------------------------------
      // list_directory — list directory entries
      // ------------------------------------------------------------------
      case 'list_directory': {
        const dirPath = input.path ? resolveSafe(String(input.path)) : this.workDir;
        const entries = await readdir(dirPath, { withFileTypes: true });
        if (entries.length === 0) return '(empty directory)';
        return entries.map((e) => `${e.isDirectory() ? '[DIR] ' : '[FILE]'} ${e.name}`).join('\n');
      }

      // ------------------------------------------------------------------
      // search_text — recursive grep
      // ------------------------------------------------------------------
      case 'search_text': {
        const pattern = String(input.pattern ?? '');
        const searchPath = input.path ? resolveSafe(String(input.path)) : this.workDir;
        const args = ['grep', '-r', '-n', '--include=*'];
        if (input.case_insensitive) args.push('-i');
        args.push(pattern, searchPath);

        const proc = Bun.spawn(args, {
          cwd: this.workDir,
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const [stdout, , exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        // exitCode 1 = no matches (not an error)
        if (exitCode > 1) throw new Error(`grep failed with exit ${exitCode}`);
        return stdout.slice(0, 15_000) || '(no matches)';
      }

      // ------------------------------------------------------------------
      // find_files — glob file search
      // ------------------------------------------------------------------
      case 'find_files': {
        const pattern = String(input.pattern ?? '*');
        const baseDir = input.directory ? resolveSafe(String(input.directory)) : this.workDir;

        const glob = new Bun.Glob(pattern);
        const files: string[] = [];
        for await (const file of glob.scan({
          cwd: baseDir,
          onlyFiles: true,
          followSymlinks: false,
        })) {
          // Skip node_modules, .git, dist
          if (file.includes('node_modules/') || file.includes('.git/') || file.includes('/dist/'))
            continue;
          files.push(file);
          if (files.length >= 200) break;
        }
        return files.length > 0 ? files.join('\n') : '(no matches)';
      }

      // ------------------------------------------------------------------
      // ask_human — request human input and pause until answered
      // ------------------------------------------------------------------
      case 'ask_human': {
        if (!this.coordinator) {
          return (
            'No coordinator connected — cannot request human assistance. ' +
            'Make your best decision and proceed.'
          );
        }

        const question = String(input.question ?? '').trim();
        const context = input.context ? String(input.context).trim() : undefined;

        if (!question) {
          return 'Error: question text is required.';
        }

        this.logger.info('agent', `Requesting human assistance: ${question.slice(0, 300)}`, {
          context: context?.slice(0, 200),
        });

        const prevPhase = this.phase;
        this.setPhase('waiting_for_human');

        try {
          const questionId = await this.coordinator.askQuestion(
            this.spec.story.storyId,
            this.spec.executorId!,
            question,
            context,
          );

          this.logger.info(
            'agent',
            `Question submitted (id=${questionId}), waiting for human response…`,
          );

          // Wait up to 30 minutes for the user to answer
          const answer = await this.coordinator.waitForAnswer(
            this.spec.story.storyId,
            questionId,
            30 * 60 * 1000,
          );

          this.logger.info('agent', `Human responded to question ${questionId}`);
          return `Human response: ${answer}`;
        } finally {
          // Always restore the previous phase even if waiting throws
          this.setPhase(prevPhase);
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  /**
   * Run quality checks on the working directory.
   */
  private async runQualityChecks(checks: QualityCheckConfig[]): Promise<QualityCheckResult[]> {
    const results: QualityCheckResult[] = [];

    for (const check of checks) {
      this.logger.info('quality_check', `Running check: ${check.name} (${check.command})`);

      const start = Date.now();

      try {
        const parts = check.command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [check.command];
        const cleanParts = parts.map((p) => p.replace(/^["']|["']$/g, ''));

        const proc = Bun.spawn(cleanParts, {
          cwd: this.workDir,
          stdout: 'pipe',
          stderr: 'pipe',
          env: { ...process.env, FORCE_COLOR: '0', CI: '1', NX_SKIP_NX_CACHE: 'true' },
        });

        let timedOut = false;
        const timeoutId = setTimeout(() => {
          timedOut = true;
          proc.kill();
        }, check.timeout);

        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        clearTimeout(timeoutId);

        const rawOutput = (stdout + '\n' + stderr).trim();
        const passed = exitCode === 0;

        const result: QualityCheckResult = {
          checkId: check.id,
          checkName: check.name,
          checkType: check.type,
          passed,
          output: rawOutput.slice(0, 15000),
          duration: Date.now() - start,
          exitCode: exitCode ?? -1,
          timedOut,
          storyId: this.spec.story.storyId,
        };

        results.push(result);

        if (passed) {
          this.logger.info('quality_check', `Check ${check.name}: PASSED`, {
            exitCode,
            duration: result.duration,
          });
        } else {
          this.logger.error('quality_check', `Check ${check.name}: FAILED`, {
            exitCode,
            duration: result.duration,
            timedOut,
            output: rawOutput.slice(0, 1000), // Log first 1KB of output for debugging
          });
        }
      } catch (err) {
        results.push({
          checkId: check.id,
          checkName: check.name,
          checkType: check.type,
          passed: false,
          output: String(err).slice(0, 5000),
          duration: Date.now() - start,
          exitCode: -1,
          storyId: this.spec.story.storyId,
        });

        this.logger.error('quality_check', `Check ${check.name} threw: ${String(err)}`);
      }
    }

    this.qualityResults = results;
    return results;
  }

  /**
   * Build the prompt for the agent from the story spec.
   */
  private buildPrompt(): string {
    const story = this.spec.story;
    const criteria = story.acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`).join('\n');

    let prompt = `## User Story: ${story.title}

${story.description}

## Acceptance Criteria
${criteria}
`;

    if (story.attempt !== undefined && story.maxAttempts !== undefined) {
      prompt += `\n## Attempt ${story.attempt} of ${story.maxAttempts}`;
    }

    if (story.learnings && story.learnings.length > 0) {
      prompt += '\n\n## Learnings from Previous Attempts\n';
      for (const learning of story.learnings) {
        prompt += `- ${learning}\n`;
      }
      prompt += '\nPlease address these issues in this attempt. Do not repeat the same mistakes.';
    }

    const qualityChecks = this.spec.qualityChecks?.filter((c) => c.enabled) ?? [];
    if (qualityChecks.length > 0) {
      prompt += '\n\n## Quality Checks That Will Run';
      for (const qc of qualityChecks) {
        prompt += `\n- **${qc.name}** (${qc.type}${qc.required ? ', required' : ''}): \`${qc.command}\``;
      }
      prompt += '\n\nMake sure your changes pass these checks before completion.';
    }

    return prompt;
  }

  /**
   * Build the system prompt for the agent.
   */
  private buildSystemPrompt(): string {
    return `You are an autonomous AI agent implementing user stories for a software project.

## Instructions
1. Read the user story carefully, including all acceptance criteria
2. Implement the story completely — make all necessary code changes
3. Ensure every acceptance criterion is met
4. Follow existing project conventions and patterns
5. Write clean, well-structured code
6. Do NOT ask questions for minor ambiguity — make reasonable decisions and document them. Only use ask_human if you are truly blocked and cannot proceed without user input
7. After implementation, the system will automatically run quality checks
8. IMPORTANT: Before declaring you are done, run the project's typecheck/build commands yourself to catch errors early
9. If this is a monorepo, ensure your changes maintain type compatibility across packages (especially shared types)
10. Do NOT leave placeholder implementations, stubs, TODOs, or empty function bodies. Every function must have a complete, working implementation. The system will detect and fail placeholder code automatically.
11. When writing or modifying tests, include a brief comment above each test explaining WHY the test exists — what behavior, edge case, or invariant it guards against. Future agents will lose your reasoning context; the test comment is the only record.`;
  }

  /**
   * Commit work-in-progress and push partial branch.
   */
  private async commitWipAndPush(startTime: number, reason: string): Promise<void> {
    if (!this.workDir || !existsSync(this.workDir)) return;

    try {
      if (await hasChanges(this.workDir)) {
        this.setPhase('committing');
        const msg = `wip: partial work on ${this.spec.story.title}\n\nStory: ${this.spec.story.storyId}\nReason: ${reason}\nGolem: ${this.spec.executorId}`;
        this.commitSha = await commitChanges(this.workDir, msg, this.logger);

        if (this.spec.autoPush !== false && this.commitSha) {
          this.setPhase('pushing');
          try {
            await pushBranch(this.workDir, this.branchName, this.logger, true);
          } catch {
            // Push failure during shutdown is non-fatal
          }
        }
      }

      // Report to coordinator
      if (this.coordinator) {
        this.setPhase('reporting');
        const status = reason === 'timeout' ? 'timeout' : 'cancelled';
        await this.reportResult(status as StoryResultReport['status'], this.agentOutput, reason);
      }
    } catch (err) {
      this.logger.error('shutdown', `WIP commit/push failed: ${String(err)}`);
    }
  }

  /**
   * Report execution result to the coordinator.
   */
  private async reportResult(
    status: StoryResultReport['status'],
    agentOutput: string,
    error: string | null,
  ): Promise<void> {
    if (!this.coordinator) return;

    try {
      const report: StoryResultReport = {
        executorId: this.spec.executorId!,
        status,
        branchName: this.branchName,
        commitSha: this.commitSha ?? undefined,
        logs: this.logLines,
        durationMs: Date.now() - this.startTime,
        qualityResults: this.qualityResults,
        agentOutput: agentOutput.slice(0, 50000),
        agentError: error ?? undefined,
      };

      this.coordinator.stopHeartbeat();
      const result = await this.coordinator.reportResult(this.spec.story.storyId, report);

      this.logger.info('report', 'Result reported to coordinator', {
        accepted: result.accepted,
        newStatus: result.newStatus,
        mergeTriggered: result.mergeTriggered,
      });
    } catch (err) {
      this.logger.error('report', `Failed to report result: ${String(err)}`);
    }
  }

  /**
   * Create a cancelled result.
   */
  private cancelledResult(startTime: number): GolemRunResult {
    return {
      exitCode: GolemExitCode.STORY_FAILURE,
      branchName: this.branchName,
      commitSha: this.commitSha,
      qualityResults: this.qualityResults,
      agentOutput: this.agentOutput,
      error: 'Execution cancelled',
      duration: Date.now() - startTime,
    };
  }

  /**
   * Clean up resources.
   */
  private cleanup(): void {
    if (this.coordinator) {
      this.coordinator.dispose();
    }
    if (this.healthServer) {
      this.healthServer.stop();
    }
    this.logger.close();
  }
}
