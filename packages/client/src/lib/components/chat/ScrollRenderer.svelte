<script lang="ts">
  /**
   * Scroll Renderer — applies a papyrus/scroll taper effect to chat content.
   *
   * Lines near the vertical center of the viewport render at full width.
   * Lines further from center get progressively narrower and more transparent,
   * creating the look of reading an unfurled scroll.
   *
   * This is a headless side-effect component. It observes the scroll container
   * and applies CSS custom properties (--sr-width, --sr-opacity) to block-level
   * elements inside it. The actual styling is driven by the .scroll-mode class
   * on the container.
   */

  let { scrollContainer }: { scrollContainer: HTMLElement | null } = $props();

  let raf = 0;

  // ── Tuning ──
  const TAPER_STRENGTH = 70; // max % width reduction at edges
  const OPACITY_MIN = 0.15; // opacity at the very edge

  const SELECTOR = [
    '.prose > p',
    '.prose > h1',
    '.prose > h2',
    '.prose > h3',
    '.prose > h4',
    '.prose > h5',
    '.prose > h6',
    '.prose > ul',
    '.prose > ol',
    '.prose > pre',
    '.prose > blockquote',
    '.prose > table',
    '.prose > hr',
    '.prose > .code-block-wrapper',
    '.message-header',
    '.compact-boundary',
    '.stream-error',
    '.thinking-block',
    '.tool-call-block',
  ].join(', ');

  // Track styled elements for cleanup
  const styled = new Set<HTMLElement>();

  function update() {
    if (!scrollContainer) return;

    const rect = scrollContainer.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const halfH = rect.height / 2;
    if (halfH === 0) return;

    const blocks = scrollContainer.querySelectorAll<HTMLElement>(SELECTOR);
    const active = new Set<HTMLElement>();

    for (const block of blocks) {
      const bRect = block.getBoundingClientRect();

      // Skip elements well outside the viewport
      if (bRect.bottom < rect.top - 200 || bRect.top > rect.bottom + 200) continue;

      active.add(block);

      // Distance from viewport center: 0 = dead center, 1 = edge
      const blockMid = bRect.top + bRect.height / 2;
      const dist = Math.abs(blockMid - midY) / halfH;
      const t = Math.min(1, Math.max(0, dist));

      // Cosine easing — smooth, natural scroll taper
      const eased = (1 - Math.cos(t * Math.PI)) / 2;

      const widthPct = 100 - eased * TAPER_STRENGTH;
      const opacity = 1 - eased * (1 - OPACITY_MIN);

      block.style.setProperty('--sr-width', `${widthPct}%`);
      block.style.setProperty('--sr-opacity', opacity.toFixed(3));
    }

    // Clean elements that scrolled away
    for (const el of styled) {
      if (!active.has(el)) {
        el.style.removeProperty('--sr-width');
        el.style.removeProperty('--sr-opacity');
      }
    }
    styled.clear();
    for (const el of active) styled.add(el);
  }

  function onScroll() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(update);
  }

  $effect(() => {
    if (!scrollContainer) return;

    scrollContainer.addEventListener('scroll', onScroll, { passive: true });
    requestAnimationFrame(update);

    const mo = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    });
    mo.observe(scrollContainer, { childList: true, subtree: true });

    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    });
    ro.observe(scrollContainer);

    return () => {
      cancelAnimationFrame(raf);
      scrollContainer!.removeEventListener('scroll', onScroll);
      mo.disconnect();
      ro.disconnect();
      for (const el of styled) {
        el.style.removeProperty('--sr-width');
        el.style.removeProperty('--sr-opacity');
      }
      styled.clear();
    };
  });
</script>

<!-- Roll shadows — positioned by the parent's .scroll-mode styles -->
<div class="scroll-roll scroll-roll-top"></div>
<div class="scroll-roll scroll-roll-bottom"></div>

<style>
  .scroll-roll {
    position: fixed;
    left: 0;
    right: 0;
    height: 80px;
    pointer-events: none;
    z-index: 3;
  }
  .scroll-roll-top {
    top: var(--topbar-height, 40px);
    background: radial-gradient(
      ellipse 50% 100% at 50% 0%,
      color-mix(in srgb, var(--bg-primary) 90%, black) 0%,
      transparent 100%
    );
  }
  .scroll-roll-bottom {
    bottom: 0;
    background: radial-gradient(
      ellipse 50% 100% at 50% 100%,
      color-mix(in srgb, var(--bg-primary) 90%, black) 0%,
      transparent 100%
    );
  }

  /*
   * Taper styles applied via CSS custom properties set by JS.
   * :global() because they target elements inside sibling/child components.
   */
  :global(.scroll-mode .prose > *),
  :global(.scroll-mode .message-header),
  :global(.scroll-mode .compact-boundary),
  :global(.scroll-mode .stream-error),
  :global(.scroll-mode .thinking-block),
  :global(.scroll-mode .tool-call-block) {
    max-width: var(--sr-width, 100%);
    opacity: var(--sr-opacity, 1);
    margin-left: auto;
    margin-right: auto;
    will-change: max-width, opacity;
  }
</style>
