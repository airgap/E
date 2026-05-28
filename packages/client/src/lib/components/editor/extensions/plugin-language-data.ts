/**
 * Plugin-contributed language-data extension (LYK-1034).
 *
 * Pushes a plugin-provided language-configuration into the editor's
 * language-data facet so CM6's built-in commands (toggleComment,
 * closeBrackets) pick up the plugin's commentTokens and autoClosingPairs
 * without us having to fork those commands.
 *
 * Scope is per-tab — the editor passes its tab.language; this returns
 * an extension that contributes the language data unconditionally
 * (callers should drop the extension from the EditorState when the
 * active language changes, which the editors already do via a fresh
 * createExtensions call on tab switch).
 *
 * Only `commentTokens` and `closeBrackets` are wired in v1 — the
 * remaining VS Code language-configuration fields (brackets,
 * surroundingPairs, indentationRules, onEnterRules, wordPattern,
 * folding) are stored but not consumed yet; they plug in as the matching
 * CM6 extensions land. Plugin authors can ship the full file today and
 * trust the hooks to attach silently as we grow them.
 */

import { EditorState, type Extension } from '@codemirror/state';
import { settingsStore } from '$lib/stores/settings.svelte';

interface NormalizedPair {
  open: string;
  close: string;
}

function normalizePairs(
  raw: Array<{ open: string; close: string } | [string, string]> | undefined,
): NormalizedPair[] {
  if (!raw) return [];
  const out: NormalizedPair[] = [];
  for (const p of raw) {
    if (Array.isArray(p)) {
      if (typeof p[0] === 'string' && typeof p[1] === 'string') {
        out.push({ open: p[0], close: p[1] });
      }
    } else if (
      p &&
      typeof p === 'object' &&
      typeof p.open === 'string' &&
      typeof p.close === 'string'
    ) {
      out.push({ open: p.open, close: p.close });
    }
  }
  return out;
}

/**
 * Return a CM6 extension that contributes the plugin's language-data for
 * `language` into the editor's languageData facet. Returns the empty
 * extension list when no plugin has registered for that language —
 * caller can include the result unconditionally without an if-check.
 */
export function pluginLanguageDataExtension(language: string): Extension {
  const cfg = settingsStore.languageConfigFor(language);
  if (!cfg) return [];

  const commentTokens: { line?: string; block?: { open: string; close: string } } = {};
  if (cfg.comments?.lineComment) commentTokens.line = cfg.comments.lineComment;
  if (cfg.comments?.blockComment && cfg.comments.blockComment.length === 2) {
    commentTokens.block = {
      open: cfg.comments.blockComment[0],
      close: cfg.comments.blockComment[1],
    };
  }

  const pairs = normalizePairs(cfg.autoClosingPairs);
  // CM6 closeBrackets reads `closeBrackets.brackets` (open chars only)
  // from language data. Plugins can declare richer open/close pairs but
  // for v1 we only honour single-char opens — CM6's built-in matches
  // by char and infers the close, so multi-char open strings would need
  // a different extension hook.
  const closeBrackets = {
    brackets: pairs.filter((p) => p.open.length === 1).map((p) => p.open),
  };

  return EditorState.languageData.of(() => {
    const data: Record<string, unknown> = {};
    if (Object.keys(commentTokens).length > 0) data.commentTokens = commentTokens;
    if (closeBrackets.brackets.length > 0) data.closeBrackets = closeBrackets;
    return [data];
  });
}
