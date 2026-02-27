<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
  import { api } from '$lib/api/client';

  let query = $state('');
  let selectedIndex = $state(0);
  let input: HTMLInputElement;

  interface Command {
    id: string;
    label: string;
    category: string;
    shortcut?: string;
    action: () => void;
  }

  const commands: Command[] = $derived([
    {
      id: 'new-chat',
      label: 'New Conversation',
      category: 'Chat',
      shortcut: 'Ctrl+N',
      action: () => {
        conversationStore.setActive(null);
        conversationStore.createDraft();
        close();
        uiStore.focusChatInput();
      },
    },
    {
      id: 'toggle-sidebar',
      label: 'Toggle Sidebar',
      category: 'View',
      shortcut: 'Ctrl+/',
      action: () => {
        uiStore.toggleSidebar();
        close();
      },
    },
    {
      id: 'settings',
      label: 'Open Settings',
      category: 'Settings',
      action: () => {
        uiStore.openModal('settings');
      },
    },
    {
      id: 'theme-dark',
      label: 'Theme: Dark',
      category: 'Appearance',
      action: () => {
        settingsStore.setTheme('dark');
        close();
      },
    },
    {
      id: 'theme-light',
      label: 'Theme: Light',
      category: 'Appearance',
      action: () => {
        settingsStore.setTheme('light');
        close();
      },
    },
    {
      id: 'mode-normal',
      label: 'Mode: Normal',
      category: 'Mode',
      action: () => {
        if (conversationStore.active) {
          const updates: Record<string, any> = { planMode: false };
          if (conversationStore.active.permissionMode === 'teach') {
            updates.permissionMode = settingsStore.permissionMode;
          }
          conversationStore.setPlanMode(false);
          conversationStore.setActive({
            ...conversationStore.active,
            planMode: false,
            permissionMode: updates.permissionMode ?? conversationStore.active.permissionMode,
          });
          if (conversationStore.activeId) {
            api.conversations.update(conversationStore.activeId, updates);
          }
        }
        close();
      },
    },
    {
      id: 'mode-plan',
      label: 'Mode: Plan',
      category: 'Mode',
      shortcut: 'Shift+Tab x2',
      action: () => {
        if (conversationStore.active) {
          const updates: Record<string, any> = { planMode: true };
          if (conversationStore.active.permissionMode === 'teach') {
            updates.permissionMode = settingsStore.permissionMode;
          }
          conversationStore.setPlanMode(true);
          conversationStore.setActive({
            ...conversationStore.active,
            planMode: true,
            permissionMode: updates.permissionMode ?? conversationStore.active.permissionMode,
          });
          if (conversationStore.activeId) {
            api.conversations.update(conversationStore.activeId, updates);
          }
        }
        close();
      },
    },
    {
      id: 'mode-teach',
      label: 'Mode: Teach Me',
      category: 'Mode',
      action: () => {
        if (conversationStore.active) {
          conversationStore.setPlanMode(false);
          conversationStore.setActive({
            ...conversationStore.active,
            planMode: false,
            permissionMode: 'teach',
          });
          if (conversationStore.activeId) {
            api.conversations.update(conversationStore.activeId, {
              planMode: false,
              permissionMode: 'teach',
            });
          }
        }
        close();
      },
    },
    {
      id: 'tab-chats',
      label: 'Show Conversations',
      category: 'View',
      action: () => {
        uiStore.setSidebarTab('conversations');
        close();
      },
    },
    {
      id: 'tab-files',
      label: 'Show Files',
      category: 'View',
      action: () => {
        uiStore.setSidebarTab('files');
        close();
      },
    },
    {
      id: 'tab-work',
      label: 'Show Work',
      category: 'View',
      action: () => {
        uiStore.setSidebarTab('work');
        close();
      },
    },
    {
      id: 'tab-memory',
      label: 'Show Memory',
      category: 'View',
      action: () => {
        uiStore.setSidebarTab('memory');
        close();
      },
    },
    {
      id: 'tab-agents',
      label: 'Show Agents',
      category: 'View',
      action: () => {
        uiStore.setSidebarTab('agents');
        close();
      },
    },
    {
      id: 'mcp',
      label: 'Manage MCP Servers',
      category: 'Settings',
      action: () => {
        uiStore.closeModal();
        uiStore.setSidebarTab('mcp');
      },
    },
    {
      id: 'snapshots',
      label: 'Git Snapshots',
      category: 'Git',
      action: () => {
        uiStore.openModal('snapshots');
      },
    },
    {
      id: 'loop-start',
      label: loopStore.isActive
        ? `Golem ${loopStore.isRunning ? 'Running' : 'Paused'} — View Dashboard`
        : 'Activate Golem',
      category: 'Golem',
      action: () => {
        if (loopStore.isActive && loopStore.activeLoop?.id) {
          primaryPaneStore.openLooperTab(loopStore.activeLoop.id, 'Looper');
          close();
        } else {
          uiStore.setSidebarTab('work');
          uiStore.openModal('loop-config');
        }
      },
    },
    {
      id: 'replay-timeline',
      label: 'Replay Timeline — Step Through AI Actions',
      category: 'Chat',
      action: () => {
        const convId = conversationStore.activeId;
        if (convId) {
          const title = conversationStore.active?.title ?? 'Timeline';
          primaryPaneStore.openTimelineTab(convId, `Timeline: ${title}`);
          close();
        }
      },
    },
    {
      id: 'compact-conversation',
      label: 'Compact Conversation — Summarize Older Messages',
      category: 'Chat',
      action: async () => {
        const convId = conversationStore.activeId;
        if (!convId) {
          uiStore.toast('No active conversation', 'error');
          close();
          return;
        }
        try {
          uiStore.toast('Compacting conversation...', 'info');
          const res = await api.conversations.compact(convId);
          if (res.ok) {
            uiStore.toast(
              `Compacted ${res.data.droppedCount} messages into summary (${res.data.usedLLM ? 'LLM' : 'rule-based'})`,
              'success',
            );
            // Reload conversation to show compacted history
            const updated = await api.conversations.get(convId);
            if (updated.ok) {
              conversationStore.setActive(updated.data);
            }
          }
        } catch (err: any) {
          uiStore.toast(err.message || 'Compaction failed', 'error');
        }
        close();
      },
    },
    {
      id: 'view-compaction-history',
      label: 'View Compaction History',
      category: 'Chat',
      action: () => {
        uiStore.openModal('compaction-history');
        close();
      },
    },
    {
      id: 'import-external',
      label: 'Import from Jira/Linear/Asana',
      category: 'Work',
      action: () => {
        uiStore.setSidebarTab('work');
        uiStore.setSidebarOpen(true);
        uiStore.openModal('external-provider-config');
      },
    },
    {
      id: 'follow-along',
      label: 'Toggle Follow Along',
      category: 'Editor',
      action: () => {
        editorStore.toggleFollowAlong();
        close();
      },
    },
    {
      id: 'toggle-terminal',
      label: 'Toggle Terminal',
      category: 'Terminal',
      shortcut: 'Ctrl+`',
      action: () => {
        terminalStore.toggle();
        close();
      },
    },
    {
      id: 'new-terminal',
      label: 'New Terminal Tab',
      category: 'Terminal',
      shortcut: 'Ctrl+Shift+`',
      action: () => {
        terminalStore.open();
        terminalStore.createTab();
        close();
      },
    },
    {
      id: 'split-terminal-horizontal',
      label: 'Split Terminal Horizontal',
      category: 'Terminal',
      shortcut: 'Ctrl+Shift+5',
      action: () => {
        terminalStore.open();
        terminalStore.splitActive('horizontal');
        close();
      },
    },
    {
      id: 'split-terminal-vertical',
      label: 'Split Terminal Vertical',
      category: 'Terminal',
      action: () => {
        terminalStore.open();
        terminalStore.splitActive('vertical');
        close();
      },
    },
    {
      id: 'close-terminal-split',
      label: 'Close Terminal Split Pane',
      category: 'Terminal',
      action: () => {
        const sid = terminalStore.activeSessionId;
        if (sid) {
          terminalStore.closeSplit(sid);
        }
        close();
      },
    },
  ]);

  let filtered = $derived(
    commands.filter(
      (c) =>
        c.label.toLowerCase().includes(query.toLowerCase()) ||
        c.category.toLowerCase().includes(query.toLowerCase()),
    ),
  );

  function close() {
    uiStore.closeModal();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      filtered[selectedIndex].action();
    } else if (e.key === 'Escape') {
      close();
    }
  }

  $effect(() => {
    query;
    selectedIndex = 0;
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="palette-overlay" onclick={close}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="palette" onclick={(e) => e.stopPropagation()}>
    <input
      bind:this={input}
      bind:value={query}
      onkeydown={handleKeydown}
      placeholder="Type a command..."
      class="palette-input"
    />

    <div class="palette-results">
      {#each filtered as cmd, i (cmd.id)}
        <button
          class="palette-item"
          class:selected={i === selectedIndex}
          onclick={() => cmd.action()}
          onmouseenter={() => (selectedIndex = i)}
        >
          <span class="cmd-category">{cmd.category}</span>
          <span class="cmd-label">{cmd.label}</span>
          {#if cmd.shortcut}
            <kbd class="cmd-shortcut">{cmd.shortcut}</kbd>
          {/if}
        </button>
      {:else}
        <div class="no-results">No commands found</div>
      {/each}
    </div>
  </div>
</div>

<svelte:window onkeydown={handleKeydown} />

<style>
  .palette-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    padding-top: 20vh;
    z-index: 1000;
  }

  .palette {
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg);
    width: 500px;
    max-height: 400px;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  .palette-input {
    padding: 14px 16px;
    border: none;
    border-bottom: 1px solid var(--border-primary);
    background: transparent;
    font-size: var(--fs-md);
    outline: none;
    color: var(--text-primary);
  }

  .palette-results {
    overflow-y: auto;
    padding: 4px;
  }

  .palette-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    text-align: left;
    transition: background var(--transition);
  }
  .palette-item:hover,
  .palette-item.selected {
    background: var(--bg-hover);
  }

  .cmd-category {
    font-size: var(--fs-xxs);
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
    min-width: 60px;
    text-align: center;
  }
  .cmd-label {
    flex: 1;
    font-size: var(--fs-base);
    color: var(--text-primary);
  }
  .cmd-shortcut {
    font-size: var(--fs-xs);
    padding: 2px 6px;
    background: var(--bg-tertiary);
    border-radius: 3px;
    color: var(--text-tertiary);
    font-family: var(--font-family);
  }
  .no-results {
    padding: 16px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--fs-base);
  }
</style>
