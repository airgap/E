/**
 * E CLI — Chat Command (Refactored to use AgentKernel)
 */

import ora from 'ora';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { theme } from '../ui/theme';
import { AgentKernel, KernelEvent } from '../../services/agent-kernel';
import { promptUser as promptWithHistory } from '../ui/input';
import { renderDiff } from '../ui/diff';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { platform } from 'os';
import { execSync } from 'child_process';
import type { PermissionMode } from '@e/shared';
import { shouldRequireApproval } from '../../services/permission-rules';
import { loadProjectInstructions } from '../../services/project-instructions';
import { loadAutoMemory } from '../../services/auto-memory';
import { loadHooks, runHooks } from '../../services/hooks';

// ── Token Tracking ───────────────────────────────────────────────────

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheHits: number;
  turns: number;
}

const COST_PER_MTK: Record<string, { input: number; output: number }> = {
  'claude-opus': { input: 15, output: 75 },
  'claude-sonnet': { input: 3, output: 15 },
  'claude-haiku': { input: 0.25, output: 1.25 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  ollama: { input: 0, output: 0 },
};

function estimateCost(usage: TokenUsage, model: string): number {
  if (model.startsWith('ollama:')) return 0;
  const key = Object.keys(COST_PER_MTK).find((k) => model.includes(k)) || '';
  const rates = COST_PER_MTK[key];
  if (!rates) return 0;
  return (usage.inputTokens * rates.input + usage.outputTokens * rates.output) / 1_000_000;
}

function formatCost(usage: TokenUsage, model: string): string {
  const cost = estimateCost(usage, model);
  const costStr = model.startsWith('ollama:') ? 'free (local)' : `$${cost.toFixed(4)}`;
  return [
    `Input: ${usage.inputTokens.toLocaleString()} tokens`,
    `Output: ${usage.outputTokens.toLocaleString()} tokens`,
    `Total: ${(usage.inputTokens + usage.outputTokens).toLocaleString()} tokens`,
    `Turns: ${usage.turns}`,
    `Est. cost: ${costStr}`,
  ].join('\n');
}

// ── Desktop Notifications ────────────────────────────────────────────

function sendNotification(title: string, body: string) {
  try {
    const os = platform();
    if (os === 'linux') {
      execSync(`notify-send ${JSON.stringify(title)} ${JSON.stringify(body)}`, {
        stdio: 'ignore',
        timeout: 5000,
      });
    } else if (os === 'darwin') {
      execSync(
        `osascript -e 'display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}'`,
        { stdio: 'ignore', timeout: 5000 },
      );
    }
  } catch {}
}

// ── Chat Command ─────────────────────────────────────────────────────

export async function runChat(opts: {
  prompt: string;
  model: string;
  sessionId: string;
  outputFormat?: string;
  depth?: number;
  yolo?: boolean;
  region?: string;
  useExternalCli?: boolean;
  systemPrompt?: string;
  effort?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpConfigPath?: string;
  permissionMode?: string;
}) {
  let {
    prompt,
    model,
    sessionId,
    outputFormat,
    depth = 0,
    yolo = false,
    region,
    useExternalCli = false,
    systemPrompt: customSystemPrompt,
    effort,
    maxTurns,
    maxBudgetUsd,
    allowedTools,
    disallowedTools,
    mcpConfigPath,
    permissionMode: permMode = 'safe',
  } = opts;

  let permissionMode = (yolo ? 'unrestricted' : permMode) as PermissionMode;
  let planMode = permissionMode === 'plan';
  const workspacePath = process.cwd();
  const isStreamJson = outputFormat === 'stream-json';

  // ── Load project instructions & memory ──
  const projectInstructions = loadProjectInstructions(workspacePath);
  const autoMemory = loadAutoMemory();
  const hooks = loadHooks(workspacePath);

  // ── Token tracking ──
  const tokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheHits: 0, turns: 0 };
  let turnCount = 0;

  if (!isStreamJson && depth === 0) {
    console.clear();
    const displayModel = useExternalCli ? 'External (Claude Code)' : model;
    console.log(theme.banner('0.1.0'));
    console.log(theme.status(displayModel, sessionId));

    // Show active mode
    const modeLabel = planMode
      ? chalk.bgYellow.black(' PLAN ')
      : permissionMode === 'unrestricted'
        ? chalk.bgRed.white(' YOLO ')
        : permissionMode === 'fast'
          ? chalk.bgGreen.white(' FAST ')
          : chalk.bgBlue.white(' SAFE ');
    console.log(`  ${modeLabel} ${chalk.dim(`Permission mode: ${permissionMode}`)}`);
    if (projectInstructions) console.log(`  ${chalk.green('✓')} Project instructions loaded`);
    if (autoMemory) console.log(`  ${chalk.green('✓')} Auto-memory loaded`);
    if (Object.keys(hooks).length > 0) console.log(`  ${chalk.green('✓')} Hooks loaded`);
    console.log(theme.divider());

    // Comprehensive Credential Check
    if (!useExternalCli) {
      const googleStatus = process.env.GOOGLE_API_KEY
        ? chalk.green('✓ Ready')
        : chalk.dim('○ Not Configured');
      const anthropicStatus = process.env.ANTHROPIC_API_KEY
        ? chalk.green('✓ Ready')
        : chalk.dim('○ Not Configured');
      const awsStatus =
        process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
          ? chalk.green('✓ Ready')
          : chalk.dim('○ Not Configured');
      const ollamaStatus = (() => {
        try {
          execSync('curl -s http://localhost:11434/api/tags', { timeout: 2000 });
          return chalk.green('✓ Ready');
        } catch {
          return chalk.dim('○ Not Running');
        }
      })();

      console.log(`${theme.gutter.blank(depth)}${chalk.bold('Provider Status:')}`);
      console.log(
        `${theme.gutter.blank(depth)}  ${chalk.cyan('Google Gemini:')}    ${googleStatus}`,
      );
      console.log(
        `${theme.gutter.blank(depth)}  ${chalk.cyan('Anthropic API:')}   ${anthropicStatus}`,
      );
      console.log(`${theme.gutter.blank(depth)}  ${chalk.cyan('AWS Bedrock:')}     ${awsStatus}`);
      console.log(
        `${theme.gutter.blank(depth)}  ${chalk.cyan('Ollama Local:')}    ${ollamaStatus}`,
      );
      console.log(theme.divider());
    } else {
      console.log(`${theme.gutter.blank(depth)}${chalk.bold.yellow('EXTERNAL CLI MODE')}`);
      console.log(`${theme.gutter.blank(depth)}  Using local 'claude' binary as the brain.`);
      console.log(theme.divider());
    }

    // Run onStart hooks
    runHooks(hooks.onStart, { SESSION_ID: sessionId, MODEL: model });
  }

  // Define Approval Handler for TUI (permission-aware)
  const onApproval = async (tool: any): Promise<boolean> => {
    const gLine = theme.gutter.line(depth);

    // Check permission rules
    const decision = shouldRequireApproval(
      tool.name,
      tool.input || {},
      [], // No DB rules in CLI mode — use permissionMode
      permissionMode,
      'auto',
    );

    if (decision === 'allow') return true;
    if (decision === 'deny') {
      console.log(`${gLine}${chalk.red('✘ Blocked by permission mode')}: ${tool.name}`);
      return false;
    }

    // Check allowed/disallowed tool lists
    if (disallowedTools?.includes(tool.name)) {
      console.log(`${gLine}${chalk.red('✘ Tool disallowed')}: ${tool.name}`);
      return false;
    }
    if (allowedTools?.length && !allowedTools.includes(tool.name)) {
      console.log(`${gLine}${chalk.red('✘ Tool not in allowed list')}: ${tool.name}`);
      return false;
    }

    // Run preToolCall hooks
    const hookEnv = {
      TOOL_NAME: tool.name,
      TOOL_ARGS: JSON.stringify(tool.input || {}),
      SESSION_ID: sessionId,
      MODEL: model,
    };
    if (!runHooks(hooks.preToolCall, hookEnv)) {
      console.log(`${gLine}${chalk.red('✘ Blocked by preToolCall hook')}`);
      return false;
    }

    // Show diff preview for writes
    if (tool.name === 'Edit' || tool.name === 'Write') {
      const filePath = tool.input.file_path;
      let oldContent = '';
      let newContent = '';
      if (existsSync(filePath)) oldContent = readFileSync(filePath, 'utf-8');
      newContent =
        tool.name === 'Write'
          ? tool.input.content
          : oldContent.replace(tool.input.old_string, tool.input.new_string);

      console.log(`${gLine}${chalk.gray(`Preview changes to: ${filePath}`)}`);
      const diffParts = renderDiff(oldContent, newContent).split('\n');
      diffParts.forEach((dp) => console.log(`${gLine}${dp}`));
    } else if (tool.name === 'Bash') {
      console.log(`${gLine}${chalk.red('⚠ DANGEROUS')}`);
      console.log(`${gLine}Exec: ${chalk.bold.yellow(tool.input.command)}`);
    }

    // Notify if waiting for approval
    sendNotification('E — Approval Required', `Tool: ${tool.name}`);

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Approve execution?',
        default: true,
      },
    ]);

    // Run postToolCall hooks if approved
    if (confirm) {
      runHooks(hooks.postToolCall, hookEnv);
    }

    return confirm;
  };

  // Determine if approval is needed based on permission mode
  const needsApproval = permissionMode !== 'unrestricted';

  const kernel = new AgentKernel({
    sessionId,
    depth,
    workspacePath,
    useExternalCli,
    yolo: permissionMode === 'unrestricted',
    onApproval: !isStreamJson && needsApproval ? onApproval : undefined,
  });

  // Create a handler for Kernel events to draw the TUI
  let spinner: any = null;
  let isThinking = false;

  kernel.on('event', async (ev: KernelEvent) => {
    const gLine = theme.gutter.line(ev.depth);
    const gConn = theme.gutter.connector(ev.depth);

    if (isStreamJson) {
      process.stdout.write(JSON.stringify(ev) + '\n');
      return;
    }

    switch (ev.type) {
      case 'thinking':
        spinner = ora({
          text: chalk.dim(ev.data?.message || 'Thinking…'),
          prefixText: gLine,
          color: ev.depth % 2 === 0 ? 'cyan' : 'magenta',
          spinner: 'dots',
        }).start();
        isThinking = true;
        break;

      case 'text':
        if (isThinking) {
          spinner?.stop();
          process.stdout.write(`${gConn}${theme.assistant('')}`);
          isThinking = false;
        }
        const parts = ev.data.text.split('\n');
        for (let i = 0; i < parts.length; i++) {
          process.stdout.write(
            ev.depth % 2 === 0 ? chalk.white(parts[i]) : chalk.magentaBright(parts[i]),
          );
          if (i < parts.length - 1) process.stdout.write(`\n${gLine}`);
        }
        break;

      case 'tool_call':
        if (isThinking) spinner?.stop();
        else process.stdout.write('\n');

        console.log(`${gConn}${theme.toolHeader(ev.data.tool.name)}`);

        if (['Write', 'Edit', 'Bash'].includes(ev.data.tool.name)) {
          if (ev.data.tool.name === 'Edit' || ev.data.tool.name === 'Write') {
            const filePath = ev.data.tool.input.file_path;
            console.log(`${gLine}${chalk.gray(`Target: ${filePath}`)}`);
          } else if (ev.data.tool.name === 'Bash') {
            console.log(`${gLine}Exec: ${chalk.bold.yellow(ev.data.tool.input.command)}`);
          }
        } else {
          console.log(`${gLine}${theme.toolInput(JSON.stringify(ev.data.tool.input, null, 2))}`);
        }

        spinner = ora({
          text: chalk.dim('Executing…'),
          prefixText: gLine,
          color: 'yellow',
          spinner: 'arc',
        }).start();
        break;

      case 'tool_result':
        spinner?.stop();
        const preview = String(ev.data.content).slice(0, 60).replace(/\n/g, ' ');
        console.log(
          `${gLine}${ev.data.is_error ? theme.toolError(preview) : theme.toolResult(preview + '…')}`,
        );
        break;

      case 'stop':
        spinner?.stop();
        process.stdout.write('\n');
        if (ev.data?.usage) {
          const u = ev.data.usage;
          tokenUsage.inputTokens += u.input_tokens || 0;
          tokenUsage.outputTokens += u.output_tokens || 0;
          tokenUsage.cacheHits += u.cache_read_input_tokens || 0;
          tokenUsage.turns++;
          turnCount++;
          if (ev.depth === 0) {
            const total = (u.input_tokens || 0) + (u.output_tokens || 0);
            const cost = estimateCost(tokenUsage, model);
            const costStr = model.startsWith('ollama:') ? '' : chalk.dim(` · $${cost.toFixed(4)}`);
            console.log(`${gLine}${chalk.dim(`Tokens: ${total.toLocaleString()}`)}${costStr}`);
          }
        }
        // Check max turns
        if (maxTurns && turnCount >= maxTurns) {
          console.log(`${gLine}${chalk.yellow(`Max turns (${maxTurns}) reached.`)}`);
        }
        break;

      case 'error':
        spinner?.stop();
        console.log(`\n${gLine}${theme.error(ev.data.message)}`);
        break;
    }
  });

  let currentPrompt = prompt;
  let isFirstTurn = true;

  while (true) {
    if (!currentPrompt) {
      if (isStreamJson || depth > 0) break;
      if (process.env.CI || process.env.NONINTERACTIVE) break;

      const input = await promptWithHistory();
      if (!input) {
        if (process.stdin.readableEnded) break;
        continue;
      }

      if (input.startsWith('/')) {
        const g = theme.gutter.blank(depth);
        if (input === '/exit' || input === '/quit') break;
        if (input === '/clear') {
          console.clear();
          console.log(theme.banner('0.1.0'));
          console.log(theme.status(model, sessionId));
          console.log(theme.divider());
          continue;
        }
        if (input.startsWith('/model ')) {
          model = input.split(' ')[1];
          console.log(`${g}${theme.success(`Switched to ${model}`)}`);
          continue;
        }
        if (input === '/yolo') {
          permissionMode = permissionMode === 'unrestricted' ? 'safe' : 'unrestricted';
          yolo = permissionMode === 'unrestricted';
          console.log(`${g}${theme.info(`Permission mode: ${permissionMode}`)}`);
          continue;
        }
        if (input === '/plan') {
          planMode = !planMode;
          permissionMode = planMode ? 'plan' : 'safe';
          console.log(`${g}${theme.info(`Plan mode: ${planMode ? 'ON (read-only)' : 'OFF'}`)}`);
          continue;
        }
        if (input === '/cost') {
          console.log(`${g}${chalk.bold('Session Cost:')}`);
          formatCost(tokenUsage, model)
            .split('\n')
            .forEach((l) => console.log(`${g}  ${l}`));
          continue;
        }
        if (input === '/compact') {
          console.log(
            `${g}${theme.info('Context compaction requested — clearing local history.')}`,
          );
          // Reset the kernel session to start fresh
          tokenUsage.inputTokens = 0;
          tokenUsage.outputTokens = 0;
          tokenUsage.cacheHits = 0;
          tokenUsage.turns = 0;
          turnCount = 0;
          continue;
        }
        if (input === '/init') {
          console.log(`${g}${chalk.bold('Scanning workspace...')}`);
          const initPrompt = `Analyze this codebase and generate an E.md project instructions file. Include:
- Project name and description
- Tech stack and frameworks
- Key directories and their purposes
- Coding conventions observed
- Build/test/deploy commands
Write the file to ${join(workspacePath, 'E.md')}.`;
          currentPrompt = initPrompt;
          continue;
        }
        if (input === '/commit') {
          const { runCommit } = await import('./commit');
          await runCommit({ model, sessionId });
          continue;
        }
        if (input === '/help') {
          console.log(`${g}${chalk.bold('Available Commands:')}`);
          console.log(`${g}  ${chalk.cyan('/help')}      Show this help`);
          console.log(
            `${g}  ${chalk.cyan('/model')}     Switch LLM model (/model ollama:llama3.1)`,
          );
          console.log(`${g}  ${chalk.cyan('/yolo')}      Toggle unrestricted mode`);
          console.log(`${g}  ${chalk.cyan('/plan')}      Toggle plan mode (read-only)`);
          console.log(`${g}  ${chalk.cyan('/cost')}      Show token usage and cost`);
          console.log(`${g}  ${chalk.cyan('/compact')}   Reset context / compact history`);
          console.log(`${g}  ${chalk.cyan('/init')}      Generate E.md project instructions`);
          console.log(
            `${g}  ${chalk.cyan('/commit')}    Generate commit message for staged changes`,
          );
          console.log(`${g}  ${chalk.cyan('/clear')}     Clear the screen`);
          console.log(`${g}  ${chalk.cyan('/exit')}      Exit the session`);
          continue;
        }
        console.log(
          `${g}${theme.error(`Unknown command: ${input}. Type /help for available commands.`)}`,
        );
        continue;
      }
      currentPrompt = input;
    } else {
      if (!isStreamJson && isFirstTurn) {
        const prefix = depth > 0 ? ' '.repeat(depth * 2) + chalk.dim('↳ ') : '';
        console.log(`\n${prefix}${theme.user(currentPrompt)}`);
      }
    }

    isFirstTurn = false;

    // Check max turns before running
    if (maxTurns && turnCount >= maxTurns) {
      if (!isStreamJson) {
        console.log(
          `\n${theme.gutter.blank(depth)}${chalk.yellow('Max turns reached. Stopping.')}`,
        );
      }
      break;
    }

    // Build system prompt with project instructions and memory
    let effectiveSystemPrompt = customSystemPrompt || undefined;
    if (projectInstructions || autoMemory) {
      const base = effectiveSystemPrompt || '';
      const parts = [base, projectInstructions, autoMemory].filter(Boolean);
      effectiveSystemPrompt = parts.join('\n\n');
    }

    try {
      await kernel.run(currentPrompt, model, effectiveSystemPrompt, region);
    } catch (err: any) {
      if (!isStreamJson) {
        console.log(`\n${theme.gutter.blank(depth)}${theme.error(err.message)}`);
        runHooks(hooks.onError, {
          ERROR_MESSAGE: err.message,
          SESSION_ID: sessionId,
          MODEL: model,
        });
        sendNotification('E — Error', err.message);
      }
    }

    if (depth > 0) break;
    currentPrompt = '';
  }

  // ── Session exit ──
  if (!isStreamJson && depth === 0) {
    // Run onEnd hooks
    runHooks(hooks.onEnd, { SESSION_ID: sessionId, MODEL: model });

    // Show final cost summary
    if (tokenUsage.turns > 0) {
      console.log(theme.divider());
      console.log(`${theme.gutter.blank(depth)}${chalk.bold('Session Summary:')}`);
      formatCost(tokenUsage, model)
        .split('\n')
        .forEach((l) => {
          console.log(`${theme.gutter.blank(depth)}  ${chalk.dim(l)}`);
        });
    }

    sendNotification('E — Session Complete', `${tokenUsage.turns} turns completed`);
  }
}
