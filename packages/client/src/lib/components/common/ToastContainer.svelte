<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
</script>

{#if uiStore.toasts.length > 0}
  <div class="toast-container">
    {#each uiStore.toasts as toast (toast.id)}
      <div class="toast toast-{toast.type}">
        <span class="toast-message">{toast.message}</span>
        <button class="toast-dismiss" onclick={() => uiStore.dismissToast(toast.id)}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    bottom: 48px;
    right: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 2000;
    max-width: 400px;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: var(--bg-elevated);
    border: var(--ht-card-border-width) var(--ht-card-border-style) var(--border-primary);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    font-size: var(--fs-base);
    color: var(--text-primary);
    animation: toastSlideTech var(--ht-transition-speed) ease;
  }

  /* Hypertheme toast styles — radically different shapes */
  :global([data-hypertheme='arcane']) .toast {
    animation: toastMaterialize 250ms ease;
    border: 3px double var(--border-primary);
    padding: 14px 18px;
  }
  :global([data-hypertheme='ethereal']) .toast {
    animation: toastFloat 300ms ease;
    border: none;
    border-radius: var(--radius-xl);
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.3),
      0 0 0 1px var(--border-secondary);
    padding: 14px 20px;
    backdrop-filter: blur(8px);
  }
  :global([data-hypertheme='study']) .toast {
    animation: toastUnfold 250ms ease;
    border: 1px solid var(--border-primary);
    box-shadow:
      var(--shadow-lg),
      0 0 20px rgba(228, 160, 60, 0.06);
    padding: 14px 18px;
  }
  :global([data-hypertheme='astral']) .toast,
  :global([data-hypertheme='astral-midnight']) .toast {
    animation: toastPhaseIn 350ms ease;
    border: 1px solid var(--border-secondary);
    box-shadow:
      var(--shadow-lg),
      0 0 15px rgba(140, 160, 220, 0.06);
    padding: 12px 18px;
  }

  .toast-info {
    border-left: 3px solid var(--accent-info);
  }
  .toast-success {
    border-left: 3px solid var(--accent-secondary);
  }
  .toast-error {
    border-left: 3px solid var(--accent-error);
  }
  .toast-warning {
    border-left: 3px solid var(--accent-warning);
  }

  /* Ethereal toasts: no left border, use bottom accent line instead */
  :global([data-hypertheme='ethereal']) .toast-info,
  :global([data-hypertheme='ethereal']) .toast-success,
  :global([data-hypertheme='ethereal']) .toast-error,
  :global([data-hypertheme='ethereal']) .toast-warning {
    border-left: none;
  }
  :global([data-hypertheme='ethereal']) .toast-info {
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.3),
      inset 0 -2px 0 var(--accent-info);
  }
  :global([data-hypertheme='ethereal']) .toast-success {
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.3),
      inset 0 -2px 0 var(--accent-secondary);
  }
  :global([data-hypertheme='ethereal']) .toast-error {
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.3),
      inset 0 -2px 0 var(--accent-error);
  }
  :global([data-hypertheme='ethereal']) .toast-warning {
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.3),
      inset 0 -2px 0 var(--accent-warning);
  }

  .toast-message {
    flex: 1;
  }

  .toast-dismiss {
    color: var(--text-tertiary);
    padding: 2px;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }
  .toast-dismiss:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
</style>
