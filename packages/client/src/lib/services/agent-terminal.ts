/**
 * AgentTerminalService — bridges AI stream events to the Agent terminal tab.
 *
 * Listens for Bash tool_use_start and tool_result events from the stream store,
 * creates or reuses the dedicated "Agent" terminal tab (a virtual xterm.js
 * instance with no PTY), and writes command text + output to it.
 *
 * The Agent tab is:
 *   - Read-only (disableStdin: true via createVirtualSession)
 *   - Visually distinct (tab bar renders a bot icon + accent color)
 *   - Opt-in via the `agentTerminalEnabled` setting
 *   - Recreated automatically after being closed
 */

import { terminalStore } from '$lib/stores/terminal.svelte';
import { terminalConnectionManager } from '$lib/services/terminal-connection';
import { settingsStore } from '$lib/stores/settings.svelte';
import type { StreamEvent } from '@e/shared';

// ANSI color codes for pretty-printing
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  bgDim: '\x1b[48;5;236m',
  white: '\x1b[37m',
};

/** Tracked state for the current tool execution */
let currentToolCallId: string | null = null;

/**
 * Ensure the Agent tab's virtual terminal session exists.
 * Creates the tab + virtual session on first call; reuses them thereafter.
 */
function ensureAgentSession(): string {
  const { sessionId } = terminalStore.getOrCreateAgentTab();

  // Create the virtual xterm.js session if it doesn't already exist
  if (!terminalConnectionManager.has(sessionId)) {
    terminalConnectionManager.createVirtualSession(sessionId);
  }

  return sessionId;
}

/**
 * Write formatted text to the Agent terminal.
 */
function writeToAgent(text: string): void {
  const sessionId = ensureAgentSession();
  terminalConnectionManager.writeToTerminal(sessionId, text);
}

/**
 * Handle a stream event that may be relevant to the Agent terminal.
 * Called from the stream event processing pipeline.
 *
 * Events handled:
 *   - tool_use_start (toolName === 'Bash') → write command header
 *   - tool_result (for tracked Bash tool calls) → write output
 */
export function handleAgentTerminalEvent(event: StreamEvent): void {
  // Guard: only process when agent terminal is enabled
  if (!settingsStore.agentTerminalEnabled) return;

  switch (event.type) {
    case 'tool_use_start': {
      // Only handle Bash tool calls
      if (event.toolName !== 'Bash') return;

      currentToolCallId = event.toolCallId;

      // Extract the command from the tool input
      const command = (event.input as Record<string, unknown>)?.command;
      const description = (event.input as Record<string, unknown>)?.description;
      const commandStr = typeof command === 'string' ? command : JSON.stringify(command ?? '');

      // Write a visually distinct command header
      const separator = `${ANSI.dim}${'─'.repeat(60)}${ANSI.reset}`;
      const timestamp = new Date().toLocaleTimeString();

      writeToAgent('\r\n' + separator + '\r\n');
      if (description) {
        writeToAgent(`${ANSI.dim}${ANSI.cyan}# ${description}${ANSI.reset}\r\n`);
      }
      writeToAgent(
        `${ANSI.bold}${ANSI.green}❯${ANSI.reset} ${ANSI.bold}${ANSI.white}${commandStr}${ANSI.reset}` +
          `  ${ANSI.dim}${timestamp}${ANSI.reset}\r\n`,
      );
      break;
    }

    case 'tool_result': {
      // Only handle results for Bash tool calls we're tracking
      if (!currentToolCallId) return;
      if (event.toolCallId !== currentToolCallId) {
        // Check if this is a Bash result by toolName
        if (event.toolName !== 'Bash') return;
      }

      const output = event.result;
      const isError = event.isError;
      const duration = event.duration;

      // Write the output, converting \n to \r\n for xterm
      if (output) {
        const formatted = output.replace(/\n/g, '\r\n');
        if (isError) {
          writeToAgent(`${ANSI.red}${formatted}${ANSI.reset}\r\n`);
        } else {
          writeToAgent(formatted + '\r\n');
        }
      }

      // Write duration footer
      if (duration !== undefined) {
        const durationStr = duration >= 1000 ? `${(duration / 1000).toFixed(1)}s` : `${duration}ms`;
        const statusColor = isError ? ANSI.red : ANSI.green;
        const statusIcon = isError ? '✗' : '✓';
        writeToAgent(`${ANSI.dim}${statusColor}${statusIcon} ${durationStr}${ANSI.reset}\r\n`);
      }

      // Clear tracked state
      if (event.toolCallId === currentToolCallId) {
        currentToolCallId = null;
      }
      break;
    }
  }
}

/**
 * Reset the agent terminal state (e.g., when a conversation resets).
 */
export function resetAgentTerminal(): void {
  currentToolCallId = null;
}
