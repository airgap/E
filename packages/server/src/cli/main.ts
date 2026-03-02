#!/usr/bin/env bun
/**
 * E CLI — The first-class terminal interface for the E Agent Platform.
 */

import { Command } from 'commander';
import { theme } from './ui/theme';
import { runChat } from './commands/chat';
import { runLink } from './commands/link';
import { runCommit } from './commands/commit';
import { nanoid } from 'nanoid';

const program = new Command();

program.name('e').description('Autonomous AI Coding Assistant').version('0.1.0');

program
  .command('chat', { isDefault: true })
  .description('Start an interactive agentic session')
  .argument('[prompt...]', 'Initial prompt for the agent')
  .option('-m, --model <model>', 'LLM model to use', 'gemini-2.0-flash')
  .option('-r, --resume <sessionId>', 'Resume a previous session')
  .option('--output-format <format>', 'Output format (text or stream-json)', 'text')
  .option('--yolo', 'Run in autonomous mode (no tool approvals)', false)
  .option('--region <region>', 'AWS region for Bedrock (e.g., us-east-1)')
  .option('--external', 'Use external CLI (Claude Code) as the brain', false)
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

program.parse();
