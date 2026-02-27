#!/usr/bin/env bun
/**
 * Lightweight MCP stdio server that provides the AskUserQuestion tool.
 *
 * The Claude CLI's built-in AskUserQuestion auto-resolves with
 * --dangerously-skip-permissions, bypassing the user entirely.
 * This MCP server replaces it: when called, it POSTs the question
 * to E's HTTP server, then long-polls for the user's answer.
 *
 * Spawned by generateMcpConfig() and passed via --mcp-config.
 *
 * Protocol: MCP over stdio (JSON-RPC 2.0, newline-delimited).
 */

const E_PORT = process.env.E_PORT || '3002';
const E_BASE = `http://localhost:${E_PORT}`;

// ── JSON-RPC helpers ──

function jsonrpcResponse(id: string | number, result: unknown) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function jsonrpcError(id: string | number, code: number, message: string) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

// ── MCP tool definition ──

const ASK_USER_TOOL = {
  name: 'AskUserQuestion',
  description:
    'Ask the user one or more questions to gather preferences, clarify requirements, or get decisions on implementation choices. Each question can have predefined options for the user to select from.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      questions: {
        type: 'array',
        description:
          'Array of questions to ask the user (1-4 questions). Each question has a question string, a short header label, an array of 2-4 options with label and description, and an optional multiSelect boolean.',
        items: { type: 'object' },
      },
    },
    required: ['questions'],
  },
};

// ── Request handlers ──

async function handleRequest(msg: any): Promise<string> {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      return jsonrpcResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'e-ask-user', version: '1.0.0' },
      });

    case 'notifications/initialized':
      // No response needed for notifications
      return '';

    case 'tools/list':
      return jsonrpcResponse(id, { tools: [ASK_USER_TOOL] });

    case 'tools/call': {
      const toolName = params?.name;
      if (toolName !== 'AskUserQuestion') {
        return jsonrpcError(id, -32601, `Unknown tool: ${toolName}`);
      }

      const questions = params?.arguments?.questions || [];
      try {
        const answer = await askUserAndWait(questions);
        return jsonrpcResponse(id, {
          content: [{ type: 'text', text: JSON.stringify(answer) }],
        });
      } catch (err: any) {
        return jsonrpcResponse(id, {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        });
      }
    }

    default:
      // Unknown methods get a generic error
      if (id != null) {
        return jsonrpcError(id, -32601, `Method not found: ${method}`);
      }
      return ''; // Notifications without id get no response
  }
}

/**
 * POST the question to E's server and long-poll for the user's answer.
 *
 * E server endpoints:
 *   POST /internal/ask-user         — submit question, returns { token }
 *   GET  /internal/ask-user/:token  — blocks until user answers, returns { answers }
 */
async function askUserAndWait(questions: any[]): Promise<any> {
  const { appendFileSync } = await import('fs');
  const dbg = (msg: string) => {
    try {
      appendFileSync('/tmp/e-ask-user-debug.log', `[${new Date().toISOString()}] [mcp] ${msg}\n`);
    } catch {}
  };

  dbg(`askUserAndWait called, E_BASE=${E_BASE}`);

  // Submit question
  const submitRes = await fetch(`${E_BASE}/internal/ask-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questions }),
  });

  dbg(`POST response: ${submitRes.status}`);

  if (!submitRes.ok) {
    throw new Error(`Failed to submit question: ${submitRes.status}`);
  }

  const { token } = (await submitRes.json()) as { token: string };
  dbg(`Got token: ${token}, starting long-poll`);

  // Long-poll for answer (up to 5 minutes)
  try {
    const pollRes = await fetch(`${E_BASE}/internal/ask-user/${token}`, {
      signal: AbortSignal.timeout(300_000),
    });

    dbg(`Long-poll response: ${pollRes.status}`);

    if (!pollRes.ok) {
      throw new Error(`Failed to get answer: ${pollRes.status}`);
    }

    const result = (await pollRes.json()) as { answers: any };
    dbg(`Got answer: ${JSON.stringify(result.answers).slice(0, 200)}`);
    return result.answers;
  } catch (pollErr: any) {
    dbg(`Long-poll error: ${pollErr.message}`);
    throw pollErr;
  }
}

// ── Stdio transport ──

const decoder = new TextDecoder();
let buffer = '';

async function main() {
  const stdin = Bun.stdin.stream();
  const reader = stdin.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process complete lines
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);

      if (!line) continue;

      try {
        const msg = JSON.parse(line);
        const response = await handleRequest(msg);
        if (response) {
          process.stdout.write(response + '\n');
        }
      } catch (err) {
        // Parse error
        process.stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          }) + '\n',
        );
      }
    }
  }
}

main().catch((err) => {
  console.error('[ask-user-mcp] Fatal:', err);
  process.exit(1);
});
