import type { CliProvider } from '@e/shared';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface CliSessionOpts {
  content: string;
  resumeSessionId?: string;
  model?: string;
  systemPrompt?: string;
  effort?: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpConfigPath?: string;
}

interface CliCommand {
  binary: string;
  args: string[];
}

/**
 * Resolve the full path to a CLI binary, checking common install locations.
 * Falls back to bare name (relies on PATH) if not found at known locations.
 */
function resolveBinary(name: string): string {
  const home = homedir();
  const candidates = [
    join(home, '.local', 'bin', name),
    join(home, '.claude', 'local', 'bin', name),
    join(home, '.npm-global', 'bin', name),
    join('/usr', 'local', 'bin', name),
    join('/usr', 'bin', name),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return name; // fall back to PATH lookup
}

/**
 * Build the CLI command + args for a given provider.
 *
 * Claude Code:
 *   claude -p <msg> --output-format stream-json --verbose --dangerously-skip-permissions [flags...]
 *
 * Kiro CLI (ACP mode for JSON-RPC output):
 *   kiro-cli acp
 *   Communicates via JSON-RPC 2.0 over stdin/stdout for reliable structured output.
 *
 * Gemini CLI (headless mode with stream-json output):
 *   gemini -p <msg> --output-format stream-json --sandbox=off [flags...]
 *   Uses Google's open-source Gemini CLI in headless/non-interactive mode.
 *
 * GitHub Copilot CLI (non-interactive mode):
 *   copilot -p <msg> --format json --no-interactive [flags...]
 *   Uses GitHub's Copilot CLI in programmatic non-interactive mode.
 *
 * Bedrock & Ollama:
 *   No CLI — handled via direct API calls in bedrock-provider.ts and ollama-provider.ts
 */
export function buildCliCommand(provider: CliProvider, opts: CliSessionOpts): CliCommand {
  switch (provider) {
    case 'kiro':
      return buildKiroCommand(opts);
    case 'gemini-cli':
      return buildGeminiCliCommand(opts);
    case 'copilot':
      return buildCopilotCommand(opts);
    case 'bedrock':
    case 'ollama':
      // Bedrock and Ollama use direct API calls, not CLI processes
      throw new Error(`${provider} provider does not use CLI commands — use API streaming instead`);
    case 'claude':
    default:
      return buildClaudeCommand(opts);
  }
}

function buildClaudeCommand(opts: CliSessionOpts): CliCommand {
  const args = ['--output-format', 'stream-json', '--verbose', '-p', opts.content];

  if (opts.resumeSessionId) args.push('-r', opts.resumeSessionId);
  if (opts.model) args.push('--model', opts.model);
  if (opts.systemPrompt) args.push('--system-prompt', opts.systemPrompt);

  args.push('--dangerously-skip-permissions');

  if (opts.effort) args.push('--effort', opts.effort);
  if (opts.maxBudgetUsd != null) args.push('--max-budget-usd', String(opts.maxBudgetUsd));
  if (opts.maxTurns != null) args.push('--max-turns', String(opts.maxTurns));
  if (opts.allowedTools?.length) {
    for (const tool of opts.allowedTools) args.push('--allowedTools', tool);
  }
  if (opts.disallowedTools?.length) {
    for (const tool of opts.disallowedTools) args.push('--disallowedTools', tool);
  }
  if (opts.mcpConfigPath) args.push('--mcp-config', opts.mcpConfigPath);

  return { binary: resolveBinary('claude'), args };
}

function buildKiroCommand(opts: CliSessionOpts): CliCommand {
  // Use ACP (Agent Client Protocol) mode for JSON-RPC communication.
  // ACP provides reliable, structured JSON-RPC 2.0 output over stdin/stdout.
  const args = ['acp'];

  // TODO: The caller (claude-process.ts) needs to implement ACP protocol initialization:
  // 1. After spawning, send initialize request:
  //    {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"capabilities":{}}}
  //    Response will include: promptCapabilities.image: true (multimodal support!)
  // 2. Then send session/new or session/prompt with the actual prompt:
  //    {"jsonrpc":"2.0","id":2,"method":"session/prompt","params":{"prompt": [text and image blocks]}}
  // 3. Handle JSON-RPC responses and notifications (AgentMessageChunk, ToolCall, TurnEnd)
  //
  // Note: Kiro CLI supports images via ACP! Can send base64-encoded images in prompt blocks.
  // See docs/kiro-cli-images.md for details on multimodal support.
  //
  // For now, we warn about unsupported options until full ACP integration is implemented.

  if (
    opts.model ||
    opts.systemPrompt ||
    opts.effort ||
    opts.maxTurns != null ||
    opts.maxBudgetUsd != null ||
    opts.allowedTools?.length ||
    opts.resumeSessionId
  ) {
    console.warn(
      '[kiro-acp] Options like --model, --system-prompt, --effort, --max-turns, --max-budget-usd, --allowed-tools, and --resume need to be sent via JSON-RPC protocol or configured in Kiro agent config. Full ACP integration pending.',
    );
  }

  return { binary: resolveBinary('kiro-cli'), args };
}

/**
 * Build the CLI command for Google Gemini CLI.
 *
 * Gemini CLI supports headless/non-interactive mode with structured JSON output.
 * In headless mode, it runs without a TUI, accepting a prompt via -p flag
 * and streaming results as newline-delimited JSON events.
 *
 * Docs: https://geminicli.com/docs/cli/headless/
 *
 * Flags:
 *   -p <prompt>              Non-interactive prompt (headless mode trigger)
 *   --output-format stream-json   Stream JSONL events (messages, tool calls, results)
 *   --sandbox=off            Disable sandbox for full tool access (we manage our own)
 *   --model <model>          Override the default model
 *   --system-prompt <text>   Set a system instruction
 *   --yolo                   Skip all confirmation prompts (auto-approve tools)
 *   --mcp-config <path>      MCP server configuration file
 *   -r <session>             Resume a previous session
 */
function buildGeminiCliCommand(opts: CliSessionOpts): CliCommand {
  const args = ['--output-format', 'stream-json', '-p', opts.content];

  // Disable Gemini's built-in sandbox — E manages its own sandboxing
  args.push('--sandbox=off');

  // Auto-approve all tool usage — E handles permission checks upstream
  args.push('--yolo');

  if (opts.resumeSessionId) args.push('-r', opts.resumeSessionId);
  if (opts.model) args.push('--model', opts.model);
  if (opts.systemPrompt) args.push('--system-prompt', opts.systemPrompt);
  if (opts.mcpConfigPath) args.push('--mcp-config', opts.mcpConfigPath);

  // Gemini CLI doesn't natively support these flags — they're handled
  // through Gemini's settings.json or extensions instead.
  if (opts.effort || opts.maxTurns != null || opts.maxBudgetUsd != null) {
    console.warn(
      '[gemini-cli] Options --effort, --max-turns, and --max-budget-usd are not natively supported by Gemini CLI. Configure these via Gemini settings.json or ignore.',
    );
  }

  if (opts.allowedTools?.length || opts.disallowedTools?.length) {
    console.warn(
      '[gemini-cli] Tool allow/disallow lists are not natively supported by Gemini CLI. Tool permissions are managed by E.',
    );
  }

  return { binary: resolveBinary('gemini'), args };
}

/**
 * Build the CLI command for GitHub Copilot CLI.
 *
 * Copilot CLI supports non-interactive programmatic mode via -p/--prompt flag
 * with JSON-formatted output for machine consumption.
 *
 * Docs: https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli
 *
 * Flags:
 *   -p <prompt>           Non-interactive prompt
 *   --format json         JSON output format
 *   --no-interactive      Explicitly disable interactive mode
 *   --model <model>       Override the default model (e.g. claude-sonnet-4.5, gpt-5)
 *   --system-prompt <text>  Set a system instruction
 *   --accept-all          Auto-approve all tool executions
 *   --additional-mcp-config <path>  Additional MCP server configuration
 *   -r <session>          Resume a previous session
 */
function buildCopilotCommand(opts: CliSessionOpts): CliCommand {
  const args = ['--format', 'json', '--no-interactive', '-p', opts.content];

  // Auto-approve all tool usage — E handles permission checks upstream
  args.push('--accept-all');

  if (opts.resumeSessionId) args.push('-r', opts.resumeSessionId);
  if (opts.model) args.push('--model', opts.model);
  if (opts.systemPrompt) args.push('--system-prompt', opts.systemPrompt);
  if (opts.mcpConfigPath) args.push('--additional-mcp-config', opts.mcpConfigPath);

  // Copilot CLI doesn't natively support budget/effort/turn limits.
  if (opts.effort || opts.maxBudgetUsd != null) {
    console.warn(
      '[copilot] Options --effort and --max-budget-usd are not natively supported by Copilot CLI.',
    );
  }

  if (opts.maxTurns != null) {
    args.push('--max-turns', String(opts.maxTurns));
  }

  if (opts.allowedTools?.length || opts.disallowedTools?.length) {
    console.warn(
      '[copilot] Tool allow/disallow lists are not natively supported by Copilot CLI. Tool permissions are managed by E.',
    );
  }

  return { binary: resolveBinary('copilot'), args };
}
