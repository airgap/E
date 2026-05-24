// Benchmark: map→filter→map→reduce over a large array
const N = 2_000_000;
const data = Array.from({ length: N }, (_, i) => i);

const f = (x) => x * 2;
const g = (x) => x % 3 === 0;
const h = (x) => x + 1;

function native() {
  return data.map(f).filter(g).map(h).reduce((a, b) => a + b, 0);
}

// Fused with wrapper calls (what my lower-fusion currently emits)
function fusedWrapped() {
  let acc = 0;
  for (let i = 0; i < data.length; i++) {
    let x = data[i];
    x = f(x);
    if (!g(x)) continue;
    x = h(x);
    acc = ((a, b) => a + b)(acc, x);
  }
  return acc;
}

// Fused with inlined callback BODIES (no per-element call)
function fusedInlined() {
  let acc = 0;
  for (let i = 0; i < data.length; i++) {
    let x = data[i];
    x = x * 2;
    if (!(x % 3 === 0)) continue;
    x = x + 1;
    acc = acc + x;
  }
  return acc;
}

function time(label, fn, runs = 20) {
  // warmup
  for (let i = 0; i < 3; i++) fn();
  const samples = [];
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    const v = fn();
    samples.push(performance.now() - t0);
    if (r === 0) globalThis.__check = v;
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(runs / 2)];
  console.log(`${label.padEnd(16)} ${median.toFixed(1)}ms (median of ${runs})  → ${globalThis.__check}`);
}

console.log(`N=${N.toLocaleString()}`);
time('native chain', native);
time('fused (wrapped)', fusedWrapped);
time('fused (inlined)', fusedInlined);
