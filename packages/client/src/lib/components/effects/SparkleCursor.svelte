<script lang="ts">
  import { onMount } from 'svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  // FTL (ftl.rocks) — cursor hover prediction library.
  // Importing for side-effects: adds .prehover class to elements the cursor is
  // heading toward, making hover states feel instant. We also implement its
  // velocity-extrapolation algorithm at a very low multiplier (0.5 when enabled,
  // vs the default 4) to nudge the sparkle cursor slightly ahead of the actual
  // pointer, compensating for the inherent JS rendering lag. Disabled by default
  // to reduce jitteriness unless "Snappy cursor" is enabled in settings.
  import 'ftl.rocks';

  interface Sparkle {
    el: HTMLElement;
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    size: number;
    rotation: number;
    rotationSpeed: number;
  }

  const POOL_SIZE = 50;
  const SPAWN_INTERVAL = 40;
  const CLICK_BURST = 8;

  // FTL-inspired prediction: very low multiplier (default in ftl.rocks is 4).
  // At 0.5 we extrapolate half a frame of velocity — just enough to reduce lag
  // without being jittery. Disabled (0.0) by default unless "Snappy cursor" is enabled.
  const FTL_MAX_OFFSET = 200; // same clamp as ftl.rocks uses (lock200)

  let container: HTMLElement;
  let cursorEl: HTMLElement;

  /** Clamp value to [-max, max], matching ftl.rocks lock200 */
  function ftlClamp(n: number, max: number): number {
    return Math.min(max, Math.max(-max, n));
  }

  onMount(() => {
    const sparkles: Sparkle[] = [];
    const pool: HTMLElement[] = [];
    // Raw (actual) mouse position — used for sparkle spawning & hit testing
    let rawMouseX = -100;
    let rawMouseY = -100;
    // FTL-predicted cursor position — used to render the visual cursor
    let cursorX = -100;
    let cursorY = -100;
    // Previous raw position for velocity calculation
    let prevRawX = -100;
    let prevRawY = -100;
    let lastSpawn = 0;
    let lastMoveX = 0;
    let lastMoveY = 0;
    let animId: number;
    let isHoveringClickable = false;

    // Touch detection: disable the cursor effect when a touch event fires.
    // On hybrid devices (e.g. touchscreen laptops), re-enable on mousemove.
    let touchActive = false;
    let cursorStyleInjected = false;
    const style = document.createElement('style');

    function enableCursorEffect() {
      if (cursorStyleInjected) return;
      document.documentElement.style.cursor = 'none';
      style.textContent = '*, *::before, *::after { cursor: none !important; }';
      document.head.appendChild(style);
      cursorStyleInjected = true;
      container.style.display = '';
    }

    function disableCursorEffect() {
      if (!cursorStyleInjected) return;
      document.documentElement.style.cursor = '';
      style.textContent = '';
      if (style.parentNode) style.remove();
      cursorStyleInjected = false;
      container.style.display = 'none';

      // Hide all active sparkles and clear the array
      for (const s of sparkles) {
        s.el.style.display = 'none';
      }
      sparkles.length = 0;

      // Move cursor offscreen
      cursorX = -100;
      cursorY = -100;
      cursorEl.style.transform = `translate(-100px, -100px)`;
    }

    function onTouchStart() {
      if (!touchActive) {
        touchActive = true;
        disableCursorEffect();
      }
    }

    // Check if the primary pointer is coarse (touch-only device).
    // On touch-only devices we start disabled; on hybrid devices we start
    // enabled and toggle on the first touch event.
    const isTouchOnly =
      window.matchMedia('(pointer: coarse)').matches &&
      !window.matchMedia('(any-pointer: fine)').matches;

    if (isTouchOnly) {
      touchActive = true;
    }

    // Only inject cursor-hiding styles if not in touch mode
    if (!touchActive) {
      enableCursorEffect();
    } else {
      // Ensure container starts hidden for touch-only devices
      container.style.display = 'none';
    }

    // Pre-create sparkle pool
    for (let i = 0; i < POOL_SIZE; i++) {
      const el = document.createElement('div');
      el.className = 'sparkle';
      el.innerHTML = '✦';
      el.style.display = 'none';
      container.appendChild(el);
      pool.push(el);
    }

    function spawnSparkle(x: number, y: number, burst = false) {
      if (touchActive) return;

      const el = pool.find((p) => p.style.display === 'none');
      if (!el) return;

      const angle = Math.random() * Math.PI * 2;
      const speed = burst ? 1.5 + Math.random() * 3 : 0.3 + Math.random() * 1;
      const size = burst ? 10 + Math.random() * 14 : 6 + Math.random() * 10;
      const maxLife = burst ? 40 + Math.random() * 30 : 25 + Math.random() * 20;

      const sparkle: Sparkle = {
        el,
        x: x + (Math.random() - 0.5) * 12,
        y: y + (Math.random() - 0.5) * 12,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (burst ? 1.5 : 0.8),
        life: maxLife,
        maxLife,
        size,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 12,
      };

      const colors = [
        'var(--accent-primary)',
        'var(--accent-secondary)',
        'var(--accent-warning)',
        '#fff',
      ];
      const color = colors[Math.floor(Math.random() * colors.length)];

      el.style.display = 'block';
      el.style.color = color;
      el.style.fontSize = `${size}px`;
      el.style.textShadow = `0 0 ${size * 0.6}px currentColor`;

      sparkles.push(sparkle);
    }

    function update() {
      if (touchActive) {
        animId = requestAnimationFrame(update);
        return;
      }

      // Update main cursor at the FTL-predicted position (slightly ahead of actual)
      const isStudyTheme = document.documentElement.getAttribute('data-hypertheme') === 'study';
      const scale = isStudyTheme && isHoveringClickable ? 1.25 : 1;
      cursorEl.style.transform = `translate(${cursorX}px, ${cursorY}px) scale(${scale})`;

      // Update trail sparkles
      for (let i = sparkles.length - 1; i >= 0; i--) {
        const s = sparkles[i];
        s.life--;
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.03;
        s.rotation += s.rotationSpeed;
        s.vx *= 0.98;

        const progress = 1 - s.life / s.maxLife;
        const scale = progress < 0.2 ? progress / 0.2 : 1 - (progress - 0.2) / 0.8;
        const opacity = Math.max(0, scale);

        s.el.style.transform = `translate(${s.x}px, ${s.y}px) rotate(${s.rotation}deg) scale(${opacity})`;
        s.el.style.opacity = String(opacity);

        if (s.life <= 0) {
          s.el.style.display = 'none';
          sparkles.splice(i, 1);
        }
      }

      animId = requestAnimationFrame(update);
    }

    function onMouseMove(e: MouseEvent) {
      // On hybrid devices, re-enable the cursor effect when the mouse is used.
      // Only re-enable for real mouse events (not synthesized from touch).
      // sourceCapabilities is a non-standard Chrome/Chromium API that reliably
      // distinguishes real mouse events from touch-synthesized ones.
      const caps = (e as MouseEvent & { sourceCapabilities?: { firesTouchEvents: boolean } })
        .sourceCapabilities;
      if (touchActive && caps && !caps.firesTouchEvents) {
        touchActive = false;
        enableCursorEffect();
      } else if (touchActive) {
        // Fallback: if sourceCapabilities is not available (Firefox/Safari),
        // use a heuristic — real mouse moves typically have non-zero movement
        // deltas, while synthesized events from touch do not.
        if (!caps && (e.movementX !== 0 || e.movementY !== 0)) {
          touchActive = false;
          enableCursorEffect();
        } else {
          return;
        }
      }

      rawMouseX = e.clientX;
      rawMouseY = e.clientY;

      // FTL-inspired velocity extrapolation (ftl.rocks algorithm at low multiplier).
      // Nudge the visual cursor slightly ahead of the actual pointer to compensate
      // for the ~1-frame lag inherent in JS cursor rendering.
      // Use 0.5 multiplier when snappy cursor is enabled, 0 (disabled) otherwise.
      const ftlMultiplier = settingsStore.snappyCursor ? 0.5 : 0;
      const velX = rawMouseX - prevRawX;
      const velY = rawMouseY - prevRawY;
      cursorX = rawMouseX + ftlClamp(velX * ftlMultiplier, FTL_MAX_OFFSET);
      cursorY = rawMouseY + ftlClamp(velY * ftlMultiplier, FTL_MAX_OFFSET);
      prevRawX = rawMouseX;
      prevRawY = rawMouseY;

      // Check if hovering over a clickable element
      const target = e.target as HTMLElement;
      isHoveringClickable =
        target?.tagName === 'BUTTON' ||
        target?.tagName === 'A' ||
        target?.tagName === 'SELECT' ||
        target?.role === 'button' ||
        (target as HTMLInputElement)?.type === 'checkbox' ||
        (target as HTMLInputElement)?.type === 'radio' ||
        target?.classList?.contains('clickable') ||
        target?.closest(
          'button, a, [role="button"], select, input[type="checkbox"], input[type="radio"], .clickable',
        ) !== null;

      // Spawn sparkles at the raw position (trail follows actual path)
      const dx = rawMouseX - lastMoveX;
      const dy = rawMouseY - lastMoveY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const now = performance.now();
      if (dist > 4 && now - lastSpawn > SPAWN_INTERVAL) {
        spawnSparkle(rawMouseX, rawMouseY);
        lastSpawn = now;
        lastMoveX = rawMouseX;
        lastMoveY = rawMouseY;
      }
    }

    function onClick(e: MouseEvent) {
      if (touchActive) return;
      for (let i = 0; i < CLICK_BURST; i++) {
        spawnSparkle(e.clientX, e.clientY, true);
      }
      // Click flash on main cursor
      cursorEl.classList.add('click');
      setTimeout(() => cursorEl.classList.remove('click'), 300);
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('click', onClick);
    animId = requestAnimationFrame(update);

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('click', onClick);
      cancelAnimationFrame(animId);
      document.documentElement.style.cursor = '';
      if (style.parentNode) style.remove();
    };
  });
</script>

<div class="sparkle-container" bind:this={container}>
  <div class="cursor-sparkle" bind:this={cursorEl}>
    <span class="star star-main">✦</span>
    <span class="star star-orbit-1">✦</span>
    <span class="star star-orbit-2">✧</span>
  </div>
</div>

<style>
  .sparkle-container {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 99999;
    overflow: hidden;
  }

  .sparkle-container :global(.sparkle) {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    will-change: transform, opacity;
    line-height: 1;
    user-select: none;
  }

  .cursor-sparkle {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    will-change: transform;
    /* offset so the center of the main star is at the cursor tip */
    margin-left: -10px;
    margin-top: -10px;
    /* anchor scale at the cursor point (center of main star) */
    transform-origin: 10px 10px;
  }

  .star {
    position: absolute;
    line-height: 1;
    user-select: none;
  }

  /* Main sparkle — pulses and slowly rotates at cursor point */
  .star-main {
    font-size: var(--fs-2xl);
    color: var(--accent-primary);
    text-shadow:
      0 0 8px var(--accent-primary),
      0 0 16px var(--accent-primary);
    animation:
      cursor-pulse 1.5s ease-in-out infinite,
      cursor-spin 4s linear infinite;
    filter: drop-shadow(0 0 3px var(--accent-primary));
  }

  /* Small orbiting sparkle 1 */
  .star-orbit-1 {
    font-size: var(--fs-xs);
    color: var(--accent-secondary);
    text-shadow: 0 0 6px var(--accent-secondary);
    animation: orbit-1 2.5s linear infinite;
    transform-origin: 10px 10px;
  }

  /* Small orbiting sparkle 2 */
  .star-orbit-2 {
    font-size: var(--fs-xxs);
    color: var(--accent-warning);
    text-shadow: 0 0 4px var(--accent-warning);
    animation: orbit-2 3.2s linear infinite reverse;
    transform-origin: 10px 10px;
  }

  /* Click flash — scales up and goes white */
  .cursor-sparkle :global(.click .star-main) {
    animation: click-flash 0.3s ease-out;
  }

  @keyframes cursor-pulse {
    0%,
    100% {
      opacity: 0.85;
      transform: scale(1);
    }
    50% {
      opacity: 1;
      transform: scale(1.2);
    }
  }

  @keyframes cursor-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes orbit-1 {
    from {
      transform: rotate(0deg) translateX(11px) rotate(0deg) scale(1);
    }
    25% {
      transform: rotate(90deg) translateX(11px) rotate(-90deg) scale(0.7);
    }
    50% {
      transform: rotate(180deg) translateX(11px) rotate(-180deg) scale(1);
    }
    75% {
      transform: rotate(270deg) translateX(11px) rotate(-270deg) scale(0.7);
    }
    to {
      transform: rotate(360deg) translateX(11px) rotate(-360deg) scale(1);
    }
  }

  @keyframes orbit-2 {
    from {
      transform: rotate(0deg) translateX(15px) rotate(0deg) scale(1);
    }
    25% {
      transform: rotate(90deg) translateX(15px) rotate(-90deg) scale(0.6);
    }
    50% {
      transform: rotate(180deg) translateX(15px) rotate(-180deg) scale(1);
    }
    75% {
      transform: rotate(270deg) translateX(15px) rotate(-270deg) scale(0.6);
    }
    to {
      transform: rotate(360deg) translateX(15px) rotate(-360deg) scale(1);
    }
  }

  @keyframes click-flash {
    0% {
      transform: scale(1);
      color: var(--accent-primary);
    }
    30% {
      transform: scale(2);
      color: #fff;
      text-shadow:
        0 0 20px #fff,
        0 0 40px var(--accent-primary);
    }
    100% {
      transform: scale(1);
      color: var(--accent-primary);
    }
  }
</style>
