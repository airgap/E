<!--
  QuickFixMenu.svelte — Floating quick-fix menu for diagnostics.

  Combines LSP code actions with AI-powered fixes into a single menu.
  Triggered by clicking the lightbulb gutter marker or pressing Mod-.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { lspStore } from '$lib/stores/lsp.svelte';
  import { aiActionsStore } from '$lib/stores/ai-actions.svelte';
  import type { QuickFixRequest } from './extensions/code-action-gutter';

  let { request, filePath, language, fileUri, documentContent, onClose, onApplyEdit } = $props<{
    request: QuickFixRequest;
    filePath?: string;
    language?: string;
    fileUri?: string;
    documentContent?: string;
    onClose: () => void;
    onApplyEdit?: (newText: string, from: number, to: number) => void;
  }>();

  interface QuickFixItem {
    label: string;
    detail?: string;
    kind: 'lsp' | 'ai';
    icon: string;
    action: () => void;
  }

  let items = $state<QuickFixItem[]>([]);
  let loading = $state(true);
  let selectedIndex = $state(0);
  let menuEl: HTMLDivElement;

  // Position clamping
  let menuX = $state(request.x);
  let menuY = $state(request.y);

  const diagMessages = $derived(
    request.diagnostics.map((d: { message: string }) => d.message).join('\n'),
  );

  // Get the code on the diagnostic line
  function getLineCode(): string {
    if (!documentContent) return '';
    const lines = documentContent.split('\n');
    if (request.line >= 1 && request.line <= lines.length) {
      return lines[request.line - 1];
    }
    return '';
  }

  // Build items: LSP code actions + AI actions
  async function buildItems() {
    const result: QuickFixItem[] = [];

    // Try LSP code actions first
    if (language && fileUri && lspStore.isConnected(language)) {
      try {
        const lspActions = await fetchLspCodeActions();
        for (const act of lspActions) {
          result.push({
            label: act.title,
            detail: act.kind ? `(${act.kind})` : undefined,
            kind: 'lsp',
            icon: getActionIcon(act.kind),
            action: () => {
              applyLspAction(act);
              onClose();
            },
          });
        }
      } catch {
        // LSP code actions not available — that's fine
      }
    }

    // AI-powered actions
    result.push({
      label: 'AI: Fix this diagnostic',
      detail: request.diagnostics[0]?.message?.slice(0, 60),
      kind: 'ai',
      icon: '🔧',
      action: () => {
        const code = getLineCode() || diagMessages;
        aiActionsStore.run('fix-diagnostic', code, {
          filePath,
          language,
          diagnosticMessage: diagMessages,
        });
        onClose();
      },
    });

    result.push({
      label: 'AI: Explain this error',
      detail: request.diagnostics[0]?.message?.slice(0, 60),
      kind: 'ai',
      icon: '💬',
      action: () => {
        const code = getLineCode() || diagMessages;
        aiActionsStore.run('explain', code, {
          filePath,
          language,
        });
        onClose();
      },
    });

    items = result;
    loading = false;
  }

  async function fetchLspCodeActions(): Promise<any[]> {
    if (!language || !fileUri) return [];

    const lspDiags = request.diagnostics.map(
      (d: { from: number; to: number; severity: string; message: string; source?: string }) => ({
        range: {
          start: { line: request.line - 1, character: d.from },
          end: { line: request.line - 1, character: d.to },
        },
        severity: d.severity === 'error' ? 1 : d.severity === 'warning' ? 2 : 3,
        message: d.message,
        source: d.source,
      }),
    );

    const result = await lspStore.request(language, 'textDocument/codeAction', {
      textDocument: { uri: fileUri },
      range: {
        start: { line: request.line - 1, character: 0 },
        end: { line: request.line - 1, character: 999 },
      },
      context: {
        diagnostics: lspDiags,
        only: ['quickfix', 'refactor', 'source'],
      },
    });

    return Array.isArray(result) ? result : [];
  }

  function applyLspAction(action: any) {
    if (!action.edit?.changes && !action.edit?.documentChanges) {
      // It might be a command, try executing it
      if (action.command && language) {
        lspStore
          .request(language, 'workspace/executeCommand', {
            command: action.command.command || action.command,
            arguments: action.command.arguments || action.arguments || [],
          })
          .catch(() => {});
      }
      return;
    }

    // Apply workspace edit
    const changes = action.edit.changes || {};
    for (const [uri, edits] of Object.entries(changes)) {
      if (uri === fileUri && onApplyEdit) {
        // Apply edits in reverse order to preserve positions
        const sorted = [...(edits as any[])].sort(
          (a, b) =>
            b.range.start.line - a.range.start.line ||
            b.range.start.character - a.range.start.character,
        );
        for (const edit of sorted) {
          const from = edit.range.start;
          const to = edit.range.end;
          // Convert LSP positions to absolute positions
          if (documentContent) {
            const lines = documentContent.split('\n');
            let fromOffset = 0;
            for (let i = 0; i < from.line && i < lines.length; i++) {
              fromOffset += lines[i].length + 1;
            }
            fromOffset += from.character;

            let toOffset = 0;
            for (let i = 0; i < to.line && i < lines.length; i++) {
              toOffset += lines[i].length + 1;
            }
            toOffset += to.character;

            onApplyEdit(edit.newText, fromOffset, toOffset);
          }
        }
      }
    }
  }

  function getActionIcon(kind?: string): string {
    if (!kind) return '⚡';
    if (kind.startsWith('quickfix')) return '🔧';
    if (kind.startsWith('refactor')) return '✏️';
    if (kind.startsWith('source')) return '📄';
    return '⚡';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[selectedIndex]) {
        items[selectedIndex].action();
      }
    }
  }

  function handleClickOutside(e: MouseEvent) {
    if (menuEl && !menuEl.contains(e.target as Node)) {
      onClose();
    }
  }

  onMount(() => {
    buildItems();
    document.addEventListener('mousedown', handleClickOutside, true);
    // Clamp position to viewport
    requestAnimationFrame(() => {
      if (menuEl) {
        const rect = menuEl.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (rect.right > vw - 8) menuX = vw - rect.width - 8;
        if (rect.bottom > vh - 8) menuY = request.y - rect.height - 4;
        menuEl.focus();
      }
    });
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="quick-fix-menu"
  style="left: {menuX}px; top: {menuY}px;"
  bind:this={menuEl}
  onkeydown={handleKeydown}
  tabindex="-1"
  role="listbox"
  aria-label="Quick fixes"
>
  {#if loading}
    <div class="qf-loading">
      <span class="qf-spinner"></span>
      Loading fixes...
    </div>
  {:else if items.length === 0}
    <div class="qf-empty">No quick fixes available</div>
  {:else}
    {#each items as item, i}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="qf-item"
        class:selected={i === selectedIndex}
        class:ai={item.kind === 'ai'}
        role="option"
        aria-selected={i === selectedIndex}
        onclick={item.action}
        onmouseenter={() => {
          selectedIndex = i;
        }}
      >
        <span class="qf-icon">{item.icon}</span>
        <span class="qf-label">{item.label}</span>
        {#if item.detail}
          <span class="qf-detail">{item.detail}</span>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .quick-fix-menu {
    position: fixed;
    z-index: 200;
    min-width: 240px;
    max-width: 480px;
    max-height: 300px;
    overflow-y: auto;
    background: var(--bg-elevated, #1c2128);
    border: 1px solid var(--border-primary, #30363d);
    border-radius: var(--radius, 6px);
    box-shadow:
      0 4px 16px rgba(0, 0, 0, 0.4),
      0 1px 4px rgba(0, 0, 0, 0.3);
    padding: 4px 0;
    font-family: var(--font-family-sans, system-ui);
    font-size: var(--fs-sm, 12px);
    outline: none;
    animation: qfIn 0.1s ease-out;
  }

  @keyframes qfIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .qf-loading,
  .qf-empty {
    padding: 8px 12px;
    color: var(--text-tertiary, #484f58);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .qf-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--text-tertiary, #484f58);
    border-top-color: var(--accent-primary, #00b4ff);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .qf-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    cursor: pointer;
    color: var(--text-secondary, #8b949e);
    transition:
      background 0.08s ease,
      color 0.08s ease;
    white-space: nowrap;
    overflow: hidden;
  }

  .qf-item.selected {
    background: var(--bg-active, rgba(0, 180, 255, 0.12));
    color: var(--text-primary, #c9d1d9);
  }

  .qf-item:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.04));
  }

  .qf-icon {
    flex-shrink: 0;
    font-size: 13px;
    width: 18px;
    text-align: center;
  }

  .qf-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .qf-detail {
    flex-shrink: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-tertiary, #484f58);
    font-size: 11px;
    max-width: 200px;
  }

  .qf-item.ai .qf-label {
    color: var(--accent-primary, #00b4ff);
  }

  .qf-item.ai.selected .qf-label {
    color: var(--text-primary, #c9d1d9);
  }
</style>
