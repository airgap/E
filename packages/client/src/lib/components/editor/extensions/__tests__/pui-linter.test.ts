import { describe, test, expect } from 'vitest';
import { Text } from '@codemirror/state';
import { puiDiagnosticToCm } from '../pui-linter';
import { compilePui } from '$lib/designer/pui-compile';

const doc = (s: string) => Text.of(s.split('\n'));

describe('puiDiagnosticToCm', () => {
  const d = doc('line one\nsecond line\nthird');

  test('maps 1-based line / 0-based column to a doc offset', () => {
    const cm = puiDiagnosticToCm(d, { message: 'oops', line: 2, column: 3 }, 'error');
    const line2 = d.line(2);
    expect(cm.from).toBe(line2.from + 3);
    expect(cm.to).toBe(line2.to);
    expect(cm.severity).toBe('error');
    expect(cm.message).toBe('oops');
    expect(cm.source).toBe('pui');
  });

  test('with no position, marks the first line so it is never dropped', () => {
    const cm = puiDiagnosticToCm(d, { message: 'no pos' }, 'warning');
    expect(cm.from).toBe(0);
    expect(cm.to).toBe(d.line(1).to);
    expect(cm.severity).toBe('warning');
  });

  test('clamps an out-of-range line back to the first line', () => {
    const cm = puiDiagnosticToCm(d, { message: 'x', line: 99 }, 'error');
    expect(cm.from).toBe(0);
    expect(cm.to).toBe(d.line(1).to);
  });

  test('clamps a column past the line end and keeps from <= to', () => {
    const cm = puiDiagnosticToCm(d, { message: 'x', line: 3, column: 999 }, 'error');
    const line3 = d.line(3);
    expect(cm.from).toBe(line3.to);
    expect(cm.from).toBeLessThanOrEqual(cm.to);
  });
});

describe('compilePui as the lint source', () => {
  test('a valid .pui yields no error', async () => {
    const r = await compilePui('<h1>hi {1 + 1}</h1>', 'Ok.pui');
    expect(r.ok).toBe(true);
    expect(r.error).toBeUndefined();
  });

  test('a broken .pui yields an error a diagnostic can be built from', async () => {
    const src = '{#if true}no end';
    const r = await compilePui(src, 'Bad.pui');
    expect(r.ok).toBe(false);
    expect(r.error?.message).toBeTruthy();
    // Whatever position it reports, the mapping must produce in-bounds offsets.
    const d = doc(src);
    const cm = puiDiagnosticToCm(d, r.error!, 'error');
    expect(cm.from).toBeGreaterThanOrEqual(0);
    expect(cm.to).toBeLessThanOrEqual(d.length);
    expect(cm.from).toBeLessThanOrEqual(cm.to);
  });
});
