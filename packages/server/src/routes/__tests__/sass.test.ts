import { describe, test, expect } from 'bun:test';
import { sassRoutes as app } from '../sass';

const compile = (body: unknown) =>
  app.request('/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /sass/compile', () => {
  test('compiles SCSS (nesting + variables + arithmetic) to CSS', async () => {
    const res = await compile({
      source: '$c: red;\n.a { color: $c; .b { width: 1px + 2px; } }',
      path: '/tmp/x.scss',
      indented: false,
    });
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.css).toContain('color: red');
    expect(json.data.css).toContain('.a .b'); // nesting flattened
    expect(json.data.css).toContain('width: 3px'); // arithmetic evaluated
  });

  test('compiles indented .sass syntax', async () => {
    const res = await compile({
      source: '.a\n  color: blue',
      path: '/tmp/x.sass',
      indented: true,
    });
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.css).toContain('color: blue');
  });

  test('returns the Sass error (not a throw) on invalid input', async () => {
    const res = await compile({ source: '.a { color: ', path: '/tmp/x.scss' });
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(typeof json.error).toBe('string');
    expect(json.error.length).toBeGreaterThan(0);
  });

  test('requires a source string', async () => {
    const res = await compile({ path: '/tmp/x.scss' });
    expect(res.status).toBe(400);
  });
});
