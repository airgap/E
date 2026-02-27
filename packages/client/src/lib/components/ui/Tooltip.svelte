<script lang="ts">
  import { tick, onDestroy } from 'svelte';

  let {
    content,
    shortcut = '',
    placement = 'top' as 'top' | 'bottom' | 'left' | 'right',
    delay = 500,
    // Programmatic mode: supply x/y/visible directly
    x = undefined as number | undefined,
    y = undefined as number | undefined,
    visible = false,
    children,
  } = $props<{
    content: string;
    shortcut?: string;
    placement?: 'top' | 'bottom' | 'left' | 'right';
    delay?: number;
    x?: number;
    y?: number;
    visible?: boolean;
    children?: import('svelte').Snippet;
  }>();

  let wrapperEl = $state<HTMLElement | undefined>(undefined);
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Portal element appended to body
  let portalEl: HTMLDivElement | null = null;
  let _visible = $state<boolean>(false);
  let _x = $state<number>(0);
  let _y = $state<number>(0);
  let _placement = $state<'top' | 'bottom' | 'left' | 'right'>(placement);

  // Programmatic mode — sync from props
  $effect(() => {
    if (x !== undefined && y !== undefined) {
      _visible = visible;
      _x = x;
      _y = y;
    }
  });

  function getPortal(): HTMLDivElement {
    if (!portalEl) {
      portalEl = document.createElement('div');
      portalEl.className = 'tooltip-portal';
      portalEl.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:9999;';
      document.body.appendChild(portalEl);
    }
    return portalEl;
  }

  function show() {
    if (x !== undefined) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      _visible = true;
      await tick();
      reposition();
    }, delay);
  }

  function hide() {
    if (x !== undefined) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    _visible = false;
  }

  function reposition() {
    if (!wrapperEl) return;
    const trigRect = wrapperEl.getBoundingClientRect();
    // If rect is zeroed (display:contents), try first child
    const rect =
      trigRect.width === 0 && trigRect.height === 0
        ? ((wrapperEl.firstElementChild as HTMLElement)?.getBoundingClientRect() ?? trigRect)
        : trigRect;

    // We need to measure the portal tooltip — find it
    const tipEl = portalEl?.firstElementChild as HTMLElement | null;
    if (!tipEl) return;
    const tipRect = tipEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const GAP = 8;

    let p = placement;
    let tx = 0,
      ty = 0;

    if (p === 'top') {
      tx = rect.left + rect.width / 2 - tipRect.width / 2;
      ty = rect.top - tipRect.height - GAP;
      if (ty < 8) {
        ty = rect.bottom + GAP;
        p = 'bottom';
      }
    } else if (p === 'bottom') {
      tx = rect.left + rect.width / 2 - tipRect.width / 2;
      ty = rect.bottom + GAP;
      if (ty + tipRect.height > vh - 8) {
        ty = rect.top - tipRect.height - GAP;
        p = 'top';
      }
    } else if (p === 'right') {
      tx = rect.right + GAP;
      ty = rect.top + rect.height / 2 - tipRect.height / 2;
      if (tx + tipRect.width > vw - 8) {
        tx = rect.left - tipRect.width - GAP;
        p = 'left';
      }
    } else {
      tx = rect.left - tipRect.width - GAP;
      ty = rect.top + rect.height / 2 - tipRect.height / 2;
      if (tx < 8) {
        tx = rect.right + GAP;
        p = 'right';
      }
    }

    tx = Math.max(8, Math.min(tx, vw - tipRect.width - 8));
    ty = Math.max(8, Math.min(ty, vh - tipRect.height - 8));

    _x = tx;
    _y = ty;
    _placement = p;
  }

  // Update portal tooltip element position/visibility reactively
  $effect(() => {
    if (!_visible || !content) {
      if (portalEl) portalEl.innerHTML = '';
      return;
    }

    const portal = getPortal();
    const arrowClass = `arrow-${_placement}`;
    portal.innerHTML = `
      <div class="e-tooltip e-tooltip-${_placement}" style="left:${_x}px;top:${_y}px;">
        <span class="e-tooltip-content">${escHtml(content)}</span>
        ${shortcut ? `<span class="e-tooltip-shortcut">${escHtml(shortcut)}</span>` : ''}
        <span class="e-tooltip-arrow" aria-hidden="true"></span>
      </div>
    `;

    // Ensure global styles are injected
    injectStyles();
  });

  function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Inject tooltip styles into document head once
  let stylesInjected = false;
  function injectStyles() {
    if (stylesInjected || typeof document === 'undefined') return;
    stylesInjected = true;
    const id = 'e-tooltip-styles';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      .e-tooltip {
        position: fixed;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 9px;
        background: var(--bg-elevated);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-sm, 4px);
        font-size: 11.5px;
        font-family: var(--font-family-sans, sans-serif);
        color: var(--text-secondary);
        white-space: nowrap;
        pointer-events: none;
        box-shadow: 0 2px 8px rgba(0,0,0,0.35), 0 8px 24px rgba(0,0,0,0.4);
        animation: eTooltipIn 0.1s cubic-bezier(0.2,0,0,1.1);
        max-width: 320px;
        z-index: 9999;
      }
      @keyframes eTooltipIn {
        from { opacity: 0; transform: scale(0.94) translateY(2px); }
        to   { opacity: 1; transform: scale(1) translateY(0); }
      }
      .e-tooltip-content {
        font-weight: 500;
      }
      .e-tooltip-shortcut {
        font-family: var(--font-family, monospace);
        font-size: 10.5px;
        color: var(--text-tertiary);
        background: var(--bg-tertiary);
        border: 1px solid var(--border-secondary);
        border-radius: 3px;
        padding: 0 4px;
        line-height: 1.6;
        flex-shrink: 0;
      }
      .e-tooltip-arrow {
        position: absolute;
        width: 6px;
        height: 6px;
        background: var(--bg-elevated);
        border: 1px solid var(--border-primary);
        transform: rotate(45deg);
        pointer-events: none;
      }
      .e-tooltip-top    .e-tooltip-arrow { bottom:-4px; left:50%; margin-left:-3px; border-top:none; border-left:none; }
      .e-tooltip-bottom .e-tooltip-arrow { top:-4px;    left:50%; margin-left:-3px; border-bottom:none; border-right:none; }
      .e-tooltip-right  .e-tooltip-arrow { left:-4px;   top:50%;  margin-top:-3px;  border-right:none; border-top:none; }
      .e-tooltip-left   .e-tooltip-arrow { right:-4px;  top:50%;  margin-top:-3px;  border-left:none;  border-bottom:none; }
    `;
    document.head.appendChild(style);
  }

  onDestroy(() => {
    if (timer) clearTimeout(timer);
    if (portalEl) {
      portalEl.remove();
      portalEl = null;
    }
  });
</script>

{#if children}
  <div
    class="tooltip-trigger"
    bind:this={wrapperEl}
    onmouseenter={show}
    onmouseleave={hide}
    onfocusin={show}
    onfocusout={hide}
  >
    {@render children()}
  </div>
{/if}

<style>
  .tooltip-trigger {
    /* Transparent pass-through wrapper — does NOT use display:contents
       so that mouseenter/mouseleave work reliably. Instead we make it
       flex so it never breaks the parent layout. */
    display: flex;
    align-items: stretch;
  }
</style>
