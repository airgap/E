<script lang="ts">
  /**
   * BranchPickerModal (LYK-1010) — status-bar branch dropdown.
   *
   * Lists local + remote branches with ahead/behind hints, a filter
   * box, and per-row actions:
   *   - Click name (or Enter on selection) → checkout
   *   - "+ New branch" footer → create-branch form (from-base picker)
   *   - "🗑 Delete" hover button on local non-current rows
   *
   * Dirty-tree confirmation:
   *   Plain `git checkout` refuses to switch when the worktree has
   *   uncommitted changes. We surface a confirm dialog before retrying
   *   with `--force`, so the user explicitly opts in to discarding.
   */
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { gitStore } from '$lib/stores/git.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';

  interface BranchRow {
    name: string;
    isLocal: boolean;
    isRemote: boolean;
    isCurrent: boolean;
    upstream: string | null;
    ahead: number;
    behind: number;
    subject: string;
  }

  let branches = $state<BranchRow[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let filter = $state('');
  let selectedIndex = $state(0);
  let mode = $state<'list' | 'create' | 'confirm-force-checkout'>('list');
  let pendingForceCheckout = $state<string | null>(null);
  // Create-branch form state.
  let newBranchName = $state('');
  let newBranchBase = $state('');
  let busy = $state(false);

  async function load() {
    loading = true;
    error = null;
    try {
      const ws = settingsStore.workspacePath;
      if (!ws || ws === '.') throw new Error('No workspace selected');
      const res = await api.git.branches(ws);
      branches = res.data.branches;
      // Default base for new-branch form: current branch.
      newBranchBase = branches.find((b) => b.isCurrent)?.name || '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  const filtered = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    const sorted = [...branches].sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    if (!q) return sorted;
    return sorted.filter(
      (b) => b.name.toLowerCase().includes(q) || b.subject.toLowerCase().includes(q),
    );
  });

  $effect(() => {
    if (selectedIndex >= filtered.length) selectedIndex = Math.max(0, filtered.length - 1);
  });

  function close() {
    uiStore.closeModal();
  }

  async function checkout(name: string, force = false) {
    busy = true;
    error = null;
    try {
      const ws = settingsStore.workspacePath;
      const res = await api.git.checkout(ws, name, force);
      if (!res.ok) {
        // Dirty-tree refusal — surface a confirmation step.
        if ((res.error || '').toLowerCase().includes('would be overwritten')) {
          pendingForceCheckout = name;
          mode = 'confirm-force-checkout';
          return;
        }
        throw new Error(res.error || 'Checkout failed');
      }
      // Refresh git store so the new branch + ahead/behind reflect immediately.
      await gitStore.refresh(ws, { force: true });
      close();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function createBranch() {
    if (!newBranchName.trim()) return;
    busy = true;
    error = null;
    try {
      const ws = settingsStore.workspacePath;
      const res = await api.git.branchCreate(
        ws,
        newBranchName.trim(),
        newBranchBase || undefined,
        true,
      );
      if (!res.ok) throw new Error(res.error || 'Create failed');
      await gitStore.refresh(ws, { force: true });
      close();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function deleteBranch(name: string) {
    const ok = confirm(
      `Delete branch "${name}"?\n\nUse force-delete if it has unmerged commits — otherwise the operation will be aborted by git.`,
    );
    if (!ok) return;
    busy = true;
    error = null;
    try {
      const ws = settingsStore.workspacePath;
      let res = await api.git.branchDelete(ws, name, false);
      if (!res.ok && (res.error || '').toLowerCase().includes('not fully merged')) {
        const forceOk = confirm(
          `"${name}" has unmerged commits. Force-delete (commits will be unreachable)?`,
        );
        if (!forceOk) return;
        res = await api.git.branchDelete(ws, name, true);
      }
      if (!res.ok) throw new Error(res.error || 'Delete failed');
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function pull() {
    busy = true;
    error = null;
    try {
      const ws = settingsStore.workspacePath;
      const res = await api.git.pull(ws);
      if (!res.ok) throw new Error(res.error || 'Pull failed');
      await gitStore.refresh(ws, { force: true });
      close();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function push() {
    busy = true;
    error = null;
    try {
      const ws = settingsStore.workspacePath;
      const res = await gitStore.push(ws);
      if (!res.ok) throw new Error(res.error || 'Push failed');
      close();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (mode !== 'list') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(filtered.length - 1, selectedIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(0, selectedIndex - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = filtered[selectedIndex];
      if (row && !row.isCurrent) checkout(row.name);
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  aria-label="Switch branch"
  onclick={(e) => e.target === e.currentTarget && close()}
  onkeydown={(e) => e.key === 'Escape' && close()}
  tabindex="-1"
>
  <div class="modal">
    {#if mode === 'list'}
      <header>
        <input
          type="text"
          class="filter"
          placeholder="Find a branch…"
          bind:value={filter}
          autofocus
        />
        <button class="btn" onclick={close} aria-label="Close">✕</button>
      </header>

      {#if loading}
        <div class="empty">Loading branches…</div>
      {:else if error}
        <div class="error">{error}</div>
      {:else if filtered.length === 0}
        <div class="empty">No branches match.</div>
      {:else}
        <ul class="list" role="listbox">
          {#each filtered as b, i (b.name)}
            <li
              role="option"
              aria-selected={i === selectedIndex}
              class:selected={i === selectedIndex}
              class:current={b.isCurrent}
            >
              <button
                type="button"
                class="row"
                disabled={b.isCurrent || busy}
                onclick={() => checkout(b.name)}
                title={b.subject}
              >
                <span class="name">
                  {#if b.isCurrent}<span class="dot">●</span>{/if}
                  {b.name}
                </span>
                <span class="meta">
                  {#if b.upstream && (b.ahead || b.behind)}
                    {#if b.ahead}<span class="ahead">↑{b.ahead}</span>{/if}
                    {#if b.behind}<span class="behind">↓{b.behind}</span>{/if}
                  {:else if b.isRemote}
                    <span class="kind">remote</span>
                  {/if}
                </span>
              </button>
              {#if b.isLocal && !b.isCurrent}
                <button
                  type="button"
                  class="row-delete"
                  title="Delete branch"
                  onclick={() => deleteBranch(b.name)}
                  disabled={busy}
                >
                  🗑
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      <footer>
        <button class="btn" onclick={() => (mode = 'create')} disabled={busy}>+ New branch</button>
        <button class="btn" onclick={pull} disabled={busy || !gitStore.hasUpstream}>
          ↓ Pull
        </button>
        <button class="btn" onclick={push} disabled={busy}>↑ Push</button>
      </footer>
    {:else if mode === 'create'}
      <header>
        <h3>New branch</h3>
        <button class="btn" onclick={() => (mode = 'list')} aria-label="Back">←</button>
      </header>
      {#if error}<div class="error">{error}</div>{/if}
      <div class="form">
        <label>
          Branch name
          <input bind:value={newBranchName} placeholder="e.g. feature/widget" autofocus />
        </label>
        <label>
          Base
          <select bind:value={newBranchBase}>
            {#each branches as b (b.name)}
              <option value={b.name}>{b.name}</option>
            {/each}
          </select>
        </label>
        <div class="form-actions">
          <button class="btn" onclick={() => (mode = 'list')} disabled={busy}>Cancel</button>
          <button
            class="btn primary"
            onclick={createBranch}
            disabled={busy || !newBranchName.trim()}
          >
            Create + Checkout
          </button>
        </div>
      </div>
    {:else if mode === 'confirm-force-checkout'}
      <header>
        <h3>Discard local changes?</h3>
      </header>
      <p class="confirm-text">
        Your working tree has uncommitted changes that would conflict with switching to
        <strong>{pendingForceCheckout}</strong>. Force-checkout will discard them.
      </p>
      <div class="form-actions">
        <button class="btn" onclick={() => (mode = 'list')} disabled={busy}>Cancel</button>
        <button
          class="btn primary"
          onclick={() => pendingForceCheckout && checkout(pendingForceCheckout, true)}
          disabled={busy}
        >
          Discard + checkout
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 80px;
    z-index: 200;
  }
  .modal {
    background: var(--bg-primary);
    color: var(--text-primary);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-primary);
    box-shadow: 0 14px 32px rgba(0, 0, 0, 0.4);
    width: 480px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-primary);
  }
  header h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    flex: 1;
  }
  .filter {
    flex: 1;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    color: var(--text-primary);
    border-radius: var(--radius-sm);
    padding: 4px 8px;
    font-size: 13px;
  }
  .btn {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    color: var(--text-primary);
    border-radius: var(--radius-sm);
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn.primary {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: #fff;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    overflow-y: auto;
    flex: 1;
  }
  .list li {
    display: flex;
    align-items: stretch;
    padding: 0 4px;
  }
  .list li.selected,
  .list li:hover {
    background: var(--bg-hover);
  }
  .row {
    flex: 1;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 6px 8px;
    cursor: pointer;
  }
  .row:disabled {
    cursor: default;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
  }
  .dot {
    color: var(--accent-secondary, #5ed26b);
  }
  .meta {
    display: flex;
    gap: 6px;
    font-size: 11px;
    color: var(--text-tertiary);
  }
  .ahead {
    color: var(--accent-secondary, #5ed26b);
  }
  .behind {
    color: var(--accent-warning, #d4a657);
  }
  .row-delete {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 0 8px;
    font-size: 12px;
  }
  .row-delete:hover:not(:disabled) {
    color: var(--accent-error, #ef4444);
  }
  footer {
    display: flex;
    gap: 8px;
    padding: 8px 10px;
    border-top: 1px solid var(--border-primary);
    background: var(--bg-secondary);
  }
  .empty,
  .error {
    padding: 24px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 12px;
  }
  .error {
    color: var(--accent-error, #ef4444);
  }
  .form {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .form label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .form input,
  .form select {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    color: var(--text-primary);
    border-radius: var(--radius-sm);
    padding: 4px 8px;
    font-size: 13px;
  }
  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 8px 14px 14px;
  }
  .confirm-text {
    padding: 12px 14px;
    font-size: 13px;
    color: var(--text-secondary);
  }
</style>
