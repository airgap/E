/**
 * One-shot LLM utility — routes a single prompt through the best available provider.
 *
 * Supports a separate `oneshotProvider` setting that controls how lightweight,
 * non-conversation LLM calls (commentary, commit messages, code actions) are routed:
 *
 *   - 'auto' (default): Try local Ollama first, fall back to CLI provider
 *   - 'ollama': Always use local Ollama
 *   - 'cli': Always use the configured cliProvider (Claude/Gemini/Copilot CLI)
 *
 * Direct provider routing (when cliProvider itself is the target):
 *   - CLI providers (claude, gemini-cli, copilot): spawn CLI with `-p`, parse stream-json
 *   - Ollama: non-streaming POST to local API
 *   - Bedrock: AWS SDK InvokeModelCommand (non-streaming)
 *   - Kiro: fallback to direct Anthropic API if ANTHROPIC_API_KEY is set
 */

import { getDb } from '../db/database';
import { buildCliCommand } from './cli-provider';
import { checkOllamaHealth } from './ollama-provider';
import type { CliProvider, OneshotProvider } from '@e/shared';

export interface CallLlmOptions {
  /** System prompt for the LLM. */
  system: string;
  /** User prompt (the actual request). */
  user: string;
  /** Optional model override. If omitted, the CLI/provider uses its default. */
  model?: string;
  /** Timeout in milliseconds (default: 120 000). */
  timeoutMs?: number;
  /**
   * When true, skip Ollama and go straight to the CLI provider.
   * Useful when the local model can't handle a task (e.g. structured output)
   * and you need a more capable model.
   */
  forceCliProvider?: boolean;
}

/**
 * Read the configured CLI provider from the settings DB.
 * Falls back to 'claude' if not set.
 */
function getConfiguredProvider(): CliProvider {
  try {
    const db = getDb();
    const row = db.query("SELECT value FROM settings WHERE key = 'cliProvider'").get() as any;
    if (row) return JSON.parse(row.value) as CliProvider;
  } catch {
    /* use default */
  }
  return 'claude';
}

/**
 * Read the configured one-shot provider from the settings DB.
 * Falls back to 'auto' if not set.
 */
function getOneshotProvider(): OneshotProvider {
  try {
    const db = getDb();
    const row = db.query("SELECT value FROM settings WHERE key = 'oneshotProvider'").get() as any;
    if (row) return JSON.parse(row.value) as OneshotProvider;
  } catch {
    /* use default */
  }
  return 'auto';
}

/**
 * Read the configured one-shot model from the settings DB.
 * Falls back to 'qwen3:1.7b' if not set.
 */
function getOneshotModel(): string {
  try {
    const db = getDb();
    const row = db.query("SELECT value FROM settings WHERE key = 'oneshotModel'").get() as any;
    if (row) return JSON.parse(row.value) as string;
  } catch {
    /* use default */
  }
  return 'qwen3:1.7b';
}

// ---------------------------------------------------------------------------
// Cached Ollama availability check
// ---------------------------------------------------------------------------

let ollamaAvailable: boolean | null = null;
let ollamaLastCheck = 0;
const OLLAMA_CACHE_TTL_MS = 60_000; // Re-check every 60 seconds

async function isOllamaAvailable(): Promise<boolean> {
  const now = Date.now();
  if (ollamaAvailable !== null && now - ollamaLastCheck < OLLAMA_CACHE_TTL_MS) {
    return ollamaAvailable;
  }

  ollamaAvailable = await checkOllamaHealth();
  ollamaLastCheck = now;

  if (ollamaAvailable) {
    console.log('[callLlm] Ollama is available — will use for one-shot calls');
  }

  return ollamaAvailable;
}

/** Reset the cached Ollama health state (useful after settings change). */
export function resetOllamaCache(): void {
  ollamaAvailable = null;
  ollamaLastCheck = 0;
}

/**
 * One-shot LLM call that routes through the best available provider.
 *
 * Routing logic:
 *   1. Check oneshotProvider setting ('auto' | 'ollama' | 'cli')
 *   2. If 'auto': try Ollama first (cached health check), fall back to CLI
 *   3. If 'ollama': use Ollama directly (throws if unavailable)
 *   4. If 'cli': use the configured cliProvider as before
 *
 * Returns the plain text response from the LLM.
 * Throws on failure — callers should catch and return appropriate HTTP errors.
 */
export async function callLlm(opts: CallLlmOptions): Promise<string> {
  const oneshotProv = getOneshotProvider();
  const timeout = opts.timeoutMs ?? 120_000;

  // --- Force CLI path (skip Ollama entirely) ---
  if (opts.forceCliProvider) {
    const provider = getConfiguredProvider();
    switch (provider) {
      case 'claude':
      case 'gemini-cli':
      case 'copilot':
        return callViaCli(provider, opts, timeout);
      case 'bedrock':
        return callViaBedrock(opts, timeout);
      case 'kiro':
        return callViaKiroFallback(opts, timeout);
      default:
        // If CLI provider is ollama, fall through to normal routing
        break;
    }
  }

  // --- Ollama fast path ---
  if (oneshotProv === 'ollama') {
    return callViaOllama(opts, timeout);
  }

  if (oneshotProv === 'auto') {
    const available = await isOllamaAvailable();
    if (available) {
      try {
        // Use the configured oneshot model for Ollama
        const oneshotModel = getOneshotModel();
        const ollamaOpts = { ...opts, model: opts.model || oneshotModel };
        return await callViaOllama(ollamaOpts, timeout);
      } catch (err) {
        // Ollama failed — invalidate cache and fall through to CLI
        console.warn('[callLlm] Ollama failed, falling back to CLI:', (err as Error).message);
        ollamaAvailable = null;
        ollamaLastCheck = 0;
      }
    }
  }

  // --- CLI / direct provider path ---
  const provider = getConfiguredProvider();

  switch (provider) {
    case 'claude':
    case 'gemini-cli':
    case 'copilot':
      return callViaCli(provider, opts, timeout);
    case 'ollama':
      return callViaOllama(opts, timeout);
    case 'bedrock':
      return callViaBedrock(opts, timeout);
    case 'kiro':
      return callViaKiroFallback(opts, timeout);
    default:
      throw new Error(`Unsupported provider for one-shot LLM calls: ${provider}`);
  }
}

// ---------------------------------------------------------------------------
// CLI strategy (claude, gemini-cli, copilot)
// ---------------------------------------------------------------------------

async function callViaCli(
  provider: CliProvider,
  opts: CallLlmOptions,
  timeoutMs: number,
): Promise<string> {
  const { binary, args } = buildCliCommand(provider, {
    content: opts.user,
    systemPrompt: opts.system,
    model: opts.model,
    maxTurns: 1,
  });

  const proc = Bun.spawn([binary, ...args], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...(process.env as Record<string, string>),
      FORCE_COLOR: '0',
      CI: '1',
      NONINTERACTIVE: '1',
    },
  });

  // Close stdin immediately — one-shot, no further input needed
  try {
    (proc.stdin as any)?.end?.();
  } catch {
    /* already closed */
  }

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`CLI timed out after ${timeoutMs}ms`)), timeoutMs),
  );

  let stdout: string;
  let stderr: string;
  try {
    const [outBuf, errBuf] = await Promise.race([
      Promise.all([
        new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
        new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
      ]),
      timeoutPromise,
    ]);
    stdout = outBuf;
    stderr = errBuf;
  } catch (err) {
    try {
      proc.kill();
    } catch {
      /* already dead */
    }
    throw err;
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0 && !stdout.trim()) {
    throw new Error(`CLI exited with code ${exitCode}: ${stderr.slice(0, 500)}`);
  }

  return extractTextFromStreamJson(stdout);
}

/**
 * Parse newline-delimited JSON (stream-json format) from CLI output
 * and extract concatenated text content from assistant events.
 *
 * Stream-json events look like:
 *   {"type":"system","subtype":"init","session_id":"..."}
 *   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
 *   {"type":"result","subtype":"success","usage":{...}}
 */
function extractTextFromStreamJson(output: string): string {
  const textParts: string[] = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text);
          }
        }
      }
    } catch {
      // Non-JSON line — CLI startup messages, warnings, etc.
    }
  }

  const result = textParts.join('');
  if (!result) {
    throw new Error('CLI produced no text content in response');
  }
  return result;
}

// ---------------------------------------------------------------------------
// Ollama strategy
// ---------------------------------------------------------------------------

async function callViaOllama(opts: CallLlmOptions, timeoutMs: number): Promise<string> {
  const base = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

  // Resolve model from settings if not provided
  let model = opts.model;
  if (!model) {
    try {
      const db = getDb();
      const row = db.query("SELECT value FROM settings WHERE key = 'model'").get() as any;
      if (row) model = JSON.parse(row.value);
    } catch {
      /* use default */
    }
  }
  // Strip 'ollama:' prefix if present
  if (model?.startsWith('ollama:')) model = model.slice(7);
  if (!model) model = getOneshotModel();

  const messages: Array<{ role: string; content: string }> = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: opts.user });

  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Ollama error ${response.status}: ${await response.text().catch(() => '')}`);
  }

  const result = (await response.json()) as any;
  const text = result.message?.content || '';
  if (!text) throw new Error('Ollama returned no text content');
  return text;
}

// ---------------------------------------------------------------------------
// Bedrock strategy
// ---------------------------------------------------------------------------

async function callViaBedrock(opts: CallLlmOptions, timeoutMs: number): Promise<string> {
  // Dynamic import to avoid requiring the AWS SDK when not using Bedrock
  const { BedrockRuntimeClient, InvokeModelCommand } =
    await import('@aws-sdk/client-bedrock-runtime');

  const region = process.env.AWS_REGION || 'us-east-1';
  const client = new BedrockRuntimeClient({ region });

  // Resolve model — strip 'bedrock:' prefix, default to Claude Sonnet
  let model = opts.model;
  if (!model) {
    try {
      const db = getDb();
      const row = db.query("SELECT value FROM settings WHERE key = 'model'").get() as any;
      if (row) model = JSON.parse(row.value);
    } catch {
      /* use default */
    }
  }
  if (model?.startsWith('bedrock:')) model = model.slice(8);
  if (!model) model = 'anthropic.claude-sonnet-4-6-v1:0';

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 4096,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  });

  const command = new InvokeModelCommand({
    modelId: model,
    contentType: 'application/json',
    accept: 'application/json',
    body: new TextEncoder().encode(body),
  });

  const response = await client.send(command, {
    requestTimeout: timeoutMs,
  });

  const result = JSON.parse(new TextDecoder().decode(response.body));
  const text = result.content?.[0]?.text || '';
  if (!text) throw new Error('Bedrock returned no text content');
  return text;
}

// ---------------------------------------------------------------------------
// Kiro fallback — Kiro uses ACP/JSON-RPC, too complex for one-shot.
// Falls back to direct Anthropic API if ANTHROPIC_API_KEY is available.
// ---------------------------------------------------------------------------

async function callViaKiroFallback(opts: CallLlmOptions, timeoutMs: number): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Kiro provider does not yet support one-shot LLM calls. ' +
        'Set ANTHROPIC_API_KEY for fallback, or switch to claude/gemini-cli/copilot provider.',
    );
  }

  console.warn(
    '[callLlm] Kiro does not support one-shot calls — falling back to direct Anthropic API.',
  );

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      model: opts.model || 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(
      `Anthropic API error ${response.status}: ${await response.text().catch(() => '')}`,
    );
  }

  const result = (await response.json()) as any;
  const text = result.content?.[0]?.text || '';
  if (!text) throw new Error('Anthropic API returned no text content');
  return text;
}
