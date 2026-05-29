<script lang="ts">
  /**
   * WalkthroughsModal (LYK-1040) — onboarding picker for plugin-
   * contributed walkthroughs. Left rail lists every walkthrough across
   * enabled plugins; right pane shows the selected walkthrough's steps
   * with check-off boxes (persisted per (pluginId, walkthroughId,
   * stepId) in localStorage) and an optional "Run" button per step that
   * fires the step's contributed command.
   *
   * Completion check-state is purely client-side — plugins don't need
   * to be notified. A step with a contributed command auto-checks on
   * run; manual click-through is also supported for steps without one.
   */
  import { uiStore } from '$lib/stores/ui.svelte';
  import { pluginContributionsStore } from '$lib/stores/pluginContributions.svelte';
  import { dispatchPluginCommand } from '$lib/stores/pluginBridge';
  import type { WalkthroughContribution } from '@e/shared';

  const PROGRESS_KEY = 'e-walkthrough-progress-v1';
  function loadProgress(): Record<string, boolean> {
    if (typeof localStorage === 'undefined') return {};
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  function persistProgress(p: Record<string, boolean>) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
    } catch {
      /* best-effort */
    }
  }

  let progress = $state<Record<string, boolean>>(loadProgress());

  function stepKey(pluginId: string, walkId: string, stepId: string): string {
    return `${pluginId}.${walkId}.${stepId}`;
  }
  function isDone(pluginId: string, walkId: string, stepId: string): boolean {
    return progress[stepKey(pluginId, walkId, stepId)] === true;
  }
  function setDone(pluginId: string, walkId: string, stepId: string, done: boolean) {
    progress = { ...progress, [stepKey(pluginId, walkId, stepId)]: done };
    persistProgress(progress);
  }

  type Entry = WalkthroughContribution & { pluginId: string };
  const all = $derived<Entry[]>(pluginContributionsStore.walkthroughs as Entry[]);
  let activeIdx = $state(0);
  const active = $derived<Entry | null>(all[activeIdx] ?? null);

  function close() {
    uiStore.closeModal();
  }

  function runStep(entry: Entry, stepId: string, command?: string) {
    if (command) {
      dispatchPluginCommand({ pluginId: entry.pluginId, command });
    }
    setDone(entry.pluginId, entry.id, stepId, true);
  }

  function completionPct(entry: Entry): number {
    if (entry.steps.length === 0) return 0;
    let done = 0;
    for (const s of entry.steps) if (isDone(entry.pluginId, entry.id, s.id)) done++;
    return Math.round((done / entry.steps.length) * 100);
  }
</script>

<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  aria-label="Walkthroughs"
  onclick={close}
  onkeydown={(e) => e.key === 'Escape' && close()}
>
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_static_element_interactions -->
  <div class="modal" role="presentation" onclick={(e) => e.stopPropagation()}>
    <header class="head">
      <h2>Walkthroughs</h2>
      <button type="button" class="close-btn" aria-label="Close" onclick={close}>×</button>
    </header>

    {#if all.length === 0}
      <div class="empty">No walkthroughs available. Install a plugin that ships one.</div>
    {:else}
      <div class="body">
        <aside class="list">
          <ul>
            {#each all as w, i (w.pluginId + '.' + w.id)}
              <li>
                <button
                  type="button"
                  class="walk-item"
                  class:active={i === activeIdx}
                  onclick={() => (activeIdx = i)}
                >
                  <span class="walk-title">{w.title}</span>
                  <span class="walk-pct">{completionPct(w)}%</span>
                </button>
              </li>
            {/each}
          </ul>
        </aside>

        <section class="detail">
          {#if active}
            <h3>{active.title}</h3>
            {#if active.description}
              <p class="walk-desc">{active.description}</p>
            {/if}
            <ol class="steps">
              {#each active.steps as step (step.id)}
                {@const done = isDone(active.pluginId, active.id, step.id)}
                <li class="step" class:done>
                  <label class="step-check">
                    <input
                      type="checkbox"
                      checked={done}
                      onchange={(e) =>
                        setDone(
                          active.pluginId,
                          active.id,
                          step.id,
                          (e.target as HTMLInputElement).checked,
                        )}
                    />
                  </label>
                  <div class="step-body">
                    <div class="step-title">{step.title}</div>
                    {#if step.description}
                      <p class="step-desc">{step.description}</p>
                    {/if}
                  </div>
                  {#if step.command}
                    <button
                      type="button"
                      class="step-run"
                      onclick={() => runStep(active, step.id, step.command)}
                    >
                      Run
                    </button>
                  {/if}
                </li>
              {/each}
            </ol>
          {/if}
        </section>
      </div>
    {/if}
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(2px);
  }
  .modal {
    background: var(--bg-elevated, var(--bg-secondary));
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    width: min(860px, 95vw);
    max-height: 86vh;
    display: flex;
    flex-direction: column;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-primary);
  }
  .head h2 {
    margin: 0;
    font-size: var(--fs-md);
  }
  .close-btn {
    background: none;
    border: none;
    color: var(--text-tertiary);
    font-size: 22px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
  }
  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .empty {
    padding: 32px;
    color: var(--text-tertiary);
    text-align: center;
  }
  .body {
    display: grid;
    grid-template-columns: 260px 1fr;
    min-height: 320px;
    overflow: hidden;
  }
  .list {
    border-right: 1px solid var(--border-primary);
    overflow-y: auto;
  }
  .list ul {
    margin: 0;
    padding: 8px 6px;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .walk-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    width: 100%;
    padding: 8px 10px;
    background: none;
    border: none;
    color: var(--text-primary);
    text-align: left;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font: inherit;
    font-size: var(--fs-sm);
  }
  .walk-item:hover {
    background: var(--bg-hover);
  }
  .walk-item.active {
    background: color-mix(in srgb, var(--accent-primary) 16%, transparent);
    color: var(--accent-primary);
  }
  .walk-pct {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .detail {
    padding: 18px 20px;
    overflow-y: auto;
  }
  .detail h3 {
    margin: 0 0 4px;
  }
  .walk-desc {
    margin: 0 0 12px;
    color: var(--text-secondary);
    font-size: var(--fs-sm);
  }
  .steps {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .step {
    display: grid;
    grid-template-columns: 24px 1fr auto;
    gap: 10px;
    align-items: start;
    padding: 10px 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
  }
  .step.done {
    opacity: 0.7;
  }
  .step-check {
    display: flex;
    align-items: center;
    padding-top: 2px;
  }
  .step-title {
    font-weight: 600;
    font-size: var(--fs-sm);
  }
  .step-desc {
    margin: 4px 0 0;
    color: var(--text-secondary);
    font-size: var(--fs-xs);
  }
  .step-run {
    padding: 4px 12px;
    background: var(--accent-primary);
    color: var(--bg-primary);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font: inherit;
    font-size: var(--fs-xs);
    align-self: center;
  }
  .step-run:hover {
    filter: brightness(1.1);
  }
</style>
