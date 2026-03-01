/**
 * E CLI — Chat Command (Refactored to use AgentKernel)
 */

import ora from 'ora';
import chalk from 'chalk';
import { theme } from '../ui/theme';
import { AgentKernel, KernelEvent } from '../../services/agent-kernel';
import { promptUser as promptWithHistory } from '../ui/input';
import { renderDiff } from '../ui/diff';
import { existsSync, readFileSync } from 'fs';

export async function runChat(opts: {
  prompt: string;
  model: string;
  sessionId: string;
  outputFormat?: string;
  depth?: number;
  yolo?: boolean;
  region?: string;
}) {
  let { prompt, model, sessionId, outputFormat, depth = 0, yolo = false, region } = opts;
  const workspacePath = process.cwd();
  const isStreamJson = outputFormat === 'stream-json';

  if (!isStreamJson && depth === 0) {
    console.clear();
    console.log(theme.banner('0.1.0'));
    console.log(theme.status(model, sessionId));
    console.log(theme.divider());

    // Comprehensive Credential Check
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

    console.log(`${theme.gutter.blank(depth)}${chalk.bold('Provider Status:')}`);
    console.log(`${theme.gutter.blank(depth)}  ${chalk.cyan('Google Gemini:')}    ${googleStatus}`);
    console.log(
      `${theme.gutter.blank(depth)}  ${chalk.cyan('Anthropic API:')}   ${anthropicStatus}`,
    );
    console.log(`${theme.gutter.blank(depth)}  ${chalk.cyan('AWS Bedrock:')}     ${awsStatus}`);
    console.log(theme.divider());
  }

  const kernel = new AgentKernel({ sessionId, depth, workspacePath });

  // Create a handler for Kernel events to draw the TUI
  let spinner: any = null;
  let isThinking = false;

  kernel.on('event', async (ev: KernelEvent) => {
    const gLine = theme.gutter.line(ev.depth);
    const gConn = theme.gutter.connector(ev.depth);
    const indent = ' '.repeat(ev.depth * 2);

    if (isStreamJson) {
      // GUI Provider Mode: Direct pass-through
      process.stdout.write(JSON.stringify(ev) + '\n');
      return;
    }

    switch (ev.type) {
      case 'thinking':
        spinner = ora({
          text: chalk.dim('Thinking…'),
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
        const preview = ev.data.content.slice(0, 60).replace(/\n/g, ' ');
        console.log(
          `${gLine}${ev.data.is_error ? theme.toolError(preview) : theme.toolResult(preview + '…')}`,
        );
        break;

      case 'stop':
        spinner?.stop();
        process.stdout.write('\n');
        if (ev.data?.usage && ev.depth === 0) {
          console.log(
            `${gLine}${chalk.dim(`Tokens: ${ev.data.usage.input_tokens + ev.data.usage.output_tokens}`)}`,
          );
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

      // Handle slash commands
      if (input.startsWith('/')) {
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
          console.log(`${theme.gutter.blank(depth)}${theme.success(`Switched to ${model}`)}`);
          continue;
        }
        console.log(`${theme.gutter.blank(depth)}${theme.error(`Unknown command: ${input}`)}`);
        continue;
      }
      currentPrompt = input;
    } else {
      if (!isStreamJson && isFirstTurn) {
        console.log(`\n${theme.user(currentPrompt)}`);
      }
    }

    isFirstTurn = false;
    try {
      await kernel.run(currentPrompt, model, undefined, region);
    } catch (err: any) {
      if (!isStreamJson) {
        console.log(`\n${theme.gutter.blank(depth)}${theme.error(err.message)}`);
      }
    }

    if (depth > 0) break;
    currentPrompt = '';
  }
}
