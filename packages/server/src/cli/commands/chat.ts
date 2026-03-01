/**
 * E CLI — Chat Command (V9 Bedrock Support - Fixed)
 */

import ora from 'ora';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { theme, clearLine } from '../ui/theme';
import { createGeminiStreamV2 } from '../../services/gemini-provider-v2';
import { createBedrockStream } from '../../services/bedrock-provider';
import { executeTool } from '../../services/tool-executor';
import { claudeManager } from '../../services/claude-process';
import { promptUser as promptWithHistory } from '../ui/input';
import { renderDiff } from '../ui/diff';
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';

export async function runChat(opts: {
  prompt: string;
  model: string;
  sessionId: string;
  outputFormat?: string;
  depth?: number;
  yolo?: boolean;
  region?: string;
}): Promise<string> {
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

    // Only warn if the CURRENTLY SELECTED model is missing its key
    const isGoogleModel = model.includes('gemini');
    const isAnthropicModel = model.startsWith('claude:');
    const isBedrockModel = model.startsWith('bedrock:');

    if (isGoogleModel && !process.env.GOOGLE_API_KEY) {
      console.log(theme.gutter.blank(depth) + theme.warning(`Model requires GOOGLE_API_KEY.`));
    } else if (isAnthropicModel && !process.env.ANTHROPIC_API_KEY) {
      console.log(theme.gutter.blank(depth) + theme.warning(`Model requires ANTHROPIC_API_KEY.`));
    } else if (
      isBedrockModel &&
      (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY)
    ) {
      console.log(theme.gutter.blank(depth) + theme.warning(`Model requires AWS Credentials.`));
    }
  }

  claudeManager.getSession(sessionId) || claudeManager.createLightweightSession(sessionId);

  let currentPrompt = prompt;
  let isFirstTurn = true;
  let lastResponse = '';

  while (true) {
    if (!currentPrompt) {
      if (isStreamJson || depth > 0) break;

      // Check for non-interactive environment
      if (process.env.CI || process.env.NONINTERACTIVE) {
        break;
      }

      const input = await promptWithHistory();
      if (!input) {
        // If stdin is closed, we'll get an empty input. Exit to avoid infinite loop.
        if (process.stdin.readableEnded) break;
        continue;
      }

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
          console.log(theme.gutter.blank(depth) + theme.success(`Switched to ${model}`));
          continue;
        }
        if (input === '/yolo') {
          yolo = !yolo;
          console.log(
            theme.gutter.blank(depth) + theme.info(`YOLO mode is now ${yolo ? 'ON' : 'OFF'}`),
          );
          continue;
        }
        if (input === '/commit') {
          const { runCommit } = await import('./commit');
          await runCommit({ model, sessionId });
          continue;
        }
        console.log(theme.error(`Unknown command: ${input}`));
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
      lastResponse = await executeTurn(
        currentPrompt,
        model,
        sessionId,
        workspacePath,
        isStreamJson,
        depth,
        yolo,
        region,
      );
    } catch (err: any) {
      if (!isStreamJson) {
        console.log(`\n${theme.gutter.blank(depth)}${theme.error(err.message)}`);
      }
      lastResponse = `Error: ${err.message}`;
    }

    if (depth > 0) break;
    currentPrompt = '';
  }

  return lastResponse;
}

async function executeTurn(
  prompt: string,
  model: string,
  sessionId: string,
  workspacePath: string,
  isStreamJson: boolean,
  depth: number,
  yolo: boolean,
  region?: string,
): Promise<string> {
  const gLine = theme.gutter.line(depth);
  const gConn = theme.gutter.connector(depth);

  let spinner = !isStreamJson
    ? ora({
        text: chalk.dim('Thinking…'),
        prefixText: gLine,
        color: depth % 2 === 0 ? 'cyan' : 'magenta',
        spinner: 'dots',
      }).start()
    : null;

  let gitContext = '';
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    gitContext = `\n[Git Context: branch ${branch}]`;
  } catch {}

  const isBedrock = model.startsWith('bedrock:') || model.startsWith('claude:');
  const streamOpts: any = {
    model: isBedrock ? model.replace('bedrock:', '') : model,
    prompt,
    conversationId: sessionId,
    workspacePath,
    systemPrompt: `You are E (Depth: ${depth}), an autonomous AI assistant. Fulfill requests accurately. ${gitContext}`,
    region: region || process.env.AWS_REGION || 'us-east-1',
  };

  const stream = isBedrock
    ? createBedrockStream({ ...streamOpts, content: prompt })
    : createGeminiStreamV2(streamOpts);

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let isThinking = true;
  let usage: any = null;
  const session = claudeManager.getSession(sessionId);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const dataStr = line.slice(6).trim();
      if (!dataStr) continue;

      try {
        const data = JSON.parse(dataStr);

        if (data.type === 'error') {
          spinner?.stop();
          throw new Error(data.error?.message || data.message || 'Provider error');
        }

        if (data.type === 'message_delta' && data.usage) usage = data.usage;

        if (isStreamJson) {
          process.stdout.write(JSON.stringify(data) + '\n');
        }

        if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
          const text = data.delta.text;
          fullText += text;
          if (session) session.emitter.emit('agent:delta', text);

          if (!isStreamJson) {
            if (isThinking) {
              spinner?.stop();
              process.stdout.write(`${gConn}${theme.assistant('')}`);
              isThinking = false;
            }
            const parts = text.split('\n');
            for (let i = 0; i < parts.length; i++) {
              process.stdout.write(
                depth % 2 === 0 ? chalk.white(parts[i]) : chalk.magentaBright(parts[i]),
              );
              if (i < parts.length - 1) process.stdout.write(`\n${gLine}`);
            }
          }
        }

        if (data.type === 'content_block_stop' && data.content_block?.type === 'tool_use') {
          const tool = data.content_block;

          if (!isStreamJson) {
            if (!isThinking) process.stdout.write('\n');
            console.log(`${gConn}${theme.toolHeader(tool.name)}`);

            if (!yolo && ['Write', 'Edit', 'Bash'].includes(tool.name)) {
              spinner?.stop();
              if (tool.name === 'Edit' || tool.name === 'Write') {
                const filePath = tool.input.file_path;
                let oldContent = '';
                let newContent = '';
                if (existsSync(filePath)) oldContent = readFileSync(filePath, 'utf-8');
                newContent =
                  tool.name === 'Write'
                    ? tool.input.content
                    : oldContent.replace(tool.input.old_string, tool.input.new_string);
                console.log(`${gLine}${chalk.gray(`Preview: ${filePath}`)}`);
                const diffParts = renderDiff(oldContent, newContent).split('\n');
                diffParts.forEach((dp) => console.log(`${gLine}${dp}`));
              } else if (tool.name === 'Bash') {
                console.log(`${gLine}${chalk.red('⚠ DANGEROUS')}`);
                console.log(`${gLine}Exec: ${chalk.bold.yellow(tool.input.command)}`);
              }

              const { confirm } = await inquirer.prompt([
                { type: 'confirm', name: 'confirm', message: 'Approve?', default: true },
              ]);
              if (!confirm) {
                return await executeTurn(
                  `[Tool Result for ${tool.name}]: Denied by user.`,
                  model,
                  sessionId,
                  workspacePath,
                  isStreamJson,
                  depth,
                  yolo,
                  region,
                );
              }
            } else {
              console.log(`${gLine}${theme.toolInput(JSON.stringify(tool.input, null, 2))}`);
            }

            spinner = ora({
              text: chalk.dim('Executing…'),
              prefixText: gLine,
              color: 'yellow',
              spinner: 'arc',
            }).start();
          }

          if (session) session.emitter.emit('agent:tool_call', tool);

          let result: any;
          if (tool.name === 'Agent') {
            spinner?.stop();
            console.log(`${gLine}${chalk.cyan('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`);
            const subResult = await runChat({
              prompt: tool.input.objective,
              model: tool.input.model || model,
              sessionId: sessionId + '_sub_' + nanoid(4),
              outputFormat: isStreamJson ? 'stream-json' : undefined,
              depth: depth + 1,
              yolo,
              region,
            });
            console.log(`${gLine}${chalk.cyan('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`);
            result = { content: subResult };
          } else {
            result = await executeTool(tool.name, tool.input, workspacePath);
          }

          if (isStreamJson) {
            process.stdout.write(
              JSON.stringify({
                type: 'tool_result',
                tool_use_id: tool.id,
                content: result.content,
                is_error: result.is_error,
              }) + '\n',
            );
          } else {
            spinner?.stop();
            const preview = result.content.slice(0, 60).replace(/\n/g, ' ');
            console.log(
              `${gLine}${result.is_error ? theme.toolError(preview) : theme.toolResult(preview + '…')}`,
            );
            spinner = ora({
              text: chalk.dim('Resuming…'),
              prefixText: gLine,
              color: 'cyan',
            }).start();
          }

          return await executeTurn(
            `[Tool Result for ${tool.name}]: ${result.content}`,
            model,
            sessionId,
            workspacePath,
            isStreamJson,
            depth,
            yolo,
            region,
          );
        }

        if (data.type === 'message_stop') {
          if (isStreamJson) {
            process.stdout.write(
              JSON.stringify({ type: 'result', subtype: 'success', stop_reason: 'end_turn' }) +
                '\n',
            );
          }
          if (session) session.emitter.emit('agent:stop');

          if (!isStreamJson) {
            spinner?.stop();
            process.stdout.write('\n');
            if (usage && depth === 0) {
              console.log(
                `${gLine}${chalk.dim(`Tokens: ${usage.input_tokens + usage.output_tokens}`)}`,
              );
            }
          }
          return fullText;
        }
      } catch (e: any) {
        if (!e.message.includes('JSON')) throw e;
      }
    }
  }
  return fullText;
}

function nanoid(len = 21) {
  return Math.random()
    .toString(36)
    .substring(2, 2 + len);
}
