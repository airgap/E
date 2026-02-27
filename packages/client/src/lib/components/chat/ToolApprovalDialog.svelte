<script lang="ts">
  import { streamStore } from '$lib/stores/stream.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { cancelStream } from '$lib/api/sse';
  import { parseMcpToolName, isMcpToolDangerous } from '@e/shared';
  import { settingsStore } from '$lib/stores/settings.svelte';

  let { toolCallId, toolName, input, description } = $props<{
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
    description: string;
  }>();

  let responding = $state(false);

  // Parse MCP tool names for display
  const parsed = $derived(parseMcpToolName(toolName));

  // Check if a matching permission rule exists for informational display
  const matchingRule = $derived.by(() => {
    const rules = settingsStore.permissionRules;
    if (!rules || rules.length === 0) return null;
    // Simple client-side check for display purposes only
    // (server-side enforcement is the source of truth)
    for (const rule of rules) {
      const toolMatches = rule.tool === '*' || rule.tool === toolName;
      if (toolMatches) return rule;
    }
    return null;
  });

  async function respond(approved: boolean) {
    if (responding) return;
    responding = true;
    if (!approved) {
      // Cancel the stream to stop further agent execution
      const convId = conversationStore.active?.id;
      if (convId) {
        await cancelStream(convId);
      }
    }
    // Dismiss the dialog only after the action has been taken
    streamStore.resolveApproval(toolCallId);
  }

  function formatInput(): string {
    const effectiveName = parsed.renderAs || parsed.toolName;
    if (effectiveName === 'Bash' && (input.command || input.input))
      return String(input.command || input.input);
    if (input.file_path || input.path) return String(input.file_path || input.path);
    return JSON.stringify(input, null, 2);
  }

  const builtinHighRisk = ['Bash', 'Write', 'Edit', 'NotebookEdit'];
  const riskLevel = $derived(
    builtinHighRisk.includes(toolName) || isMcpToolDangerous(toolName) ? 'high' : 'low',
  );
</script>

<div class="approval-dialog" class:high-risk={riskLevel === 'high'}>
  <div class="approval-header">
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path
        d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
      />
    </svg>
    <span class="approval-title">Tool requires approval</span>
    {#if matchingRule}
      <span
        class="rule-indicator"
        title="Matched rule: {matchingRule.type} {matchingRule.tool}{matchingRule.pattern
          ? ' ' + matchingRule.pattern
          : ''}"
      >
        rule
      </span>
    {/if}
  </div>

  <div class="approval-body">
    <div class="tool-info">
      <span class="tool-badge">{parsed.displayName}</span>
      {#if parsed.serverName}
        <span class="mcp-server-badge">{parsed.serverName}</span>
      {/if}
      {#if description}
        <span class="tool-desc">{description}</span>
      {/if}
    </div>
    <pre class="tool-preview">{formatInput()}</pre>
  </div>

  <div class="approval-actions">
    <button class="btn btn-deny" onclick={() => respond(false)} disabled={responding}>
      Deny
    </button>
    <button class="btn btn-approve" onclick={() => respond(true)} disabled={responding}>
      Allow
    </button>
  </div>
</div>

<style>
  .approval-dialog {
    border: 2px solid var(--accent-warning);
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--bg-elevated);
  }

  .high-risk {
    border-color: var(--accent-error);
  }

  .approval-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--bg-tertiary);
    color: var(--accent-warning);
    font-size: var(--fs-base);
    font-weight: 600;
  }
  .high-risk .approval-header {
    color: var(--accent-error);
  }

  .rule-indicator {
    font-size: var(--fs-xxs);
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    background: color-mix(in srgb, var(--accent-primary) 20%, transparent);
    color: var(--accent-primary);
    margin-left: auto;
  }

  .approval-body {
    padding: 12px;
  }

  .tool-info {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .tool-badge {
    font-size: var(--fs-sm);
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 3px;
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .mcp-server-badge {
    font-size: var(--fs-xxs);
    padding: 1px 5px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .tool-desc {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
  }

  .tool-preview {
    font-size: var(--fs-sm);
    line-height: 1.4;
    padding: 8px;
    background: var(--bg-code);
    border-radius: var(--radius-sm);
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .approval-actions {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    justify-content: flex-end;
    border-top: 1px solid var(--border-secondary);
  }

  .btn {
    padding: 6px 16px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-base);
    font-weight: 600;
    transition: all var(--transition);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-deny {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
  .btn-deny:hover:not(:disabled) {
    background: var(--accent-error);
    color: var(--text-on-accent);
  }

  .btn-approve {
    background: var(--accent-secondary);
    color: var(--text-on-accent);
  }
  .btn-approve:hover:not(:disabled) {
    filter: brightness(1.1);
  }
</style>
