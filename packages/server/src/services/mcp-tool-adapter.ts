/**
 * MCP Tool Adapter - Integrates MCP servers with Bedrock/Ollama providers
 *
 * Discovers MCP tools from configured servers and executes them via stdio.
 */

import { getDb } from '../db/database';
import { spawn } from 'child_process';
import { parseMcpToolName, isMcpToolDangerous } from '@e/shared';
import type { ToolSchema } from './tool-schemas';

export interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface MCPToolInfo {
  serverName: string;
  toolName: string;
  fullName: string; // mcp__server__tool format
  description: string;
  inputSchema: any;
  isDangerous: boolean;
}

/**
 * Get all configured MCP servers from database
 */
export function getMcpServers(): MCPServerConfig[] {
  const db = getDb();
  const rows = db.query('SELECT * FROM mcp_servers').all() as any[];

  return rows.map((row) => ({
    name: row.name,
    transport: row.transport,
    command: row.command,
    args: row.args ? JSON.parse(row.args) : undefined,
    url: row.url,
    env: row.env ? JSON.parse(row.env) : undefined,
  }));
}

/**
 * Discover tools from a single MCP server via stdio
 */
async function discoverServerTools(server: MCPServerConfig): Promise<MCPToolInfo[]> {
  if (server.transport !== 'stdio' || !server.command) {
    console.warn(`[mcp-adapter] Skipping ${server.name} - only stdio transport supported`);
    return [];
  }

  return new Promise((resolve) => {
    const tools: MCPToolInfo[] = [];
    let output = '';

    try {
      const proc = spawn(server.command!, server.args || [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...server.env },
      });

      // Send initialize request
      const initRequest =
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'e-mcp-adapter',
              version: '1.0.0',
            },
          },
        }) + '\n';

      proc.stdin.write(initRequest);

      // Send tools/list request
      const toolsRequest =
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }) + '\n';

      setTimeout(() => {
        proc.stdin.write(toolsRequest);
        proc.stdin.end();
      }, 100);

      // Collect output
      proc.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      proc.on('close', () => {
        // Parse JSON-RPC responses
        const lines = output.split('\n').filter((l) => l.trim());
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            if (response.id === 2 && response.result?.tools) {
              for (const tool of response.result.tools) {
                const fullName = `mcp__${server.name}__${tool.name}`;
                tools.push({
                  serverName: server.name,
                  toolName: tool.name,
                  fullName,
                  description: tool.description || '',
                  inputSchema: tool.inputSchema,
                  isDangerous: isMcpToolDangerous(fullName),
                });
              }
            }
          } catch {
            // Skip invalid JSON
          }
        }
        resolve(tools);
      });

      proc.on('error', (err: Error) => {
        console.error(`[mcp-adapter] Error discovering ${server.name}:`, err);
        resolve([]);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        proc.kill();
        resolve(tools);
      }, 5000);
    } catch (err) {
      console.error(`[mcp-adapter] Failed to spawn ${server.name}:`, err);
      resolve([]);
    }
  });
}

/**
 * Discover all tools from all configured MCP servers
 */
export async function discoverAllMcpTools(): Promise<MCPToolInfo[]> {
  const servers = getMcpServers();
  const allTools: MCPToolInfo[] = [];

  for (const server of servers) {
    const tools = await discoverServerTools(server);
    allTools.push(...tools);
  }

  return allTools;
}

/**
 * Convert MCP tools to Bedrock/Anthropic tool schema format
 */
export function mcpToolsToSchemas(mcpTools: MCPToolInfo[]): ToolSchema[] {
  return mcpTools.map((tool) => ({
    name: tool.fullName,
    description: tool.description || `${tool.toolName} from ${tool.serverName}`,
    input_schema: tool.inputSchema || {
      type: 'object',
      properties: {},
      required: [],
    },
  }));
}

/**
 * Execute an MCP tool via stdio
 */
export async function executeMcpTool(
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<{ content: string; is_error?: boolean }> {
  const parsed = parseMcpToolName(toolName);

  if (!parsed.isMcp || !parsed.serverName) {
    return {
      content: `Not an MCP tool: ${toolName}`,
      is_error: true,
    };
  }

  // Find server config
  const db = getDb();
  const serverRow = db
    .query('SELECT * FROM mcp_servers WHERE name = ?')
    .get(parsed.serverName) as any;

  if (!serverRow) {
    return {
      content: `MCP server not found: ${parsed.serverName}`,
      is_error: true,
    };
  }

  const server: MCPServerConfig = {
    name: serverRow.name,
    transport: serverRow.transport,
    command: serverRow.command,
    args: serverRow.args ? JSON.parse(serverRow.args) : undefined,
    env: serverRow.env ? JSON.parse(serverRow.env) : undefined,
  };

  if (server.transport !== 'stdio' || !server.command) {
    return {
      content: `Only stdio transport supported for ${parsed.serverName}`,
      is_error: true,
    };
  }

  return new Promise((resolve) => {
    let output = '';
    let resultContent = '';
    let hasError = false;

    try {
      const proc = spawn(server.command!, server.args || [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...server.env },
      });

      // Initialize the server
      const initRequest =
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'e-mcp-adapter',
              version: '1.0.0',
            },
          },
        }) + '\n';

      proc.stdin.write(initRequest);

      // Call the tool
      setTimeout(() => {
        const toolRequest =
          JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
              name: parsed.toolName,
              arguments: toolInput,
            },
          }) + '\n';

        proc.stdin.write(toolRequest);
        proc.stdin.end();
      }, 100);

      // Collect output
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        // Parse JSON-RPC responses
        const lines = output.split('\n').filter((l) => l.trim());
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            if (response.id === 2) {
              if (response.error) {
                hasError = true;
                resultContent = `MCP Error: ${response.error.message || JSON.stringify(response.error)}`;
              } else if (response.result) {
                // MCP tool results can be arrays of content blocks
                if (Array.isArray(response.result.content)) {
                  resultContent = response.result.content
                    .map((c: any) => c.text || JSON.stringify(c))
                    .join('\n');
                } else if (response.result.content) {
                  resultContent = String(response.result.content);
                } else {
                  resultContent = JSON.stringify(response.result);
                }
              }
            }
          } catch {
            // Skip invalid JSON
          }
        }

        if (!resultContent) {
          resultContent = `No response from MCP tool ${toolName}`;
          hasError = true;
        }

        resolve({
          content: resultContent,
          is_error: hasError,
        });
      });

      proc.on('error', (err) => {
        resolve({
          content: `Failed to execute MCP tool: ${err.message}`,
          is_error: true,
        });
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        proc.kill();
        resolve({
          content: `MCP tool execution timeout: ${toolName}`,
          is_error: true,
        });
      }, 30000);
    } catch (err) {
      resolve({
        content: `Error executing MCP tool: ${err instanceof Error ? err.message : String(err)}`,
        is_error: true,
      });
    }
  });
}

/**
 * Check if a tool name is an MCP tool
 */
export function isMcpTool(toolName: string): boolean {
  return toolName.startsWith('mcp__');
}

/**
 * Cache for discovered tools (refreshed every 5 minutes)
 */
let toolCache: MCPToolInfo[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get MCP tools with caching
 */
export async function getCachedMcpTools(): Promise<MCPToolInfo[]> {
  const now = Date.now();
  if (toolCache && now - cacheTimestamp < CACHE_TTL) {
    return toolCache;
  }

  toolCache = await discoverAllMcpTools();
  cacheTimestamp = now;
  return toolCache;
}

/**
 * Clear the tool cache (call after adding/removing MCP servers)
 */
export function clearMcpToolCache() {
  toolCache = null;
  cacheTimestamp = 0;
}
