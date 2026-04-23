/**
 * Agent registry — first-class "chat participants" à la VS Code's `@workspace`
 * etc. An agent is a named dispatch target the user can @-mention in chat to
 * route the turn through a specific provider + model + system prompt + tool
 * allowlist.
 *
 * v1 ships with one built-in (`@claude-code`). The plan is that future
 * additions — `@workspace`, `@commit`, `@test`, plus user-defined agents from
 * `.e/agents/*.json` and MCP-server-contributed agents — all land in this
 * registry so there's one surface the chat input queries.
 */

export type AgentTransport =
  /** Spawn Claude Code CLI via claudeManager. Tool surface + session model
   *  are the CLI's. */
  | 'claude-cli'
  /** Use the in-process agent-kernel with a specific LLM provider. */
  | 'provider';

export interface AgentDefinition {
  /** Stable identifier used in DB rows and routing. */
  id: string;
  /** @-mention handle without the @. Lowercase, `[a-z0-9-]`. */
  handle: string;
  /** Human-readable name displayed in chips and lists. */
  name: string;
  /** One-line description for autocomplete / sidebar listing. */
  description: string;
  /** Emoji or short glyph used as the avatar until we ship real icons. */
  icon: string;
  /** Longer tagline shown below the name in the agent panel. */
  tagline?: string;
  /** How a turn addressed to this agent gets dispatched. */
  transport: AgentTransport;
  /** For `provider` transport: which provider/model to force. Ignored by
   *  `claude-cli` since the CLI manages its own model selection. */
  provider?: string;
  model?: string;
  /** Prepended to the conversation's system prompt for this turn. */
  systemPrompt?: string;
  /** Tool allowlist for this agent's turns. Empty = inherit conversation defaults. */
  allowedTools?: string[];
  /** Tools this agent must not use regardless of conversation defaults. */
  disallowedTools?: string[];
  /** Whether this agent is enabled for new conversations. */
  enabled: boolean;
  /** `builtin` agents live in code; `user` ones come from .e/agents/. */
  source: 'builtin' | 'user';
}

/**
 * Built-in agents shipped with E. The initial set is deliberately minimal —
 * we ship one canonical example so the @-mention UX has a real target, then
 * add `@workspace` / `@commit` / `@test` as follow-ups once the plumbing is
 * proven.
 */
const BUILTINS: AgentDefinition[] = [
  {
    id: 'claude-code',
    handle: 'claude-code',
    name: 'Claude Code',
    description: 'The official Claude Code CLI — file tools, bash, the whole surface.',
    tagline: 'Powered by Anthropic Claude, via the Claude Code CLI',
    icon: '☄',
    transport: 'claude-cli',
    enabled: true,
    source: 'builtin',
  },
];

export function listAgents(): AgentDefinition[] {
  // When user-defined agents are added (.e/agents/*.json), they merge in here.
  return BUILTINS.map((a) => ({ ...a }));
}

export function getAgent(handle: string): AgentDefinition | null {
  return listAgents().find((a) => a.handle === handle) ?? null;
}

/**
 * Extract a leading `@handle` mention from a message body. Used by the
 * stream route to pick up agent routing when the client sends the raw
 * chat content (vs. an explicit `agentHandle` field on the request).
 * Returns null when no mention is present, or when the mention doesn't
 * match a known handle.
 */
export function extractLeadingMention(content: string): {
  agent: AgentDefinition;
  rest: string;
} | null {
  const m = content.match(/^@([a-z0-9][a-z0-9-]{0,63})(\s+|$)/);
  if (!m) return null;
  const agent = getAgent(m[1]);
  if (!agent || !agent.enabled) return null;
  return { agent, rest: content.slice(m[0].length) };
}
