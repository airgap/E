/**
 * Plugin-contributed MCP servers (LYK-1116).
 *
 * Syncs a plugin's `contributes.mcpServers` into the `mcp_servers` table (the
 * same store the user configures), marked with scope `plugin:<id>` so they can
 * be removed cleanly on disable. Once present, the existing MCP tool adapter
 * discovers their tools and exposes them to the agent as `mcp__<server>__<tool>`
 * — no extra agent wiring needed.
 */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { getDb } from '../db/database';
import type { PluginManifest } from '@e/shared';

const scopeFor = (pluginId: string) => `plugin:${pluginId}`;

export function activatePluginMcpServers(manifest: PluginManifest, installPath: string): void {
  const servers = manifest.contributes?.mcpServers ?? [];
  if (servers.length === 0) return;
  const db = getDb();
  // Replace this plugin's rows wholesale so re-enabling reflects manifest edits.
  db.run('DELETE FROM mcp_servers WHERE scope = ?', [scopeFor(manifest.id)]);

  for (const s of servers) {
    if (!s.name) continue;
    const name = `${manifest.id}.${s.name}`;
    let command: string | null = null;
    let args: string | null = null;
    let url: string | null = null;

    if (s.transport === 'stdio') {
      if (!s.command || s.command.length === 0) continue;
      // Resolve a bundled binary to an absolute path; leave bare PATH names as-is.
      const binAbs = resolve(installPath, s.command[0]);
      command = existsSync(binAbs) ? binAbs : s.command[0];
      args = JSON.stringify(s.command.slice(1));
    } else {
      if (!s.url) continue;
      url = s.url;
    }

    db.run(
      `INSERT OR REPLACE INTO mcp_servers (name, transport, command, args, url, env, scope, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'disconnected')`,
      [name, s.transport, command, args, url, s.env ? JSON.stringify(s.env) : null, scopeFor(manifest.id)],
    );
  }
}

export function deactivatePluginMcpServers(pluginId: string): void {
  getDb().run('DELETE FROM mcp_servers WHERE scope = ?', [scopeFor(pluginId)]);
}
