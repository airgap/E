<script lang="ts">
  export type ConversationMode = 'normal' | 'plan' | 'teach';

  const MODE_META: Record<ConversationMode, { label: string; paths: string[]; color?: string }> = {
    normal: {
      label: 'Chat',
      paths: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
    },
    plan: {
      label: 'Plan',
      paths: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'],
      color: 'var(--accent-warning)',
    },
    teach: {
      label: 'Teach',
      paths: ['M22 10v6M2 10l10-5 10 5-10 5z', 'M6 12v5c0 2 3 3 6 3s6-1 6-3v-5'],
      color: 'var(--accent-secondary, #10b981)',
    },
  };

  let {
    mode = 'normal',
    onchange,
  }: {
    mode: ConversationMode;
    onchange: (mode: ConversationMode) => void;
  } = $props();

  let open = $state(false);

  function select(m: ConversationMode) {
    onchange(m);
    open = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false;
  }

  $effect(() => {
    if (!open) return;
    const close = () => {
      open = false;
    };
    // Close on any outside click — delay to avoid closing on the trigger click
    const timer = setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', close);
    };
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="mode-dropdown">
  <button
    class="mode-trigger"
    class:active={mode !== 'normal'}
    style:--mode-color={MODE_META[mode].color ?? 'var(--text-tertiary)'}
    onclick={() => (open = !open)}
    title="Switch mode (Shift+Tab x2)"
  >
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {#each MODE_META[mode].paths as d}
        <path {d} />
      {/each}
    </svg>
    <svg
      class="chevron"
      width="8"
      height="8"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  </button>

  {#if open}
    <div class="mode-menu">
      {#each Object.entries(MODE_META) as [key, meta]}
        {@const m = key as ConversationMode}
        <button
          class="mode-option"
          class:selected={mode === m}
          style:--option-color={meta.color ?? 'var(--accent-primary)'}
          onclick={(e: MouseEvent) => {
            e.stopPropagation();
            select(m);
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            {#each meta.paths as d}
              <path {d} />
            {/each}
          </svg>
          <span>{meta.label}</span>
          {#if mode === m}
            <svg
              class="check"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .mode-dropdown {
    position: relative;
    flex-shrink: 0;
  }

  .mode-trigger {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 4px 4px 6px;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius);
    background: transparent;
    color: var(--mode-color);
    cursor: pointer;
    transition: all var(--transition);
    line-height: 1;
  }

  .mode-trigger:hover {
    background: var(--bg-hover);
    border-color: var(--border-primary);
  }

  .mode-trigger.active {
    background: color-mix(in srgb, var(--mode-color) 10%, transparent);
    border-color: color-mix(in srgb, var(--mode-color) 40%, transparent);
  }

  .chevron {
    opacity: 0.5;
  }

  .mode-menu {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    min-width: 120px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    padding: 3px;
    box-shadow: var(--shadow-lg);
    z-index: 50;
  }

  .mode-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition);
    white-space: nowrap;
  }

  .mode-option:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .mode-option.selected {
    color: var(--option-color);
    font-weight: 600;
  }

  .check {
    margin-left: auto;
  }
</style>
