/**
 * Permission rule enforcement service.
 *
 * Evaluates per-tool PermissionRule patterns to determine whether a given
 * tool invocation should be allowed, denied, or require user confirmation.
 *
 * Rules are evaluated in priority order: deny > ask > allow.
 * More specific patterns (with a glob) take precedence over generic ones.
 * A wildcard tool name ("*") matches any tool.
 */

import type { PermissionRule, PermissionMode, TerminalCommandPolicy } from '@e/shared';
import { getDb } from '../db/database';

export type RuleDecision = 'allow' | 'deny' | 'ask' | 'default';

/**
 * Simple glob pattern matcher.
 * Supports:
 *   - `*` matches any sequence of characters (except nothing before /)
 *   - exact string match
 *   - prefix match with trailing `*`
 */
function globMatch(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return pattern === value;

  // Convert glob to regex: escape special chars, replace * with .*
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(value);
}

/**
 * Evaluate a set of permission rules against a tool call.
 *
 * @param rules     The permission rules to evaluate (ordered by specificity).
 * @param toolName  The name of the tool being invoked (e.g. "Bash", "Write").
 * @param toolInput A serialised representation of the tool input for pattern
 *                  matching (e.g. the shell command for Bash, or file path for Write).
 * @returns The decision: 'allow', 'deny', 'ask', or 'default' if no rule matched.
 */
export function evaluateRules(
  rules: PermissionRule[],
  toolName: string,
  toolInput?: string,
): RuleDecision {
  // Separate rules into buckets by type.
  // Within each bucket, more-specific rules (with a pattern) come first.
  const matching: PermissionRule[] = [];

  for (const rule of rules) {
    // Check tool name match
    const toolMatches = rule.tool === '*' || globMatch(rule.tool, toolName);
    if (!toolMatches) continue;

    // If the rule has a pattern, check it against the input
    if (rule.pattern) {
      if (!toolInput) continue; // Pattern requires input to match
      if (!globMatch(rule.pattern, toolInput)) continue;
    }

    matching.push(rule);
  }

  if (matching.length === 0) return 'default';

  // Priority: deny > ask > allow
  // Among equal-priority types, specific (with pattern) beats generic
  const deny = matching.find((r) => r.type === 'deny' && r.pattern);
  if (deny) return 'deny';
  const denyGeneric = matching.find((r) => r.type === 'deny' && !r.pattern);
  if (denyGeneric) return 'deny';

  const ask = matching.find((r) => r.type === 'ask' && r.pattern);
  if (ask) return 'ask';
  const askGeneric = matching.find((r) => r.type === 'ask' && !r.pattern);
  if (askGeneric) return 'ask';

  const allow = matching.find((r) => r.type === 'allow');
  if (allow) return 'allow';

  return 'default';
}

/**
 * Extract a human-readable input string from tool input for pattern matching.
 */
export function extractToolInputForMatching(
  toolName: string,
  input: Record<string, unknown>,
): string | undefined {
  switch (toolName) {
    case 'Bash':
      return (input.command as string) || undefined;
    case 'Write':
    case 'Read':
    case 'Edit':
      return (input.file_path as string) || (input.path as string) || undefined;
    case 'Glob':
      return (input.pattern as string) || undefined;
    case 'Grep':
      return (input.pattern as string) || undefined;
    case 'NotebookEdit':
      return (input.notebook_path as string) || undefined;
    case 'WebFetch':
      return (input.url as string) || undefined;
    case 'WebSearch':
      return (input.query as string) || undefined;
    default:
      // For MCP tools or unknown tools, try common field names
      return (
        (input.command as string) ||
        (input.file_path as string) ||
        (input.path as string) ||
        (input.query as string) ||
        undefined
      );
  }
}

/**
 * Determine whether a tool call should require approval based on:
 * 1. Per-tool permission rules (highest priority)
 * 2. Terminal command policy (for Bash tools)
 * 3. Permission mode (fallback)
 */
export function shouldRequireApproval(
  toolName: string,
  input: Record<string, unknown>,
  rules: PermissionRule[],
  permissionMode: PermissionMode,
  terminalPolicy: TerminalCommandPolicy,
): RuleDecision {
  // 1. Evaluate explicit per-tool rules first
  const toolInput = extractToolInputForMatching(toolName, input);
  const ruleDecision = evaluateRules(rules, toolName, toolInput);

  if (ruleDecision !== 'default') {
    return ruleDecision;
  }

  // 2. AskUserQuestion is always allowed — it's a user interaction tool, not a mutation
  if (toolName === 'AskUserQuestion' || toolName === 'mcp__e-ask-user__AskUserQuestion')
    return 'allow';

  // 3. Terminal command policy (independent of general permission mode)
  if (toolName === 'Bash') {
    switch (terminalPolicy) {
      case 'off':
        return 'deny';
      case 'turbo':
        return 'allow';
      case 'custom':
        // Custom falls through to general permission mode
        break;
      case 'auto':
      default:
        // Auto: use the general permission mode
        break;
    }
  }

  // 3. Fallback to permission mode
  switch (permissionMode) {
    case 'unrestricted':
      return 'allow';
    case 'plan':
      // In plan mode, deny all write tools
      if (['Write', 'Edit', 'Bash', 'NotebookEdit'].includes(toolName)) {
        return 'deny';
      }
      return 'allow';
    case 'fast': {
      // Auto-approve safe tools
      const safeTools = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'];
      if (safeTools.includes(toolName)) return 'allow';
      return 'ask';
    }
    case 'safe':
    default: {
      // Ask for dangerous tools, allow safe ones
      const dangerousTools = ['Write', 'Edit', 'Bash', 'NotebookEdit'];
      if (dangerousTools.includes(toolName)) return 'ask';
      return 'allow';
    }
  }
}

/**
 * Load permission rules from the database, scoped appropriately.
 * Rules are loaded from: global → project → session, with later scopes overriding.
 */
export function loadPermissionRules(
  conversationId?: string,
  workspacePath?: string,
): PermissionRule[] {
  const db = getDb();
  const rules: PermissionRule[] = [];

  // Load global rules
  try {
    const rows = db
      .query("SELECT data FROM permission_rules WHERE scope = 'global' ORDER BY created_at ASC")
      .all() as Array<{ data: string }>;
    for (const row of rows) {
      try {
        rules.push(JSON.parse(row.data));
      } catch {}
    }
  } catch {}

  // Load project-scoped rules
  if (workspacePath) {
    try {
      const rows = db
        .query(
          "SELECT data FROM permission_rules WHERE scope = 'project' AND workspace_path = ? ORDER BY created_at ASC",
        )
        .all(workspacePath) as Array<{ data: string }>;
      for (const row of rows) {
        try {
          rules.push(JSON.parse(row.data));
        } catch {}
      }
    } catch {}
  }

  // Load session-scoped rules
  if (conversationId) {
    try {
      const rows = db
        .query(
          "SELECT data FROM permission_rules WHERE scope = 'session' AND conversation_id = ? ORDER BY created_at ASC",
        )
        .all(conversationId) as Array<{ data: string }>;
      for (const row of rows) {
        try {
          rules.push(JSON.parse(row.data));
        } catch {}
      }
    } catch {}
  }

  return rules;
}

/**
 * Save a permission rule to the database.
 */
export function savePermissionRule(
  rule: PermissionRule,
  workspacePath?: string,
  conversationId?: string,
): void {
  const db = getDb();

  // Ensure the table exists
  ensurePermissionRulesTable();

  db.query(
    `INSERT INTO permission_rules (id, scope, workspace_path, conversation_id, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
  ).run(
    rule.id,
    rule.scope,
    workspacePath || null,
    conversationId || null,
    JSON.stringify(rule),
    Date.now(),
  );
}

/**
 * Delete a permission rule from the database.
 */
export function deletePermissionRule(ruleId: string): void {
  const db = getDb();
  ensurePermissionRulesTable();
  db.query('DELETE FROM permission_rules WHERE id = ?').run(ruleId);
}

/**
 * Ensure the permission_rules table exists.
 */
export function ensurePermissionRulesTable(): void {
  const db = getDb();
  db.query(
    `
    CREATE TABLE IF NOT EXISTS permission_rules (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL DEFAULT 'global',
      workspace_path TEXT,
      conversation_id TEXT,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0
    )
  `,
  ).run();
}

/**
 * Load the terminal command policy from settings.
 */
export function loadTerminalCommandPolicy(): TerminalCommandPolicy {
  try {
    const db = getDb();
    const row = db
      .query("SELECT value FROM settings WHERE key = 'terminalCommandPolicy'")
      .get() as { value: string } | null;
    if (row) {
      const val = JSON.parse(row.value);
      if (['off', 'auto', 'turbo', 'custom'].includes(val)) {
        return val as TerminalCommandPolicy;
      }
    }
  } catch {}
  return 'auto';
}
