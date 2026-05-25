import { describe, test, expect } from 'vitest';
import { compilePui } from '../pui-compile';

// The preview compiles via @lyku/para-preprocess, which only STUBS several Para
// lowerings (the parabun runtime does them natively). The vendored browser
// lowering chain (designer/lower) fills that gap so the preview compiles the same
// syntax the real build does. These pin that each lowering actually compiles.
describe('compilePui — Para lowering coverage', () => {
  const ok = async (src: string) => (await compilePui(src, 'T.pui')).ok;

  test('signal / derived', async () => {
    expect(
      await ok('<script>let n = signal(0); let d = derived(() => n() * 2);</script><p>{d()}</p>'),
    ).toBe(true);
  });

  test('pipeline |>', async () => {
    expect(
      await ok('<script>let x = [1, 2, 3] |> .map((v) => v + 1);</script><p>{x.length}</p>'),
    ).toBe(true);
  });

  test('match', async () => {
    expect(
      await ok("<script>let s = 'a'; let r = match s { 'a' => 1, _ => 0 };</script><p>{r}</p>"),
    ).toBe(true);
  });

  test('leading-dot placeholder lambda', async () => {
    expect(await ok('<script>let f = [1, 2].filter(.toString());</script><p>{f.length}</p>')).toBe(
      true,
    );
  });

  test('async {} block', async () => {
    expect(await ok('<script>let p = async { 1 + 1 };</script><p>ok</p>')).toBe(true);
  });

  test('still reports a genuine error', async () => {
    const r = await compilePui('{#if true}no end', 'Bad.pui');
    expect(r.ok).toBe(false);
    expect(r.error?.message).toBeTruthy();
  });
});
