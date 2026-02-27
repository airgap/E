<script lang="ts">
  import { onMount } from 'svelte';
  import {
    EditorView,
    keymap,
    lineNumbers,
    highlightActiveLine,
    highlightActiveLineGutter,
    drawSelection,
    dropCursor,
    rectangularSelection,
    crosshairCursor,
    highlightSpecialChars,
  } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
  import {
    indentOnInput,
    bracketMatching,
    foldGutter,
    foldKeymap,
    foldAll,
    unfoldAll,
    indentUnit,
  } from '@codemirror/language';
  import {
    closeBrackets,
    closeBracketsKeymap,
    autocompletion,
    snippetCompletion,
    type CompletionContext,
    type CompletionResult,
  } from '@codemirror/autocomplete';
  import {
    searchKeymap,
    highlightSelectionMatches,
    selectNextOccurrence,
  } from '@codemirror/search';
  import { lintKeymap } from '@codemirror/lint';
  import { eEditorTheme, eSyntaxHighlighting } from './e-cm-theme';
  import { loadLanguage } from './language-map';
  import { editorStore, type EditorTab } from '$lib/stores/editor.svelte';
  import { symbolStore } from '$lib/stores/symbols.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { lspStore } from '$lib/stores/lsp.svelte';
  import { gotoDefinitionExtension } from './extensions/goto-definition';
  import { lspCompletionSource } from './extensions/lsp-completions';
  import { lspDiagnosticsExtension } from './extensions/lsp-diagnostics';
  import { lspHoverExtension } from './extensions/lsp-hover';
  import { fileUriField } from './extensions/file-uri-field';
  import { hoverHighlightExtension } from './extensions/hover-highlight';
  import { testStatusGutterExtension } from './extensions/test-status-gutter';
  import {
    codeActionGutterExtension,
    triggerQuickFix,
    type QuickFixRequest,
  } from './extensions/code-action-gutter';
  import {
    mergeConflictExtension,
    hasConflictMarkers,
    resolveConflictText,
    type ConflictRegion,
    type ConflictResolution,
  } from './extensions/merge-conflict';
  import { mergeConflictsStore } from '$lib/stores/merge-conflicts.svelte';
  import { lspInlayHintsExtension } from './extensions/lsp-inlay-hints';
  import { gitBlameExtension } from './extensions/git-blame';
  import { lspCodeLensExtension } from './extensions/lsp-code-lens';
  import { proactiveWarningsExtension } from './extensions/proactive-warnings';
  import EditorContextMenu from './EditorContextMenu.svelte';
  import QuickFixMenu from './QuickFixMenu.svelte';
  import AiActionResult from './AiActionResult.svelte';

  let { tab } = $props<{ tab: EditorTab }>();

  let container: HTMLDivElement;
  let view: EditorView | null = null;
  let currentTabId = tab.id;
  // Track whether the update is coming from our own sync (to prevent loops)
  let updatingFromStore = false;

  // ── Context menu state ──
  let showContextMenu = $state(false);
  let ctxMenuX = $state(0);
  let ctxMenuY = $state(0);
  let ctxSelectedText = $state('');

  // ── Quick fix menu state ──
  let showQuickFix = $state(false);
  let quickFixRequest = $state<QuickFixRequest | null>(null);

  function handleQuickFixRequest(request: QuickFixRequest) {
    quickFixRequest = request;
    showQuickFix = true;
  }

  function handleApplyEdit(newText: string, from: number, to: number) {
    if (!view) return;
    view.dispatch({ changes: { from, to, insert: newText } });
  }

  // ── Merge conflict resolution ──
  function handleConflictResolve(region: ConflictRegion, resolution: ConflictResolution) {
    if (!view) return;
    const doc = view.state.doc;

    if (resolution === 'ai-merge') {
      // Kick off AI merge asynchronously
      const content = doc.toString();
      const workspacePath = settingsStore.workspacePath || '';
      mergeConflictsStore
        .requestAiMerge(workspacePath, tab.filePath, region, content)
        .then((result) => {
          if (result.ok && result.mergedText != null && view) {
            const currentDoc = view.state.doc;
            const startLine = currentDoc.line(region.startLine);
            const endLine = currentDoc.line(region.endLine);
            view.dispatch({
              changes: { from: startLine.from, to: endLine.to, insert: result.mergedText },
            });
          } else if (result.error) {
            console.error('[merge-conflict] AI merge failed:', result.error);
          }
        });
      return;
    }

    // Local resolution: current / incoming / both
    const content = doc.toString();
    const resolved = resolveConflictText(content, region, resolution);
    const startLine = doc.line(region.startLine);
    const endLine = doc.line(region.endLine);
    view.dispatch({
      changes: { from: startLine.from, to: endLine.to, insert: resolved },
    });
  }

  function handleEditorContextMenu(e: MouseEvent) {
    if (!view) return;
    const selection = view.state.selection.main;
    const selectedText = selection.empty ? '' : view.state.sliceDoc(selection.from, selection.to);
    ctxSelectedText = selectedText;
    ctxMenuX = e.clientX;
    ctxMenuY = e.clientY;
    showContextMenu = true;
    e.preventDefault();
  }

  const jsSnippets = [
    snippetCompletion('if (${condition}) {\n\t${}\n}', {
      label: 'if',
      detail: 'if block',
      type: 'keyword',
    }),
    snippetCompletion('for (let ${i} = 0; ${i} < ${length}; ${i}++) {\n\t${}\n}', {
      label: 'for',
      detail: 'for loop',
      type: 'keyword',
    }),
    snippetCompletion('function ${name}(${params}) {\n\t${}\n}', {
      label: 'function',
      detail: 'function declaration',
      type: 'keyword',
    }),
    snippetCompletion('const ${name} = (${params}) => {\n\t${}\n};', {
      label: 'arrow',
      detail: 'arrow function',
      type: 'keyword',
    }),
    snippetCompletion('try {\n\t${}\n} catch (${err}) {\n\t${}\n}', {
      label: 'try',
      detail: 'try-catch block',
      type: 'keyword',
    }),
    snippetCompletion('console.log(${});', {
      label: 'log',
      detail: 'console.log',
      type: 'function',
    }),
  ];

  const genericSnippets = [
    snippetCompletion('if (${condition}) {\n\t${}\n}', {
      label: 'if',
      detail: 'if block',
      type: 'keyword',
    }),
    snippetCompletion('for (${init}; ${cond}; ${step}) {\n\t${}\n}', {
      label: 'for',
      detail: 'for loop',
      type: 'keyword',
    }),
  ];

  function snippetSource(ctx: CompletionContext): CompletionResult | null {
    const word = ctx.matchBefore(/\w+/);
    if (!word && !ctx.explicit) return null;
    const lang = tab.language;
    const builtIn = lang === 'javascript' || lang === 'typescript' ? jsSnippets : genericSnippets;
    const custom = (settingsStore.customSnippets[lang] || []).map((s) =>
      snippetCompletion(s.body, { label: s.prefix, detail: s.description, type: 'snippet' }),
    );
    return { from: word?.from ?? ctx.pos, options: [...builtIn, ...custom] };
  }

  function fileUri(): string {
    const p = tab.filePath;
    if (!p) return '';
    // Normalise to file:///absolute/path (already absolute on Linux/Mac)
    return p.startsWith('file://') ? p : `file://${p}`;
  }

  function createExtensions(languageSupport?: any) {
    const ec = tab.editorConfig;
    const exts = [
      // Stores the file URI so lsp-hover and lsp-completions can reference it
      fileUriField.init(() => fileUri()),
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      ...testStatusGutterExtension(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      eEditorTheme,
      eSyntaxHighlighting,
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...lintKeymap,
        indentWithTab,
        { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
        { key: 'Ctrl-Shift-[', run: foldAll },
        { key: 'Ctrl-Shift-]', run: unfoldAll },
        { key: 'Mod-.', run: triggerQuickFix, preventDefault: true },
        {
          key: 'Mod-s',
          run: () => {
            editorStore.saveFile(tab.id);
            return true;
          },
        },
      ]),
      autocompletion({
        override: [
          ...(lspStore.isConnected(tab.language) ? [lspCompletionSource(tab.language)] : []),
          snippetSource,
        ],
      }),
      EditorView.updateListener.of((update) => {
        if (updatingFromStore) return;
        if (update.docChanged) {
          const content = update.state.doc.toString();
          editorStore.updateContent(tab.id, content);
          // Trigger tree-sitter parse (debounced)
          symbolStore.requestParse(tab.id, content, tab.language);
          // Notify LSP of changes
          if (lspStore.isConnected(tab.language)) {
            lspStore.sendDidChange(tab.language, tab.filePath, content);
          }
        }
        if (update.selectionSet) {
          const pos = update.state.selection.main.head;
          const line = update.state.doc.lineAt(pos);
          editorStore.setCursorPosition(tab.id, line.number, pos - line.from + 1);
        }
      }),
      // Tree-sitter powered extensions
      gotoDefinitionExtension(tab.id, tab.language),
      // Unified hover: LSP first, tree-sitter fallback if LSP is absent or returns nothing
      lspHoverExtension(tab.language, tab.id),
      // Highlight all occurrences of the word under the cursor on hover
      hoverHighlightExtension(),
      // LSP diagnostics (only when connected)
      ...(lspStore.isConnected(tab.language) ? [lspDiagnosticsExtension(tab.language)] : []),
      // LSP inlay type hints (when connected and enabled)
      ...(lspStore.isConnected(tab.language) && settingsStore.showInlayHints
        ? lspInlayHintsExtension(tab.language)
        : []),
      // Code action lightbulb gutter (shows on lines with diagnostics)
      ...codeActionGutterExtension(handleQuickFixRequest),
      // Merge conflict inline resolution (only when content has conflict markers)
      ...(hasConflictMarkers(tab.content)
        ? mergeConflictExtension({ onResolve: handleConflictResolve })
        : []),
      // LSP Code Lens (reference counts above functions, when connected and enabled)
      ...(lspStore.isConnected(tab.language) && settingsStore.showCodeLens
        ? lspCodeLensExtension(tab.language)
        : []),
      // Git blame inline annotations (when enabled)
      ...(settingsStore.showInlineBlame && tab.filePath
        ? gitBlameExtension(tab.filePath, settingsStore.workspacePath || '')
        : []),
      // Proactive AI warnings (LLM-powered code review, when enabled)
      ...(settingsStore.proactiveWarningsEnabled && tab.filePath
        ? proactiveWarningsExtension(tab.filePath, tab.language)
        : []),
    ];

    if (languageSupport) {
      exts.push(languageSupport);
    }

    // Apply editorconfig settings
    if (ec) {
      exts.push(EditorState.tabSize.of(ec.tab_width ?? ec.indent_size ?? 4));
      exts.push(indentUnit.of(ec.indent_style === 'tab' ? '\t' : ' '.repeat(ec.indent_size ?? 4)));
    }

    return exts;
  }

  async function initEditor() {
    if (!container) return;
    if (view) {
      view.destroy();
      view = null;
    }

    const langSupport = await loadLanguage(tab.language);

    const state = EditorState.create({
      doc: tab.content,
      extensions: createExtensions(langSupport),
    });

    view = new EditorView({
      state,
      parent: container,
    });

    currentTabId = tab.id;

    // Trigger initial tree-sitter parse
    symbolStore.parseFull(tab.id, tab.content, tab.language);

    // Auto-connect LSP if a server is available
    if (!lspStore.isConnected(tab.language)) {
      lspStore.ensureConnection(tab.language, settingsStore.workspacePath);
    }

    // Notify LSP of file open
    if (lspStore.isConnected(tab.language)) {
      lspStore.sendDidOpen(tab.language, tab.filePath, tab.content, tab.language);
    }
  }

  // React to tab changes
  $effect(() => {
    if (tab.id !== currentTabId && container) {
      initEditor();
    }
  });

  // Reinitialize editor when LSP connects (to pick up LSP extensions)
  let wasLspConnected = false;
  $effect(() => {
    const connected = lspStore.isConnected(tab.language);
    if (connected && !wasLspConnected && view) {
      wasLspConnected = connected;
      // Reinitialize to pick up LSP extensions (completions, hover, diagnostics)
      initEditor();
    }
    wasLspConnected = connected;
  });

  // Sync content from store → editor when external changes happen (e.g. refreshFile)
  $effect(() => {
    const content = tab.content;
    if (view && currentTabId === tab.id) {
      const currentDoc = view.state.doc.toString();
      if (content !== currentDoc) {
        updatingFromStore = true;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: content },
        });
        updatingFromStore = false;
      }
    }
  });

  // Handle pending goto-definition scroll after file opens
  $effect(() => {
    const goTo = editorStore.pendingGoTo;
    if (goTo && view && currentTabId === tab.id) {
      const target = editorStore.consumePendingGoTo();
      if (target) {
        const lineCount = view.state.doc.lines;
        if (target.line >= 1 && target.line <= lineCount) {
          const docLine = view.state.doc.line(target.line);
          const pos = docLine.from + Math.min(target.col - 1, docLine.length);
          view.dispatch({
            selection: { anchor: pos },
            scrollIntoView: true,
          });
          editorStore.setCursorPosition(tab.id, target.line, target.col);
        }
      }
    }
  });

  // Follow Along: scroll to the edit location when the agent modifies a file.
  // This is a standalone effect so it fires even when the content hasn't changed
  // (e.g. a Write that produces identical content, or the tab was just opened).
  $effect(() => {
    const faTarget = editorStore.followAlongTarget;
    const editorView = view; // Explicitly track view as a dependency
    const tabId = currentTabId; // Explicitly track currentTabId

    if (faTarget && faTarget.filePath === tab.filePath && editorView && tabId === tab.id) {
      // Use a small delay to ensure the editor view is fully initialized and content is loaded
      setTimeout(() => {
        const target = editorStore.consumeFollowAlongTarget();
        if (target && editorView && editorView.state.doc.lines > 0) {
          const lineCount = editorView.state.doc.lines;
          const targetLine = Math.min(target.line, lineCount);
          if (targetLine >= 1) {
            const docLine = editorView.state.doc.line(targetLine);
            editorView.dispatch({
              selection: { anchor: docLine.from },
              scrollIntoView: true,
            });
          }
        }
      }, 50);
    }
  });

  onMount(() => {
    // Load server info so StatusBar can show install prompts
    lspStore.loadServerInfo();
    initEditor();
    return () => {
      // Notify LSP of file close
      if (lspStore.isConnected(tab.language)) {
        lspStore.sendDidClose(tab.language, tab.filePath);
      }
      if (view) {
        view.destroy();
        view = null;
      }
    };
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="code-editor-wrapper">
  <div class="code-editor" bind:this={container} oncontextmenu={handleEditorContextMenu}></div>
  <AiActionResult />
</div>

{#if showContextMenu}
  <EditorContextMenu
    x={ctxMenuX}
    y={ctxMenuY}
    selectedText={ctxSelectedText}
    filePath={tab.filePath}
    language={tab.language}
    onClose={() => {
      showContextMenu = false;
    }}
  />
{/if}

{#if showQuickFix && quickFixRequest}
  <QuickFixMenu
    request={quickFixRequest}
    filePath={tab.filePath}
    language={tab.language}
    fileUri={fileUri()}
    documentContent={tab.content}
    onClose={() => {
      showQuickFix = false;
      quickFixRequest = null;
    }}
    onApplyEdit={handleApplyEdit}
  />
{/if}

<style>
  .code-editor-wrapper {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    position: relative;
  }
  .code-editor {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .code-editor :global(.cm-editor) {
    height: 100%;
  }
  .code-editor :global(.cm-scroller) {
    overflow: auto;
  }
</style>
