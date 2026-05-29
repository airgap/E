<script lang="ts">
  /**
   * PluginPromptModal (LYK-1056) — renders the active pluginPromptStore
   * request (quick-pick or input-box) and resolves it on pick / submit /
   * dismiss. Mounted once in AppShell. Plugin id shown so the user knows
   * which extension is asking.
   */
  import { tick } from 'svelte';
  import { pluginPromptStore } from '$lib/stores/pluginPrompt.svelte';

  const active = $derived(pluginPromptStore.active);

  let filter = $state('');
  let pickIndex = $state(0);
  let inputValue = $state('');
  let inputEl = $state<HTMLInputElement | undefined>();

  // Reset transient UI state whenever a new request becomes active.
  $effect(() => {
    const a = pluginPromptStore.active;
    if (!a) return;
    filter = '';
    pickIndex = 0;
    inputValue = a.kind === 'inputBox' ? (a.value ?? '') : '';
    tick().then(() => inputEl?.focus());
  });

  const filteredItems = $derived.by(() => {
    if (!active || active.kind !== 'quickPick') return [];
    const q = filter.trim().toLowerCase();
    if (!q) return active.items;
    return active.items.filter(
      (it) =>
        it.label.toLowerCase().includes(q) ||
        (it.description ?? '').toLowerCase().includes(q) ||
        (it.detail ?? '').toLowerCase().includes(q),
    );
  });

  $effect(() => {
    if (pickIndex >= filteredItems.length) pickIndex = Math.max(0, filteredItems.length - 1);
  });

  function dismiss() {
    pluginPromptStore.resolveActive(null);
  }
  function pick(label: string) {
    pluginPromptStore.resolveActive(label);
  }
  function submitInput() {
    pluginPromptStore.resolveActive(inputValue);
  }

  function onKeydown(e: KeyboardEvent) {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
      return;
    }
    if (active.kind === 'quickPick') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        pickIndex = Math.min(filteredItems.length - 1, pickIndex + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        pickIndex = Math.max(0, pickIndex - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = filteredItems[pickIndex];
        if (it) pick(it.label);
      }
    } else if (active.kind === 'inputBox' && e.key === 'Enter') {
      e.preventDefault();
      submitInput();
    }
  }
</script>

{#if active}
  <div
    class="prompt-backdrop"
    role="dialog"
    aria-modal="true"
    aria-label={active.kind === 'quickPick' ? 'Quick pick' : 'Input'}
    tabindex="-1"
    onclick={(e) => e.target === e.currentTarget && dismiss()}
    onkeydown={onKeydown}
  >
    <div class="prompt">
      <div class="prompt-origin">{active.pluginId}</div>

      {#if active.kind === 'quickPick'}
        <input
          bind:this={inputEl}
          bind:value={filter}
          class="prompt-input"
          type="text"
          placeholder={active.placeholder ?? 'Type to filter…'}
          spellcheck="false"
        />
        <ul class="pick-list" role="listbox">
          {#each filteredItems as it, i (it.label + i)}
            <li role="option" aria-selected={i === pickIndex} class:active={i === pickIndex}>
              <button type="button" class="pick-item" onclick={() => pick(it.label)}>
                <span class="pick-label">{it.label}</span>
                {#if it.description}<span class="pick-desc">{it.description}</span>{/if}
                {#if it.detail}<span class="pick-detail">{it.detail}</span>{/if}
              </button>
            </li>
          {:else}
            <li class="pick-empty">No matches</li>
          {/each}
        </ul>
      {:else}
        {#if active.prompt}<p class="prompt-text">{active.prompt}</p>{/if}
        <input
          bind:this={inputEl}
          bind:value={inputValue}
          class="prompt-input"
          type={active.password ? 'password' : 'text'}
          placeholder={active.placeholder ?? ''}
          spellcheck="false"
        />
        <div class="prompt-actions">
          <button type="button" class="btn" onclick={dismiss}>Cancel</button>
          <button type="button" class="btn primary" onclick={submitInput}>OK</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .prompt-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 90px;
    z-index: 300;
  }
  .prompt {
    width: 460px;
    max-width: 90vw;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-md);
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
    overflow: hidden;
  }
  .prompt-origin {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
    padding: 6px 10px 0;
  }
  .prompt-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font: inherit;
    font-size: 13px;
    padding: 6px 8px;
    margin: 6px 10px;
    width: calc(100% - 20px);
    outline: none;
  }
  .prompt-input:focus {
    border-color: var(--accent-primary);
  }
  .prompt-text {
    margin: 8px 10px 0;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .pick-list {
    list-style: none;
    margin: 0;
    padding: 4px 0 6px;
    max-height: 320px;
    overflow-y: auto;
  }
  .pick-list li.active,
  .pick-list li:hover {
    background: var(--bg-hover);
  }
  .pick-item {
    display: flex;
    flex-direction: column;
    width: 100%;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 5px 12px;
    cursor: pointer;
  }
  .pick-label {
    font-size: 13px;
  }
  .pick-desc {
    font-size: 11px;
    color: var(--text-secondary);
  }
  .pick-detail {
    font-size: 10px;
    color: var(--text-tertiary);
  }
  .pick-empty {
    padding: 8px 12px;
    color: var(--text-tertiary);
    font-size: 12px;
  }
  .prompt-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 4px 10px 10px;
  }
  .btn {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    color: var(--text-primary);
    border-radius: var(--radius-sm);
    font: inherit;
    font-size: 12px;
    padding: 4px 12px;
    cursor: pointer;
  }
  .btn.primary {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: #fff;
  }
</style>
