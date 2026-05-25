// In-browser `.pui` compiler for the visual designer (LYK-970).
//
// `.pui` is a Svelte superset (Para syntax: signal/derived/effect, |>, match,
// pure, ..!, …). The canonical toolchain is @lyku/para-preprocess (which wraps
// para-transpile) → run as a Svelte preprocessor → svelte/compiler. Both run in
// the browser (the Svelte REPL does the same), so the designer can compile the
// live editor buffer with no server round-trip.
//
// This module produces compiled JS/CSS + diagnostics. Mounting the result (the
// in-browser eval/import-resolution harness) is a separate slice.
import { compile, preprocess } from 'svelte/compiler';
import { parabunPreprocess } from '@lyku/para-preprocess';

export interface PuiDiagnostic {
  message: string;
  line?: number;
  column?: number;
  code?: string;
}

export interface PuiCompileResult {
  ok: boolean;
  /** Compiled client-side JS (when ok). */
  js?: string;
  /** Scoped component CSS (when ok). */
  css?: string;
  /** Non-fatal compiler warnings. */
  warnings: PuiDiagnostic[];
  /** The fatal preprocess/compile error, if any. */
  error?: PuiDiagnostic;
}

function toDiagnostic(e: unknown): PuiDiagnostic {
  const err = e as {
    message?: string;
    start?: { line?: number; column?: number };
    position?: [number, number];
    code?: string;
  };
  return {
    message: err?.message ?? String(e),
    line: err?.start?.line,
    column: err?.start?.column,
    code: err?.code,
  };
}

/**
 * Compile a `.pui` source string to client JS + CSS, with diagnostics.
 * Never throws — failures come back as `{ ok: false, error }`.
 */
export async function compilePui(
  source: string,
  filename = 'Component.pui',
): Promise<PuiCompileResult> {
  try {
    const processed = await preprocess(source, parabunPreprocess(), { filename });
    const { js, css, warnings } = compile(processed.code, {
      filename,
      generate: 'client',
      dev: false,
      runes: true,
    });
    return {
      ok: true,
      js: js.code,
      css: css?.code,
      warnings: (warnings ?? []).map(toDiagnostic),
    };
  } catch (e) {
    return { ok: false, warnings: [], error: toDiagnostic(e) };
  }
}
