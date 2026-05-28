/**
 * plugin-hover.ts — CM6 hoverTooltip extension that surfaces hover
 * markdown produced by command-source hover contributions declared by
 * installed plugins. POSTs the file URI + 0-indexed line/col to the
 * server; the server runs every matching plugin binary and returns its
 * stdout as markdown.
 *
 * Rendered as plain text inside a sandboxed wrapper — we deliberately
 * do NOT render markdown HTML here, to avoid plugin-supplied scripts
 * executing in the parent. Plugins that want richer formatting should
 * use a primary pane.
 */
import { hoverTooltip, type Tooltip } from '@codemirror/view';
import { fileUriField } from './file-uri-field';

interface PluginHoverResult {
  markdown: string;
  source: string;
}

function pathFromUri(uri: string): string {
  return uri.startsWith('file://') ? uri.slice(7) : uri;
}

export function pluginHoverExtension() {
  return hoverTooltip(
    async (view, pos): Promise<Tooltip | null> => {
      const uri = view.state.field(fileUriField, false);
      if (!uri) return null;
      const path = pathFromUri(uri);
      const lineObj = view.state.doc.lineAt(pos);
      const line = lineObj.number - 1;
      const character = pos - lineObj.from;

      let json: any;
      try {
        const res = await fetch('/api/plugins/hover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, line, character }),
        });
        if (!res.ok) return null;
        json = await res.json();
      } catch {
        return null;
      }
      const results: PluginHoverResult[] = json?.data?.results ?? [];
      if (results.length === 0) return null;

      return {
        pos,
        above: true,
        create: () => {
          const dom = document.createElement('div');
          dom.className = 'cm-plugin-hover-tooltip';
          dom.setAttribute('role', 'tooltip');
          dom.style.maxWidth = '480px';
          dom.style.maxHeight = '320px';
          dom.style.overflow = 'auto';
          dom.style.padding = '6px 8px';
          dom.style.font = '12px var(--font-mono, ui-monospace, monospace)';
          for (const r of results) {
            const section = document.createElement('section');
            section.style.marginBottom = '6px';
            const head = document.createElement('div');
            head.textContent = r.source;
            head.style.fontSize = '10px';
            head.style.textTransform = 'uppercase';
            head.style.letterSpacing = '0.04em';
            head.style.opacity = '0.6';
            head.style.marginBottom = '2px';
            const body = document.createElement('pre');
            // Plain text — no markdown HTML. The plugin's stdout is
            // displayed verbatim; CSS handles wrap. We never set
            // innerHTML here, so a malicious plugin can't inject script
            // tags into the parent DOM.
            body.textContent = r.markdown;
            body.style.margin = '0';
            body.style.whiteSpace = 'pre-wrap';
            body.style.wordBreak = 'break-word';
            section.appendChild(head);
            section.appendChild(body);
            dom.appendChild(section);
          }
          return { dom };
        },
      };
    },
    { hoverTime: 300 },
  );
}
