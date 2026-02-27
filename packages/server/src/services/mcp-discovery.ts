/**
 * MCP Discovery Service
 *
 * Scans known MCP configuration file locations from other tools
 * (Claude Desktop, Claude Code, Cursor, VS Code, Gemini) and
 * returns discovered servers that can be imported.
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { DiscoveredMcpSource, DiscoveredMcpServer, MCPTransport } from '@e/shared';

// ── Known Config Locations ──

interface ConfigLocation {
  source: string;
  paths: string[];
}

function getConfigLocations(): ConfigLocation[] {
  const home = homedir();
  return [
    {
      source: 'Claude Desktop',
      paths: [
        // Linux
        join(home, '.config', 'Claude', 'claude_desktop_config.json'),
        // macOS
        join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
        // Windows (via WSL or similar)
        join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
      ],
    },
    {
      source: 'Claude Code',
      paths: [join(home, '.claude', 'settings.json'), join(home, '.claude', 'settings.local.json')],
    },
    {
      source: 'Cursor',
      paths: [join(home, '.cursor', 'mcp.json')],
    },
    {
      source: 'Gemini',
      paths: [join(home, '.gemini', 'settings.json')],
    },
    {
      source: 'Windsurf',
      paths: [join(home, '.codeium', 'windsurf', 'mcp_config.json')],
    },
  ];
}

// ── Config Parsing ──

function inferTransport(config: any): MCPTransport {
  if (config.type === 'sse') return 'sse';
  if (config.type === 'http') return 'http';
  if (config.url && !config.command) {
    return config.url.includes('/sse') ? 'sse' : 'http';
  }
  return 'stdio';
}

function parseServersFromJson(data: any): DiscoveredMcpServer[] {
  const mcpServers = data?.mcpServers;
  if (!mcpServers || typeof mcpServers !== 'object') return [];

  const servers: DiscoveredMcpServer[] = [];
  for (const [name, config] of Object.entries(mcpServers)) {
    if (!config || typeof config !== 'object') continue;
    const c = config as any;
    servers.push({
      name,
      command: c.command || undefined,
      args: Array.isArray(c.args) ? c.args : undefined,
      url: c.url || undefined,
      env: c.env && typeof c.env === 'object' ? c.env : undefined,
      transport: inferTransport(c),
    });
  }
  return servers;
}

function tryReadConfig(configPath: string): DiscoveredMcpServer[] {
  if (!existsSync(configPath)) return [];
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const data = JSON.parse(raw);
    return parseServersFromJson(data);
  } catch {
    return [];
  }
}

// ── VS Code Scanner ──

function scanVscodeConfigs(): DiscoveredMcpSource[] {
  const results: DiscoveredMcpSource[] = [];
  const home = homedir();

  // VS Code stores workspace-specific MCP configs in workspaceStorage
  const storagePaths = [
    join(home, '.config', 'Code', 'User', 'workspaceStorage'),
    join(home, 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage'),
    join(home, 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage'),
  ];

  // Also check the user-level settings
  const userSettings = [
    join(home, '.config', 'Code', 'User', 'settings.json'),
    join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json'),
  ];

  for (const settingsPath of userSettings) {
    const servers = tryReadConfig(settingsPath);
    if (servers.length > 0) {
      results.push({ source: 'VS Code', configPath: settingsPath, servers });
    }
  }

  for (const basePath of storagePaths) {
    if (!existsSync(basePath)) continue;
    try {
      for (const dir of readdirSync(basePath)) {
        const mcpPath = join(basePath, dir, 'mcp', 'mcp-servers.json');
        const servers = tryReadConfig(mcpPath);
        if (servers.length > 0) {
          results.push({ source: 'VS Code', configPath: mcpPath, servers });
        }
      }
    } catch {
      // Permission denied or other error — skip
    }
  }

  return results;
}

// ── Main Discovery ──

/**
 * Scan all known MCP config file locations and return discovered servers.
 * Deduplicates by server name within each source (not across sources —
 * the user may want the same server from different configs).
 */
export function discoverMcpConfigs(): DiscoveredMcpSource[] {
  const results: DiscoveredMcpSource[] = [];

  for (const location of getConfigLocations()) {
    for (const configPath of location.paths) {
      const servers = tryReadConfig(configPath);
      if (servers.length > 0) {
        results.push({
          source: location.source,
          configPath,
          servers,
        });
      }
    }
  }

  // VS Code needs special scanning (workspace storage directories)
  results.push(...scanVscodeConfigs());

  return results;
}
