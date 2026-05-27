<script lang="ts">
  /**
   * DocsPanel — workspace-scoped WYSIWYG markdown editor (Tiptap).
   *
   * Layout: collapsible doc list at the top, editor pane fills the rest.
   * `content` round-trips as markdown (canonical persisted form) via
   * tiptap-markdown; Tiptap's editor model is the in-memory representation.
   *
   * Autosave: debounced 600ms after the last keystroke. Title edits also
   * autosave. The save indicator surfaces save state for honesty about what
   * has and hasn't been persisted.
   */
  import { onMount, onDestroy, tick } from 'svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { api } from '$lib/api/client';
  import type { Document } from '@e/shared';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import { Markdown } from 'tiptap-markdown';

  let workspacePath = $derived(workspaceStore.activeWorkspace?.workspacePath);

  let docs = $state<Document[]>([]);
  let activeId = $state<string | null>(null);
  let activeDoc = $derived(docs.find((d) => d.id === activeId) ?? null);
  let titleDraft = $state('');
  let loading = $state(false);
  let saveState = $state<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  let saveError = $state<string | null>(null);

  let editorEl = $state<HTMLDivElement | null>(null);
  let editor: Editor | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Suppress autosave while we're programmatically loading content into the
   *  editor — otherwise switching docs would immediately re-save the old
   *  content to the newly-selected doc. */
  let loadingIntoEditor = false;

  $effect(() => {
    if (workspacePath) loadDocs(workspacePath);
    else {
      docs = [];
      activeId = null;
    }
  });

  $effect(() => {
    // Keep titleDraft in sync when the active doc changes (or its title
    // changes from elsewhere).
    if (activeDoc) titleDraft = activeDoc.title;
    else titleDraft = '';
  });

  async function loadDocs(ws: string) {
    loading = true;
    try {
      const res = await api.docs.list(ws);
      if (res.ok) {
        docs = res.data;
        // Keep the previously-active doc selected if it's still present.
        if (activeId && !docs.find((d) => d.id === activeId)) activeId = null;
      }
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    if (!editorEl) return;
    editor = new Editor({
      element: editorEl,
      extensions: [StarterKit, Markdown.configure({ html: false, breaks: true })],
      content: '',
      editorProps: {
        attributes: {
          class: 'docs-prose',
          spellcheck: 'false',
        },
      },
      onUpdate: () => {
        if (loadingIntoEditor) return;
        scheduleSave();
      },
    });
  });

  onDestroy(() => {
    if (saveTimer) clearTimeout(saveTimer);
    editor?.destroy();
    editor = null;
  });

  // When the active doc changes, swap the editor's content. We use
  // setContent so an undo doesn't bring the previous doc's text back.
  $effect(() => {
    if (!editor) return;
    const doc = activeDoc;
    if (!doc) {
      loadingIntoEditor = true;
      editor.commands.clearContent();
      loadingIntoEditor = false;
      return;
    }
    loadingIntoEditor = true;
    // tiptap-markdown registers a `setContent` markdown parser; passing a
    // string tells it to parse as markdown if html option is false.
    editor.commands.setContent(doc.content || '', false);
    loadingIntoEditor = false;
    saveState = 'idle';
    saveError = null;
  });

  function scheduleSave() {
    if (!activeId) return;
    saveState = 'dirty';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => doSave(), 600);
  }

  async function doSave() {
    if (!activeId || !editor) return;
    const id = activeId;
    saveState = 'saving';
    saveError = null;
    // tiptap-markdown exposes editor.storage.markdown.getMarkdown().
    const md = (editor.storage as any).markdown?.getMarkdown?.() ?? '';
    try {
      const res = await api.docs.update(id, { content: md, title: titleDraft });
      if (res.ok) {
        // Reflect the persisted doc locally without a full reload.
        const idx = docs.findIndex((d) => d.id === id);
        if (idx >= 0) docs[idx] = res.data;
        saveState = 'saved';
        // Drop "saved" badge after a moment so it doesn't linger.
        setTimeout(() => {
          if (saveState === 'saved') saveState = 'idle';
        }, 1200);
      } else {
        saveState = 'error';
        saveError = 'Save failed';
      }
    } catch (err) {
      saveState = 'error';
      saveError = err instanceof Error ? err.message : String(err);
    }
  }

  async function createDoc() {
    if (!workspacePath) return;
    const res = await api.docs.create({
      workspacePath,
      title: 'Untitled',
      content: '',
    });
    if (res.ok) {
      docs = [res.data, ...docs];
      activeId = res.data.id;
      await tick();
      editor?.commands.focus();
    }
  }

  async function deleteDoc(id: string) {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    const res = await api.docs.delete(id);
    if (res.ok) {
      docs = docs.filter((d) => d.id !== id);
      if (activeId === id) activeId = null;
    }
  }

  function selectDoc(id: string) {
    // Flush a pending autosave before switching so we don't lose the last
    // keystrokes of the outgoing doc.
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      doSave();
    }
    activeId = id;
  }

  function onTitleInput() {
    if (!activeId) return;
    scheduleSave();
  }
</script>

<div class="docs-panel">
  <header class="docs-header">
    <h2>Docs</h2>
    <button class="new-btn" onclick={createDoc} disabled={!workspacePath} title="New document">
      + New
    </button>
  </header>

  <ul class="doc-list" class:empty={docs.length === 0}>
    {#if loading && docs.length === 0}
      <li class="hint">Loading…</li>
    {:else if !workspacePath}
      <li class="hint">Open a workspace to see docs.</li>
    {:else if docs.length === 0}
      <li class="hint">No docs yet. Click <strong>+ New</strong> to start one.</li>
    {:else}
      {#each docs as doc (doc.id)}
        <li class="doc-item" class:active={doc.id === activeId}>
          <button
            class="doc-select"
            onclick={() => selectDoc(doc.id)}
            title={new Date(doc.updatedAt).toLocaleString()}
          >
            <span class="doc-title">{doc.title || 'Untitled'}</span>
          </button>
          <button class="doc-del" onclick={() => deleteDoc(doc.id)} title="Delete">×</button>
        </li>
      {/each}
    {/if}
  </ul>

  <div class="editor-pane" class:has-doc={!!activeDoc}>
    {#if activeDoc}
      <div class="title-row">
        <input
          class="title-input"
          bind:value={titleDraft}
          oninput={onTitleInput}
          placeholder="Untitled"
        />
        <span class="save-state" data-state={saveState}>
          {#if saveState === 'saving'}
            saving…
          {:else if saveState === 'saved'}
            saved
          {:else if saveState === 'dirty'}
            unsaved
          {:else if saveState === 'error'}
            error: {saveError ?? 'unknown'}
          {/if}
        </span>
      </div>
    {/if}
    <div bind:this={editorEl} class="editor" class:visible={!!activeDoc}></div>
    {#if !activeDoc && workspacePath}
      <div class="empty-state">Select a doc on the left, or create a new one.</div>
    {/if}
  </div>
</div>

<style>
  .docs-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg-primary, #1e1e1e);
    color: var(--fg-primary, #d4d4d4);
  }

  .docs-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
    flex-shrink: 0;
  }

  .docs-header h2 {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
    margin: 0;
    color: var(--fg-secondary, #aaa);
  }

  .new-btn {
    background: var(--accent-bg, #0e639c);
    color: white;
    border: none;
    padding: 0.25rem 0.6rem;
    border-radius: 3px;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .new-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .new-btn:hover:not(:disabled) {
    background: var(--accent-bg-hover, #1177bb);
  }

  .doc-list {
    list-style: none;
    margin: 0;
    padding: 0.25rem 0;
    max-height: 30vh;
    overflow-y: auto;
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
    flex-shrink: 0;
  }
  .doc-list.empty {
    padding: 0.5rem 0.75rem;
  }
  .doc-list .hint {
    padding: 0.5rem 0.75rem;
    font-size: 0.8rem;
    color: var(--fg-tertiary, #888);
  }

  .doc-item {
    display: flex;
    align-items: center;
    padding: 0 0.25rem 0 0.75rem;
  }
  .doc-item.active {
    background: var(--bg-selected, rgba(255, 255, 255, 0.08));
  }
  .doc-item:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.04));
  }

  .doc-select {
    flex: 1;
    text-align: left;
    background: transparent;
    border: none;
    color: inherit;
    padding: 0.35rem 0;
    cursor: pointer;
    overflow: hidden;
  }
  .doc-title {
    display: block;
    font-size: 0.85rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .doc-del {
    background: transparent;
    border: none;
    color: var(--fg-tertiary, #888);
    cursor: pointer;
    padding: 0 0.4rem;
    font-size: 1rem;
    line-height: 1;
    opacity: 0;
  }
  .doc-item:hover .doc-del {
    opacity: 1;
  }
  .doc-del:hover {
    color: var(--fg-danger, #e06c75);
  }

  .editor-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem 0.25rem;
    flex-shrink: 0;
  }

  .title-input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--fg-primary, #d4d4d4);
    font-size: 1.05rem;
    font-weight: 600;
    padding: 0.25rem 0;
    outline: none;
  }
  .title-input:focus {
    border-bottom: 1px solid var(--accent-bg, #0e639c);
  }

  .save-state {
    font-size: 0.7rem;
    color: var(--fg-tertiary, #888);
    white-space: nowrap;
  }
  .save-state[data-state='error'] {
    color: var(--fg-danger, #e06c75);
  }
  .save-state[data-state='saved'] {
    color: var(--fg-success, #98c379);
  }

  .editor {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem 0.75rem 1rem;
    display: none;
  }
  .editor.visible {
    display: block;
  }

  .empty-state {
    padding: 2rem 1rem;
    text-align: center;
    color: var(--fg-tertiary, #888);
    font-size: 0.85rem;
  }

  /* Tiptap ProseMirror surface styling — keep it close to the rendered
     markdown in MessageBubble so the editor preview matches what readers
     of the saved doc would see. */
  :global(.docs-prose) {
    outline: none;
    min-height: 200px;
    font-size: 0.95rem;
    line-height: 1.6;
  }
  /* Modular scale: 1.25 ratio, base = body 0.95rem.
     h1=2x, h2=1.6x, h3=1.3x, h4=1.1x, h5=1x, h6=0.85x. h1/h2 are top-of-doc
     so they get extra top margin; h3-h6 are subsection so they get less. */
  :global(.docs-prose h1) {
    font-size: 1.9rem;
    font-weight: 700;
    line-height: 1.2;
    margin: 1.4rem 0 0.6rem;
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
    padding-bottom: 0.3rem;
  }
  :global(.docs-prose h2) {
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.25;
    margin: 1.2rem 0 0.5rem;
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
    padding-bottom: 0.2rem;
  }
  :global(.docs-prose h3) {
    font-size: 1.2rem;
    font-weight: 700;
    line-height: 1.3;
    margin: 1rem 0 0.4rem;
  }
  :global(.docs-prose h4) {
    font-size: 1.05rem;
    font-weight: 600;
    line-height: 1.35;
    margin: 0.9rem 0 0.3rem;
  }
  :global(.docs-prose h5) {
    font-size: 0.95rem;
    font-weight: 600;
    line-height: 1.4;
    margin: 0.8rem 0 0.25rem;
    color: var(--fg-secondary, #aaa);
  }
  :global(.docs-prose h6) {
    font-size: 0.85rem;
    font-weight: 600;
    line-height: 1.4;
    margin: 0.7rem 0 0.2rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-tertiary, #888);
  }
  :global(.docs-prose p) {
    margin: 0.6rem 0;
  }
  :global(.docs-prose ul, .docs-prose ol) {
    padding-left: 1.5rem;
    margin: 0.5rem 0;
  }
  :global(.docs-prose li) {
    margin: 0.2rem 0;
  }
  :global(.docs-prose code) {
    background: var(--bg-code, rgba(255, 255, 255, 0.08));
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    font-family: 'JetBrains Mono', 'Monaco', monospace;
    font-size: 0.85em;
  }
  :global(.docs-prose pre) {
    background: var(--bg-code-block, rgba(255, 255, 255, 0.04));
    padding: 0.75rem 1rem;
    border-radius: 4px;
    overflow-x: auto;
    margin: 0.75rem 0;
  }
  :global(.docs-prose pre code) {
    background: transparent;
    padding: 0;
  }
  :global(.docs-prose blockquote) {
    border-left: 3px solid var(--accent-bg, #0e639c);
    padding-left: 0.75rem;
    margin: 0.75rem 0;
    color: var(--fg-secondary, #aaa);
  }
  :global(.docs-prose a) {
    color: var(--accent-fg, #4ec1f5);
    text-decoration: underline;
  }
  :global(.docs-prose hr) {
    border: none;
    border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
    margin: 1rem 0;
  }
</style>
