<!--
  Shared context menu component — VS Code / IntelliJ parity.

  Features:
  - Smart viewport-aware positioning (flips when near edges)
  - Full keyboard navigation: ↑↓ Home End Enter Esc
  - Keyboard shortcut hints right-aligned
  - Section separators via `kind: 'separator'`
  - Submenu indicator (▶) and disabled state
  - Danger item styling
  - Opens on right-click OR programmatically (x, y props)
  - Auto-closes on Escape / click-outside / item activation
  - Minimal animation matching app.css global fadeIn
-->
<script lang="ts" module>
  export type ContextMenuItem =
    | {
        kind?: 'item';
        label: string;
        icon?: string; // SVG path data OR raw SVG string
        shortcut?: string; // e.g. '⌘C', 'Ctrl+Shift+C'
        danger?: boolean;
        disabled?: boolean;
        submenu?: boolean; // shows ▶ indicator
        action: () => void;
      }
    | { kind: 'separator' }
    | { kind: 'header'; label: string };
</script>

<script lang="ts">
  import { tick } from 'svelte';

  let { items, x, y, onClose } = $props<{
    items: ContextMenuItem[];
    x: number;
    y: number;
    onClose: () => void;
  }>();

  let menuEl = $state<HTMLDivElement>();
  let focusedIdx = $state(-1);

  // Actionable items only (for keyboard nav)
  let actionableItems = $derived(
    items
      .map((item: ContextMenuItem, i: number) => ({ item, i }))
      .filter(
        ({ item }: { item: ContextMenuItem; i: number }) =>
          item.kind !== 'separator' && item.kind !== 'header' && !(item as any).disabled,
      ),
  );

  // Smart positioning: flip if near viewport edges
  let menuX = $state(x);
  let menuY = $state(y);

  $effect(() => {
    void x;
    void y;
    tick().then(() => {
      if (!menuEl) return;
      const rect = menuEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      menuX = x + rect.width > vw - 8 ? x - rect.width : x;
      menuY = y + rect.height > vh - 8 ? y - rect.height : y;
    });
  });

  // Focus first item on open
  $effect(() => {
    tick().then(() => {
      focusedIdx = -1;
      menuEl?.focus();
    });
  });

  function handleKeydown(e: KeyboardEvent) {
    const navItems = actionableItems;
    if (!navItems.length) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'Tab') {
      e.preventDefault();
      const currentPos = navItems.findIndex((entry: { i: number }) => entry.i === focusedIdx);
      const next = navItems[(currentPos + 1) % navItems.length];
      focusedIdx = next.i;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const currentPos = navItems.findIndex((entry: { i: number }) => entry.i === focusedIdx);
      const prev = navItems[(currentPos - 1 + navItems.length) % navItems.length];
      focusedIdx = prev.i;
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusedIdx = navItems[0].i;
    } else if (e.key === 'End') {
      e.preventDefault();
      focusedIdx = navItems[navItems.length - 1].i;
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const focused = navItems.find((entry: { i: number }) => entry.i === focusedIdx);
      if (focused) {
        activate(focused.item as Extract<ContextMenuItem, { action: () => void }>);
      }
    }
  }

  function activate(item: Extract<ContextMenuItem, { action: () => void }>) {
    if (item.disabled) return;
    onClose();
    item.action();
  }

  function getItemIndex(i: number): boolean {
    return focusedIdx === i;
  }
</script>

<!-- Backdrop captures all pointer events to close -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="ctx-backdrop"
  onmousedown={() => onClose()}
  oncontextmenu={(e) => {
    e.preventDefault();
    onClose();
  }}
></div>

<!-- Menu -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="ctx-menu"
  role="menu"
  tabindex="-1"
  bind:this={menuEl}
  style="left: {menuX}px; top: {menuY}px;"
  onkeydown={handleKeydown}
>
  {#each items as item, i}
    {#if item.kind === 'separator'}
      <div class="ctx-sep" role="separator"></div>
    {:else if item.kind === 'header'}
      <div class="ctx-header">{item.label}</div>
    {:else}
      <!-- svelte-ignore a11y_interactive_supports_focus -->
      <div
        class="ctx-item"
        class:danger={item.danger}
        class:disabled={item.disabled}
        class:focused={getItemIndex(i)}
        role="menuitem"
        aria-disabled={item.disabled}
        onmouseenter={() => {
          if (!item.disabled) focusedIdx = i;
        }}
        onmouseleave={() => {
          focusedIdx = -1;
        }}
        onmousedown={(e) => {
          if (item.disabled) return;
          e.preventDefault();
          activate(item as Extract<ContextMenuItem, { action: () => void }>);
        }}
      >
        <span class="ctx-item-left">
          {#if item.icon}
            <span class="ctx-icon" aria-hidden="true">{@html item.icon}</span>
          {:else}
            <span class="ctx-icon-placeholder"></span>
          {/if}
          <span class="ctx-label">{item.label}</span>
        </span>
        <span class="ctx-item-right">
          {#if item.shortcut}
            <span class="ctx-shortcut">{item.shortcut}</span>
          {/if}
          {#if item.submenu}
            <span class="ctx-submenu-arrow" aria-hidden="true">▶</span>
          {/if}
        </span>
      </div>
    {/if}
  {/each}
</div>

<style>
  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9000;
    cursor: default;
  }

  .ctx-menu {
    position: fixed;
    z-index: 9001;
    min-width: 200px;
    max-width: 320px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    padding: 3px;
    box-shadow:
      0 4px 6px -1px rgba(0, 0, 0, 0.3),
      0 10px 30px -5px rgba(0, 0, 0, 0.5),
      inset 0 1px 0 rgba(255, 255, 255, 0.04);
    outline: none;
    animation: ctxAppear 0.08s cubic-bezier(0.2, 0, 0, 1.2);
    transform-origin: top left;
  }

  @keyframes ctxAppear {
    from {
      opacity: 0;
      transform: scale(0.95) translateY(-4px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  /* Section separator */
  .ctx-sep {
    height: 1px;
    background: var(--border-secondary);
    margin: 3px 6px;
  }

  /* Section header */
  .ctx-header {
    padding: 4px 10px 2px;
    font-size: var(--fs-xxs);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    user-select: none;
  }

  /* Item */
  .ctx-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    user-select: none;
    transition:
      background var(--transition),
      color var(--transition);
    gap: 12px;
    min-height: 28px;
  }

  .ctx-item:not(.disabled):not(.danger) {
    color: var(--text-secondary);
  }
  .ctx-item.focused:not(.disabled):not(.danger),
  .ctx-item:not(.disabled):not(.danger):hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .ctx-item.danger {
    color: var(--accent-error);
    opacity: 0.85;
  }
  .ctx-item.danger.focused,
  .ctx-item.danger:hover {
    background: color-mix(in srgb, var(--accent-error) 12%, transparent);
    opacity: 1;
  }

  .ctx-item.disabled {
    color: var(--text-tertiary);
    opacity: 0.4;
    cursor: not-allowed;
  }

  .ctx-item-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }

  .ctx-item-right {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .ctx-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    opacity: 0.7;
  }
  .ctx-item.focused .ctx-icon,
  .ctx-item:hover .ctx-icon {
    opacity: 1;
  }

  .ctx-icon-placeholder {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  .ctx-label {
    font-size: 12.5px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ctx-shortcut {
    font-size: var(--fs-xs);
    font-family: var(--font-family);
    color: var(--text-tertiary);
    opacity: 0.75;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  .ctx-item.focused .ctx-shortcut,
  .ctx-item:hover .ctx-shortcut {
    opacity: 1;
  }

  .ctx-submenu-arrow {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    margin-left: 2px;
  }
</style>
