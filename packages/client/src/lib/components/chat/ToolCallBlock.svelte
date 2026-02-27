<script lang="ts">
  import { highlightLines, langFromPath, escapeHtml } from '$lib/utils/highlight';
  import { parseMcpToolName } from '@e/shared';
  import { chirpEngine } from '$lib/audio/chirp-engine';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { api } from '$lib/api/client';

  function uiClick() {
    if (settingsStore.soundEnabled) chirpEngine.uiClick();
  }

  let {
    toolName,
    input,
    result,
    running = false,
    compact = false,
    toolCallId,
  } = $props<{
    toolName: string;
    input: Record<string, unknown>;
    result?: { content: string; is_error?: boolean };
    running?: boolean;
    /** When true, suppress large error styling (used during streaming) */
    compact?: boolean;
    /** Tool call ID for interactive features (e.g. answering AskUserQuestion) */
    toolCallId?: string;
  }>();

  // ── MCP Tool Name Resolution ──
  // Parse MCP-prefixed names (e.g. "mcp__desktop-commander__read_file")
  // into a resolved name that routes to existing rich rendering templates.
  const parsed = $derived(parseMcpToolName(toolName));
  /** The built-in tool name to use for icons, colors, and rendering templates */
  const effectiveName = $derived(parsed.renderAs || parsed.toolName);
  /** Short display name for the header */
  const displayName = $derived(parsed.displayName);
  /** MCP server name shown as a badge, null for built-in tools */
  const serverLabel = $derived(parsed.serverName);

  // AskUserQuestion should auto-expand so questions are visible
  const isAskUser = $derived(effectiveName === 'AskUserQuestion' || toolName === 'AskUserQuestion');
  let expanded = $state(false);
  let autoExpanded = $state(false);

  $effect(() => {
    if (isAskUser && !autoExpanded) {
      expanded = true;
      autoExpanded = true;
    }
  });

  const toolIcons: Record<string, string> = {
    Read: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z',
    Write: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z',
    Edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z',
    Bash: 'M4 17l6-6-6-6M12 19h8',
    Glob: 'M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
    Grep: 'M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
    WebFetch: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z',
    WebSearch: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z',
    Task: 'M12 2L2 7l10 5 10-5-10-5z',
    TodoWrite: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
    NotebookEdit:
      'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
    AskUserQuestion:
      'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm0-6v.01M12 8a2 2 0 0 0-2 2',
  };

  /** Short filename from a full path */
  function basename(path: string): string {
    return path.split('/').pop() || path;
  }

  /**
   * Extract file path from input — handles both built-in (file_path)
   * and MCP (path) parameter naming conventions.
   */
  function getFilePath(): string {
    return String(input.file_path || input.path || '');
  }

  function formatInput(input: Record<string, unknown>): string {
    const fp = getFilePath();
    if (effectiveName === 'Read' && fp) return fp;
    if (effectiveName === 'Bash' && input.command) return String(input.command);
    if (effectiveName === 'Edit' && fp) return fp;
    if (effectiveName === 'Write' && fp) return fp;
    if (effectiveName === 'Glob' && input.pattern) return String(input.pattern);
    if (effectiveName === 'Grep' && input.pattern) return String(input.pattern);
    if (effectiveName === 'AskUserQuestion' || toolName === 'AskUserQuestion') {
      const qs = parseQuestions();
      if (qs.length === 1) return qs[0].header || qs[0].question.slice(0, 80);
      return `${qs.length} questions`;
    }
    if (effectiveName === 'TodoWrite' || toolName === 'TodoWrite') return 'update tasks';
    if ((effectiveName === 'Task' || toolName === 'Task') && input.description)
      return String(input.description);
    // For MCP tools, show a concise summary rather than raw JSON
    if (parsed.isMcp) {
      const keys = Object.keys(input).filter((k) => input[k] !== undefined && input[k] !== null);
      if (keys.length === 0) return '';
      // Show the first meaningful value
      const firstKey = keys[0];
      const val = String(input[firstKey]);
      return val.length > 120 ? val.slice(0, 120) + '...' : val;
    }
    return JSON.stringify(input, null, 2).slice(0, 200);
  }

  // ── Diff types ──

  interface DiffLine {
    type: 'context' | 'removed' | 'added' | 'header';
    text: string;
    html: string; // Highlighted HTML (or escaped plain text as fallback)
  }

  /**
   * Build unified diff lines for Edit tool.
   */
  function buildEditDiff(highlightedOld: string[], highlightedNew: string[]): DiffLine[] {
    const oldStr = String(input.old_string || '');
    const newStr = String(input.new_string || '');
    const oldLines = oldStr.split('\n');
    const newLines = newStr.split('\n');
    const lines: DiffLine[] = [];
    const fp = getFilePath();

    lines.push({
      type: 'header',
      text: `@@ ${basename(fp)}`,
      html: escapeHtml(`@@ ${basename(fp)}`),
    });

    // Find common prefix/suffix
    let prefixLen = 0;
    while (
      prefixLen < oldLines.length &&
      prefixLen < newLines.length &&
      oldLines[prefixLen] === newLines[prefixLen]
    ) {
      prefixLen++;
    }

    let suffixLen = 0;
    while (
      suffixLen < oldLines.length - prefixLen &&
      suffixLen < newLines.length - prefixLen &&
      oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
    ) {
      suffixLen++;
    }

    // Context before
    const contextBefore = Math.min(prefixLen, 2);
    for (let i = prefixLen - contextBefore; i < prefixLen; i++) {
      lines.push({
        type: 'context',
        text: oldLines[i],
        html: highlightedOld[i] || escapeHtml(oldLines[i]),
      });
    }

    // Removed
    const oldEnd = oldLines.length - suffixLen;
    for (let i = prefixLen; i < oldEnd; i++) {
      lines.push({
        type: 'removed',
        text: oldLines[i],
        html: highlightedOld[i] || escapeHtml(oldLines[i]),
      });
    }

    // Added
    const newEnd = newLines.length - suffixLen;
    for (let i = prefixLen; i < newEnd; i++) {
      lines.push({
        type: 'added',
        text: newLines[i],
        html: highlightedNew[i] || escapeHtml(newLines[i]),
      });
    }

    // Context after
    const contextAfter = Math.min(suffixLen, 2);
    for (let i = oldEnd; i < oldEnd + contextAfter; i++) {
      lines.push({
        type: 'context',
        text: oldLines[i],
        html: highlightedOld[i] || escapeHtml(oldLines[i]),
      });
    }

    return lines;
  }

  /** Count lines in a string */
  function lineCount(s: string): number {
    if (!s) return 0;
    return s.split('\n').length;
  }

  /** Truncate content to N lines with indicator */
  function truncateLines(
    s: string,
    max: number,
  ): { text: string; truncated: boolean; total: number } {
    const lines = s.split('\n');
    if (lines.length <= max) return { text: s, truncated: false, total: lines.length };
    return { text: lines.slice(0, max).join('\n'), truncated: true, total: lines.length };
  }

  const categoryColors: Record<string, string> = {
    Read: 'var(--accent-info)',
    Write: 'var(--accent-warning)',
    Edit: 'var(--accent-warning)',
    Bash: 'var(--accent-error)',
    Glob: 'var(--accent-info)',
    Grep: 'var(--accent-info)',
    WebFetch: 'var(--accent-purple)',
    WebSearch: 'var(--accent-purple)',
    Task: 'var(--accent-secondary)',
    TodoWrite: 'var(--accent-info)',
    AskUserQuestion: 'var(--accent-primary)',
  };

  // ── AskUserQuestion helpers ──
  interface AskOption {
    label: string;
    description?: string;
  }
  interface AskQuestion {
    question: string;
    header?: string;
    options?: AskOption[];
    multiSelect?: boolean;
  }

  function parseQuestions(): AskQuestion[] {
    const raw = input.questions;
    if (Array.isArray(raw)) return raw as AskQuestion[];
    return [];
  }

  /**
   * Parse the tool result to extract selected answers.
   * The result format from Claude CLI can vary:
   *   - JSON: { "answers": { "q0": "OptionLabel", ... } }
   *   - JSON: { "question": "OptionLabel" }
   *   - Plain text matching an option label
   */
  function getSelectedLabels(): Set<string> {
    if (!result?.content) return new Set();
    const content = result.content.trim();
    const labels = new Set<string>();

    // Try JSON parsing first
    try {
      const parsed = JSON.parse(content);
      if (parsed.answers && typeof parsed.answers === 'object') {
        for (const v of Object.values(parsed.answers)) {
          if (typeof v === 'string') labels.add(v);
        }
        if (labels.size > 0) return labels;
      }
      // Single answer object: { "someKey": "value" }
      for (const v of Object.values(parsed)) {
        if (typeof v === 'string') labels.add(v);
      }
      if (labels.size > 0) return labels;
    } catch {
      // Not JSON — try matching against option labels
    }

    // Plain text: check if the result mentions any option label
    const allOptions = parseQuestions().flatMap((q) => q.options || []);
    for (const opt of allOptions) {
      if (content.includes(opt.label)) {
        labels.add(opt.label);
      }
    }
    return labels;
  }

  // ── Interactive AskUserQuestion state ──
  // When the question has no result yet (pending), allow the user to answer
  // directly from the ToolCallBlock — this handles reload/reconnect cases
  // where the UserQuestionDialog overlay may not appear.
  // BUT: if the overlay (UserQuestionDialog) is already showing this question,
  // don't render a second interactive form here — defer to the overlay.
  const overlayHasThis = $derived(
    toolCallId ? streamStore.pendingQuestions.some((q) => q.toolCallId === toolCallId) : false,
  );
  const isPendingAskUser = $derived(isAskUser && !result && !overlayHasThis);
  let askSelections = $state<Record<number, string>>({});
  let askSubmitting = $state(false);
  let askSubmitted = $state(false);

  function selectAskOption(questionIndex: number, label: string, multiSelect?: boolean) {
    if (askSubmitting || askSubmitted) return;
    if (multiSelect) {
      const current = askSelections[questionIndex];
      if (current === label) {
        const next = { ...askSelections };
        delete next[questionIndex];
        askSelections = next;
      } else {
        askSelections = { ...askSelections, [questionIndex]: label };
      }
    } else {
      askSelections = { ...askSelections, [questionIndex]: label };
    }
  }

  const askAllAnswered = $derived(
    isPendingAskUser &&
      parseQuestions().every((_q: any, i: number) => askSelections[i] !== undefined),
  );

  async function submitAskAnswer() {
    if (askSubmitting || !askAllAnswered || !toolCallId) return;
    askSubmitting = true;

    const questions = parseQuestions();
    const answers: Record<string, string> = {};
    for (let i = 0; i < questions.length; i++) {
      const key = questions[i].header || `q${i}`;
      answers[key] = askSelections[i];
    }

    const convId = conversationStore.active?.id;
    const sessionId = streamStore.sessionId;
    if (convId && sessionId) {
      try {
        await api.stream.answerQuestion(convId, sessionId, toolCallId, answers);
        askSubmitted = true;
        // Also resolve the pending question in the stream store if it exists
        streamStore.resolveQuestion(toolCallId);
      } catch (err) {
        console.error('[ToolCallBlock] Failed to submit AskUserQuestion answer:', err);
        askSubmitting = false;
        return;
      }
    }
  }

  // ── Async syntax highlighting state ──

  let diffLines = $state<DiffLine[]>([]);
  let writeHighlightedHtml = $state('');

  // Recompute highlighted content when expanded — use effectiveName for template routing
  $effect(() => {
    if (!expanded) return;

    const filePath = getFilePath();
    const lang = langFromPath(filePath);

    if (effectiveName === 'Edit') {
      const oldStr = String(input.old_string || '');
      const newStr = String(input.new_string || '');

      // Start with plain-text fallback immediately
      const oldPlain = oldStr.split('\n').map(escapeHtml);
      const newPlain = newStr.split('\n').map(escapeHtml);
      diffLines = buildEditDiff(oldPlain, newPlain);

      // Then async highlight
      if (lang) {
        Promise.all([highlightLines(oldStr, lang), highlightLines(newStr, lang)]).then(
          ([hlOld, hlNew]) => {
            diffLines = buildEditDiff(hlOld, hlNew);
          },
        );
      }
    } else if (effectiveName === 'Write') {
      const content = String(input.content || '');
      const preview = truncateLines(content, 20);

      // Plain fallback
      writeHighlightedHtml = escapeHtml(preview.text);

      // Async highlight
      if (lang) {
        highlightLines(preview.text, lang).then((lines) => {
          writeHighlightedHtml = lines.join('\n');
        });
      }
    }
  });
</script>

<div class="tool-block" class:running class:error={result?.is_error && !compact} class:compact>
  <button
    class="tool-header"
    onclick={() => {
      expanded = !expanded;
      uiClick();
    }}
  >
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      class:rotated={expanded}
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
    <span class="tool-icon" style:color={categoryColors[effectiveName] || 'var(--text-tertiary)'}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path
          d={toolIcons[effectiveName] ||
            'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'}
        />
      </svg>
    </span>
    <span class="tool-name">{displayName}</span>
    {#if serverLabel}
      <span class="mcp-badge">{serverLabel}</span>
    {/if}
    <span class="tool-summary truncate">{formatInput(input)}</span>
    {#if running}
      <span class="running-indicator"></span>
    {:else if result && !result.is_error}
      <span class="success-badge">✓</span>
    {:else if result?.is_error}
      <span class="error-badge">{compact ? '✕' : 'ERROR'}</span>
    {/if}
  </button>

  {#if expanded && !compact}
    <div class="tool-details">
      {#if effectiveName === 'Edit'}
        <!-- Unified diff view for Edit / edit_block -->
        <div class="detail-section">
          <span class="detail-label">{basename(getFilePath())}</span>
          <div class="diff-view">
            {#each diffLines as line}
              <div
                class="diff-line"
                class:diff-header={line.type === 'header'}
                class:diff-removed={line.type === 'removed'}
                class:diff-added={line.type === 'added'}
                class:diff-context={line.type === 'context'}
              >
                <span class="diff-gutter"
                  >{line.type === 'removed'
                    ? '-'
                    : line.type === 'added'
                      ? '+'
                      : line.type === 'header'
                        ? '@@'
                        : ' '}</span
                >
                <span class="diff-text">{@html line.html}</span>
              </div>
            {/each}
          </div>
          {#if input.replace_all || input.expected_replacements}
            <span class="edit-flag"
              >{input.replace_all ? 'replace all' : `×${input.expected_replacements}`}</span
            >
          {/if}
        </div>
        {#if result}
          <div class="detail-section">
            <span class="detail-label">Result</span>
            <pre class="detail-content" class:error-output={result.is_error}>{result.content}</pre>
          </div>
        {/if}
      {:else if effectiveName === 'Write'}
        <!-- Content preview for Write / write_file -->
        <div class="detail-section">
          <div class="write-header">
            <span class="detail-label">{getFilePath()}</span>
            <span class="write-meta">{lineCount(String(input.content || ''))} lines</span>
          </div>
          <pre class="detail-content write-preview">{@html writeHighlightedHtml}</pre>
          {#if truncateLines(String(input.content || ''), 20).truncated}
            <span class="truncated-indicator"
              >... {truncateLines(String(input.content || ''), 20).total - 20} more lines</span
            >
          {/if}
        </div>
        {#if result}
          <div class="detail-section">
            <span class="detail-label">Result</span>
            <pre class="detail-content" class:error-output={result.is_error}>{result.content}</pre>
          </div>
        {/if}
      {:else if effectiveName === 'Read'}
        <!-- File path + result content for Read / read_file -->
        <div class="detail-section">
          <span class="detail-label">{getFilePath()}</span>
          {#if input.offset || input.limit || input.length}
            <span class="read-range">
              {#if input.offset}offset: {input.offset}{/if}
              {#if input.limit || input.length}{input.offset ? ', ' : ''}limit: {input.limit ||
                  input.length}{/if}
            </span>
          {/if}
        </div>
        {#if result}
          <div class="detail-section">
            <pre class="detail-content" class:error-output={result.is_error}>{truncateLines(
                result.content,
                30,
              ).text}</pre>
            {#if truncateLines(result.content, 30).truncated}
              <span class="truncated-indicator"
                >... {truncateLines(result.content, 30).total - 30} more lines</span
              >
            {/if}
          </div>
        {/if}
      {:else if effectiveName === 'Bash'}
        <!-- Command + output for Bash / start_process / execute_command -->
        <div class="detail-section">
          <span class="detail-label">Command</span>
          <pre class="detail-content bash-command">{String(
              input.command || input.input || '',
            )}</pre>
          {#if input.description}
            <span class="bash-desc">{String(input.description)}</span>
          {/if}
        </div>
        {#if result}
          <div class="detail-section">
            <span class="detail-label">Output</span>
            <pre class="detail-content" class:error-output={result.is_error}>{truncateLines(
                result.content,
                30,
              ).text}</pre>
            {#if truncateLines(result.content, 30).truncated}
              <span class="truncated-indicator"
                >... {truncateLines(result.content, 30).total - 30} more lines</span
              >
            {/if}
          </div>
        {/if}
      {:else if effectiveName === 'Grep'}
        <!-- Pattern + path + results for Grep / search -->
        <div class="detail-section">
          <span class="detail-label">Search</span>
          <div class="grep-params">
            <span class="grep-pattern">/{String(input.pattern || '')}/</span>
            {#if input.path}<span class="grep-path">in {String(input.path)}</span>{/if}
            {#if input.glob}<span class="grep-flag">glob: {String(input.glob)}</span>{/if}
            {#if input.type}<span class="grep-flag">type: {String(input.type)}</span>{/if}
            {#if input.filePattern}<span class="grep-flag">files: {String(input.filePattern)}</span
              >{/if}
            {#if input.searchType}<span class="grep-flag">{String(input.searchType)}</span>{/if}
          </div>
        </div>
        {#if result}
          <div class="detail-section">
            <span class="detail-label">Matches</span>
            <pre class="detail-content" class:error-output={result.is_error}>{truncateLines(
                result.content,
                30,
              ).text}</pre>
            {#if truncateLines(result.content, 30).truncated}
              <span class="truncated-indicator"
                >... {truncateLines(result.content, 30).total - 30} more lines</span
              >
            {/if}
          </div>
        {/if}
      {:else if effectiveName === 'Glob'}
        <!-- Pattern + results for Glob / list_directory -->
        <div class="detail-section">
          <span class="detail-label">Pattern</span>
          <pre class="detail-content">{String(input.pattern || input.path || '')}</pre>
          {#if input.path && input.pattern}
            <span class="grep-path">in {String(input.path)}</span>
          {/if}
          {#if input.depth}
            <span class="grep-flag">depth: {String(input.depth)}</span>
          {/if}
        </div>
        {#if result}
          <div class="detail-section">
            <span class="detail-label">Files</span>
            <pre class="detail-content" class:error-output={result.is_error}>{truncateLines(
                result.content,
                30,
              ).text}</pre>
            {#if truncateLines(result.content, 30).truncated}
              <span class="truncated-indicator"
                >... {truncateLines(result.content, 30).total - 30} more lines</span
              >
            {/if}
          </div>
        {/if}
      {:else if effectiveName === 'AskUserQuestion' || toolName === 'AskUserQuestion'}
        <!-- Question prompt display for AskUserQuestion -->
        {@const questions = parseQuestions()}
        {@const selected = getSelectedLabels()}
        {@const hasResult = !!result}
        {#if overlayHasThis && !hasResult && !askSubmitted}
          <!-- Overlay dialog is handling this question — don't duplicate -->
          <div class="detail-section">
            <span class="ask-waiting-label">Waiting for your answer…</span>
          </div>
        {:else}
          {#each questions as q, qi}
            <div class="detail-section ask-question-section">
              {#if q.header}
                <span class="ask-header">{q.header}</span>
              {/if}
              <p class="ask-question-text">{q.question}</p>
              {#if q.options && q.options.length > 0}
                <div class="ask-options">
                  {#each q.options as opt}
                    {@const isAnswered = selected.has(opt.label)}
                    {@const isInteractiveSelected = askSelections[qi] === opt.label}
                    {#if isPendingAskUser && toolCallId && !askSubmitted}
                      <!-- Interactive mode: render as clickable buttons -->
                      <button
                        class="ask-option ask-option-interactive"
                        class:ask-option-selected={isInteractiveSelected}
                        onclick={() => selectAskOption(qi, opt.label, q.multiSelect)}
                        disabled={askSubmitting}
                      >
                        <span class="ask-option-indicator">
                          {#if isInteractiveSelected}
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2.5"><path d="M20 6L9 17l-5-5" /></svg
                            >
                          {:else}
                            ○
                          {/if}
                        </span>
                        <div class="ask-option-content">
                          <span class="ask-option-label">{opt.label}</span>
                          {#if opt.description}
                            <span class="ask-option-desc">{opt.description}</span>
                          {/if}
                        </div>
                      </button>
                    {:else}
                      <!-- Static mode: display-only (answered or no toolCallId) -->
                      <div
                        class="ask-option"
                        class:ask-option-selected={isAnswered ||
                          (askSubmitted && isInteractiveSelected)}
                      >
                        <span class="ask-option-indicator">
                          {#if isAnswered || (askSubmitted && isInteractiveSelected)}
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2.5"><path d="M20 6L9 17l-5-5" /></svg
                            >
                          {:else}
                            ·
                          {/if}
                        </span>
                        <div class="ask-option-content">
                          <span class="ask-option-label">{opt.label}</span>
                          {#if opt.description}
                            <span class="ask-option-desc">{opt.description}</span>
                          {/if}
                        </div>
                      </div>
                    {/if}
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
          {#if isPendingAskUser && toolCallId && !askSubmitted}
            <!-- Submit button for interactive mode -->
            <div class="ask-actions">
              <button
                class="ask-submit-btn"
                onclick={submitAskAnswer}
                disabled={askSubmitting || !askAllAnswered}
              >
                {askSubmitting ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          {:else if askSubmitted}
            <div class="detail-section">
              <span class="ask-submitted-label">Answer submitted</span>
            </div>
          {/if}
          {#if hasResult && selected.size === 0}
            <!-- Result didn't match any option — show raw answer -->
            <div class="detail-section">
              <span class="detail-label">Answer</span>
              <pre
                class="detail-content"
                class:error-output={result.is_error}>{result.content}</pre>
            </div>
          {/if}
        {/if}
      {:else}
        <!-- Fallback: generic JSON display for unknown tools -->
        <div class="detail-section">
          <span class="detail-label">Input</span>
          <pre class="detail-content">{JSON.stringify(input, null, 2)}</pre>
        </div>
        {#if result}
          <div class="detail-section">
            <span class="detail-label">Output</span>
            <pre class="detail-content" class:error-output={result.is_error}>{result.content}</pre>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .tool-block {
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    overflow: hidden;
    font-size: var(--fs-base);
  }

  .tool-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 10px;
    background: var(--bg-tertiary);
    transition: background var(--transition);
  }
  .tool-header:hover {
    background: var(--bg-hover);
  }

  .tool-name {
    font-weight: 600;
    color: var(--text-primary);
    font-size: var(--fs-sm);
  }

  .mcp-badge {
    font-size: var(--fs-xxs);
    padding: 1px 5px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .tool-summary {
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
    flex: 1;
    min-width: 0;
    font-family: var(--font-family);
    text-align: left;
  }

  .tool-icon {
    display: flex;
  }

  svg {
    transition: transform var(--transition);
  }
  .rotated {
    transform: rotate(90deg);
  }

  .running-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-primary);
    animation: pulse 1s infinite;
  }

  .error-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--accent-error);
    color: var(--text-on-accent);
  }

  .success-badge {
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--accent-secondary, #00ff88);
    opacity: 0.7;
  }

  .tool-block.compact {
    border-color: var(--border-secondary);
    transition: border-color 0.3s ease;
  }
  .tool-block.compact .error-badge {
    font-size: var(--fs-xxs);
    background: transparent;
    color: var(--accent-error);
    padding: 0;
  }

  .tool-details {
    border-top: 1px solid var(--border-secondary);
    background: var(--bg-primary);
  }

  .detail-section {
    padding: 8px 10px;
  }
  .detail-section + .detail-section {
    border-top: 1px solid var(--border-secondary);
  }

  .detail-label {
    font-size: var(--fs-xxs);
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    color: var(--text-tertiary);
    display: block;
    margin-bottom: 4px;
  }

  .detail-content {
    font-size: var(--fs-sm);
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 300px;
    overflow-y: auto;
    background: none;
    padding: 0;
    color: var(--text-secondary);
  }

  .error-output {
    color: var(--accent-error);
  }

  .tool-block.error {
    border-color: var(--accent-error);
  }

  /* ── Diff view (Edit tool) ── */
  .diff-view {
    font-family: var(--font-family);
    font-size: var(--fs-sm);
    line-height: 1.5;
    border-radius: 2px;
    overflow: hidden;
    max-height: 300px;
    overflow-y: auto;
  }
  .diff-line {
    display: flex;
    padding: 0 8px;
    min-height: 20px;
  }
  .diff-gutter {
    flex-shrink: 0;
    width: 18px;
    text-align: center;
    color: var(--text-tertiary);
    user-select: none;
    opacity: 0.6;
  }
  .diff-text {
    white-space: pre-wrap;
    word-break: break-word;
    flex: 1;
  }
  .diff-header {
    color: var(--accent-info);
    font-weight: 600;
    opacity: 0.7;
    font-size: var(--fs-xs);
    padding: 2px 8px;
  }
  .diff-removed {
    background: color-mix(in srgb, var(--accent-error) 8%, transparent);
    border-left: 2px solid color-mix(in srgb, var(--accent-error) 40%, transparent);
  }
  .diff-removed .diff-gutter {
    color: var(--accent-error);
    opacity: 0.7;
  }
  .diff-added {
    background: color-mix(in srgb, var(--accent-secondary) 8%, transparent);
    border-left: 2px solid color-mix(in srgb, var(--accent-secondary) 40%, transparent);
  }
  .diff-added .diff-gutter {
    color: var(--accent-secondary);
    opacity: 0.7;
  }
  .diff-context {
    color: var(--text-tertiary);
    border-left: 2px solid transparent;
  }
  .edit-flag {
    display: inline-block;
    margin-top: 4px;
    font-size: var(--fs-xxs);
    padding: 1px 6px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* ── Syntax highlighting token classes ── */
  .diff-text :global(.syn-keyword) {
    color: var(--syn-keyword);
  }
  .diff-text :global(.syn-string) {
    color: var(--syn-string);
  }
  .diff-text :global(.syn-number) {
    color: var(--syn-number);
  }
  .diff-text :global(.syn-function) {
    color: var(--syn-function);
  }
  .diff-text :global(.syn-comment) {
    color: var(--syn-comment);
  }
  .diff-text :global(.syn-type) {
    color: var(--syn-type);
  }
  .diff-text :global(.syn-variable) {
    color: var(--syn-variable);
  }
  .diff-text :global(.syn-operator) {
    color: var(--syn-operator);
  }

  /* ── Write tool ── */
  .write-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .write-meta {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-family: var(--font-family);
  }
  .write-preview {
    border-left: 2px solid var(--accent-warning);
    padding-left: 8px !important;
    margin-top: 4px;
  }
  /* Syntax highlighting in write preview */
  .write-preview :global(.syn-keyword) {
    color: var(--syn-keyword);
  }
  .write-preview :global(.syn-string) {
    color: var(--syn-string);
  }
  .write-preview :global(.syn-number) {
    color: var(--syn-number);
  }
  .write-preview :global(.syn-function) {
    color: var(--syn-function);
  }
  .write-preview :global(.syn-comment) {
    color: var(--syn-comment);
  }
  .write-preview :global(.syn-type) {
    color: var(--syn-type);
  }
  .write-preview :global(.syn-variable) {
    color: var(--syn-variable);
  }
  .write-preview :global(.syn-operator) {
    color: var(--syn-operator);
  }

  /* ── Truncation ── */
  .truncated-indicator {
    display: block;
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-style: italic;
    margin-top: 4px;
    padding-left: 10px;
  }

  /* ── Read tool ── */
  .read-range {
    display: inline-block;
    margin-top: 2px;
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-family: var(--font-family);
  }

  /* ── Bash tool ── */
  .bash-command {
    color: var(--text-primary) !important;
    font-weight: 500;
  }
  .bash-desc {
    display: block;
    margin-top: 4px;
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-style: italic;
  }

  /* ── Grep/Glob tool ── */
  .grep-params {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: baseline;
    font-size: var(--fs-sm);
  }
  .grep-pattern {
    font-family: var(--font-family);
    color: var(--accent-primary);
    font-weight: 600;
  }
  .grep-path {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    font-family: var(--font-family);
  }
  .grep-flag {
    font-size: var(--fs-xxs);
    padding: 1px 5px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    color: var(--text-tertiary);
    font-family: var(--font-family);
  }

  /* ── AskUserQuestion ── */
  .ask-question-section {
    padding: 10px 12px;
  }
  .ask-header {
    display: inline-block;
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 7px;
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent);
    color: var(--accent-primary);
    border-radius: 3px;
    margin-bottom: 6px;
  }
  .ask-question-text {
    font-size: var(--fs-base);
    line-height: 1.5;
    color: var(--text-primary);
    font-weight: 500;
    margin: 4px 0 8px;
  }
  .ask-options {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .ask-option {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-secondary);
    background: var(--bg-tertiary);
    transition: all var(--transition);
  }
  .ask-option-selected {
    border-color: var(--accent-secondary);
    background: color-mix(in srgb, var(--accent-secondary) 8%, var(--bg-tertiary));
  }
  .ask-option-indicator {
    flex-shrink: 0;
    font-size: var(--fs-xxs);
    line-height: 18px;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    width: 14px;
    justify-content: center;
  }
  .ask-option-selected .ask-option-indicator {
    color: var(--accent-secondary);
  }
  .ask-option-waiting {
    opacity: 0.7;
  }
  .ask-option-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .ask-option-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
  }
  .ask-option-selected .ask-option-label {
    color: var(--accent-secondary);
  }
  .ask-option-desc {
    font-size: var(--fs-xs);
    line-height: 1.4;
    color: var(--text-tertiary);
  }
  /* Interactive button mode for pending questions */
  button.ask-option-interactive {
    cursor: pointer;
    text-align: left;
    width: 100%;
  }
  button.ask-option-interactive:hover:not(:disabled) {
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 5%, var(--bg-tertiary));
  }
  button.ask-option-interactive:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ask-actions {
    display: flex;
    gap: 8px;
    padding: 8px 10px;
    justify-content: flex-end;
    border-top: 1px solid var(--border-secondary);
  }
  .ask-submit-btn {
    padding: 6px 20px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-base);
    font-weight: 600;
    transition: all var(--transition);
    background: var(--accent-primary);
    color: var(--text-on-accent);
    cursor: pointer;
  }
  .ask-submit-btn:hover:not(:disabled) {
    filter: brightness(1.1);
  }
  .ask-submit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ask-submitted-label,
  .ask-waiting-label {
    font-size: var(--fs-xs);
    color: var(--accent-secondary);
    font-weight: 600;
    font-style: italic;
  }
  .ask-waiting {
    display: block;
    margin-top: 6px;
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    font-style: italic;
    animation: hudPulse 1.2s infinite linear;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }
</style>
