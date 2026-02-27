<script lang="ts">
  import type { RichErrorData } from '@e/shared';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { chirpEngine } from '$lib/audio/chirp-engine';
  import { settingsStore } from '$lib/stores/settings.svelte';

  function uiClick() {
    if (settingsStore.soundEnabled) chirpEngine.uiClick();
  }

  let { data } = $props<{ data: string }>();

  let showInternal = $state(false);

  const parsed = $derived.by((): RichErrorData | null => {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  });

  const visibleFrames = $derived.by(() => {
    if (!parsed) return [];
    if (showInternal) return parsed.frames;
    return parsed.frames.filter((f) => !f.isInternal);
  });

  const internalCount = $derived(parsed?.frames.filter((f) => f.isInternal).length ?? 0);

  function openFile(file: string, line: number, col?: number) {
    uiClick();
    editorStore.openFile(file, false, { line, col: col ?? 1 });
  }
</script>

{#if parsed}
  <div class="error-renderer">
    <div class="error-header">
      <span class="error-icon">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </span>
      <span class="error-type">{parsed.errorType}</span>
      <span class="error-message">{parsed.message}</span>
    </div>

    {#if parsed.file}
      <div class="error-location">
        <button class="file-link" onclick={() => openFile(parsed!.file!, parsed!.line ?? 1)}>
          {parsed.file}{parsed.line ? `:${parsed.line}` : ''}{parsed.column
            ? `:${parsed.column}`
            : ''}
        </button>
      </div>
    {/if}

    {#if parsed.frames.length > 0}
      <div class="stack-trace">
        <div class="stack-header">
          <span class="stack-label">Stack Trace</span>
          {#if internalCount > 0}
            <button class="internal-toggle" onclick={() => (showInternal = !showInternal)}>
              {showInternal ? 'Hide' : 'Show'}
              {internalCount} internal frame{internalCount !== 1 ? 's' : ''}
            </button>
          {/if}
        </div>
        {#each visibleFrames as frame, i (i)}
          <div class="stack-frame" class:internal={frame.isInternal}>
            <span class="frame-fn">{frame.function || '(anonymous)'}</span>
            <button class="frame-file" onclick={() => openFile(frame.file, frame.line)}>
              {frame.file}:{frame.line}{frame.column ? `:${frame.column}` : ''}
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .error-renderer {
    border: var(--ht-border-width, 1px) var(--ht-border-style, solid)
      color-mix(in srgb, var(--accent-error, #ff3344) 30%, transparent);
    border-radius: var(--ht-radius, 4px);
    overflow: hidden;
    background: color-mix(in srgb, var(--accent-error, #ff3344) 4%, var(--bg-primary, #0d1117));
    transition: border-color var(--ht-transition-speed, 125ms) ease;
    animation:
      error-shake 0.3s ease-out,
      error-flash 0.4s ease-out;
  }

  @keyframes error-shake {
    0%,
    100% {
      transform: translateX(0);
    }
    20% {
      transform: translateX(-2px);
    }
    40% {
      transform: translateX(2px);
    }
    60% {
      transform: translateX(-1px);
    }
    80% {
      transform: translateX(1px);
    }
  }

  @keyframes error-flash {
    0% {
      border-color: var(--accent-error, #ff3344);
    }
    100% {
      border-color: color-mix(in srgb, var(--accent-error, #ff3344) 30%, transparent);
    }
  }

  .error-header {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--accent-error, #ff3344) 15%, transparent);
    flex-wrap: wrap;
  }

  .error-icon {
    color: var(--accent-error, #ff3344);
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .error-type {
    color: var(--accent-error, #ff3344);
    font-weight: 700;
    font-size: var(--fs-sans-sm);
  }

  .error-message {
    color: var(--text-primary, #c9d1d9);
    font-size: var(--fs-sans-sm);
    word-break: break-word;
  }

  .error-location {
    padding: 4px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--accent-error, #ff3344) 10%, transparent);
  }

  .file-link {
    border: none;
    background: none;
    color: var(--accent-primary, #00b4ff);
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xs);
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
    text-decoration-color: transparent;
    transition: text-decoration-color 0.15s;
  }

  .file-link:hover {
    text-decoration-color: currentColor;
  }

  .stack-trace {
    padding: 6px 0;
  }

  .stack-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px 4px;
  }

  .stack-label {
    color: var(--text-tertiary, #6e7681);
    font-size: var(--fs-sans-xxs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .internal-toggle {
    border: none;
    background: none;
    color: var(--text-tertiary, #6e7681);
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xxs);
    cursor: pointer;
    padding: 1px 6px;
    border-radius: 3px;
    transition:
      color 0.15s,
      background 0.15s;
  }

  .internal-toggle:hover {
    color: var(--text-primary, #c9d1d9);
    background: color-mix(in srgb, var(--text-primary, #c9d1d9) 10%, transparent);
  }

  .stack-frame {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 2px 10px 2px 20px;
    font-size: var(--fs-xs);
  }

  .stack-frame.internal {
    opacity: 0.5;
  }

  .frame-fn {
    color: var(--text-secondary, #8b949e);
    white-space: nowrap;
  }

  .frame-file {
    border: none;
    background: none;
    color: var(--accent-primary, #00b4ff);
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xs);
    cursor: pointer;
    padding: 0;
    text-decoration: none;
    transition: text-decoration 0.15s;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .frame-file:hover {
    text-decoration: underline;
  }
</style>
