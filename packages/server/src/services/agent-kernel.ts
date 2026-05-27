/**
 * Agent Kernel — The unified core engine for E.
 */

import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { createGeminiStreamV2 } from './gemini-provider-v2';
import { createBedrockStream } from './bedrock-provider';
import { createOllamaStreamV2 } from './ollama-provider-v2';
import { createOpenAIStreamV2 } from './openai-provider-v2';
import { executeTool } from './tool-executor';
import { buildCliCommand } from './cli-provider';
import { acquire as acquireKiroSession } from './kiro-acp/session-pool';
import { buildKiroPromptBlocks } from './kiro-acp/attachments';
import type { Attachment } from '@e/shared';
import { execSync } from 'child_process';

export interface KernelEvent {
  type:
    | 'thinking'
    | 'text'
    | 'tool_call'
    | 'tool_result'
    | 'stop'
    | 'error'
    | 'status'
    | 'approval_required';
  data?: any;
  depth: number;
  sessionId: string;
}

export interface KernelOptions {
  sessionId: string;
  depth?: number;
  workspacePath?: string;
  useExternalCli?: boolean;
  yolo?: boolean;
  onApproval?: (tool: any) => Promise<boolean>;
  /**
   * CLI provider for this kernel turn. Picks the runtime path:
   *   - 'kiro' → runKiroAcp (stateful JSON-RPC ACP subprocess)
   *   - any other → existing useExternalCli / executeTurn paths
   * Defaults to undefined (falls back to the legacy useExternalCli branching).
   */
  provider?: string;
}

/** Per-turn options that don't belong on the constructor — image attachments
 *  for multimodal prompts, currently honored only by the Kiro path. */
export interface RunOptions {
  attachments?: Attachment[];
}

export class AgentKernel extends EventEmitter {
  private depth: number;
  private sessionId: string;
  private workspacePath: string;
  private isRunning: boolean = false;
  private useExternalCli: boolean;
  private yolo: boolean;
  private onApproval?: (tool: any) => Promise<boolean>;
  private provider?: string;
  /**
   * Reference to the currently-acquired Kiro ACP client during a kiro turn,
   * so cancelTurn() can issue `session/cancel` without re-acquiring. Null
   * outside of an in-flight kiro turn.
   */
  private currentKiroClient: { cancel: () => Promise<void> } | null = null;

  constructor(opts: KernelOptions) {
    super();
    this.sessionId = opts.sessionId;
    this.depth = opts.depth || 0;
    this.workspacePath = opts.workspacePath || process.cwd();
    this.useExternalCli = !!opts.useExternalCli;
    this.yolo = !!opts.yolo;
    this.onApproval = opts.onApproval;
    this.provider = opts.provider;
  }

  async run(
    prompt: string,
    model: string,
    systemPrompt?: string,
    region?: string,
    runOpts?: RunOptions,
  ): Promise<string> {
    if (this.isRunning) throw new Error('Kernel is already running a turn.');
    this.isRunning = true;

    try {
      // Kiro routes through ACP regardless of useExternalCli — the legacy
      // external-CLI path is hardcoded to spawn `claude`, which is wrong for
      // a Kiro-selected user.
      if (this.provider === 'kiro') {
        return await this.runKiroAcp(prompt, runOpts?.attachments);
      }
      if (this.useExternalCli || model === 'external') {
        return await this.runExternalCli(prompt, model);
      }
      return await this.executeTurn(prompt, model, systemPrompt, region);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Drive a Kiro-CLI ACP session for one turn. Acquires the per-conversation
   * client (long-lived subprocess; pool keyed on sessionId), forwards prompt
   * + image attachments as ACP `session/prompt`, and translates incoming
   * `session/update` notifications into the kernel's existing event surface
   * so the route handlers (DB persistence, hook firing, approval gating)
   * don't need to know they're talking to Kiro.
   */
  private async runKiroAcp(prompt: string, attachments?: Attachment[]): Promise<string> {
    this.emitEvent('thinking', { message: 'Spawning Kiro ACP session...' });

    let client;
    try {
      client = await acquireKiroSession({
        conversationId: this.sessionId,
        cwd: this.workspacePath,
      });
    } catch (err) {
      this.emitEvent('error', {
        message: `kiro-cli acp failed to start: ${err instanceof Error ? err.message : String(err)}`,
      });
      return '';
    }

    let fullText = '';
    const onUpdate = (update: any) => {
      switch (update.sessionUpdate) {
        case 'agent_message_chunk': {
          const text = update.content?.type === 'text' ? (update.content.text ?? '') : '';
          if (text) {
            fullText += text;
            this.emitEvent('text', { text });
          }
          break;
        }
        case 'agent_thought_chunk': {
          // Surface thinking deltas in the kernel's thinking channel — the
          // route already maps these to `content_block_delta(thinking_delta)`.
          const text = update.content?.type === 'text' ? (update.content.text ?? '') : '';
          if (text) this.emitEvent('thinking', { message: text });
          break;
        }
        case 'tool_call': {
          // Best-effort mapping — Kiro's tool payload field names aren't
          // pinned in spec; we fall through several. The route's approval
          // gating runs on whatever we surface here, so this is the seam
          // where Kiro tool calls inherit E's permission rules.
          const u = update as any;
          this.emitEvent('tool_call', {
            tool: {
              id: u.toolCallId || u.toolCall?.id || nanoid(),
              name: u.toolName || u.toolCall?.name || u.name || 'unknown',
              input: u.input || u.toolCall?.input || u.arguments || {},
            },
          });
          break;
        }
        // tool_call_update / unknown — drop silently for now; the translator
        // in kiro-acp/ documents the same trade-off and a sibling Linear
        // issue (LYK-973) tracks expanding this against real payloads.
      }
    };
    client.on('update', onUpdate);
    // Stash on the kernel so cancelTurn() can reach the in-flight client
    // without re-acquiring (and without the route needing to know about
    // session-pool internals).
    this.currentKiroClient = client;

    try {
      const result = await client.prompt(buildKiroPromptBlocks(prompt, attachments));
      this.emitEvent('stop', {
        usage: { input_tokens: 0, output_tokens: 0 },
        stopReason: result.stopReason || 'end_turn',
      });
    } catch (err) {
      this.emitEvent('error', {
        message: `kiro-cli prompt failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      client.off('update', onUpdate);
      this.currentKiroClient = null;
    }
    return fullText;
  }

  /**
   * Best-effort cancel of the in-flight turn. For Kiro, this sends ACP
   * `session/cancel`; Kiro will resolve its prompt Promise with whatever
   * stopReason it returns (typically 'cancelled'). For other providers this
   * is currently a no-op — they don't have a comparable interrupt path yet.
   *
   * Called by the route when the user denies a tool approval. Note this is
   * advisory: Kiro tool execution runs in-process and may already be
   * committed by the time cancel arrives. The honest framing is "stop
   * future work on this turn", not "undo what already ran".
   */
  cancelTurn(): void {
    if (this.currentKiroClient) {
      this.currentKiroClient.cancel().catch((err) => {
        console.warn('[kernel] kiro cancelTurn failed:', err);
      });
    }
  }

  private async runExternalCli(prompt: string, model: string): Promise<string> {
    this.emitEvent('thinking', { message: `Spawning External CLI (Claude Code)...` });

    const { binary, args } = buildCliCommand('claude', {
      content: prompt,
      resumeSessionId: this.sessionId,
      yolo: this.yolo,
    });

    args.push('--include-partial-messages');

    const proc = Bun.spawn([binary, ...args], {
      cwd: this.workspacePath,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          let event = JSON.parse(trimmed);

          // Unwrap stream events
          if (event.type === 'stream_event' && event.event) {
            event = event.event;
          }

          // 1. Handle Text Deltas (Live streaming)
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            const deltaText = event.delta.text;
            fullText += deltaText;
            this.emitEvent('text', { text: deltaText });
          }

          // 2. Handle Tool Calls
          if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            this.emitEvent('tool_call', { tool: event.content_block });
          }

          // 3. Handle Full Assistant Messages (fallback/verification)
          if (event.type === 'assistant' && event.message?.content) {
            const blocks = event.message.content;
            for (const block of blocks) {
              if (block.type === 'text' && !fullText) {
                // Only emit if we haven't seen deltas (unlikely with partial-messages flag)
                fullText = block.text;
                this.emitEvent('text', { text: block.text });
              }
              if (block.type === 'tool_use') {
                // Tool use usually comes in content_block_start, but safety check
              }
            }
          }

          if (event.type === 'tool_result') {
            this.emitEvent('tool_result', event);
          }

          if (event.type === 'result') {
            if (event.subtype === 'error_during_execution' || event.is_error) {
              const errorMsg =
                event.message ||
                (event.errors ? event.errors.join('\n') : 'Claude Code execution error');
              this.emitEvent('error', { message: errorMsg });
            }
            this.emitEvent('stop', { usage: event.usage });
          }
        } catch {}
      }
    }

    return fullText;
  }

  private async executeTurn(
    prompt: string,
    model: string,
    customSystemPrompt?: string,
    region?: string,
  ): Promise<string> {
    this.emitEvent('thinking', { message: 'Agent is thinking...' });

    let gitContext = '';
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.workspacePath,
        encoding: 'utf-8',
      }).trim();
      gitContext = `\n[Git Context: branch ${branch}]`;
    } catch {}

    const systemPrompt =
      customSystemPrompt ||
      `You are E (Depth: ${this.depth}), an autonomous AI assistant. Fulfill requests accurately. ${gitContext}`;

    const isBedrock = model.startsWith('bedrock:') || model.startsWith('claude:');
    const isGemini = model.startsWith('gemini:');
    const isOllama = model.startsWith('ollama:');
    const isOpenAI = model.startsWith('openai:');
    const strippedModel = model.replace(/^(bedrock|gemini|ollama|openai|claude):/, '');

    const streamOpts: any = {
      model: strippedModel,
      content: prompt,
      conversationId: this.sessionId,
      workspacePath: this.workspacePath,
      systemPrompt,
      region: region || process.env.AWS_REGION || 'us-east-1',
    };

    const stream = isOllama
      ? createOllamaStreamV2(streamOpts)
      : isOpenAI
        ? createOpenAIStreamV2(streamOpts)
        : isBedrock
          ? createBedrockStream(streamOpts)
          : createGeminiStreamV2(streamOpts);

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

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
          if (data.type === 'error')
            throw new Error(data.error?.message || data.message || 'Provider error');
          if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
            const text = data.delta.text;
            fullText += text;
            this.emitEvent('text', { text: data.delta.text });
          }

          if (data.type === 'content_block_stop' && data.content_block?.type === 'tool_use') {
            const tool = data.content_block;
            this.emitEvent('tool_call', { tool });

            if (this.onApproval && !this.yolo && ['Write', 'Edit', 'Bash'].includes(tool.name)) {
              const approved = await this.onApproval(tool);
              if (!approved)
                return await this.executeTurn(
                  `[Tool Result for ${tool.name}]: Denied by user.`,
                  model,
                  systemPrompt,
                  region,
                );
            }

            let result: any;
            if (tool.name === 'Agent') {
              const subKernel = new AgentKernel({
                sessionId: `${this.sessionId}_sub_${nanoid(4)}`,
                depth: this.depth + 1,
                workspacePath: this.workspacePath,
                useExternalCli: this.useExternalCli,
                yolo: this.yolo,
                onApproval: this.onApproval,
              });
              subKernel.on('event', (ev) => this.emit('event', ev));
              const subResult = await subKernel.run(
                tool.input.objective,
                tool.input.model || model,
                undefined,
                region,
              );
              result = { content: subResult };
            } else {
              result = await executeTool(tool.name, tool.input, this.workspacePath);
            }

            this.emitEvent('tool_result', {
              tool_use_id: tool.id,
              tool_name: tool.name,
              content: result.content,
              is_error: result.is_error,
            });
            return await this.executeTurn(
              `[Tool Result for ${tool.name}]: ${result.content}`,
              model,
              systemPrompt,
              region,
            );
          }

          if (data.type === 'message_stop') {
            this.emitEvent('stop', { usage: data.usage });
            return fullText;
          }
        } catch (e: any) {
          if (!e.message.includes('JSON')) throw e;
        }
      }
    }
    return fullText;
  }

  private emitEvent(type: KernelEvent['type'], data?: any) {
    this.emit('event', { type, data, depth: this.depth, sessionId: this.sessionId });
  }
}
