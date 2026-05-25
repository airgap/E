// `.pui` diagnostics for the CM6 code view (LYK-968).
//
// Reuses the designer's in-browser compiler (`compilePui`) as the lint source:
// preprocess (@lyku/para-preprocess) → svelte/compiler, surfaced as CodeMirror
// lint diagnostics (squiggles + gutter + the lint panel). No language server —
// the same toolchain the live preview uses, run on the editor buffer.
//
// Caveat: positions come from the compiled (post-preprocess) output, so they're
// best-effort — a Para transform earlier in the file can shift a line. Markup
// errors (the common case) line up; deep script-transform errors may be off by a
// line. The message is always exact.
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import type { Text } from '@codemirror/state';
import { compilePui, type PuiDiagnostic } from '$lib/designer/pui-compile';

/**
 * Map a `.pui` compiler diagnostic (1-based line / 0-based column) to a CM6
 * lint Diagnostic over `doc`. Exported + pure so the offset math is testable.
 * Clamps to doc bounds; with no position, marks the first line so the diagnostic
 * is never silently dropped.
 */
export function puiDiagnosticToCm(
  doc: Text,
  d: PuiDiagnostic,
  severity: 'error' | 'warning',
): Diagnostic {
  let from = 0;
  let to = Math.min(doc.length, doc.line(1).to);
  if (d.line && d.line >= 1 && d.line <= doc.lines) {
    const line = doc.line(d.line);
    const col = Math.max(0, d.column ?? 0);
    from = Math.min(line.from + col, line.to);
    to = line.to;
    if (to <= from) to = Math.min(doc.length, from + 1);
  }
  return { from, to, severity, message: d.message, source: 'pui' };
}

export function puiLinterExtension(filename = 'Component.pui') {
  return [
    linter(
      async (view): Promise<Diagnostic[]> => {
        const result = await compilePui(view.state.doc.toString(), filename);
        const diags: Diagnostic[] = [];
        if (result.error) diags.push(puiDiagnosticToCm(view.state.doc, result.error, 'error'));
        for (const w of result.warnings)
          diags.push(puiDiagnosticToCm(view.state.doc, w, 'warning'));
        return diags;
      },
      { delay: 400 },
    ),
    lintGutter(),
  ];
}
