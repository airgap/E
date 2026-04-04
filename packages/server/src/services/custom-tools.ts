/**
 * Workspace Custom Tools — Pi-inspired extensibility.
 *
 * Users define custom tools as TypeScript files in `.e/tools/` within their
 * workspace. Each file exports a tool definition that gets loaded into the
 * agent's tool set. Files are hot-reloaded when modified.
 *
 * Example `.e/tools/deploy.ts`:
 *
 *   import type { CustomTool } from './types';
 *   export default {
 *     name: 'Deploy',
 *     description: 'Deploy the current branch to staging',
 *     parameters: {
 *       environment: { type: 'string', description: 'Target environment', enum: ['staging', 'production'] },
 *     },
 *     required: ['environment'],
 *     execute: async (input, workspacePath) => {
 *       const { execSync } = require('child_process');
 *       const result = execSync(`./scripts/deploy.sh ${input.environment}`, { cwd: workspacePath, encoding: 'utf-8' });
 *       return { content: result };
 *     },
 *   } satisfies CustomTool;
 *
 * The tool becomes available to the agent as "Deploy" alongside built-in tools.
 */

import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import type { ToolSchema } from './tool-schemas';

export interface CustomToolInput {
  [key: string]: unknown;
}

export interface CustomToolResult {
  content: string;
  is_error?: boolean;
}

export interface CustomToolDefinition {
  name: string;
  description: string;
  parameters: Record<
    string,
    {
      type: string;
      description: string;
      enum?: string[];
      items?: { type: string };
    }
  >;
  required?: string[];
  execute: (input: CustomToolInput, workspacePath: string) => Promise<CustomToolResult>;
}

interface LoadedTool {
  definition: CustomToolDefinition;
  filePath: string;
  loadedAt: number;
  mtime: number;
}

/** Cache of loaded tools per workspace, keyed by workspace path */
const workspaceToolCache = new Map<string, Map<string, LoadedTool>>();

/**
 * Get the .e/tools/ directory for a workspace.
 */
function getToolsDir(workspacePath: string): string {
  return join(workspacePath, '.e', 'tools');
}

/**
 * Load or reload custom tools from the workspace's .e/tools/ directory.
 * Returns a map of tool name → definition.
 *
 * Uses file mtime for hot-reload: if a file has changed since last load,
 * it gets re-evaluated.
 */
export function loadCustomTools(workspacePath: string): Map<string, CustomToolDefinition> {
  const toolsDir = getToolsDir(workspacePath);

  if (!existsSync(toolsDir)) {
    return new Map();
  }

  let cache = workspaceToolCache.get(workspacePath);
  if (!cache) {
    cache = new Map();
    workspaceToolCache.set(workspacePath, cache);
  }

  const result = new Map<string, CustomToolDefinition>();
  const seenFiles = new Set<string>();

  try {
    const files = readdirSync(toolsDir).filter((f) => f.endsWith('.ts') || f.endsWith('.js'));

    for (const file of files) {
      const filePath = join(toolsDir, file);
      seenFiles.add(filePath);

      try {
        const stat = statSync(filePath);
        const cached = cache.get(filePath);

        // Hot-reload: skip re-eval if file hasn't changed
        if (cached && cached.mtime === stat.mtimeMs) {
          result.set(cached.definition.name, cached.definition);
          continue;
        }

        const tool = loadSingleTool(filePath);
        if (tool) {
          cache.set(filePath, {
            definition: tool,
            filePath,
            loadedAt: Date.now(),
            mtime: stat.mtimeMs,
          });
          result.set(tool.name, tool);
          console.log(`[custom-tools] Loaded: ${tool.name} from ${file}`);
        }
      } catch (err) {
        console.warn(`[custom-tools] Failed to load ${file}:`, err);
      }
    }

    // Remove tools from cache if their files were deleted
    for (const [path] of cache) {
      if (!seenFiles.has(path)) {
        cache.delete(path);
      }
    }
  } catch (err) {
    console.warn(`[custom-tools] Error reading tools directory:`, err);
  }

  return result;
}

/**
 * Load a single tool file. Supports two formats:
 *
 * 1. ES module with default export: `export default { name, description, ... }`
 * 2. CommonJS: `module.exports = { name, description, ... }`
 *
 * For security, tool files run in the same process as the server.
 * This is acceptable because the user controls the workspace.
 */
function loadSingleTool(filePath: string): CustomToolDefinition | null {
  try {
    // Clear Bun's module cache so hot-reload works
    delete require.cache[filePath];

    // Use require for synchronous loading
    const mod = require(filePath);
    const def = mod.default || mod;

    if (!def || !def.name || !def.description || !def.execute) {
      console.warn(
        `[custom-tools] ${basename(filePath)}: missing required fields (name, description, execute)`,
      );
      return null;
    }

    // Validate the definition shape
    if (typeof def.name !== 'string') return null;
    if (typeof def.description !== 'string') return null;
    if (typeof def.execute !== 'function') return null;

    return {
      name: def.name,
      description: def.description,
      parameters: def.parameters || {},
      required: def.required || [],
      execute: def.execute,
    };
  } catch (err) {
    console.warn(`[custom-tools] Error loading ${basename(filePath)}:`, err);
    return null;
  }
}

/**
 * Execute a custom tool by name.
 */
export async function executeCustomTool(
  toolName: string,
  input: CustomToolInput,
  workspacePath: string,
): Promise<CustomToolResult> {
  const tools = loadCustomTools(workspacePath);
  const tool = tools.get(toolName);

  if (!tool) {
    return {
      content: `Custom tool not found: ${toolName}`,
      is_error: true,
    };
  }

  try {
    const result = await tool.execute(input, workspacePath);
    return {
      content: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
      is_error: result.is_error,
    };
  } catch (err) {
    return {
      content: `Custom tool "${toolName}" error: ${err instanceof Error ? err.message : String(err)}`,
      is_error: true,
    };
  }
}

/**
 * Convert loaded custom tools to Anthropic-compatible tool schemas,
 * so they appear alongside built-in tools in the model's tool list.
 */
export function customToolsToSchemas(workspacePath: string): ToolSchema[] {
  const tools = loadCustomTools(workspacePath);
  const schemas: ToolSchema[] = [];

  for (const [, tool] of tools) {
    schemas.push({
      name: tool.name,
      description: `[Custom] ${tool.description}`,
      input_schema: {
        type: 'object',
        properties: tool.parameters,
        required: tool.required,
      },
    });
  }

  return schemas;
}

/**
 * Check if a tool name belongs to a workspace custom tool.
 */
export function isCustomTool(toolName: string, workspacePath: string): boolean {
  const tools = loadCustomTools(workspacePath);
  return tools.has(toolName);
}

/**
 * Clear the tool cache for a workspace (useful for testing).
 */
export function clearToolCache(workspacePath?: string) {
  if (workspacePath) {
    workspaceToolCache.delete(workspacePath);
  } else {
    workspaceToolCache.clear();
  }
}
