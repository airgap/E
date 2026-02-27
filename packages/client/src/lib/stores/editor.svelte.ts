import { api } from '$lib/api/client';
import { uiStore } from './ui.svelte';
import { settingsStore } from './settings.svelte';
import { lspStore } from './lsp.svelte';
import { uuid } from '$lib/utils/uuid';
import type { EditorConfigProps } from '@e/shared';

const FOLLOW_ALONG_KEY = 'e-follow-along';

function loadFollowAlong(): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    const raw = localStorage.getItem(FOLLOW_ALONG_KEY);
    if (raw !== null) return JSON.parse(raw);
  } catch {}
  return true;
}

function persistFollowAlong(enabled: boolean) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(FOLLOW_ALONG_KEY, JSON.stringify(enabled));
  } catch {}
}

export interface EditorTab {
  id: string;
  filePath: string;
  fileName: string;
  language: string;
  content: string;
  originalContent: string;
  cursorLine: number;
  cursorCol: number;
  scrollTop: number;
  scrollLeft: number;
  editorConfig?: EditorConfigProps;
  /** Set to 'diff' for git diff tabs — renders diffContent instead of code editor */
  kind?: 'file' | 'diff';
  /** Raw unified diff string, only used when kind === 'diff' */
  diffContent?: string;
  /** Whether this tab is pinned (sorts left, cannot be closed without unpinning first) */
  pinned?: boolean;
}

export type LayoutMode = 'chat-only' | 'editor-only' | 'split-horizontal';

export function detectLanguage(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    c: 'cpp',
    h: 'cpp',
    cpp: 'cpp',
    cc: 'cpp',
    hpp: 'cpp',
    css: 'css',
    scss: 'css',
    html: 'html',
    htm: 'html',
    svelte: 'svelte',
    vue: 'html',
    json: 'json',
    md: 'markdown',
    mdx: 'markdown',
    xml: 'xml',
    svg: 'xml',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    txt: 'text',
  };
  return map[ext] || 'text';
}

export function applyEditorConfig(content: string, config: EditorConfigProps): string {
  let result = content;

  // Normalize line endings
  if (config.end_of_line === 'crlf') {
    result = result.replace(/\r\n|\r|\n/g, '\r\n');
  } else if (config.end_of_line === 'cr') {
    result = result.replace(/\r\n|\r|\n/g, '\r');
  } else if (config.end_of_line === 'lf') {
    result = result.replace(/\r\n|\r|\n/g, '\n');
  }

  // Trim trailing whitespace
  if (config.trim_trailing_whitespace) {
    const eol = config.end_of_line === 'crlf' ? '\r\n' : config.end_of_line === 'cr' ? '\r' : '\n';
    result = result
      .split(/\r\n|\r|\n/)
      .map((line) => line.replace(/[\t ]+$/, ''))
      .join(eol);
  }

  // Insert final newline
  if (config.insert_final_newline) {
    const eol = config.end_of_line === 'crlf' ? '\r\n' : config.end_of_line === 'cr' ? '\r' : '\n';
    if (result.length > 0 && !result.endsWith(eol)) {
      result += eol;
    }
  }

  return result;
}

// ── Format on save helpers ──

/** Apply LSP TextEdits to content string. Edits applied in reverse order. */
function applyTextEdits(
  content: string,
  edits: Array<{
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    newText: string;
  }>,
): string {
  if (!edits || edits.length === 0) return content;
  const lines = content.split('\n');

  // Sort edits in reverse to apply from bottom to top
  const sorted = [...edits].sort((a, b) => {
    const lineDiff = b.range.start.line - a.range.start.line;
    return lineDiff !== 0 ? lineDiff : b.range.start.character - a.range.start.character;
  });

  for (const edit of sorted) {
    const { start, end } = edit.range;
    // Convert line:character to offset
    let fromOffset = 0;
    for (let i = 0; i < start.line && i < lines.length; i++) {
      fromOffset += lines[i].length + 1;
    }
    fromOffset += Math.min(start.character, lines[start.line]?.length ?? 0);

    let toOffset = 0;
    for (let i = 0; i < end.line && i < lines.length; i++) {
      toOffset += lines[i].length + 1;
    }
    toOffset += Math.min(end.character, lines[end.line]?.length ?? 0);

    content = content.slice(0, fromOffset) + edit.newText + content.slice(toOffset);
  }

  return content;
}

interface EditorTabLike {
  filePath: string;
  language: string;
  editorConfig?: EditorConfigProps | null;
}

/** Try LSP formatting first, then fall back to external formatter. */
async function formatContent(tab: EditorTabLike, content: string): Promise<string> {
  const language = tab.language;
  const pref = settingsStore.defaultFormatter;

  // Try LSP first (unless explicitly set to 'external')
  if (pref !== 'external' && lspStore.isConnected(language)) {
    try {
      const tabSize = tab.editorConfig?.tab_width ?? tab.editorConfig?.indent_size ?? 2;
      const insertSpaces = tab.editorConfig?.indent_style !== 'tab';
      const edits = await lspStore.formatDocument(language, tab.filePath, {
        tabSize,
        insertSpaces,
      });
      if (edits.length > 0) {
        return applyTextEdits(content, edits);
      }
    } catch {
      // LSP formatting failed — try external
    }
  }

  // Try external formatter (unless explicitly set to 'lsp')
  if (pref !== 'lsp') {
    try {
      // Write current content first so the external formatter has it
      await api.files.write(tab.filePath, content);
      const resp = await api.format.format(tab.filePath, language, settingsStore.workspacePath);
      if (resp.data?.formatted) {
        // Re-read the file after formatting
        const readResp = await api.files.read(tab.filePath);
        return readResp.data.content;
      }
    } catch {
      // External formatting failed — use original content
    }
  }

  return content;
}

/** Organize imports via LSP. */
async function organizeImportsContent(tab: EditorTabLike, content: string): Promise<string> {
  const language = tab.language;
  if (!lspStore.isConnected(language)) return content;

  try {
    const edits = await lspStore.organizeImports(language, tab.filePath);
    if (edits.length > 0) {
      return applyTextEdits(content, edits);
    }
  } catch {
    // Organize imports failed — non-fatal
  }

  return content;
}

function createEditorStore() {
  let tabs = $state<EditorTab[]>([]);
  let activeTabId = $state<string | null>(null);
  let layoutMode = $state<LayoutMode>('chat-only');
  let splitRatio = $state(0.5);
  let previewTabId = $state<string | null>(null);
  let pendingGoTo = $state<{ line: number; col: number } | null>(null);
  let followAlong = $state(loadFollowAlong());
  /** Set when Follow Along detects a file edit — CodeEditor scrolls to this line after content sync. */
  let followAlongTarget = $state<{ filePath: string; line: number } | null>(null);

  const activeTab = $derived(tabs.find((t) => t.id === activeTabId) ?? null);
  const dirtyTabs = $derived(tabs.filter((t) => t.content !== t.originalContent));
  const hasOpenTabs = $derived(tabs.length > 0);

  function isDirty(tabId: string): boolean {
    const tab = tabs.find((t) => t.id === tabId);
    return tab ? tab.content !== tab.originalContent : false;
  }

  return {
    get tabs() {
      return tabs;
    },
    get activeTabId() {
      return activeTabId;
    },
    get activeTab() {
      return activeTab;
    },
    get layoutMode() {
      return layoutMode;
    },
    get splitRatio() {
      return splitRatio;
    },
    get previewTabId() {
      return previewTabId;
    },
    get dirtyTabs() {
      return dirtyTabs;
    },
    get hasOpenTabs() {
      return hasOpenTabs;
    },
    isDirty,

    get followAlong() {
      return followAlong;
    },
    setFollowAlong(enabled: boolean) {
      followAlong = enabled;
      persistFollowAlong(enabled);
    },
    toggleFollowAlong() {
      followAlong = !followAlong;
      persistFollowAlong(followAlong);
    },

    get pendingGoTo() {
      return pendingGoTo;
    },
    consumePendingGoTo() {
      const val = pendingGoTo;
      pendingGoTo = null;
      return val;
    },
    setPendingGoTo(target: { line: number; col: number }) {
      pendingGoTo = target;
    },

    /** Follow Along scroll target — set when an agent edits a file and Follow Along is on. */
    get followAlongTarget() {
      return followAlongTarget;
    },
    setFollowAlongTarget(target: { filePath: string; line: number } | null) {
      followAlongTarget = target;
    },
    consumeFollowAlongTarget() {
      const val = followAlongTarget;
      followAlongTarget = null;
      return val;
    },

    async openFile(filePath: string, preview = false, goTo?: { line: number; col: number }) {
      // Check if already open
      const existing = tabs.find((t) => t.filePath === filePath);
      if (existing) {
        activeTabId = existing.id;
        // If it was a preview tab and we're double-clicking, make it permanent
        if (previewTabId === existing.id && !preview) {
          previewTabId = null;
        }
        if (goTo) pendingGoTo = goTo;
        return;
      }

      // Fetch content
      let content = '';
      try {
        const res = await api.files.read(filePath);
        content = res.data.content;
      } catch (e) {
        uiStore.toast(`Failed to open file: ${e}`, 'error');
        return;
      }

      const fileName = filePath.split('/').pop() ?? filePath;
      const language = detectLanguage(fileName);
      const id = uuid();

      // Fetch editorconfig (non-blocking — don't fail the open if this errors)
      let editorConfig: EditorConfigProps | undefined;
      try {
        const ecRes = await api.files.editorConfig(filePath);
        if (ecRes.data && Object.keys(ecRes.data).length > 0) {
          editorConfig = ecRes.data;
        }
      } catch {
        // No .editorconfig or server error — that's fine
      }

      // Re-check after async gap — another openFile call for the same path
      // may have completed while we were fetching content / editorconfig.
      const raceWinner = tabs.find((t) => t.filePath === filePath);
      if (raceWinner) {
        activeTabId = raceWinner.id;
        if (previewTabId === raceWinner.id && !preview) {
          previewTabId = null;
        }
        if (goTo) pendingGoTo = goTo;
        return;
      }

      const tab: EditorTab = {
        id,
        filePath,
        fileName,
        language,
        content,
        originalContent: content,
        cursorLine: 1,
        cursorCol: 1,
        scrollTop: 0,
        scrollLeft: 0,
        editorConfig,
      };

      // If preview, replace existing preview tab
      if (preview && previewTabId) {
        const previewIdx = tabs.findIndex((t) => t.id === previewTabId);
        if (previewIdx >= 0) {
          tabs = [...tabs.slice(0, previewIdx), tab, ...tabs.slice(previewIdx + 1)];
          previewTabId = id;
          activeTabId = id;
          if (layoutMode === 'chat-only') {
            layoutMode = 'split-horizontal';
          }
          return;
        }
      }

      tabs = [...tabs, tab];
      activeTabId = id;
      if (preview) previewTabId = id;
      if (goTo) pendingGoTo = goTo;

      // Auto-switch to split mode on first tab
      if (layoutMode === 'chat-only') {
        layoutMode = 'split-horizontal';
      }
    },

    openDiffTab(filePath: string, diffContent: string, staged: boolean) {
      const fileName = `${filePath.split('/').pop() ?? filePath} (${staged ? 'staged' : 'unstaged'})`;
      // Reuse existing diff tab for the same file+staged combo
      const existing = tabs.find(
        (t) => t.kind === 'diff' && t.filePath === filePath && t.fileName === fileName,
      );
      if (existing) {
        existing.diffContent = diffContent;
        activeTabId = existing.id;
        tabs = [...tabs];
        if (layoutMode === 'chat-only') layoutMode = 'split-horizontal';
        return;
      }
      const id = uuid();
      const tab: EditorTab = {
        id,
        filePath,
        fileName,
        language: 'text',
        content: '',
        originalContent: '',
        cursorLine: 1,
        cursorCol: 1,
        scrollTop: 0,
        scrollLeft: 0,
        kind: 'diff',
        diffContent,
      };
      tabs = [...tabs, tab];
      activeTabId = id;
      if (layoutMode === 'chat-only') layoutMode = 'split-horizontal';
    },

    closeTab(id: string) {
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx < 0) return;

      // Prevent closing pinned tabs
      if (tabs[idx].pinned) return;

      if (previewTabId === id) previewTabId = null;

      tabs = tabs.filter((t) => t.id !== id);

      // Update active tab
      if (activeTabId === id) {
        if (tabs.length === 0) {
          activeTabId = null;
          layoutMode = 'chat-only';
        } else {
          activeTabId = tabs[Math.min(idx, tabs.length - 1)].id;
        }
      }
    },

    pinTab(id: string) {
      const tab = tabs.find((t) => t.id === id);
      if (!tab || tab.pinned) return;
      tab.pinned = true;
      // Sort: pinned tabs first, preserve relative order within each group
      tabs = [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
    },

    unpinTab(id: string) {
      const tab = tabs.find((t) => t.id === id);
      if (!tab || !tab.pinned) return;
      tab.pinned = false;
      tabs = [...tabs];
    },

    isTabPinned(id: string): boolean {
      return tabs.find((t) => t.id === id)?.pinned ?? false;
    },

    async saveFile(id: string) {
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return;
      try {
        let content = tab.content;

        // 1. Format on save (LSP or external)
        if (settingsStore.formatOnSave) {
          content = await formatContent(tab, content);
        }

        // 2. Organize imports on save
        if (settingsStore.organizeImportsOnSave) {
          content = await organizeImportsContent(tab, content);
        }

        // 3. Apply editorconfig rules before saving
        if (tab.editorConfig) {
          content = applyEditorConfig(content, tab.editorConfig);
        }

        // Update the tab content if formatting changed it
        if (content !== tab.content) {
          tab.content = content;
        }

        await api.files.write(tab.filePath, tab.content);
        tab.originalContent = tab.content;
        tabs = [...tabs]; // trigger reactivity
        uiStore.toast(`Saved ${tab.fileName}`, 'success', 2000);
      } catch (e) {
        uiStore.toast(`Failed to save: ${e}`, 'error');
      }
    },

    updateContent(id: string, content: string) {
      const tab = tabs.find((t) => t.id === id);
      if (tab) {
        tab.content = content;
        tabs = [...tabs];
      }
    },

    setCursorPosition(id: string, line: number, col: number) {
      const tab = tabs.find((t) => t.id === id);
      if (tab) {
        tab.cursorLine = line;
        tab.cursorCol = col;
      }
    },

    setScrollPosition(id: string, top: number, left: number) {
      const tab = tabs.find((t) => t.id === id);
      if (tab) {
        tab.scrollTop = top;
        tab.scrollLeft = left;
      }
    },

    setActiveTab(id: string) {
      activeTabId = id;
    },

    setLayoutMode(mode: LayoutMode) {
      layoutMode = mode;
    },

    setSplitRatio(ratio: number) {
      splitRatio = Math.max(0.15, Math.min(0.85, ratio));
    },

    async refreshFile(filePath: string) {
      const tab = tabs.find((t) => t.filePath === filePath);
      if (!tab) return;
      try {
        const res = await api.files.read(filePath);
        const newContent = res.data.content;
        // If user hasn't modified, just update both
        if (tab.content === tab.originalContent) {
          tab.content = newContent;
          tab.originalContent = newContent;
        } else {
          // File changed externally while user has local edits — update original only
          tab.originalContent = newContent;
        }
        tabs = [...tabs];
      } catch {
        // File may have been deleted
      }
    },

    reorderTab(fromIndex: number, toIndex: number) {
      const newTabs = [...tabs];
      const [moved] = newTabs.splice(fromIndex, 1);
      newTabs.splice(toIndex, 0, moved);
      tabs = newTabs;
    },

    cycleTab(direction: 1 | -1) {
      if (tabs.length < 2) return;
      const currentIdx = tabs.findIndex((t) => t.id === activeTabId);
      const next = (currentIdx + direction + tabs.length) % tabs.length;
      activeTabId = tabs[next].id;
    },

    activateTabByIndex(index: number) {
      if (index >= 0 && index < tabs.length) {
        activeTabId = tabs[index].id;
      }
    },

    restoreState(state: {
      tabs: EditorTab[];
      activeTabId: string | null;
      layoutMode: LayoutMode;
      splitRatio: number;
      previewTabId: string | null;
    }) {
      // Deduplicate tabs by filePath (keep first occurrence)
      const seen = new Set<string>();
      tabs = state.tabs.filter((t) => {
        if (seen.has(t.filePath)) return false;
        seen.add(t.filePath);
        return true;
      });
      activeTabId = state.activeTabId;
      layoutMode = state.layoutMode;
      splitRatio = state.splitRatio;
      previewTabId = state.previewTabId;
    },
  };
}

export const editorStore = createEditorStore();
