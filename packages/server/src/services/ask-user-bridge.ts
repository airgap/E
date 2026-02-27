/**
 * In-memory bridge between the ask-user MCP server and E's SSE stream.
 *
 * Flow:
 * 1. Manager sees tool_use → prelinkToolCallId() → stores block.id for later linking
 * 2. Manager emits user_question_request SSE event with toolCallId = block.id
 * 3. MCP server POSTs question → submitQuestion() → auto-links via prelink → returns token
 * 4. MCP server GETs /:token → waitForAnswer() → blocks on promise
 * 5. Client answers → resolveByToolCallId(block.id) → resolves the promise
 * 6. MCP server's GET returns → MCP server returns tool result to CLI
 */

import { nanoid } from 'nanoid';

interface PendingQuestion {
  token: string;
  questions: any[];
  resolve: (answers: any) => void;
  reject: (err: Error) => void;
  promise: Promise<any>;
  toolCallId?: string;
  createdAt: number;
}

const pending = new Map<string, PendingQuestion>();
const toolCallIdMap = new Map<string, string>(); // toolCallId → token

// Prelink map: questionsHash → toolCallId
// The manager populates this when it sees a tool_use BEFORE the MCP server posts.
const prelinkMap = new Map<string, string>();

/**
 * Called by the manager when it sees an AskUserQuestion tool_use in the CLI stream.
 * Stores the block.id so that when submitQuestion() is later called by the MCP server,
 * the bridge can auto-link the token to the CLI's tool_use ID.
 */
export function prelinkToolCallId(toolCallId: string, questions: any[]): void {
  const key = JSON.stringify(questions);
  prelinkMap.set(key, toolCallId);
  // Clean up after 30 seconds (the MCP POST should arrive within milliseconds)
  setTimeout(() => prelinkMap.delete(key), 30_000);
}

/** Submit a question from the MCP server. Returns a unique token. */
export function submitQuestion(questions: any[]): string {
  const token = nanoid();
  let resolve!: (answers: any) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<any>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  // Check if the manager already saw the tool_use and pre-linked a toolCallId
  const key = JSON.stringify(questions);
  const prelinkedId = prelinkMap.get(key);
  if (prelinkedId) prelinkMap.delete(key);

  pending.set(token, {
    token,
    questions,
    resolve,
    reject,
    promise,
    toolCallId: prelinkedId,
    createdAt: Date.now(),
  });

  // If pre-linked, set up the reverse map so resolveByToolCallId works
  if (prelinkedId) {
    toolCallIdMap.set(prelinkedId, token);
  }

  // Auto-cleanup after 5 minutes (matches MCP server's timeout)
  setTimeout(() => {
    const pq = pending.get(token);
    if (pq) {
      pq.reject(new Error('Question timed out'));
      pending.delete(token);
      if (pq.toolCallId) toolCallIdMap.delete(pq.toolCallId);
    }
  }, 300_000);

  return token;
}

/** Wait for the answer to a pending question. Blocks until resolved or timeout. */
export function waitForAnswer(token: string): Promise<any> {
  const pq = pending.get(token);
  if (!pq) return Promise.reject(new Error('Unknown question token'));
  return pq.promise;
}

/**
 * Link a CLI tool_use block.id to a pending question by matching question content.
 * Called by the manager when it sees an AskUserQuestion tool_use in the CLI stream.
 */
export function linkToolCallId(toolCallId: string, questions: any[]): boolean {
  const questionsStr = JSON.stringify(questions);
  for (const [token, pq] of pending) {
    if (!pq.toolCallId && JSON.stringify(pq.questions) === questionsStr) {
      pq.toolCallId = toolCallId;
      toolCallIdMap.set(toolCallId, token);
      return true;
    }
  }
  return false;
}

/**
 * Resolve a pending question by its toolCallId (from the client's answer).
 * Also checks if the provided ID is a bridge token directly (used when the
 * user_question_request was emitted from the bridge before the CLI's assistant event).
 * Returns true if a pending question was found and resolved.
 */
export function resolveByToolCallId(toolCallId: string, answers: any): boolean {
  // First check if this is a CLI toolCallId mapped to a bridge token
  let token = toolCallIdMap.get(toolCallId);

  // If not found, check if this IS a bridge token directly
  if (!token && pending.has(toolCallId)) {
    token = toolCallId;
  }

  if (!token) return false;

  const pq = pending.get(token);
  if (!pq) return false;

  pq.resolve(answers);
  pending.delete(token);
  if (pq.toolCallId) toolCallIdMap.delete(pq.toolCallId);
  if (toolCallId !== token) toolCallIdMap.delete(toolCallId);
  return true;
}
