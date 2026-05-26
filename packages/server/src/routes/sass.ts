// Compiled-CSS preview for SCSS/Sass (the "see the output" analog for a
// preprocessor that has no debugger). Compiles the editor buffer on demand with
// Dart Sass, resolving @use/@import relative to the file's directory.
import { Hono } from 'hono';
import * as sass from 'sass';
import { dirname } from 'path';
import { pathToFileURL } from 'url';

const app = new Hono();

app.post('/compile', async (c) => {
  let body: { source?: string; path?: string; indented?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid JSON body' }, 400);
  }
  const { source, path, indented } = body;
  if (typeof source !== 'string') {
    return c.json({ ok: false, error: 'source (string) required' }, 400);
  }
  try {
    const result = sass.compileString(source, {
      syntax: indented ? 'indented' : 'scss',
      // Resolve relative @use/@import from the file's own directory.
      loadPaths: path ? [dirname(path)] : [],
      url: path ? pathToFileURL(path) : undefined,
    });
    return c.json({ ok: true, data: { css: result.css } });
  } catch (e) {
    // Dart Sass throws a formatted error (message includes line/column + snippet).
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

export const sassRoutes = app;
