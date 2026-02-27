<script lang="ts">
  import { startupTipsStore } from '$lib/stores/startupTips.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { onMount } from 'svelte';

  let dismissing = $state(false);

  function handleAction(actionId: string) {
    switch (actionId) {
      case 'open-command-palette':
        uiStore.openModal('command-palette');
        break;
      case 'focus-chat':
        uiStore.focusChatInput();
        break;
      case 'toggle-sidebar':
        uiStore.toggleSidebar();
        break;
      case 'open-quick-open':
        uiStore.openModal('quick-open');
        break;
      case 'open-memory-panel':
        uiStore.setSidebarTab('memory');
        break;
      case 'open-help-panel':
        uiStore.setSidebarTab('help');
        break;
      case 'open-settings':
        uiStore.openModal('settings');
        break;
      case 'open-work-panel':
        uiStore.setSidebarTab('work');
        break;
      case 'open-costs-panel':
        uiStore.setSidebarTab('costs');
        break;
      case 'toggle-editor':
        if (editorStore.layoutMode === 'chat-only') {
          editorStore.setLayoutMode('split-horizontal');
        } else {
          editorStore.setLayoutMode('chat-only');
        }
        break;
      case 'toggle-terminal':
        terminalStore.toggle();
        break;
    }
    dismiss();
  }

  function dismiss() {
    dismissing = true;
    setTimeout(() => {
      startupTipsStore.dismiss();
      dismissing = false;
    }, 200);
  }

  function nextTip() {
    startupTipsStore.next();
  }

  // Auto-dismiss after 12 seconds
  let autoTimer: ReturnType<typeof setTimeout>;
  onMount(() => {
    autoTimer = setTimeout(() => {
      if (startupTipsStore.visible) dismiss();
    }, 12000);
    return () => clearTimeout(autoTimer);
  });

  // Reset timer when tip changes
  $effect(() => {
    const _tip = startupTipsStore.currentTip;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      if (startupTipsStore.visible) dismiss();
    }, 12000);
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
    }
  }

  function handleDisableClick() {
    settingsStore.update({ showStartupTips: false });
    dismiss();
    uiStore.toast('Startup tips disabled. Re-enable in Settings → General.', 'info');
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if startupTipsStore.visible && startupTipsStore.currentTip}
  {@const tip = startupTipsStore.currentTip}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="startup-tip-overlay" class:dismissing>
    <div class="startup-tip-card">
      <div class="tip-header">
        <div class="tip-icon">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <span class="tip-category">{tip.category}</span>
        <span class="tip-counter">
          {startupTipsStore.currentIndex} / {startupTipsStore.totalTips}
        </span>
        <button class="tip-close" onclick={dismiss} title="Dismiss (Esc)">
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

      <p class="tip-text">{tip.text}</p>

      {#if tip.shortcut}
        <div class="tip-shortcut">
          <kbd>{tip.shortcut}</kbd>
        </div>
      {/if}

      <div class="tip-actions">
        {#if tip.actionLabel && tip.actionId}
          <button class="tip-action-btn primary" onclick={() => handleAction(tip.actionId!)}>
            {tip.actionLabel}
          </button>
        {/if}
        <button class="tip-action-btn secondary" onclick={nextTip}> Next tip → </button>
        <button class="tip-disable-btn" onclick={handleDisableClick}> Don't show again </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .startup-tip-overlay {
    position: fixed;
    bottom: 56px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1500;
    animation: tipSlideUp 300ms ease;
    pointer-events: auto;
  }
  .startup-tip-overlay.dismissing {
    animation: tipSlideDown 200ms ease forwards;
  }

  .startup-tip-card {
    background: var(--bg-elevated);
    border: var(--ht-card-border-width) var(--ht-card-border-style) var(--border-primary);
    border-radius: var(--radius-lg, var(--radius));
    box-shadow:
      var(--shadow-lg),
      0 0 40px rgba(0, 0, 0, 0.15);
    padding: 16px 20px 14px;
    min-width: 380px;
    max-width: 520px;
    backdrop-filter: blur(12px);
  }

  .tip-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .tip-icon {
    color: var(--accent-primary);
    display: flex;
    align-items: center;
    flex-shrink: 0;
    opacity: 0.8;
  }

  .tip-category {
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: var(--ht-label-transform, uppercase);
    letter-spacing: var(--ht-label-spacing, 0.08em);
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
    padding: 2px 8px;
    border-radius: var(--radius-sm);
  }

  .tip-counter {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    margin-left: auto;
    font-weight: 600;
    letter-spacing: 0.03em;
  }

  .tip-close {
    color: var(--text-tertiary);
    padding: 4px;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
    transition: all var(--transition);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .tip-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .tip-text {
    font-size: var(--fs-base);
    line-height: 1.55;
    color: var(--text-primary);
    margin: 0;
    letter-spacing: 0.01em;
  }

  .tip-shortcut {
    margin-top: 8px;
  }
  .tip-shortcut kbd {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    padding: 2px 10px;
    font-size: var(--fs-sm);
    font-family: var(--font-family);
    color: var(--accent-primary);
    font-weight: 600;
  }

  .tip-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
  }

  .tip-action-btn {
    font-size: var(--fs-sm);
    padding: 5px 14px;
    border-radius: var(--radius-sm);
    font-weight: 700;
    cursor: pointer;
    transition: all var(--transition);
    letter-spacing: var(--ht-label-spacing, 0.04em);
  }

  .tip-action-btn.primary {
    background: var(--accent-primary);
    color: var(--bg-primary);
    border: 1px solid var(--accent-primary);
  }
  .tip-action-btn.primary:hover {
    filter: brightness(1.15);
    box-shadow: var(--shadow-glow-sm);
  }

  .tip-action-btn.secondary {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
  }
  .tip-action-btn.secondary:hover {
    color: var(--text-primary);
    border-color: var(--accent-primary);
  }

  .tip-disable-btn {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    margin-left: auto;
    cursor: pointer;
    transition: color var(--transition);
    white-space: nowrap;
  }
  .tip-disable-btn:hover {
    color: var(--text-secondary);
  }

  /* ── Hypertheme variants ── */

  :global([data-hypertheme='arcane']) .startup-tip-card {
    border: 3px double var(--border-primary);
    box-shadow:
      var(--shadow-lg),
      0 0 30px rgba(147, 51, 234, 0.08);
  }

  :global([data-hypertheme='ethereal']) .startup-tip-card {
    border: none;
    border-radius: var(--radius-xl, 16px);
    box-shadow:
      0 8px 40px rgba(0, 0, 0, 0.25),
      0 0 0 1px var(--border-secondary);
    backdrop-filter: blur(16px);
  }

  :global([data-hypertheme='study']) .startup-tip-card {
    box-shadow:
      var(--shadow-lg),
      0 0 25px rgba(228, 160, 60, 0.06);
  }

  :global([data-hypertheme='astral']) .startup-tip-card,
  :global([data-hypertheme='astral-midnight']) .startup-tip-card {
    box-shadow:
      var(--shadow-lg),
      0 0 20px rgba(140, 160, 220, 0.06);
  }

  /* ── Animations ── */
  @keyframes tipSlideUp {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  @keyframes tipSlideDown {
    from {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    to {
      opacity: 0;
      transform: translateX(-50%) translateY(20px);
    }
  }

  /* ── Mobile ── */
  :global([data-mobile]) .startup-tip-overlay {
    left: 8px;
    right: 8px;
    bottom: 52px;
    transform: none;
  }
  :global([data-mobile]) .startup-tip-card {
    min-width: 0;
    max-width: 100%;
  }
  :global([data-mobile]) .startup-tip-overlay.dismissing {
    animation: tipSlideDownMobile 200ms ease forwards;
  }
  @keyframes tipSlideDownMobile {
    from {
      opacity: 1;
      transform: translateY(0);
    }
    to {
      opacity: 0;
      transform: translateY(20px);
    }
  }
</style>
