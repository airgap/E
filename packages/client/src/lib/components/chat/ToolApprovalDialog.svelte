<script lang="ts">
  import { streamStore } from '$lib/stores/stream.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { cancelStream } from '$lib/api/sse';
  import { parseMcpToolName, isMcpToolDangerous } from '@e/shared';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { api } from '$lib/api/client';
  import UnifiedDiffView from '../editor/UnifiedDiffView.svelte';

  let { toolCallId, toolName, input, description, hookRequestId } = $props<{
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
    description: string;
    /** Set for hook-gated approvals (real pre-edit pause); when present
     *  Allow/Deny routes through /api/hooks/pretooluse-respond to unblock the
     *  CLI, instead of just dismissing the dialog. */
    hookRequestId?: string;
  }>();

  let responding = $state(false);

  /**
   * Build a unified-diff string from this tool's inputs so we can render a
   * diff preview before the user approves. Coarse for now (no LCS minimisation
   * — every old line is `-` and every new line is `+`), but UnifiedDiffView
   * parses it correctly and the user sees the actual content that's about to
   * change. Returns null when the tool isn't an editor mutation we know about.
   */
  function buildDiff(): { fileName: string; diffContent: string } | null {
    const filePath = (input.file_path as string | undefined) ?? (input.path as string | undefined);
    if (!filePath) return null;
    const lines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

    if (
      toolName === 'Edit' &&
      typeof input.old_string === 'string' &&
      typeof input.new_string === 'string'
    ) {
      const oldL = input.old_string.split('\n');
      const newL = input.new_string.split('\n');
      lines.push(`@@ -1,${oldL.length} +1,${newL.length} @@`);
      for (const l of oldL) lines.push(`-${l}`);
      for (const l of newL) lines.push(`+${l}`);
      return { fileName: filePath, diffContent: lines.join('\n') };
    }

    if (toolName === 'Write' && typeof input.content === 'string') {
      // No way to read the existing file from the client cheaply — treat as
      // pure additions. (An old-content fetch via api.files.read could come
      // later for richer previews.)
      const newL = input.content.split('\n');
      lines.push(`@@ -0,0 +1,${newL.length} @@`);
      for (const l of newL) lines.push(`+${l}`);
      return { fileName: filePath, diffContent: lines.join('\n') };
    }

    if (toolName === 'MultiEdit' && Array.isArray(input.edits)) {
      const edits = input.edits as Array<{ old_string?: string; new_string?: string }>;
      let cursor = 0;
      for (const e of edits) {
        const oldL = (e.old_string ?? '').split('\n');
        const newL = (e.new_string ?? '').split('\n');
        lines.push(`@@ -${cursor + 1},${oldL.length} +${cursor + 1},${newL.length} @@`);
        for (const l of oldL) lines.push(`-${l}`);
        for (const l of newL) lines.push(`+${l}`);
        cursor += newL.length;
      }
      return { fileName: filePath, diffContent: lines.join('\n') };
    }
    return null;
  }
  const diff = $derived(buildDiff());

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
    if (hookRequestId) {
      // Hook-gated path: the CLI is BLOCKED inside the hook script waiting
      // for this response. POST resolves the held request → hook returns →
      // CLI either runs the edit (allow) or skips it (deny).
      try {
        await api.hooks.pretooluseRespond(hookRequestId, approved ? 'allow' : 'deny');
      } catch (err) {
        console.error('[approval] failed to send hook decision', err);
      }
    } else if (!approved) {
      // Legacy path (no hook in flight): denial can only cancel the rest of
      // the stream, since the tool already ran in the CLI by this point.
      const convId = conversationStore.active?.id;
      if (convId) await cancelStream(convId);
    }
    // Dismiss the dialog only after the action has been taken.
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
    {#if diff}
      <!-- Real diff preview for Edit/Write/MultiEdit. Gives the user the
           exact change about to apply BEFORE clicking Allow. With the
           hookRequestId path (PreToolUse hook), this is true pre-edit
           gating; the file isn't mutated until 'allow' is sent. -->
      <div class="diff-wrap">
        <UnifiedDiffView diffContent={diff.diffContent} fileName={diff.fileName} />
      </div>
    {:else}
      <pre class="tool-preview">{formatInput()}</pre>
    {/if}
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

  .diff-wrap {
    max-height: 320px;
    overflow: auto;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
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
