<script lang="ts">
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import { deviceStore } from '$lib/stores/device.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { commentaryStore } from '$lib/stores/commentary.svelte';
  import { findTheme } from '$lib/config/themes';
  import WorkspaceTabBar from './WorkspaceTabBar.svelte';
  import WindowControls from './WindowControls.svelte';
  import ProfileSwitcher from './ProfileSwitcher.svelte';
  import RemoteSessionIndicator from '../common/RemoteSessionIndicator.svelte';

  let commentaryActive = $derived(commentaryStore.isActive);
  let commentaryWorkspaceId = $derived(commentaryStore.workspaceId);
  let activeWorkspaceId = $derived(workspaceStore.activeWorkspace?.workspaceId);

  function toggleCommentary() {
    if (!activeWorkspaceId) return;
    if (commentaryActive && commentaryWorkspaceId === activeWorkspaceId) {
      commentaryStore.stopCommentary();
    } else {
      const personality =
        commentaryStore.personality ||
        findTheme(settingsStore.theme)?.suggestedPersonality ||
        'documentary_narrator';
      commentaryStore.startCommentary(activeWorkspaceId, personality);
    }
  }

  function golemStatusLabel(): string {
    if (loopStore.isRunning) return 'GOLEM ACTIVE';
    if (loopStore.isPaused) return 'GOLEM PAUSED';
    return '';
  }

  function golemProgressLabel(): string {
    const total = loopStore.totalStories;
    if (total === 0) return '';
    return `${loopStore.completedStories}/${total}`;
  }
</script>

<header class="topbar">
  <div class="topbar-left">
    <WindowControls side="left" />
    {#if deviceStore.isMobileUI}
      <button
        class="icon-btn"
        onclick={() => uiStore.setMobileView('conversations')}
        title="Conversations"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <line x1="9" y1="9" x2="15" y2="9" />
          <line x1="9" y1="13" x2="13" y2="13" />
        </svg>
      </button>
    {:else}
      <button
        class="icon-btn"
        onclick={() => uiStore.toggleSidebar()}
        title="Toggle sidebar (Ctrl+/)"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      </button>
    {/if}
    <WorkspaceTabBar />
  </div>

  <div class="topbar-center" data-tauri-drag-region>
    {#if conversationStore.active}
      <span class="conv-title truncate">{conversationStore.active.title}</span>
    {/if}
  </div>

  <div class="topbar-right">
    {#if loopStore.isActive}
      <button
        class="golem-badge"
        class:running={loopStore.isRunning}
        class:paused={loopStore.isPaused}
        onclick={() => uiStore.setSidebarTab('work')}
        title="Golem is {loopStore.isRunning ? 'running' : 'paused'} — click to view"
      >
        <span class="golem-icon">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path
              d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"
            />
          </svg>
        </span>
        <span class="golem-label">{golemStatusLabel()}</span>
        {#if golemProgressLabel()}
          <span class="golem-progress">{golemProgressLabel()}</span>
        {/if}
      </button>
    {/if}

    <RemoteSessionIndicator />

    {#if conversationStore.active?.planMode}
      <span class="mode-badge plan">PLAN MODE</span>
    {:else if conversationStore.active?.permissionMode === 'teach'}
      <span class="mode-badge teach">TEACH MODE</span>
    {/if}

    <ProfileSwitcher />

    <div
      class="context-meter"
      title="Context usage: {streamStore.tokenUsage.input + streamStore.tokenUsage.output} tokens"
    >
      <div
        class="context-meter-fill"
        style:width="{Math.min(
          100,
          ((streamStore.tokenUsage.input + streamStore.tokenUsage.output) / 200000) * 100,
        )}%"
      ></div>
    </div>

    <button
      class="icon-btn commentary-toggle"
      class:active={commentaryActive && commentaryWorkspaceId === activeWorkspaceId}
      onclick={toggleCommentary}
      title={commentaryActive && commentaryWorkspaceId === activeWorkspaceId
        ? 'Stop commentary'
        : 'Start live commentary'}
      aria-label="Toggle live commentary"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <!-- broadcast/radio icon -->
        <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
        <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.4" />
        <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.4" />
        <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    </button>

    <button
      class="icon-btn"
      onclick={() => uiStore.setSidebarTab('help')}
      title="Help & Docs (?)"
      aria-label="Help and documentation"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <path d="M12 17h.01" />
      </svg>
    </button>

    <button class="icon-btn" onclick={() => uiStore.openModal('settings')} title="Settings">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
        <path
          d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        />
      </svg>
    </button>
    <WindowControls side="right" />
  </div>
</header>

<style>
  .topbar {
    height: var(--topbar-height);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    background: var(--bg-glass);
    border-bottom: var(--ht-separator);
    gap: 12px;
    flex-shrink: 0;
    z-index: 10;
    position: relative;
  }
  /* Topbar accent overlay — varies per hypertheme */
  .topbar::after {
    content: '';
    position: absolute;
    inset: 0;
    /* Tech default: scanlines */
    background: repeating-linear-gradient(
      0deg,
      transparent,
      transparent 2px,
      var(--border-secondary) 2px,
      var(--border-secondary) 4px
    );
    pointer-events: none;
  }

  :global([data-hypertheme='arcane']) .topbar::after {
    background: linear-gradient(180deg, transparent 90%, var(--border-primary) 100%);
  }

  :global([data-hypertheme='ethereal']) .topbar::after {
    background: linear-gradient(180deg, transparent 92%, var(--border-secondary) 100%);
  }

  :global([data-hypertheme='study']) .topbar::after {
    background: linear-gradient(
      90deg,
      transparent 5%,
      rgba(228, 160, 60, 0.08) 50%,
      transparent 95%
    );
    border-bottom: none;
  }

  :global([data-hypertheme='astral']) .topbar::after,
  :global([data-hypertheme='astral-midnight']) .topbar::after {
    background:
      radial-gradient(0.5px 0.5px at 10% 50%, var(--border-primary), transparent),
      radial-gradient(0.5px 0.5px at 30% 30%, var(--border-secondary), transparent),
      radial-gradient(0.5px 0.5px at 50% 70%, var(--border-primary), transparent),
      radial-gradient(0.5px 0.5px at 70% 40%, var(--border-secondary), transparent),
      radial-gradient(0.5px 0.5px at 90% 60%, var(--border-primary), transparent);
  }

  .topbar-left,
  .topbar-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .topbar-center {
    flex: 1;
    text-align: center;
    min-width: 0;
  }

  .conv-title {
    color: var(--text-secondary);
    font-size: var(--fs-base);
    font-weight: 600;
    letter-spacing: var(--ht-label-spacing);
    text-transform: var(--ht-label-transform);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    display: block;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    border: 1px solid transparent;
    transition: all var(--transition);
  }
  .icon-btn:hover {
    color: var(--accent-primary);
    border-color: var(--border-primary);
    background: var(--bg-hover);
    box-shadow: var(--shadow-glow-sm);
  }

  .mode-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    padding: 3px 10px;
    border-radius: var(--radius);
    color: var(--text-on-accent);
    letter-spacing: var(--ht-label-spacing);
    text-transform: var(--ht-label-transform);
    animation: hudBlink 3s infinite;
  }
  .mode-badge.plan {
    background: var(--accent-warning);
  }
  .mode-badge.teach {
    background: var(--accent-secondary, #10b981);
  }

  .context-meter {
    width: 64px;
    height: 3px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    overflow: hidden;
    position: relative;
    border: 1px solid var(--border-secondary);
  }
  .context-meter-fill {
    height: 100%;
    background: var(--accent-primary);
    border-radius: var(--radius-sm);
    transition: width 500ms linear;
    box-shadow: var(--shadow-glow-sm);
  }

  /* ── Golem active badge ── */
  .golem-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 12px;
    border-radius: var(--radius);
    font-size: var(--fs-xxs);
    font-weight: 700;
    letter-spacing: var(--ht-label-spacing);
    text-transform: var(--ht-label-transform);
    cursor: pointer;
    border: 1px solid transparent;
    transition: all var(--transition);
    position: relative;
    overflow: hidden;
  }
  .golem-badge.running {
    background: color-mix(in srgb, var(--accent-primary) 20%, var(--bg-tertiary));
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    box-shadow:
      0 0 8px color-mix(in srgb, var(--accent-primary) 30%, transparent),
      0 0 20px color-mix(in srgb, var(--accent-primary) 15%, transparent);
    animation: golemBadgePulse 2s ease-in-out infinite;
  }
  .golem-badge.paused {
    background: color-mix(in srgb, var(--accent-warning) 20%, var(--bg-tertiary));
    color: var(--accent-warning);
    border-color: var(--accent-warning);
    box-shadow: 0 0 8px color-mix(in srgb, var(--accent-warning) 20%, transparent);
  }
  .golem-badge:hover {
    filter: brightness(1.15);
    transform: scale(1.02);
  }
  .golem-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 0;
  }
  .golem-badge.running .golem-icon {
    animation: golemSpin 3s linear infinite;
  }
  .golem-label {
    white-space: nowrap;
  }
  .golem-progress {
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, currentColor 15%, transparent);
    font-size: var(--fs-xxs);
    font-weight: 800;
    letter-spacing: 0.5px;
  }

  @keyframes golemBadgePulse {
    0%,
    100% {
      box-shadow:
        0 0 8px color-mix(in srgb, var(--accent-primary) 30%, transparent),
        0 0 20px color-mix(in srgb, var(--accent-primary) 15%, transparent);
    }
    50% {
      box-shadow:
        0 0 12px color-mix(in srgb, var(--accent-primary) 50%, transparent),
        0 0 30px color-mix(in srgb, var(--accent-primary) 25%, transparent);
    }
  }
  @keyframes golemSpin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  /* ── Commentary toggle ── */
  .commentary-toggle.active {
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border-color: var(--accent-primary);
    box-shadow: 0 0 6px color-mix(in srgb, var(--accent-primary) 25%, transparent);
  }
  .commentary-toggle.active svg {
    animation: commentaryPulse 2.5s ease-in-out infinite;
  }
  @keyframes commentaryPulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.6;
    }
  }

  /* ── Mobile overrides ── */
  :global([data-mobile]) .topbar {
    padding: 0 10px;
    gap: 6px;
  }
  /* Hide items that don't fit / aren't useful on mobile */
  :global([data-mobile]) .mode-badge,
  :global([data-mobile]) .context-meter {
    display: none;
  }
  :global([data-mobile]) .golem-badge .golem-label {
    display: none;
  }
  /* Topbar left: let workspace tabs shrink but don't clip dropdown */
  :global([data-mobile]) .topbar-left {
    flex: 1;
    min-width: 0;
    overflow: visible;
  }
  :global([data-mobile]) .topbar-right {
    flex-shrink: 0;
    gap: 4px;
  }
</style>
