/**
 * Plugin-contributed agent tools (LYK-1117).
 *
 * Command-source tools a plugin declares in `contributes.tools`. When the plugin
 * is enabled they're registered here; the agent sees them as
 * `plugin__<pluginId>__<name>` (alongside MCP and custom tools). On a tool call
 * the host spawns the contributed command in the plugin's install dir, writes
 * the JSON input to stdin, and returns stdout as the result. Always
 * approval-gated (untrusted code).
 */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { PluginManifest, ToolContribution } from '@e/shared';
import type { ToolSchema } from './tool-schemas';
import type { ToolResult } from './tool-executor';

const PREFIX = 'plugin__';

interface RegisteredTool {
  pluginId: string;
  fullName: string; // plugin__<id>__<name>
  contribution: ToolContribution;
  cwd: string; // plugin install dir
  binAbs: string; // resolved command[0]
}

const tools = new Map<string, RegisteredTool>();

export function pluginToolName(pluginId: string, name: string): string {
  return `${PREFIX}${pluginId}__${name}`;
}

export function activatePluginTools(manifest: PluginManifest, installPath: string): void {
  const contributed = manifest.contributes?.tools ?? [];
  for (const t of contributed) {
    if (!t.name || !t.command || t.command.length === 0) continue;
    const binAbs = resolve(installPath, t.command[0]);
    if (!existsSync(binAbs)) {
      console.warn(
        `[plugin ${manifest.id}] tool '${t.name}' binary not found: ${binAbs} — skipping`,
      );
      continue;
    }
    const fullName = pluginToolName(manifest.id, t.name);
    tools.set(fullName, {
      pluginId: manifest.id,
      fullName,
      contribution: t,
      cwd: installPath,
      binAbs,
    });
  }
}

export function deactivatePluginTools(pluginId: string): void {
  for (const [name, t] of tools) {
    if (t.pluginId === pluginId) tools.delete(name);
  }
}

export function isPluginTool(toolName: string): boolean {
  return toolName.startsWith(PREFIX) && tools.has(toolName);
}

export function pluginToolsToSchemas(): ToolSchema[] {
  return [...tools.values()].map((t) => ({
    name: t.fullName,
    description: t.contribution.description,
    input_schema: (t.contribution.inputSchema as ToolSchema['input_schema']) ?? {
      type: 'object',
      properties: {},
    },
  }));
}

export async function executePluginTool(
  toolName: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const t = tools.get(toolName);
  if (!t) return { content: `Unknown plugin tool: ${toolName}`, is_error: true };
  try {
    const proc = Bun.spawn([t.binAbs, ...t.contribution.command.slice(1)], {
      cwd: t.cwd,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: process.env,
    });
    proc.stdin.write(JSON.stringify(input ?? {}));
    await proc.stdin.end();
    const timeout = setTimeout(() => proc.kill(), 60_000);
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timeout);
    if (code !== 0) {
      return { content: stderr.trim() || `Tool exited with code ${code}`, is_error: true };
    }
    return { content: stdout.trim() || '(no output)' };
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), is_error: true };
  }
}
