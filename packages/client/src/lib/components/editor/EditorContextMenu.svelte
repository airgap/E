<!--
  EditorContextMenu.svelte — Right-click context menu for the code editor.

  Shows AI actions when text is selected:
  - Explain Selection
  - Optimize
  - Simplify
  - Generate Test
  - Add Documentation
  - Custom Prompt...

  Also shows standard editor actions (Cut, Copy, Paste, Select All).
-->
<script lang="ts">
  import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
  import type { ContextMenuItem } from '$lib/components/ui/ContextMenu.svelte';
  import { aiActionsStore, type ActionType } from '$lib/stores/ai-actions.svelte';

  let { x, y, selectedText, filePath, language, onClose, onApplyResult } = $props<{
    x: number;
    y: number;
    selectedText: string;
    filePath?: string;
    language?: string;
    onClose: () => void;
    onApplyResult?: (result: string) => void;
  }>();

  const hasSelection = $derived(selectedText.length > 0);

  function runAction(action: ActionType, customPrompt?: string) {
    onClose();
    aiActionsStore.run(action, selectedText, {
      filePath,
      language,
      customPrompt,
    });
  }

  function handleCustomPrompt() {
    onClose();
    const prompt = window.prompt('Enter your instruction for the AI:');
    if (prompt?.trim()) {
      aiActionsStore.run('custom', selectedText, {
        filePath,
        language,
        customPrompt: prompt.trim(),
      });
    }
  }

  async function handleCopy() {
    onClose();
    try {
      await navigator.clipboard.writeText(selectedText);
    } catch {
      // Clipboard may not be available
    }
  }

  async function handlePaste() {
    onClose();
    try {
      const text = await navigator.clipboard.readText();
      onApplyResult?.(text);
    } catch {
      // Clipboard may not be available
    }
  }

  const isMac = typeof navigator !== 'undefined' && navigator.platform?.includes('Mac');
  const mod = isMac ? '⌘' : 'Ctrl+';

  const items = $derived<ContextMenuItem[]>([
    // ── AI Actions (only when text is selected) ──
    ...(hasSelection
      ? [
          { kind: 'header' as const, label: 'AI Actions' },
          {
            label: 'Explain Selection',
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
            action: () => runAction('explain'),
          },
          {
            label: 'Optimize',
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
            action: () => runAction('optimize'),
          },
          {
            label: 'Simplify',
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
            action: () => runAction('simplify'),
          },
          {
            label: 'Generate Test',
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
            action: () => runAction('generate-test'),
          },
          {
            label: 'Add Documentation',
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
            action: () => runAction('document'),
          },
          {
            label: 'Custom Prompt...',
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
            action: () => handleCustomPrompt(),
          },
          { kind: 'separator' as const },
        ]
      : []),

    // ── Standard actions ──
    {
      label: 'Copy',
      shortcut: `${mod}C`,
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
      disabled: !hasSelection,
      action: () => handleCopy(),
    },
    {
      label: 'Paste',
      shortcut: `${mod}V`,
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>`,
      action: () => handlePaste(),
    },
    { kind: 'separator' as const },
    {
      label: 'Select All',
      shortcut: `${mod}A`,
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="16" y2="16"/></svg>`,
      action: () => {
        onClose();
        document.execCommand('selectAll');
      },
    },
  ]);
</script>

<ContextMenu {items} {x} {y} {onClose} />
