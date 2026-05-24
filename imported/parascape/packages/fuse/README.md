# @lyku/fuse

Array-method **chain fusion** for JavaScript and TypeScript. Collapses
chains of `Array.prototype` methods into a single `for`-loop, killing
the intermediate arrays each `.map()` / `.filter()` would otherwise
allocate.

```js
// in
const out = items.map(toRow).filter(isActive).map(toLabel);

// out (one pass, no intermediate arrays)
const out = ((__src) => {
	const __out = [];
	for (let __i = 0; __i < __src.length; __i++) {
		let __x = __src[__i];
		__x = toRow(__x, __i, __src);
		if (!isActive(__x, __i, __src)) continue;
		__x = toLabel(__x, __i, __src);
		__out.push(__x);
	}
	return __out;
})(items);
```

## Why

Neither V8 nor JSC fuses array-method chains. Every `.map()` /
`.filter()` is a real library call that allocates a full intermediate
array, which immediately becomes garbage. A 3-stage chain over a 2M
array throws away ~48MB. Fusion does the whole thing in one pass with
no intermediates.

This is **not** lazy evaluation (RxJS / Lazy.js) and **not** a runtime
wrapper — it's a compile-time source transform, so there's zero
runtime library and the output is plain JS the engine optimizes
normally.

### Benchmark

`map → filter → map → reduce` over 2,000,000 elements, median of 20
runs (`node bench.mjs`):

| runtime   | native chain | fused  | speedup  |
| --------- | ------------ | ------ | -------- |
| V8 (Node) | 29.4 ms      | 5.8 ms | **5.1×** |
| JSC (Bun) | 14.5 ms      | 2.4 ms | **6.0×** |

The win scales with array size — it's the eliminated intermediate
allocations (and the GC that follows them), not loop overhead. On
small arrays (< ~1k) the difference is in the noise; this is an
optimization for data-heavy hot paths, not a blanket rewrite.

## Usage

### Vite plugin

```js
import fuse from '@lyku/fuse/vite-plugin';

export default {
	plugins: [fuse()],
};
```

Runs over `.js / .ts / .jsx / .tsx / .pts / .ptsx` by default, skipping
`node_modules`. Options: `{ include?: RegExp, exclude?: RegExp }`.

### Programmatic

```js
import { lowerFusion, findFusableChains } from '@lyku/fuse';

lowerFusion(src); // → transformed source string
findFusableChains(src); // → [{ start, end, original, fused }, …]
```

`findFusableChains` reports without rewriting — for editors and
tooltips that want to show "this chain fuses to …".

## What fuses

- **Transform stages** (any number, in any order): `map`, `filter`
- **Terminal stages** (at most one, at the end): `forEach`, `reduce`,
  `some`, `every`, `find`, `findIndex`

A chain of two or more of these fuses. `xs.map(f).filter(g).sort()`
fuses the `map`/`filter` and leaves `.sort()` running on the result.

## What doesn't (on purpose)

- `flatMap` — would need a nested loop; breaks the linear model.
- `sort` / `reverse` / `slice` / `concat` / etc. — not per-element;
  they terminate the fusable prefix.
- Single-stage chains (`xs.map(f)`) — nothing to fuse.
- Arrow-parameter inlining — callbacks pass through verbatim. Modern
  engines inline small one-call-site arrows, so `((x) => x*2)(v)`
  becomes `v*2` in the JIT anyway. Source-level substitution is
  bug-prone (shadowing) for marginal gain.

## Caveats

- **No sourcemaps yet.** The transform reshapes line structure; a
  faithful map needs per-token tracking. Output is correct, debugging
  line numbers aren't.
- **`this` in callbacks.** A non-arrow callback that relies on `this`
  from the call site (`xs.map(this.fn)`) still works — it's invoked as
  `(this.fn)(x, i, src)` — but `this` inside is `undefined`, same as
  native `.map` without a `thisArg`. Pass `thisArg`? Not fused.
- **Side effects in stages** are preserved in order. Fusion changes
  _when_ nothing — each element still flows through the stages
  left-to-right; it only changes _where_ the intermediates live (a
  register instead of an array).

## License

MIT
