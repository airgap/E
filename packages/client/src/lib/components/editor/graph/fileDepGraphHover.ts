/**
 * fileDepGraphHover — Svelte action that shows the FILE dependency graph
 * (module-deps) in a hover popover anchored to its target.
 *
 * The module-deps graph used to appear (alongside reactive/component/etc.
 * graphs) when hovering code in the editor. It now belongs to the *file* as a
 * whole, so it's surfaced only from file-level affordances:
 *   - a pane tab        -> popover below the tab   (placement: 'below')
 *   - a file-list row   -> popover to its right    (placement: 'right')
 *
 * The graph is whole-file (every import), so no cursor context is needed — we
 * just feed the file path + its current content to moduleDepsProvider.
 */
import { mount, unmount } from 'svelte';
import { moduleDepsProvider } from './providers/module-deps';
import RelationGraphView from './RelationGraphView.svelte';
import type { RelationNode } from './types';
import { settingsStore } from '$lib/stores/settings.svelte';
import { editorStore } from '$lib/stores/editor.svelte';
import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
import { api } from '$lib/api/client';
import { detectLanguage } from '$lib/utils/detect-language';

export interface FileDepGraphHoverParams {
  /** Absolute file path. Empty/missing -> the action is a no-op (e.g. a chat
   *  tab or a directory row). */
  filePath?: string;
  placement: 'below' | 'right';
}

const OPEN_DELAY = 350;
const CLOSE_DELAY = 180;

export function fileDepGraphHover(node: HTMLElement, params: FileDepGraphHoverParams) {
  let p = params;
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let popover: HTMLElement | null = null;
  let mounted: ReturnType<typeof mount> | null = null;
  let token = 0; // invalidates in-flight async opens

  // Prefer the live (possibly unsaved) buffer; fall back to disk.
  async function resolveDoc(filePath: string): Promise<string | null> {
    const live = editorStore.tabs.find((t) => t.filePath === filePath)?.content;
    if (typeof live === 'string') return live;
    try {
      const res = await api.files.read(filePath);
      return res.data?.content ?? null;
    } catch {
      return null;
    }
  }

  function tearDown() {
    if (mounted) {
      try {
        unmount(mounted);
      } catch {
        /* already gone */
      }
      mounted = null;
    }
    if (popover) {
      popover.remove();
      popover = null;
    }
  }

  function place(el: HTMLElement) {
    const r = node.getBoundingClientRect();
    const gap = 6;
    el.style.position = 'fixed';
    el.style.zIndex = '9999';
    if (p.placement === 'right') {
      el.style.left = `${r.right + gap}px`;
      el.style.top = `${r.top}px`;
    } else {
      el.style.left = `${r.left}px`;
      el.style.top = `${r.bottom + gap}px`;
    }
    // Clamp inside the viewport once it has a measured size.
    requestAnimationFrame(() => {
      if (!el.isConnected) return;
      const pr = el.getBoundingClientRect();
      if (pr.right > window.innerWidth - 8)
        el.style.left = `${Math.max(8, window.innerWidth - 8 - pr.width)}px`;
      if (pr.bottom > window.innerHeight - 8)
        el.style.top = `${Math.max(8, window.innerHeight - 8 - pr.height)}px`;
    });
  }

  function navigate(n: RelationNode) {
    const fp = n.navigate?.filePath;
    if (!fp) return;
    api.files
      .read(fp)
      .then((res) => {
        const name = fp.split('/').pop() ?? fp;
        primaryPaneStore.openFileTab(fp, res.data.content, detectLanguage(name));
      })
      .catch(() => {});
    closeNow();
  }

  async function open() {
    if (popover) return;
    const filePath = p.filePath;
    if (!filePath || !moduleDepsProvider.supports({ filePath } as never)) return;
    const my = ++token;
    const doc = await resolveDoc(filePath);
    if (my !== token || doc == null) return;
    const graph = await moduleDepsProvider.build({
      filePath,
      workspacePath: settingsStore.workspacePath || '',
      doc,
      pos: 0,
      line: 0,
      column: 0,
    });
    if (my !== token || !graph) return; // superseded or nothing to show

    const el = document.createElement('div');
    el.className = 'file-dep-graph-popover';
    el.addEventListener('mouseenter', cancelClose);
    el.addEventListener('mouseleave', scheduleClose);
    document.body.appendChild(el);
    popover = el;
    mounted = mount(RelationGraphView, {
      target: el,
      props: { graph, onNavigate: navigate },
    });
    place(el);
  }

  function scheduleOpen() {
    cancelClose();
    if (openTimer || popover) return;
    openTimer = setTimeout(() => {
      openTimer = null;
      void open();
    }, OPEN_DELAY);
  }
  function scheduleClose() {
    if (openTimer) {
      clearTimeout(openTimer);
      openTimer = null;
    }
    if (closeTimer) return;
    closeTimer = setTimeout(() => {
      closeTimer = null;
      closeNow();
    }, CLOSE_DELAY);
  }
  function cancelClose() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  }
  function closeNow() {
    token++; // cancel any in-flight open
    tearDown();
  }

  node.addEventListener('mouseenter', scheduleOpen);
  node.addEventListener('mouseleave', scheduleClose);

  return {
    update(next: FileDepGraphHoverParams) {
      p = next;
    },
    destroy() {
      node.removeEventListener('mouseenter', scheduleOpen);
      node.removeEventListener('mouseleave', scheduleClose);
      if (openTimer) clearTimeout(openTimer);
      if (closeTimer) clearTimeout(closeTimer);
      closeNow();
    },
  };
}
