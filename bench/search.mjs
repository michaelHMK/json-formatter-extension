import { performance } from 'node:perf_hooks';

// node --expose-gc bench/search.mjs [module URL] [case]
// Heap deltas include temporary allocations awaiting GC, not peak/retained memory.
const moduleUrl = process.argv[2] || new URL('../src/core/search.js', import.meta.url).href;
const { searchData } = await import(moduleUrl);
const cases = {
  'wide-array': () => [Array.from({ length: 1_000_000 }, (_, i) => i % 997 === 0 ? 'needle' : 'value'), 'needle'],
  'wide-object': () => [Object.fromEntries(Array.from({ length: 200_000 }, (_, i) => [`field${i}`, i % 997 === 0 ? 'needle' : 'value'])), 'needle'],
  'records': () => [Array.from({ length: 100_000 }, (_, i) => ({ id: i, name: `record ${i}`, enabled: true, nested: { label: 'value' } })), 'absent'],
};

for (const [name, build] of Object.entries(cases)) {
  if (process.argv[3] && process.argv[3] !== name) continue;
  const [data, query] = build();
  for (let i = 0; i < 2; i++) searchData(data, query);
  const timings = [];
  const heapDeltas = [];
  let result;
  for (let i = 0; i < 7; i++) {
    globalThis.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    const start = performance.now();
    result = searchData(data, query);
    timings.push(performance.now() - start);
    heapDeltas.push((process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024);
  }
  timings.sort((a, b) => a - b);
  heapDeltas.sort((a, b) => a - b);
  console.log(JSON.stringify({
    name, medianMs: +timings[3].toFixed(2),
    medianHeapDeltaMiB: +heapDeltas[3].toFixed(2),
    matches: result.matchCount, highlights: result.highlights.length,
    node: process.version,
  }));
}
