<script lang="ts">
  import { api } from '$lib/api/client';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
  import { highlightLines } from '$lib/utils/highlight';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { chirpEngine } from '$lib/audio/chirp-engine';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
  import type { ContextMenuItem } from '$lib/components/ui/ContextMenu.svelte';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';

  function uiClick() {
    if (settingsStore.soundEnabled) chirpEngine.uiClick();
  }

  // ── Friendly names for language labels ──
  const LANG_DISPLAY: Record<string, string> = {
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    tsx: 'TSX',
    jsx: 'JSX',
    python: 'Python',
    rust: 'Rust',
    go: 'Go',
    java: 'Java',
    kotlin: 'Kotlin',
    ruby: 'Ruby',
    php: 'PHP',
    cpp: 'C++',
    c: 'C',
    csharp: 'C#',
    swift: 'Swift',
    css: 'CSS',
    scss: 'SCSS',
    less: 'Less',
    html: 'HTML',
    vue: 'Vue',
    svelte: 'Svelte',
    json: 'JSON',
    yaml: 'YAML',
    toml: 'TOML',
    xml: 'XML',
    markdown: 'Markdown',
    mdx: 'MDX',
    sql: 'SQL',
    bash: 'Bash',
    powershell: 'PowerShell',
    dockerfile: 'Dockerfile',
    graphql: 'GraphQL',
    lua: 'Lua',
    r: 'R',
    dart: 'Dart',
    elixir: 'Elixir',
    erlang: 'Erlang',
    haskell: 'Haskell',
    scala: 'Scala',
    zig: 'Zig',
    text: 'Plain Text',
  };

  // ── Token scope → human description for hover tooltip ──
  const SCOPE_DESC: Record<string, string> = {
    'syn-keyword': 'keyword',
    'syn-string': 'string literal',
    'syn-comment': 'comment',
    'syn-function': 'function',
    'syn-type': 'type / class',
    'syn-variable': 'variable',
    'syn-operator': 'operator',
    'syn-number': 'numeric literal',
  };

  let {
    code,
    language = 'text',
    filePath = '',
    showLineNumbers = true,
  } = $props<{
    code: string;
    language?: string;
    filePath?: string;
    showLineNumbers?: boolean;
  }>();

  // ── UI state ──
  let copied = $state(false);
  let copiedLine = $state<number | null>(null);
  let wordWrap = $state(false);
  let lineNums = $state<boolean>(showLineNumbers);

  // ── Context menu ──
  let showCtx = $state(false);
  let ctxX = $state(0);
  let ctxY = $state(0);

  // ── Token tooltip ──
  let tokenTooltip = $state<{ content: string; x: number; y: number } | null>(null);
  let tokenTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Header button tooltips ──
  let wrapTooltip = $state(false);
  let lineNumTooltip = $state(false);

  // ── Syntax highlighting ──
  let highlightedLines = $state<string[]>([]);
  let isHighlighted = $state(false);

  $effect(() => {
    const lang = language === 'text' || !language ? null : language;
    isHighlighted = false;
    highlightLines(code, lang).then((lines) => {
      highlightedLines = lines;
      isHighlighted = true;
    });
  });

  let lines = $derived(code.split('\n'));
  let displayLines = $derived(lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines);
  let lineCount = $derived(displayLines.length);
  let charCount = $derived(code.replace(/\n/g, '').length);
  let langDisplay = $derived(LANG_DISPLAY[language] ?? language ?? 'text');

  // ── Copy helpers ──
  async function copy() {
    await navigator.clipboard.writeText(code);
    copied = true;
    uiClick();
    setTimeout(() => {
      copied = false;
    }, 2000);
  }

  async function copyLine(idx: number) {
    await navigator.clipboard.writeText(displayLines[idx]);
    copiedLine = idx;
    uiClick();
    setTimeout(() => {
      copiedLine = null;
    }, 1500);
  }

  async function copyAsMarkdown() {
    const fence = '```' + (language || '') + '\n' + code + '\n```';
    await navigator.clipboard.writeText(fence);
    uiStore.toast('Copied as markdown', 'success');
  }

  async function copySelection() {
    const sel = window.getSelection()?.toString();
    if (sel) {
      await navigator.clipboard.writeText(sel);
      uiStore.toast('Selection copied', 'success');
    } else {
      await copy();
    }
  }

  // ── Open in editor ──
  async function openInEditor() {
    if (!filePath) return;
    try {
      const res = await api.files.read(filePath);
      const fileName = filePath.split('/').pop() ?? filePath;
      const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
      const langMap: Record<string, string> = {
        ts: 'typescript',
        tsx: 'typescript',
        js: 'javascript',
        jsx: 'javascript',
        py: 'python',
        rs: 'rust',
        go: 'go',
        java: 'java',
        c: 'cpp',
        cpp: 'cpp',
        css: 'css',
        html: 'html',
        svelte: 'html',
        json: 'json',
        md: 'markdown',
        sql: 'sql',
        sh: 'shell',
        yaml: 'yaml',
        yml: 'yaml',
        toml: 'toml',
      };
      primaryPaneStore.openFileTab(filePath, res.data.content, langMap[ext] ?? language ?? 'text');
    } catch {
      // ignore
    }
  }

  // ── Context menu definition ──
  let ctxItems = $derived<ContextMenuItem[]>([
    {
      label: 'Copy',
      shortcut: navigator?.platform?.includes('Mac') ? '⌘C' : 'Ctrl+C',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
      action: copy,
    },
    {
      label: 'Copy Selection',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>`,
      action: copySelection,
    },
    {
      label: 'Copy as Markdown',
      shortcut: navigator?.platform?.includes('Mac') ? '⌘⇧C' : 'Ctrl+Shift+C',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
      action: copyAsMarkdown,
    },
    { kind: 'separator' },
    ...(filePath
      ? [
          {
            label: 'Open in Editor',
            shortcut: navigator?.platform?.includes('Mac') ? '⌘↵' : 'Ctrl+Enter',
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
            action: openInEditor,
          } as ContextMenuItem,
          { kind: 'separator' } as ContextMenuItem,
        ]
      : []),
    { kind: 'header', label: 'View' },
    {
      label: lineNums ? 'Hide Line Numbers' : 'Show Line Numbers',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
      action: () => {
        lineNums = !lineNums;
      },
    },
    {
      label: wordWrap ? 'Disable Word Wrap' : 'Enable Word Wrap',
      shortcut: navigator?.platform?.includes('Mac') ? '⌥Z' : 'Alt+Z',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
      action: () => {
        wordWrap = !wordWrap;
      },
    },
  ]);

  // ── Context menu trigger ──
  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    ctxX = e.clientX;
    ctxY = e.clientY;
    showCtx = true;
  }

  // ── Token hover tooltip ──
  function handleTokenEnter(e: MouseEvent) {
    const el = e.target as HTMLElement;
    // Find the syn-* class
    const cls = Array.from(el.classList).find((c) => c.startsWith('syn-'));
    if (!cls) return;
    const desc = SCOPE_DESC[cls];
    if (!desc) return;
    if (tokenTimer) clearTimeout(tokenTimer);
    tokenTimer = setTimeout(() => {
      tokenTooltip = { content: desc, x: e.clientX, y: e.clientY - 32 };
    }, 300);
  }

  function handleTokenLeave() {
    if (tokenTimer) {
      clearTimeout(tokenTimer);
      tokenTimer = null;
    }
    tokenTooltip = null;
  }

  function handleTokenMove(e: MouseEvent) {
    if (tokenTooltip) tokenTooltip = { ...tokenTooltip, x: e.clientX, y: e.clientY - 32 };
  }
</script>

<!-- Context menu -->
{#if showCtx}
  <ContextMenu
    items={ctxItems}
    x={ctxX}
    y={ctxY}
    onClose={() => {
      showCtx = false;
    }}
  />
{/if}

<!-- Token tooltip -->
{#if tokenTooltip}
  <Tooltip content={tokenTooltip.content} x={tokenTooltip.x} y={tokenTooltip.y} visible={true} />
{/if}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="code-block"
  class:word-wrap={wordWrap}
  data-language={language}
  oncontextmenu={handleContextMenu}
>
  <!-- ── Header ── -->
  <div class="code-header">
    <div class="header-left">
      <span class="language-dot" style="background: var(--syn-{language}, var(--accent-primary))"
      ></span>
      <span class="language-label">{langDisplay}</span>
      <span class="code-meta"
        >{lineCount} {lineCount === 1 ? 'line' : 'lines'} · {charCount} chars</span
      >
    </div>
    <div class="code-actions">
      {#if filePath}
        <Tooltip
          content="Open in editor"
          shortcut={navigator?.platform?.includes('Mac') ? '⌘↵' : 'Ctrl+Enter'}
        >
          <button
            class="code-btn"
            onclick={() => {
              openInEditor();
              uiClick();
            }}
            aria-label="Open in editor"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Open
          </button>
        </Tooltip>
      {/if}
      <Tooltip
        content={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
        shortcut={navigator?.platform?.includes('Mac') ? '⌥Z' : 'Alt+Z'}
      >
        <button
          class="code-btn icon-only"
          class:active={wordWrap}
          onclick={() => {
            wordWrap = !wordWrap;
            uiClick();
          }}
          aria-label={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
          aria-pressed={wordWrap}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
        </button>
      </Tooltip>
      <Tooltip
        content={copied ? 'Copied!' : 'Copy code'}
        shortcut={copied ? '' : navigator?.platform?.includes('Mac') ? '⌘C' : 'Ctrl+C'}
      >
        <button class="code-btn" class:success={copied} onclick={copy} aria-label="Copy code">
          {#if copied}
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
            Copied!
          {:else}
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Copy
          {/if}
        </button>
      </Tooltip>
    </div>
  </div>

  <!-- ── Code body ── -->
  <div class="code-body">
    {#if lineNums}
      <div class="gutter" aria-hidden="true">
        {#each displayLines as _, i}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="line-num"
            class:copied={copiedLine === i}
            onclick={() => copyLine(i)}
            title="Copy line {i + 1}"
          >
            {#if copiedLine === i}
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            {:else}
              {i + 1}
            {/if}
          </div>
        {/each}
      </div>
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <pre
      class="code-pre"
      onmouseenter={handleTokenEnter}
      onmouseleave={handleTokenLeave}
      onmousemove={handleTokenMove}><code class="code-inner"
        >{#each displayLines as line, i}<div
            class="code-line">{#if isHighlighted && highlightedLines[i] !== undefined}{@html highlightedLines[
                i
              ]}{:else}{line}{/if}</div>{/each}</code
      ></pre>
  </div>
</div>

<style>
  .code-block {
    border-radius: var(--radius);
    border: 1px solid var(--border-primary);
    overflow: hidden;
    font-size: var(--fs-base);
    position: relative;
  }

  /* ── Header ── */
  .code-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 5px 10px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-primary);
    gap: 8px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    flex: 1;
  }

  .language-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    opacity: 0.8;
  }

  .language-label {
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-primary);
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    flex-shrink: 0;
  }

  .code-meta {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    opacity: 0.65;
    white-space: nowrap;
    font-family: var(--font-family);
  }

  .code-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .code-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--fs-xs);
    font-weight: 500;
    color: var(--text-tertiary);
    padding: 2px 7px;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    white-space: nowrap;
    font-family: var(--font-family-sans);
  }
  .code-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-primary);
  }
  .code-btn.icon-only {
    padding: 3px 5px;
  }
  .code-btn.active {
    color: var(--accent-primary);
    border-color: color-mix(in srgb, var(--accent-primary) 35%, transparent);
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }
  .code-btn.success {
    color: var(--accent-success, #4caf50);
  }

  /* ── Code body ── */
  .code-body {
    display: flex;
    background: var(--bg-code, var(--bg-secondary));
    overflow-x: auto;
  }

  /* ── Line number gutter ── */
  .gutter {
    display: flex;
    flex-direction: column;
    padding: 12px 0;
    background: color-mix(in srgb, var(--bg-tertiary) 60%, transparent);
    border-right: 1px solid var(--border-primary);
    user-select: none;
    flex-shrink: 0;
  }

  .line-num {
    font-family: var(--font-family);
    font-size: var(--fs-xs);
    line-height: 1.5;
    color: var(--text-tertiary);
    padding: 0 10px 0 8px;
    min-width: 38px;
    text-align: right;
    cursor: pointer;
    opacity: 0.45;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    transition: all var(--transition);
    height: 1.5em;
  }
  .line-num:hover {
    opacity: 1;
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }
  .line-num.copied {
    opacity: 1;
    color: var(--accent-success, #4caf50);
  }

  /* ── Code display ── */
  .code-pre {
    padding: 12px 14px;
    margin: 0;
    background: transparent;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
  }

  .code-inner {
    font-family: var(--font-family);
    font-size: var(--fs-base);
    line-height: 1.5;
    background: none;
    padding: 0;
    display: block;
  }

  .code-line {
    display: block;
    min-height: 1.5em;
    white-space: pre;
  }

  .word-wrap .code-line {
    white-space: pre-wrap;
    word-break: break-all;
  }

  /* ── Syntax token colours ── */
  :global(.syn-keyword) {
    color: var(--syn-keyword, #cf8ef4);
    font-weight: 500;
  }
  :global(.syn-string) {
    color: var(--syn-string, #98c379);
  }
  :global(.syn-comment) {
    color: var(--syn-comment, #5c6370);
    font-style: italic;
  }
  :global(.syn-function) {
    color: var(--syn-function, #61afef);
  }
  :global(.syn-type) {
    color: var(--syn-type, #e5c07b);
  }
  :global(.syn-variable) {
    color: var(--syn-variable, #e06c75);
  }
  :global(.syn-operator) {
    color: var(--syn-operator, #56b6c2);
  }
  :global(.syn-number) {
    color: var(--syn-number, #d19a66);
  }

  /* Token hover highlight */
  :global(.syn-keyword:hover),
  :global(.syn-string:hover),
  :global(.syn-function:hover),
  :global(.syn-type:hover),
  :global(.syn-variable:hover),
  :global(.syn-operator:hover),
  :global(.syn-number:hover) {
    text-decoration: underline;
    text-decoration-color: currentColor;
    text-decoration-style: dotted;
    cursor: default;
  }
  :global(.syn-comment:hover) {
    font-style: italic;
    opacity: 0.85;
    cursor: default;
  }
</style>
