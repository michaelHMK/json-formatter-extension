// Optional, dependency-free-in-repo browser experiment; does not modify product files.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_EXECUTABLE=/path/to/chromium node bench/text-rendering.mjs
// BENCH_TRIALS=3 controls repetitions. Times include a forced browser layout.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const trials = Number(process.env.BENCH_TRIALS || 3);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE,
  args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
});
const scenarios = [
  { name: 'pretty-20000-lines', count: 20000, kind: 'pretty' },
  { name: 'pretty-100000-lines', count: 100000, kind: 'pretty' },
  { name: 'single-line-5MiB', count: 5 * 1024 * 1024, kind: 'single' },
  { name: 'diff-50000-rows', count: 50000, kind: 'diff' },
];
const results = [];
try {
  for (const scenario of scenarios) {
    const variants = scenario.kind === 'diff' ? ['diff-dom', 'virtual-lines']
      : ['pre', 'textarea', 'virtual-lines', 'virtual-window'];
    for (const variant of variants) {
      const samples = [];
      for (let trial = 0; trial < trials; trial++) {
        const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
        await page.setContent('<!doctype html><style>body{margin:0}#host{width:800px;height:500px}pre,textarea,.viewport{box-sizing:border-box;display:block;width:100%;height:100%;margin:0;padding:0;border:0;font:13px/21px monospace;white-space:pre;overflow:auto;resize:none}.viewport{position:relative}.row{height:21px;white-space:pre}.del{background:#fee}.add{background:#efe}.layer{position:absolute;top:0;left:0}</style><div id="host"></div>');
        const value = await page.evaluate(async ({ scenario, variant }) => {
          const { kind, count } = scenario;
          // ASCII fixtures deliberately isolate layout cost. Horizontal clipping
          // here is a prototype, not a complete Unicode/tab-aware implementation.
          const text = kind === 'single' ? '"' + 'abcdefghijklmnopqrstuvwxyz012345'.repeat(Math.ceil(count / 32)).slice(0, count - 2) + '"'
            : Array.from({ length: count }, (_, i) => `  {"id":${i},"name":"Record ${i}","active":true,"payload":"abcdefghijklmnopqrstuvwxyz0123456789"},`).join('\n');
          // Flatten a possible rope before the measured render starts.
          text.charCodeAt(text.length - 1);
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          globalThis.gc?.();
          const heapBefore = performance.memory?.usedJSHeapSize;
          const host = document.getElementById('host');
          let viewport;
          let lineStarts;
          let maxLineLength = 0;
          let refresh = () => {};
          const started = performance.now();
          let indexMs = 0;
          if (variant.startsWith('virtual')) {
            const indexStarted = performance.now();
            let lineCount = 1;
            for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) lineCount++;
            lineStarts = new Uint32Array(lineCount + 1);
            let line = 1;
            for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) lineStarts[line++] = at + 1;
            lineStarts[lineCount] = text.length + 1;
            for (let i = 0; i < lineCount; i++) maxLineLength = Math.max(maxLineLength, lineStarts[i + 1] - lineStarts[i] - 1);
            indexMs = performance.now() - indexStarted;
            viewport = document.createElement('div');
            viewport.className = 'viewport';
            const spacer = document.createElement('div');
            spacer.style.height = `${lineCount * 21}px`;
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            context.font = '13px monospace';
            const characterWidth = context.measureText('M').width;
            const maxWidth = maxLineLength * characterWidth;
            spacer.style.width = `${maxWidth}px`;
            viewport.appendChild(spacer);
            const layer = document.createElement('div');
            layer.className = 'layer';
            viewport.appendChild(layer);
            refresh = () => {
              const start = Math.max(0, Math.floor(viewport.scrollTop / 21) - 10);
              const end = Math.min(lineCount, start + 46);
              const horizontal = variant === 'virtual-window';
              const column = horizontal ? Math.max(0, Math.floor(viewport.scrollLeft / characterWidth) - 10) : 0;
              const lastColumn = horizontal ? column + 140 : Infinity;
              layer.style.transform = `translate(${column * characterWidth}px,${start * 21}px)`;
              const fragment = document.createDocumentFragment();
              for (let i = start; i < end; i++) {
                const div = document.createElement('div');
                div.className = 'row' + (kind === 'diff' ? (i % 2 ? ' add' : ' del') : '');
                const begin = lineStarts[i];
                const finish = lineStarts[i + 1] - 1;
                div.textContent = text.slice(Math.min(finish, begin + column), Math.min(finish, begin + lastColumn));
                fragment.appendChild(div);
              }
              layer.replaceChildren(fragment);
            };
            viewport.addEventListener('scroll', refresh);
            refresh();
          } else if (variant === 'textarea') {
            viewport = document.createElement('textarea');
            viewport.readOnly = true;
            viewport.wrap = 'off';
            viewport.value = text;
          } else {
            viewport = document.createElement('pre');
            if (variant === 'diff-dom') {
              const fragment = document.createDocumentFragment();
              for (const [i, line] of text.split('\n').entries()) {
                const div = document.createElement('div');
                div.className = 'row' + (i % 2 ? ' add' : ' del');
                div.textContent = line;
                fragment.appendChild(div);
              }
              viewport.appendChild(fragment);
            } else viewport.textContent = text;
          }
          host.appendChild(viewport);
          const assignedMs = performance.now() - started;
          const scrollHeight = viewport.scrollHeight;
          const scrollWidth = viewport.scrollWidth;
          const layoutMs = performance.now() - started;
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const frameMs = performance.now() - started;
          const scrollStarted = performance.now();
          viewport.scrollTop = Math.floor((scrollHeight - viewport.clientHeight) / 2);
          viewport.scrollLeft = kind === 'single' ? Math.floor((scrollWidth - viewport.clientWidth) / 2) : 0;
          refresh();
          viewport.getBoundingClientRect();
          const scrollSyncMs = performance.now() - scrollStarted;
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const scrollFrameMs = performance.now() - scrollStarted;
          const heapAfter = performance.memory?.usedJSHeapSize;
          return {
            bytes: text.length,
            indexMs,
            assignedMs,
            layoutMs,
            frameMs,
            scrollSyncMs,
            scrollFrameMs,
            jsHeapDeltaMiB: (heapAfter - heapBefore) / 1048576,
            elements: host.querySelectorAll('*').length,
            renderedCharacters: viewport.tagName === 'TEXTAREA' ? viewport.value.length : viewport.textContent.length,
            scrollHeight,
            scrollWidth,
            indexBytes: lineStarts?.byteLength || 0,
          };
        }, { scenario, variant });
        if (variant.startsWith('virtual')) assert.ok(value.elements <= 49);
        samples.push(value);
        await page.close();
      }
      const median = (field) => {
        const sorted = samples.map((sample) => sample[field]).sort((a, b) => a - b);
        return Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100;
      };
      const result = { scenario: scenario.name, variant, trials, ...Object.fromEntries(Object.keys(samples[0]).map((field) => [field, median(field)])) };
      results.push(result);
      console.error(JSON.stringify(result));
    }
  }
  console.log(JSON.stringify({ browser: browser.version(), note: 'Synthetic ASCII layout experiment; JS heap is not total browser memory. virtual-window is a horizontal-clipping prototype.', results }, null, 2));
} finally {
  await browser.close();
}
