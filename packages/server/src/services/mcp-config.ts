import { getDb } from '../db/database';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { writeFileSync, mkdirSync } from 'node:fs';

const MCP_CONFIG_PATH = join(homedir(), '.e', 'mcp-config.json');

/** Absolute path to the ask-user MCP server script. */
const ASK_USER_SERVER_PATH = resolve(import.meta.dir, 'ask-user-mcp-server.ts');

/**
 * Reads MCP servers from the database and generates a config file
 * in the format expected by Claude CLI's --mcp-config flag.
 *
 * Always includes E's built-in ask-user MCP server so the CLI's
 * AskUserQuestion tool routes through E's UI instead of auto-resolving.
 *
 * CLI expects:
 * {
 *   "mcpServers": {
 *     "server-name": {
 *       "command": "...",
 *       "args": [...],
 *       "env": {...}
 *     }
 *   }
 * }
 */
export function generateMcpConfig(): string {
  const db = getDb();
  const servers = db.query('SELECT * FROM mcp_servers').all() as any[];

  const mcpServers: Record<string, any> = {};

  for (const server of servers) {
    const config: any = {};

    if (server.transport === 'stdio') {
      if (server.command) config.command = server.command;
      if (server.args) {
        try {
          config.args = JSON.parse(server.args);
        } catch {
          config.args = [];
        }
      }
    } else if (server.transport === 'sse' || server.transport === 'http') {
      if (server.url) config.url = server.url;
      config.type = server.transport;
    }

    if (server.env) {
      try {
        config.env = JSON.parse(server.env);
      } catch {}
    }

    mcpServers[server.name] = config;
  }

  // Always include E's ask-user MCP server — replaces the CLI's built-in
  // AskUserQuestion which auto-resolves under --dangerously-skip-permissions.
  mcpServers['e-ask-user'] = {
    command: 'bun',
    args: [ASK_USER_SERVER_PATH],
    env: {
      E_PORT: process.env.PORT || '3002',
    },
  };

  const configContent = JSON.stringify({ mcpServers }, null, 2);

  // Ensure directory exists and write config
  mkdirSync(join(homedir(), '.e'), { recursive: true });
  writeFileSync(MCP_CONFIG_PATH, configContent, 'utf-8');

  return MCP_CONFIG_PATH;
}
