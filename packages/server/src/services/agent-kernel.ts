/**
 * Agent Kernel — The unified core engine for E.
 */

import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { createGeminiStreamV2 } from './gemini-provider-v2';
import { createBedrockStream } from './bedrock-provider';
import { executeTool } from './tool-executor';
import { buildCliCommand } from './cli-provider';
import { execSync } from 'child_process';

export interface KernelEvent {
  type: 'thinking' | 'text' | 'tool_call' | 'tool_result' | 'stop' | 'error' | 'status' | 'approval_required';
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
}

export class AgentKernel extends EventEmitter {
  private depth: number;
  private sessionId: string;
  private workspacePath: string;
  private isRunning: boolean = false;
  private useExternalCli: boolean;
  private yolo: boolean;
  private onApproval?: (tool: any) => Promise<boolean>;

  constructor(opts: KernelOptions) {
    super();
    this.sessionId = opts.sessionId;
    this.depth = opts.depth || 0;
    this.workspacePath = opts.workspacePath || process.cwd();
    this.useExternalCli = !!opts.useExternalCli;
    this.yolo = !!opts.yolo;
    this.onApproval = opts.onApproval;
  }

  async run(prompt: string, model: string, systemPrompt?: string, region?: string): Promise<string> {
    if (this.isRunning) throw new Error('Kernel is already running a turn.');
    this.isRunning = true;

    try {
      if (this.useExternalCli || model === 'external') {
        return await this.runExternalCli(prompt, model);
      }
      return await this.executeTurn(prompt, model, systemPrompt, region);
    } finally {
      this.isRunning = false;
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
               const errorMsg = event.message || (event.errors ? event.errors.join('\n') : 'Claude Code execution error');
               this.emitEvent('error', { message: errorMsg });
            }
            this.emitEvent('stop', { usage: event.usage });
          }
        } catch { }
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
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: this.workspacePath, encoding: 'utf-8' }).trim();
      gitContext = `\n[Git Context: branch ${branch}]`;
    } catch {}

    const systemPrompt = customSystemPrompt || `You are E (Depth: ${this.depth}), an autonomous AI assistant. Fulfill requests accurately. ${gitContext}`;

    const isBedrock = model.startsWith('bedrock:') || model.startsWith('claude:');
    const isGemini = model.startsWith('gemini:');
    const strippedModel = isBedrock
      ? model.replace('bedrock:', '')
      : isGemini
        ? model.replace('gemini:', '')
        : model;

    const streamOpts: any = {
      model: strippedModel,
      content: prompt,
      conversationId: this.sessionId,
      workspacePath: this.workspacePath,
      systemPrompt,
      region: region || process.env.AWS_REGION || 'us-east-1',
    };

    const stream = isBedrock
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
          if (data.type === 'error') throw new Error(data.error?.message || data.message || 'Provider error');
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
              if (!approved) return await this.executeTurn(`[Tool Result for ${tool.name}]: Denied by user.`, model, systemPrompt, region);
            }

            let result: any;
            if (tool.name === 'Agent') {
              const subKernel = new AgentKernel({
                sessionId: `${this.sessionId}_sub_${nanoid(4)}`,
                depth: this.depth + 1,
                workspacePath: this.workspacePath,
                useExternalCli: this.useExternalCli,
                yolo: this.yolo,
                onApproval: this.onApproval
              });
              subKernel.on('event', (ev) => this.emit('event', ev));
              const subResult = await subKernel.run(tool.input.objective, tool.input.model || model, undefined, region);
              result = { content: subResult };
            } else {
              result = await executeTool(tool.name, tool.input, this.workspacePath);
            }

            this.emitEvent('tool_result', { tool_use_id: tool.id, tool_name: tool.name, content: result.content, is_error: result.is_error });
            return await this.executeTurn(`[Tool Result for ${tool.name}]: ${result.content}`, model, systemPrompt, region);
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
