import { nanoid } from 'nanoid';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getDb } from '../db/database';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

interface StreamSession {
  id: string;
  conversationId: string;
  model: string;
  systemPrompt?: string;
  abortController?: AbortController;
}

interface AuthInfo {
  token: string;
  type: 'api-key' | 'oauth';
}

class ClaudeApiClient {
  private sessions = new Map<string, StreamSession>();
  private cachedAuth: AuthInfo | null = null;

  private getAuth(): AuthInfo {
    if (this.cachedAuth) return this.cachedAuth;

    // 1. Check ANTHROPIC_API_KEY env var
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.cachedAuth = { token: apiKey, type: 'api-key' };
      return this.cachedAuth;
    }

    // 2. Fall back to Claude Code OAuth credentials
    try {
      const credPath = join(homedir(), '.claude', '.credentials.json');
      const creds = JSON.parse(readFileSync(credPath, 'utf-8'));
      const oauthToken = creds?.claudeAiOauth?.accessToken;
      if (oauthToken) {
        this.cachedAuth = { token: oauthToken, type: 'oauth' };
        return this.cachedAuth;
      }
    } catch {
      // Credentials file not found or invalid
    }

    throw new Error(
      'No Anthropic API key found. Set ANTHROPIC_API_KEY or log in with Claude Code.',
    );
  }

  createSession(
    conversationId: string,
    opts: {
      model?: string;
      systemPrompt?: string;
    } = {},
  ): string {
    const sessionId = nanoid();
    this.sessions.set(sessionId, {
      id: sessionId,
      conversationId,
      model: opts.model || 'claude-sonnet-4-6',
      systemPrompt: opts.systemPrompt,
    });
    return sessionId;
  }

  async sendMessage(sessionId: string, content: string): Promise<ReadableStream> {
    const sessionOrUndef = this.sessions.get(sessionId);
    if (!sessionOrUndef) throw new Error(`Session ${sessionId} not found`);
    const session = sessionOrUndef;

    const auth = this.getAuth();

    // Build conversation history from DB
    const db = getDb();
    const rows = db
      .query('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
      .all(session.conversationId) as Array<{ role: string; content: string }>;

    const messages = rows.map((row) => {
      const parsed = JSON.parse(row.content);
      // Normalize nudge content blocks → text for Anthropic API compatibility
      const content = Array.isArray(parsed)
        ? parsed.map((block: any) =>
            block.type === 'nudge' ? { type: 'text', text: `[User nudge]: ${block.text}` } : block,
          )
        : parsed;
      return { role: row.role as 'user' | 'assistant', content };
    });

    // Build request body
    const body: Record<string, unknown> = {
      model: session.model,
      max_tokens: 16384,
      stream: true,
      messages,
    };

    if (session.systemPrompt) {
      body.system = session.systemPrompt;
    }

    // Create abort controller for this request
    const abortController = new AbortController();
    session.abortController = abortController;

    // Build auth headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
    };
    if (auth.type === 'oauth') {
      headers['Authorization'] = `Bearer ${auth.token}`;
    } else {
      headers['x-api-key'] = auth.token;
    }

    // Call Anthropic API
    const apiResponse = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: abortController.signal,
    });

    if (!apiResponse.ok) {
      const errBody = await apiResponse.text().catch(() => 'Unknown error');
      const encoder = new TextEncoder();
      return new ReadableStream({
        start(controller) {
          const errorEvent = {
            type: 'error',
            error: {
              type: 'api_error',
              message: `Anthropic API ${apiResponse.status}: ${errBody}`,
            },
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
          controller.close();
        },
      });
    }

    // Pipe the Anthropic SSE stream directly to the client
    // The Anthropic API returns SSE with `event:` and `data:` lines.
    // We need to extract just the `data:` lines and forward them.
    const encoder = new TextEncoder();
    const apiReader = apiResponse.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let assistantContent: Array<Record<string, unknown>> = [];

    return new ReadableStream({
      start(controller) {
        const pingInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`data: {"type":"ping"}\n\n`));
          } catch {
            clearInterval(pingInterval);
          }
        }, 15000);

        async function pump() {
          try {
            while (true) {
              const { done, value } = await apiReader.read();
              if (done) {
                clearInterval(pingInterval);
                // Save assistant message to DB
                if (assistantContent.length > 0) {
                  const msgId = nanoid();
                  const db = getDb();
                  db.query(
                    `
                    INSERT INTO messages (id, conversation_id, role, content, model, timestamp)
                    VALUES (?, ?, 'assistant', ?, ?, ?)
                  `,
                  ).run(
                    msgId,
                    session.conversationId,
                    JSON.stringify(assistantContent),
                    session.model,
                    Date.now(),
                  );

                  // Update conversation timestamp
                  db.query('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
                    Date.now(),
                    session.conversationId,
                  );
                }
                controller.close();
                return;
              }

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                // Anthropic SSE format: "event: <type>\ndata: <json>\n\n"
                // We only care about data lines
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (!data || data === '[DONE]') continue;

                try {
                  const event = JSON.parse(data);

                  // Track content blocks for DB persistence
                  if (event.type === 'content_block_start') {
                    assistantContent.push({ ...event.content_block });
                  } else if (event.type === 'content_block_delta') {
                    const block = assistantContent[event.index];
                    if (block) {
                      if (event.delta.type === 'text_delta' && block.type === 'text') {
                        block.text = ((block.text as string) || '') + (event.delta.text || '');
                      } else if (
                        event.delta.type === 'thinking_delta' &&
                        block.type === 'thinking'
                      ) {
                        block.thinking =
                          ((block.thinking as string) || '') + (event.delta.thinking || '');
                      }
                    }
                  }

                  // Forward the event as-is to the client
                  controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                } catch {
                  // Non-JSON data line, skip
                }
              }
            }
          } catch (err) {
            clearInterval(pingInterval);
            if ((err as Error).name === 'AbortError') {
              controller.enqueue(
                encoder.encode(`data: {"type":"message_stop","reason":"cancelled"}\n\n`),
              );
            } else {
              const errorEvent = {
                type: 'error',
                error: { type: 'stream_error', message: String(err) },
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
            }
            controller.close();
          }
        }

        pump();
      },
    });
  }

  cancelGeneration(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.abortController) {
      session.abortController.abort();
      session.abortController = undefined;
    }
  }

  terminateSession(sessionId: string): void {
    this.cancelGeneration(sessionId);
    this.sessions.delete(sessionId);
  }

  getSession(sessionId: string): StreamSession | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): Array<{ id: string; conversationId: string }> {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      conversationId: s.conversationId,
    }));
  }
}

export const claudeApi = new ClaudeApiClient();
