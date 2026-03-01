/**
 * Agent Kernel — The unified core engine for E.
 *
 * This service manages the autonomous agent loop (think-act-verify),
 * handles multi-model routing, tool execution, and recursive agent spawning.
 * It is UI-agnostic and emits events for CLI or GUI consumption.
 */

import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { createGeminiStreamV2 } from './gemini-provider-v2';
import { createBedrockStream } from './bedrock-provider';
import { executeTool } from './tool-executor';
import { execSync } from 'child_process';

export interface KernelEvent {
  type: 'thinking' | 'text' | 'tool_call' | 'tool_result' | 'stop' | 'error' | 'status';
  data?: any;
  depth: number;
  sessionId: string;
}

export interface KernelOptions {
  prompt: string;
  model: string;
  sessionId: string;
  depth?: number;
  workspacePath?: string;
  systemPrompt?: string;
  region?: string;
}

export class AgentKernel extends EventEmitter {
  private depth: number;
  private sessionId: string;
  private workspacePath: string;
  private isRunning: boolean = false;

  constructor(opts: { sessionId: string; depth?: number; workspacePath?: string }) {
    super();
    this.sessionId = opts.sessionId;
    this.depth = opts.depth || 0;
    this.workspacePath = opts.workspacePath || process.cwd();
  }

  /**
   * Run a single autonomous turn (or recursive loop)
   */
  async run(
    prompt: string,
    model: string,
    systemPrompt?: string,
    region?: string,
  ): Promise<string> {
    if (this.isRunning) throw new Error('Kernel is already running a turn.');
    this.isRunning = true;

    try {
      return await this.executeTurn(prompt, model, systemPrompt, region);
    } finally {
      this.isRunning = false;
    }
  }

  private async executeTurn(
    prompt: string,
    model: string,
    customSystemPrompt?: string,
    region?: string,
  ): Promise<string> {
    this.emitEvent('thinking', { message: 'Agent is thinking...' });

    // Gather Git Context
    let gitContext = '';
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.workspacePath,
        encoding: 'utf-8',
      }).trim();
      gitContext = `\n[Git Context: branch ${branch}]`;
    } catch {}

    const defaultSystemPrompt = `You are E (Depth: ${this.depth}), an autonomous AI assistant. Fulfill requests accurately. ${gitContext}`;
    const systemPrompt = customSystemPrompt || defaultSystemPrompt;

    const isBedrock = model.startsWith('bedrock:') || model.startsWith('claude:');
    const streamOpts: any = {
      model: isBedrock ? model.replace('bedrock:', '') : model,
      prompt,
      conversationId: this.sessionId,
      workspacePath: this.workspacePath,
      systemPrompt,
      region: region || process.env.AWS_REGION || 'us-east-1',
    };

    const stream = isBedrock
      ? createBedrockStream({ ...streamOpts, content: prompt })
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

          if (data.type === 'error') {
            throw new Error(data.error?.message || data.message || 'Provider error');
          }

          if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
            const text = data.delta.text;
            fullText += text;
            this.emitEvent('text', { text });
          }

          if (data.type === 'content_block_stop' && data.content_block?.type === 'tool_use') {
            const tool = data.content_block;
            this.emitEvent('tool_call', { tool });

            let result: any;
            if (tool.name === 'Agent') {
              // Recursive delegation
              const subSessionId = `${this.sessionId}_sub_${nanoid(4)}`;
              const subKernel = new AgentKernel({
                sessionId: subSessionId,
                depth: this.depth + 1,
                workspacePath: this.workspacePath,
              });

              // Proxy sub-kernel events to our listeners
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

            // Feed result back for next turn
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
    const event: KernelEvent = {
      type,
      data,
      depth: this.depth,
      sessionId: this.sessionId,
    };
    this.emit('event', event);
  }
}
