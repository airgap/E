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
  import { EditorState, EditorSelection } from '@codemirror/state';
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
    selectSelectionMatches,
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
  import { pluginCompletionSource } from './extensions/plugin-completions';
  import { pluginInlineCompletionsExtension } from './extensions/plugin-inline-completions';
  import { lspDiagnosticsExtension } from './extensions/lsp-diagnostics';
  import { lspHoverExtension } from './extensions/lsp-hover';
  import { pluginHoverExtension } from './extensions/plugin-hover';
  import { graphPopoverExtension } from './extensions/graph-popover';
  import { fileUriField } from './extensions/file-uri-field';
  import { hoverHighlightExtension } from './extensions/hover-highlight';
  import { testStatusGutterExtension } from './extensions/test-status-gutter';
  import { testActionsGutterExtension } from './extensions/test-actions-gutter';
  import { testCodeLensExtension } from './extensions/test-code-lens';
  import { testFailurePeekExtension } from './extensions/test-failure-peek';
  import FindWidget from './FindWidget.svelte';
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
  import { gitBlameRibbonExtension } from './extensions/git-blame-ribbon';
  import { lspCodeLensExtension } from './extensions/lsp-code-lens';
  import { proactiveWarningsExtension } from './extensions/proactive-warnings';
  import { parabunSyntaxExtension } from './extensions/parabun-syntax';
  import { puiLinterExtension } from './extensions/pui-linter';
  import { overviewRulerExtension } from './extensions/overview-ruler';
  import { alwaysHScrollbar } from './extensions/always-h-scrollbar';
  import { breakpointGutterExtension } from './extensions/breakpoint-gutter';
  import { pluginLanguageDataExtension } from './extensions/plugin-language-data';
  import {
    peekPanelExtension,
    triggerPeekDefinition,
    triggerPeekReferences,
    closeAll as closeAllPeeks,
  } from './extensions/peek-panel';
  import { isRuntimeFlagEnabled } from '@e/shared';
  import EditorContextMenu from './EditorContextMenu.svelte';
  import QuickFixMenu from './QuickFixMenu.svelte';
  import AiActionResult from './AiActionResult.svelte';

  /** Add a cursor on the line above/below each existing selection, preserving column. */
  function addCursor(direction: 'up' | 'down') {
    return (view: EditorView): boolean => {
      const state = view.state;
      const ranges = state.selection.ranges;
      const newRanges: any[] = [...ranges];
      for (const r of ranges) {
        const line = state.doc.lineAt(r.head);
        const col = r.head - line.from;
        const targetLineNum = direction === 'up' ? line.number - 1 : line.number + 1;
        if (targetLineNum < 1 || targetLineNum > state.doc.lines) continue;
        const targetLine = state.doc.line(targetLineNum);
        const newHead = targetLine.from + Math.min(col, targetLine.length);
        newRanges.push(EditorSelection.cursor(newHead));
      }
      if (newRanges.length === ranges.length) return false;
      view.dispatch({
        selection: EditorSelection.create(newRanges, state.selection.mainIndex),
        scrollIntoView: true,
      });
      return true;
    };
  }

  /** Lazy-load vim keybindings when e_vim_mode flag is enabled */
  async function loadVimExtension(): Promise<any | null> {
    try {
      if (!isRuntimeFlagEnabled('e_vim_mode', settingsStore.featureFlags)) return null;
      // Dynamic import — package is optional, silently skipped if not installed
      const modName = '@replit/codemirror-vim';
      const mod = await import(/* @vite-ignore */ modName);
      return mod.vim();
    } catch {
      return null;
    }
  }

  let { tab } = $props<{ tab: EditorTab }>();

  let container: HTMLDivElement;
  let view = $state<EditorView | null>(null);
  // LYK-982 find/replace overlay state. Cmd+F opens find-only; Cmd+Alt+F
  // opens with replace; both are intercepted before CM6's search panel
  // would have run so the bare panel never shows.
  let findOpen = $state(false);
  let findReplaceMode = $state(false);
  let currentTabId = tab.id;
  let currentLang = tab.language;
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
    // Plugin-contributed snippets (LYK-1037) — merged in alongside the
    // user-imported set; plugin authors don't have to ship a UI to
    // install them.
    const fromPlugins = settingsStore
      .pluginSnippetsFor(lang)
      .map((s) =>
        snippetCompletion(s.body, { label: s.prefix, detail: s.description, type: 'snippet' }),
      );
    return { from: word?.from ?? ctx.pos, options: [...builtIn, ...custom, ...fromPlugins] };
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
      // LYK-1015: click-to-run icons next to test() / it() / describe()
      // / bench() call sites. Routes through pluginTestDiscoveryStore +
      // api.plugins.runTests when discovery is available.
      ...testActionsGutterExtension(),
      // LYK-1018: file-level synthetic code lens summarising test
      // results above the first line of any .test./.spec. file.
      ...testCodeLensExtension(),
      // LYK-1017: inline assertion-diff peek under each failed test.
      ...testFailurePeekExtension(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      // Plugin-contributed language data (LYK-1034) — commentTokens +
      // closeBrackets.brackets for the active tab's language. Returns
      // [] when no plugin contributed for this language, so the
      // unconditional include is cheap.
      pluginLanguageDataExtension(tab.language),
      // Plugin-contributed inline completions (LYK-1050). Ghost text +
      // Tab-to-accept; no-op when no plugin contributed.
      pluginInlineCompletionsExtension(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      eEditorTheme,
      eSyntaxHighlighting,
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        // LYK-982: take Cmd+F / Cmd+Alt+F off CM6's bare search panel
        // and route them to our overlay instead. Returning true tells
        // CM the binding was handled so searchKeymap's bindings below
        // don't also fire.
        {
          key: 'Mod-f',
          run: () => {
            findReplaceMode = false;
            findOpen = true;
            return true;
          },
        },
        {
          key: 'Mod-Alt-f',
          run: () => {
            findReplaceMode = true;
            findOpen = true;
            return true;
          },
        },
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...lintKeymap,
        indentWithTab,
        { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
        { key: 'Mod-Shift-l', run: selectSelectionMatches, preventDefault: true },
        { key: 'Mod-Alt-ArrowDown', run: addCursor('down'), preventDefault: true },
        { key: 'Mod-Alt-ArrowUp', run: addCursor('up'), preventDefault: true },
        { key: 'Ctrl-Shift-[', run: foldAll },
        { key: 'Ctrl-Shift-]', run: unfoldAll },
        { key: 'Mod-.', run: triggerQuickFix, preventDefault: true },
        {
          key: 'Alt-F12',
          run: (v) => triggerPeekDefinition(v, tab.language),
          preventDefault: true,
        },
        {
          key: 'Shift-F12',
          run: (v) => triggerPeekReferences(v, tab.language),
          preventDefault: true,
        },
        {
          // Close any open peek panels; only consume Esc when one actually
          // exists so other handlers (search, completion, vim) still run.
          key: 'Escape',
          run: (v) => {
            if (!document.querySelector('.cm-peek-panel.cm-peek-open')) return false;
            closeAllPeeks(v);
            return true;
          },
        },
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
          // Plugin completions are aggregated server-side; one HTTP call
          // returns every contributing plugin's items (LYK-1049).
          pluginCompletionSource(),
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
      // Plugin-supplied command-based hovers — stacked alongside the LSP card.
      pluginHoverExtension(),
      // Popover DAG diagrams (module deps in Phase 1; reactive/component/call
      // graphs land in follow-up phases). Runs alongside lsp-hover; CM6
      // stacks both tooltips for the same hover.
      graphPopoverExtension(settingsStore.workspacePath || ''),
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
      // Right-edge overview ruler: whole-file diagnostic marks, click to jump
      overviewRulerExtension(),
      // Always show the horizontal scrollbar so it doesn't flicker as long
      // lines scroll in/out of the viewport
      alwaysHScrollbar,
      // Merge conflict inline resolution (only when content has conflict markers)
      ...(hasConflictMarkers(tab.content)
        ? mergeConflictExtension({ onResolve: handleConflictResolve })
        : []),
      // LSP Code Lens (reference counts above functions, when connected and enabled)
      ...(lspStore.isConnected(tab.language) && settingsStore.showCodeLens
        ? lspCodeLensExtension(tab.language)
        : []),
      // Git blame — two visual modes (settings.blameDisplayMode):
      //   'caret' = inline annotation at end of caret line(s)
      //   'ribbon' = colored band on the right edge with sticky author labels
      ...(settingsStore.showInlineBlame && tab.filePath
        ? settingsStore.blameDisplayMode === 'ribbon'
          ? [gitBlameRibbonExtension(tab.filePath, settingsStore.workspacePath || '')]
          : gitBlameExtension(tab.filePath, settingsStore.workspacePath || '')
        : []),
      // Proactive AI warnings (LLM-powered code review, when enabled)
      ...(settingsStore.proactiveWarningsEnabled && tab.filePath
        ? proactiveWarningsExtension(tab.filePath, tab.language)
        : []),
      // Scroll lens moved to canvas-renderer/CanvasEditor.svelte
      // Parabun syntax decoration for .pts / .pjs files
      ...(tab.language.startsWith('parabun-') ? parabunSyntaxExtension() : []),
      // `.pui` diagnostics — compile the buffer via the designer toolchain and
      // surface errors/warnings as lint (no language server needed).
      ...(tab.language === 'pui' ? puiLinterExtension(tab.fileName) : []),
      // Debugger breakpoint gutter — click to toggle, persists across sessions
      ...(tab.filePath ? [breakpointGutterExtension(tab.filePath)] : []),
      // Peek panel — Alt+F12 opens an inline block widget with the definition
      peekPanelExtension(),
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
    const vimExt = await loadVimExtension();

    const extensions = createExtensions(langSupport);
    if (vimExt) extensions.unshift(vimExt);

    const state = EditorState.create({
      doc: tab.content,
      extensions,
    });

    view = new EditorView({
      state,
      parent: container,
    });

    currentTabId = tab.id;
    currentLang = tab.language;

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

  // React to tab changes (and to a language change on the same tab — e.g. a file
  // reopened after its extension gained support, so the CM mode re-loads).
  $effect(() => {
    if ((tab.id !== currentTabId || tab.language !== currentLang) && container) {
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
  <FindWidget {view} bind:open={findOpen} bind:replaceMode={findReplaceMode} />
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
