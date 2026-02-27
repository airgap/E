import { resolve, relative } from 'path';
import { getDb } from '../db/database';

export interface SandboxConfig {
  enabled: boolean;
  allowedPaths: string[];
  blockedCommands: string[];
}

const DEFAULT_BLOCKED_COMMANDS = [
  'rm -rf /',
  'rm -rf ~',
  'mkfs',
  'dd if=',
  ':(){:|:&};:',
  '> /dev/sda',
  'chmod -R 777 /',
  'curl | sh',
  'curl | bash',
  'wget | sh',
  'wget | bash',
];

/**
 * Get sandbox configuration for a project path.
 * Returns sandbox settings from project settings in the DB.
 */
export function getSandboxConfig(workspacePath: string | null): SandboxConfig {
  if (!workspacePath) {
    return { enabled: false, allowedPaths: [], blockedCommands: DEFAULT_BLOCKED_COMMANDS };
  }

  try {
    const db = getDb();
    const project = db
      .query(`SELECT settings FROM projects WHERE path = ?`)
      .get(workspacePath) as any;

    if (project?.settings) {
      const settings = JSON.parse(project.settings);
      if (settings.sandbox) {
        return {
          enabled: settings.sandbox.enabled !== false,
          allowedPaths: settings.sandbox.allowedPaths || [workspacePath],
          blockedCommands: [
            ...DEFAULT_BLOCKED_COMMANDS,
            ...(settings.sandbox.blockedCommands || []),
          ],
        };
      }
    }
  } catch {
    // Fall back to defaults
  }

  // Default: sandbox enabled, restrict to project dir + home config dirs
  return {
    enabled: true,
    allowedPaths: [workspacePath],
    blockedCommands: DEFAULT_BLOCKED_COMMANDS,
  };
}

/**
 * Check if a file path is allowed by the sandbox.
 * Always allows ~/.e/ for config.
 */
export function isPathAllowed(filePath: string, config: SandboxConfig): boolean {
  if (!config.enabled) return true;

  const resolved = resolve(filePath);

  // Always allow app config directory
  const homeDir = process.env.HOME || '/root';
  if (resolved.startsWith(resolve(homeDir, '.e'))) return true;

  // Check against allowed paths
  for (const allowed of config.allowedPaths) {
    const resolvedAllowed = resolve(allowed);
    const rel = relative(resolvedAllowed, resolved);
    // Path is inside allowed if relative doesn't start with '..'
    if (!rel.startsWith('..') && !resolve(rel).startsWith('/')) return true;
    // Exact match
    if (resolved === resolvedAllowed) return true;
  }

  return false;
}

/**
 * Check if a command is blocked by the sandbox.
 */
export function isCommandBlocked(command: string, config: SandboxConfig): boolean {
  const normalized = command.toLowerCase().trim();
  return config.blockedCommands.some((blocked) => normalized.includes(blocked.toLowerCase()));
}

/**
 * Validate a path and return 403 info if blocked.
 */
export function validatePath(
  filePath: string,
  workspacePath: string | null,
): { allowed: boolean; reason?: string } {
  const config = getSandboxConfig(workspacePath);
  if (!config.enabled) return { allowed: true };

  if (isPathAllowed(filePath, config)) return { allowed: true };

  return {
    allowed: false,
    reason: `Path "${filePath}" is outside the sandbox. Allowed: ${config.allowedPaths.join(', ')}`,
  };
}
