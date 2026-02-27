export type MCPTransport = 'stdio' | 'sse' | 'http';
export type MCPScope = 'local' | 'project' | 'user';

export interface MCPServer {
  name: string;
  transport: MCPTransport;
  command?: string;
  args?: string[];
  url?: string;
  scope: MCPScope;
  status: MCPServerStatus;
  tools: MCPTool[];
  resources: MCPResource[];
  env?: Record<string, string>;
}

export type MCPServerStatus = 'connected' | 'disconnected' | 'error' | 'connecting';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  serverName: string;
}

export interface MCPServerConfig {
  name: string;
  transport: MCPTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  scope: MCPScope;
}

// ── MCP Import/Discovery Types ──

export interface DiscoveredMcpServer {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  transport: MCPTransport;
}

export interface DiscoveredMcpSource {
  /** Human label: "Claude Desktop", "Claude Code", "Cursor", etc. */
  source: string;
  /** Path to the config file */
  configPath: string;
  /** Servers found in this config */
  servers: DiscoveredMcpServer[];
}
