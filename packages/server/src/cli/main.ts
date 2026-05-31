#!/usr/bin/env bun
/**
 * E CLI — The first-class terminal interface for the E Agent Platform.
 */

import { Command } from 'commander';
import { theme } from './ui/theme';
import { runChat } from './commands/chat';
import { runLink } from './commands/link';
import { runCommit } from './commands/commit';
import { runOpen } from './commands/open';
import { runFileTypesCommand } from '../file-associations/cli';
import { nanoid } from 'nanoid';

const program = new Command();

program.name('e').description('Autonomous AI Coding Assistant').version('0.2.1');

program
  .command('open', { isDefault: true })
  .description('Open a file or directory in the E app (defaults to the current directory)')
  .argument('[path]', 'File or directory to open')
  .option('--serve', 'Start the server without opening a browser', false)
  .action(async (path, options) => {
    await runOpen({ path, serve: options.serve });
  });

// Backwards-compatible alias so `e serve` runs headless.
program
  .command('serve')
  .description('Start the E server without opening a browser')
  .action(async () => {
    await runOpen({ serve: true });
  });

program
  .command('chat')
  .description('Start an interactive agentic session')
  .argument('[prompt...]', 'Initial prompt for the agent')
  .option('-m, --model <model>', 'LLM model to use', 'gemini-2.0-flash')
  .option('-r, --resume <sessionId>', 'Resume a previous session')
  .option('--output-format <format>', 'Output format (text or stream-json)', 'text')
  .option('--yolo', 'Run in autonomous mode (no tool approvals)', false)
  .option('--region <region>', 'AWS region for Bedrock (e.g., us-east-1)')
  .option('--external', 'Use external CLI (Claude Code) as the brain', false)
  .option('-s, --system-prompt <text>', 'Custom system prompt')
  .option('--effort <level>', 'Effort level (low, medium, high)', 'high')
  .option('--max-turns <n>', 'Maximum agentic turns', parseInt)
  .option('--max-budget-usd <n>', 'Maximum spending cap in USD', parseFloat)
  .option('--allowedTools <tools...>', 'Whitelist specific tools (repeatable)')
  .option('--disallowedTools <tools...>', 'Blacklist specific tools (repeatable)')
  .option('--mcp-config <path>', 'MCP server configuration file path')
  .option(
    '-p, --permission-mode <mode>',
    'Permission mode (plan, safe, fast, unrestricted)',
    'safe',
  )
  .action(async (promptParts, options) => {
    const prompt = promptParts.join(' ');
    await runChat({
      prompt,
      model: options.model,
      sessionId: options.resume || nanoid(),
      outputFormat: options.outputFormat,
      yolo: options.yolo,
      region: options.region,
      useExternalCli: options.external,
      systemPrompt: options.systemPrompt,
      effort: options.effort,
      maxTurns: options.maxTurns,
      maxBudgetUsd: options.maxBudgetUsd,
      allowedTools: options.allowedTools,
      disallowedTools: options.disallowedTools,
      mcpConfigPath: options.mcpConfig,
      permissionMode: options.yolo ? 'unrestricted' : options.permissionMode,
    });
  });

program
  .command('commit')
  .description('Summarize staged changes and propose a commit message')
  .option('-m, --model <model>', 'LLM model to use', 'gemini-2.0-flash')
  .action(async (options) => {
    await runCommit({
      model: options.model,
      sessionId: 'commit_' + nanoid(8),
    });
  });

program
  .command('link')
  .description('Link this CLI to a running E Desktop GUI')
  .option('-r, --resume <sessionId>', 'Session ID to link')
  .action(async (options) => {
    await runLink({
      sessionId: options.resume || nanoid(),
    });
  });

program
  .command('register-file-types')
  .description('Register E as the default handler for code file types')
  .action(async () => {
    await runFileTypesCommand('register-file-types');
  });

program
  .command('unregister-file-types')
  .description("Remove E's code file-type associations")
  .action(async () => {
    await runFileTypesCommand('unregister-file-types');
  });

program.parse();
