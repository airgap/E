<script lang="ts">
  import type { TerminalCommandBlock } from '@e/shared';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { terminalConnectionManager } from '$lib/services/terminal-connection';
  import RichBlockRenderer from './RichBlockRenderer.svelte';
  import { chirpEngine } from '$lib/audio/chirp-engine';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { terminalErrorsStore } from '$lib/stores/terminal-errors.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { resolvePath } from '$lib/services/terminal-links';

  let { sessionId, blocks, cellHeight, cellWidth, viewportTopRow, viewportRows, terminalElement } =
    $props<{
      sessionId: string;
      blocks: TerminalCommandBlock[];
      cellHeight: number;
      cellWidth: number;
      viewportTopRow: number;
      viewportRows: number;
      terminalElement: HTMLElement | null;
    }>();

  /** Track which blocks just had their output copied (for visual feedback) */
  let copiedBlockId = $state<string | null>(null);
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Copy command output text from the xterm.js buffer to clipboard */
  async function copyBlockOutput(block: TerminalCommandBlock) {
    // Extract actual output from xterm.js buffer
    const outputStartRow = block.startRow + 1; // Skip the command line itself
    const outputEndRow = block.endRow >= 0 ? block.endRow : -1;

    let text = '';

    if (outputEndRow >= outputStartRow) {
      // Extract buffer text between command start and command end
      text = terminalConnectionManager.getBufferText(sessionId, outputStartRow, outputEndRow);
    }

    // If no output text, fall back to command text
    if (!text.trim()) {
      text = `$ ${block.commandText}`;
    }

    try {
      await navigator.clipboard.writeText(text);
      // Show visual feedback
      copiedBlockId = block.id;
      if (copyTimeout) clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => {
        copiedBlockId = null;
      }, 1500);
    } catch {
      // Clipboard API may fail in some contexts
    }
  }

  /** Count the number of output lines in a block */
  function getOutputLineCount(block: TerminalCommandBlock): number {
    if (block.endRow < 0) return 0; // Still running
    return Math.max(0, block.endRow - block.startRow);
  }

  /** Jump to the first error location from a failed command block */
  function jumpToError(blockId: string) {
    const error = terminalErrorsStore.getFirstError(blockId);
    if (!error) return;

    // Resolve relative paths against the terminal's CWD
    const sessionMeta = terminalStore.sessions.get(sessionId);
    const cwd = sessionMeta?.cwd || '.';
    const resolved = resolvePath(error.file, cwd);

    editorStore.openFile(resolved, false, { line: error.line, col: error.col ?? 1 });
    if (settingsStore.soundEnabled) chirpEngine.uiClick();
  }

  /** Blocks that are visible in the current viewport */
  const visibleBlocks = $derived.by(() => {
    if (!blocks.length || cellHeight <= 0) return [];

    const vpBottom = viewportTopRow + viewportRows;

    return blocks
      .map((block: TerminalCommandBlock) => {
        const blockStart = block.startRow;
        // For in-progress blocks, extend to viewport bottom
        const blockEnd = block.endRow >= 0 ? block.endRow : vpBottom;

        // Check if block overlaps viewport
        if (blockEnd < viewportTopRow || blockStart > vpBottom) {
          return null;
        }

        // Header position (the command line row)
        const headerTopPx = (blockStart - viewportTopRow) * cellHeight;
        const isHeaderVisible = blockStart >= viewportTopRow && blockStart <= vpBottom;

        // Output area (rows after the command line up to endRow)
        const outputStartRow = blockStart + 1;
        const outputEndRow = blockEnd;
        const outputLines = Math.max(0, outputEndRow - outputStartRow);

        // Visible output area clipped to viewport
        const visOutputStart = Math.max(outputStartRow, viewportTopRow);
        const visOutputEnd = Math.min(outputEndRow, vpBottom);
        const outputTopPx = (visOutputStart - viewportTopRow) * cellHeight;
        const outputHeightPx = Math.max(0, visOutputEnd - visOutputStart) * cellHeight;

        const isRunning = block.exitCode === null;
        const isCopied = copiedBlockId === block.id;
        const hasRich = terminalStore.hasRichContent(block.id);
        const richActive = terminalStore.isRichViewActive(block.id);

        return {
          block,
          headerTopPx,
          isHeaderVisible,
          outputTopPx,
          outputHeightPx,
          outputLines,
          isRunning,
          isCopied,
          hasRich,
          richActive,
        };
      })
      .filter(Boolean) as Array<{
      block: TerminalCommandBlock;
      headerTopPx: number;
      isHeaderVisible: boolean;
      outputTopPx: number;
      outputHeightPx: number;
      outputLines: number;
      isRunning: boolean;
      isCopied: boolean;
      hasRich: boolean;
      richActive: boolean;
    }>;
  });
</script>

{#if visibleBlocks.length > 0}
  <div class="command-block-overlay" aria-hidden="true">
    {#each visibleBlocks as vb (vb.block.id)}
      {@const block = vb.block}

      <!-- Block header: always shown when visible -->
      {#if vb.isHeaderVisible}
        <div
          class="command-block-header"
          class:collapsed={block.collapsed}
          class:running={vb.isRunning}
          class:success={block.exitCode === 0}
          class:failure={block.exitCode !== null && block.exitCode !== 0}
          style="top: {vb.headerTopPx}px; height: {cellHeight}px"
        >
          <div class="block-header-inner">
            <button
              class="collapse-toggle"
              onclick={() => {
                terminalStore.toggleBlockCollapse(sessionId, block.id);
                if (settingsStore.soundEnabled) chirpEngine.uiClick();
              }}
              title={block.collapsed ? 'Expand output' : 'Collapse output'}
              aria-label={block.collapsed ? 'Expand command output' : 'Collapse command output'}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                class="chevron"
                class:rotated={!block.collapsed}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            <span class="command-text" title={block.commandText}>
              <span class="prompt-symbol">$</span>
              {block.commandText || '...'}
            </span>

            <!-- Collapsed line count -->
            {#if block.collapsed && vb.outputLines > 0}
              <span class="line-count" title="{vb.outputLines} lines hidden">
                {vb.outputLines} line{vb.outputLines !== 1 ? 's' : ''}
              </span>
            {/if}

            <!-- Exit code badge -->
            {#if block.exitCode !== null}
              <span
                class="exit-badge"
                class:exit-success={block.exitCode === 0}
                class:exit-failure={block.exitCode !== 0}
                title={block.exitCode === 0 ? 'Success' : `Exit code ${block.exitCode}`}
              >
                {#if block.exitCode === 0}
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                {:else}
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                  <span class="exit-code-num">{block.exitCode}</span>
                {/if}
              </span>
            {:else}
              <span class="running-indicator" title="Running...">
                <span class="running-dot"></span>
              </span>
            {/if}

            <!-- Rich view toggle -->
            {#if vb.hasRich}
              <button
                class="rich-toggle"
                class:active={vb.richActive}
                onclick={() => {
                  terminalStore.toggleRichView(block.id);
                  if (settingsStore.soundEnabled) chirpEngine.uiClick();
                }}
                title={vb.richActive ? 'Show raw output' : 'Show rich view'}
                aria-label={vb.richActive
                  ? 'Switch to raw terminal output'
                  : 'Switch to rich rendered view'}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="3" y1="9" x2="21" y2="9" />
                  <line x1="9" y1="9" x2="9" y2="21" />
                </svg>
              </button>
            {/if}

            <!-- Jump to error button (failed commands with detected errors) -->
            {#if block.exitCode !== null && block.exitCode !== 0 && terminalErrorsStore.hasErrors(block.id)}
              {@const errorCount = terminalErrorsStore.getErrorCount(block.id)}
              <button
                class="jump-error-btn"
                onclick={() => jumpToError(block.id)}
                title="Jump to first error ({errorCount} error{errorCount !== 1 ? 's' : ''} found)"
                aria-label="Jump to first error in editor"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span class="error-count">{errorCount}</span>
              </button>
            {/if}

            <!-- Copy button -->
            <button
              class="copy-btn"
              class:copied={vb.isCopied}
              onclick={() => copyBlockOutput(block)}
              title={vb.isCopied ? 'Copied!' : 'Copy output'}
              aria-label="Copy command output to clipboard"
            >
              {#if vb.isCopied}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              {:else}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              {/if}
            </button>
          </div>
        </div>
      {/if}

      <!-- Collapsed output mask: covers output rows with opaque background -->
      {#if block.collapsed && vb.outputHeightPx > 0}
        <div
          class="collapsed-mask"
          class:success={block.exitCode === 0}
          class:failure={block.exitCode !== null && block.exitCode !== 0}
          class:running={vb.isRunning}
          style="top: {vb.outputTopPx}px; height: {vb.outputHeightPx}px"
        >
          <div class="collapsed-mask-inner">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="collapsed-icon"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            <span class="collapsed-label">
              {vb.outputLines} line{vb.outputLines !== 1 ? 's' : ''} collapsed
            </span>
            <button
              class="expand-btn"
              onclick={() => terminalStore.toggleBlockCollapse(sessionId, block.id)}
              title="Expand output"
            >
              Show
            </button>
          </div>
        </div>
      {/if}

      <!-- Rich content overlay: replaces raw terminal output with HTML rendering -->
      {#if vb.hasRich && vb.richActive && vb.outputHeightPx > 0 && !block.collapsed}
        {@const richEntries = terminalStore.getRichContent(block.id)}
        <div
          class="rich-overlay"
          class:success={block.exitCode === 0}
          class:failure={block.exitCode !== null && block.exitCode !== 0}
          class:running={vb.isRunning}
          style="top: {vb.outputTopPx}px; min-height: {vb.outputHeightPx}px"
        >
          <RichBlockRenderer entries={richEntries} blockId={block.id} />
        </div>
      {/if}

      <!-- Block border gutter: left accent border along the output area (expanded only) -->
      {#if !block.collapsed && vb.outputHeightPx > 0 && !(vb.hasRich && vb.richActive)}
        <div
          class="block-gutter"
          class:success={block.exitCode === 0}
          class:failure={block.exitCode !== null && block.exitCode !== 0}
          class:running={vb.isRunning}
          style="top: {vb.outputTopPx}px; height: {vb.outputHeightPx}px"
        ></div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .command-block-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    z-index: 5;
    overflow: hidden;
  }

  /* ── Block header ── */

  .command-block-header {
    position: absolute;
    left: 0;
    right: 0;
    pointer-events: auto;
    display: flex;
    align-items: stretch;
  }

  .block-header-inner {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    width: 100%;
    background: color-mix(in srgb, var(--bg-secondary, #161b22) 88%, transparent);
    border-left: 2px solid transparent;
    border-radius: 0 var(--radius-sm, 4px) var(--radius-sm, 4px) 0;
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xs);
    line-height: 1;
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }

  .command-block-header.success .block-header-inner {
    border-left-color: var(--accent-secondary, #00ff88);
  }

  .command-block-header.failure .block-header-inner {
    border-left-color: var(--accent-error, #ff3344);
  }

  .command-block-header.running .block-header-inner {
    border-left-color: var(--accent-primary, #00b4ff);
  }

  .block-header-inner:hover {
    background: color-mix(in srgb, var(--bg-secondary, #161b22) 95%, transparent);
  }

  /* ── Collapse toggle ── */

  .collapse-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-tertiary, #6e7681);
    cursor: pointer;
    border-radius: var(--radius-sm, 4px);
    flex-shrink: 0;
    transition:
      color 0.15s ease,
      background 0.15s ease;
  }

  .collapse-toggle:hover {
    color: var(--text-primary, #c9d1d9);
    background: color-mix(in srgb, var(--text-primary, #c9d1d9) 10%, transparent);
  }

  .chevron {
    transition: transform 0.15s ease;
  }

  .chevron.rotated {
    transform: rotate(90deg);
  }

  /* ── Command text ── */

  .command-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary, #8b949e);
  }

  .prompt-symbol {
    color: var(--accent-primary, #00b4ff);
    margin-right: 4px;
    font-weight: 600;
  }

  /* ── Line count (collapsed state) ── */

  .line-count {
    color: var(--text-tertiary, #6e7681);
    font-size: var(--fs-xxs);
    flex-shrink: 0;
    padding: 1px 6px;
    border-radius: var(--radius-sm, 4px);
    background: color-mix(in srgb, var(--text-tertiary, #6e7681) 10%, transparent);
  }

  /* ── Exit code badge ── */

  .exit-badge {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 1px 4px;
    border-radius: var(--radius-sm, 4px);
    font-size: var(--fs-sans-xxs);
    font-weight: 600;
    flex-shrink: 0;
  }

  .exit-badge.exit-success {
    color: var(--accent-secondary, #00ff88);
    background: color-mix(in srgb, var(--accent-secondary, #00ff88) 12%, transparent);
  }

  .exit-badge.exit-failure {
    color: var(--accent-error, #ff3344);
    background: color-mix(in srgb, var(--accent-error, #ff3344) 12%, transparent);
  }

  .exit-code-num {
    font-size: var(--fs-xs);
  }

  /* ── Running indicator ── */

  .running-indicator {
    display: flex;
    align-items: center;
    padding: 1px 4px;
    flex-shrink: 0;
  }

  .running-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-primary, #00b4ff);
    animation: pulse-dot 1.5s ease-in-out infinite;
  }

  @keyframes pulse-dot {
    0%,
    100% {
      opacity: 0.4;
    }
    50% {
      opacity: 1;
    }
  }

  /* ── Jump to error button ── */

  .jump-error-btn {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 16px;
    padding: 0 5px;
    border: none;
    background: color-mix(in srgb, var(--accent-error, #ff3344) 15%, transparent);
    color: var(--accent-error, #ff3344);
    cursor: pointer;
    border-radius: var(--radius-sm, 4px);
    flex-shrink: 0;
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-sans-xxs);
    font-weight: 600;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }

  .jump-error-btn:hover {
    background: color-mix(in srgb, var(--accent-error, #ff3344) 25%, transparent);
    color: var(--accent-error, #ff3344);
  }

  .error-count {
    font-size: var(--fs-xxs);
    line-height: 1;
  }

  /* ── Copy button ── */

  .copy-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 16px;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-tertiary, #6e7681);
    cursor: pointer;
    border-radius: var(--radius-sm, 4px);
    flex-shrink: 0;
    opacity: 0;
    transition:
      opacity 0.15s ease,
      color 0.15s ease,
      background 0.15s ease;
  }

  .block-header-inner:hover .copy-btn {
    opacity: 1;
  }

  .copy-btn:hover {
    color: var(--text-primary, #c9d1d9);
    background: color-mix(in srgb, var(--text-primary, #c9d1d9) 10%, transparent);
  }

  .copy-btn.copied {
    opacity: 1;
    color: var(--accent-secondary, #00ff88);
  }

  /* ── Rich toggle button ── */

  .rich-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 16px;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-tertiary, #6e7681);
    cursor: pointer;
    border-radius: var(--radius-sm, 4px);
    flex-shrink: 0;
    opacity: 0;
    transition:
      opacity 0.15s ease,
      color 0.15s ease,
      background 0.15s ease;
  }

  .block-header-inner:hover .rich-toggle {
    opacity: 1;
  }

  .rich-toggle:hover {
    color: var(--text-primary, #c9d1d9);
    background: color-mix(in srgb, var(--text-primary, #c9d1d9) 10%, transparent);
  }

  .rich-toggle.active {
    opacity: 1;
    color: var(--accent-primary, #00b4ff);
  }

  /* ── Rich content overlay ── */

  .rich-overlay {
    position: absolute;
    left: 0;
    right: 0;
    pointer-events: auto;
    background: var(--bg-primary, #0d1117);
    border-left: 2px solid transparent;
    padding: 4px 8px;
    overflow-y: auto;
    z-index: 6;
    animation: rich-entrance var(--ht-transition-speed, 125ms) ease-out;
  }

  @keyframes rich-entrance {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .rich-overlay.success {
    border-left-color: color-mix(in srgb, var(--accent-secondary, #00ff88) 30%, transparent);
  }

  .rich-overlay.failure {
    border-left-color: color-mix(in srgb, var(--accent-error, #ff3344) 30%, transparent);
  }

  .rich-overlay.running {
    border-left-color: color-mix(in srgb, var(--accent-primary, #00b4ff) 30%, transparent);
  }

  /* ── Collapsed output mask ── */

  .collapsed-mask {
    position: absolute;
    left: 0;
    right: 0;
    pointer-events: auto;
    background: var(--bg-primary, #0d1117);
    border-left: 2px solid transparent;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    overflow: hidden;
  }

  .collapsed-mask.success {
    border-left-color: color-mix(in srgb, var(--accent-secondary, #00ff88) 30%, transparent);
  }

  .collapsed-mask.failure {
    border-left-color: color-mix(in srgb, var(--accent-error, #ff3344) 30%, transparent);
  }

  .collapsed-mask.running {
    border-left-color: color-mix(in srgb, var(--accent-primary, #00b4ff) 30%, transparent);
  }

  .collapsed-mask-inner {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xs);
    color: var(--text-tertiary, #6e7681);
  }

  .collapsed-icon {
    opacity: 0.5;
    flex-shrink: 0;
  }

  .collapsed-label {
    white-space: nowrap;
  }

  .expand-btn {
    border: none;
    background: color-mix(in srgb, var(--accent-primary, #00b4ff) 15%, transparent);
    color: var(--accent-primary, #00b4ff);
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xxs);
    font-weight: 600;
    padding: 1px 8px;
    border-radius: var(--radius-sm, 4px);
    cursor: pointer;
    transition: background 0.15s ease;
    white-space: nowrap;
  }

  .expand-btn:hover {
    background: color-mix(in srgb, var(--accent-primary, #00b4ff) 25%, transparent);
  }

  /* ── Block gutter (left border along expanded output) ── */

  .block-gutter {
    position: absolute;
    left: 0;
    width: 2px;
    pointer-events: none;
    opacity: 0.25;
    transition: opacity 0.15s ease;
  }

  .block-gutter.success {
    background: var(--accent-secondary, #00ff88);
  }

  .block-gutter.failure {
    background: var(--accent-error, #ff3344);
  }

  .block-gutter.running {
    background: var(--accent-primary, #00b4ff);
  }
</style>
