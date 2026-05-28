<script lang="ts">
  import { onMount } from 'svelte';
  import {
    EditorView,
    keymap,
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
  import { eEditorTheme, eSyntaxHighlighting } from '../e-cm-theme';
  import { loadLanguage } from '../language-map';
  import { editorStore, type EditorTab } from '$lib/stores/editor.svelte';
  import { symbolStore } from '$lib/stores/symbols.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { lspStore } from '$lib/stores/lsp.svelte';
  import { gotoDefinitionExtension } from '../extensions/goto-definition';
  import { lspCompletionSource } from '../extensions/lsp-completions';
  import { pluginCompletionSource } from '../extensions/plugin-completions';
  import { lspDiagnosticsExtension } from '../extensions/lsp-diagnostics';
  import { lspHoverExtension } from '../extensions/lsp-hover';
  import { pluginHoverExtension } from '../extensions/plugin-hover';
  import { fileUriField } from '../extensions/file-uri-field';
  import { hoverHighlightExtension } from '../extensions/hover-highlight';
  import {
    mergeConflictExtension,
    hasConflictMarkers,
    resolveConflictText,
    type ConflictRegion,
    type ConflictResolution,
  } from '../extensions/merge-conflict';
  import { mergeConflictsStore } from '$lib/stores/merge-conflicts.svelte';
  import { lspInlayHintsExtension } from '../extensions/lsp-inlay-hints';
  import { lspCodeLensExtension } from '../extensions/lsp-code-lens';
  import { proactiveWarningsExtension } from '../extensions/proactive-warnings';
  import {
    triggerQuickFix,
    codeActionGutterExtension,
    type QuickFixRequest,
  } from '../extensions/code-action-gutter';
  import { testStatusGutterExtension } from '../extensions/test-status-gutter';
  import { gitBlameExtension } from '../extensions/git-blame';
  import { gitBlameRibbonExtension } from '../extensions/git-blame-ribbon';
  import { pluginLanguageDataExtension } from '../extensions/plugin-language-data';
  import EditorContextMenu from '../EditorContextMenu.svelte';
  import QuickFixMenu from '../QuickFixMenu.svelte';
  import AiActionResult from '../AiActionResult.svelte';
  import { CanvasRenderer } from './core/renderer';

  let { tab } = $props<{ tab: EditorTab }>();

  let container: HTMLDivElement;
  let view: EditorView | null = null;
  let renderer = $state<CanvasRenderer | null>(null);
  let currentTabId = tab.id;
  let currentLang = tab.language;
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

  function handleConflictResolve(region: ConflictRegion, resolution: ConflictResolution) {
    if (!view) return;
    const doc = view.state.doc;
    if (resolution === 'ai-merge') {
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
          }
        });
      return;
    }
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
    // Plugin-contributed snippets (LYK-1037).
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
    return p.startsWith('file://') ? p : `file://${p}`;
  }

  function createExtensions(languageSupport?: any) {
    const ec = tab.editorConfig;
    const exts = [
      fileUriField.init(() => fileUri()),
      // No lineNumbers() — canvas draws them
      // No highlightActiveLine() — canvas draws it
      // No highlightActiveLineGutter() — canvas draws it
      highlightSpecialChars(),
      history(),
      foldGutter(),
      ...testStatusGutterExtension(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      // Plugin-contributed language data (LYK-1034).
      pluginLanguageDataExtension(tab.language),
      rectangularSelection(),
      crosshairCursor(),
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
          pluginCompletionSource(),
          snippetSource,
        ],
      }),
      EditorView.updateListener.of((update) => {
        if (updatingFromStore) return;
        if (update.docChanged) {
          const content = update.state.doc.toString();
          editorStore.updateContent(tab.id, content);
          symbolStore.requestParse(tab.id, content, tab.language);
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
      gotoDefinitionExtension(tab.id, tab.language),
      lspHoverExtension(tab.language, tab.id),
      pluginHoverExtension(),
      hoverHighlightExtension(),
      ...(lspStore.isConnected(tab.language) ? [lspDiagnosticsExtension(tab.language)] : []),
      ...(lspStore.isConnected(tab.language) && settingsStore.showInlayHints
        ? lspInlayHintsExtension(tab.language)
        : []),
      ...codeActionGutterExtension(handleQuickFixRequest),
      ...(hasConflictMarkers(tab.content)
        ? mergeConflictExtension({ onResolve: handleConflictResolve })
        : []),
      ...(lspStore.isConnected(tab.language) && settingsStore.showCodeLens
        ? lspCodeLensExtension(tab.language)
        : []),
      // Blame: caret-line inline OR right-edge author-coloured ribbon.
      // See settings.svelte.ts `blameDisplayMode` for the picker.
      ...(settingsStore.showInlineBlame && tab.filePath
        ? settingsStore.blameDisplayMode === 'ribbon'
          ? [gitBlameRibbonExtension(tab.filePath, settingsStore.workspacePath || '')]
          : gitBlameExtension(tab.filePath, settingsStore.workspacePath || '')
        : []),
      ...(settingsStore.proactiveWarningsEnabled && tab.filePath
        ? proactiveWarningsExtension(tab.filePath, tab.language)
        : []),
    ];

    if (languageSupport) {
      exts.push(languageSupport);
    }

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
    currentLang = tab.language;

    // Create or update the canvas renderer (injects canvas into CM scroller)
    if (renderer) {
      renderer.setView(view);
    } else {
      renderer = new CanvasRenderer(view);
      renderer.zoomAlign = settingsStore.scrollRendererAlign;
      renderer.start();
    }

    symbolStore.parseFull(tab.id, tab.content, tab.language);

    if (!lspStore.isConnected(tab.language)) {
      lspStore.ensureConnection(tab.language, settingsStore.workspacePath);
    }
    if (lspStore.isConnected(tab.language)) {
      lspStore.sendDidOpen(tab.language, tab.filePath, tab.content, tab.language);
    }
  }

  // React to tab changes (and to a language change on the same tab, so the CM
  // mode re-loads when a reopened file's detected language changes).
  $effect(() => {
    if ((tab.id !== currentTabId || tab.language !== currentLang) && container) {
      initEditor();
    }
  });

  // Reinitialize editor when LSP connects
  let wasLspConnected = false;
  $effect(() => {
    const connected = lspStore.isConnected(tab.language);
    if (connected && !wasLspConnected && view) {
      wasLspConnected = connected;
      initEditor();
    }
    wasLspConnected = connected;
  });

  // Sync content from store → editor
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

  // Handle pending goto-definition scroll
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

  // Follow Along
  $effect(() => {
    const faTarget = editorStore.followAlongTarget;
    const editorView = view;
    const tabId = currentTabId;

    if (faTarget && faTarget.filePath === tab.filePath && editorView && tabId === tab.id) {
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

  // Theme change → re-resolve canvas colors
  $effect(() => {
    const _theme = settingsStore.theme;
    const _fontSize = settingsStore.fontSize;
    if (renderer) {
      renderer.onThemeChange();
    }
  });

  // Zoom alignment
  $effect(() => {
    if (renderer) {
      renderer.zoomAlign = settingsStore.scrollRendererAlign;
    }
  });

  onMount(() => {
    console.log('[CanvasEditor] mounted, container:', !!container);
    lspStore.loadServerInfo();
    initEditor();
    return () => {
      if (lspStore.isConnected(tab.language)) {
        lspStore.sendDidClose(tab.language, tab.filePath);
      }
      if (renderer) {
        renderer.destroy();
        renderer = null;
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
