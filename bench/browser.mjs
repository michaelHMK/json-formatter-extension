// Optional browser check: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node bench/browser.mjs [repo] [--verify]
// Uses a local HTTP server; extension installation/i18n are outside this benchmark.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] || '.');
const verify = process.argv.includes('--verify');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = createServer(async (request, response) => {
  try {
    const file = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!file.startsWith(root + '/')) throw new Error('Invalid path');
    const data = await readFile(file);
    response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' })[extname(file)] || 'application/octet-stream');
    response.end(data);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const rows = [];
const settled = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

try {
  for (const size of [20000, 50000]) {
    await page.goto(base + '/formatter.html');
    const data = Array(size).fill('ordinary');
    data[size - 1] = 'needle';
    await page.locator('#input').fill(JSON.stringify(data));
    await page.locator('#view-tree').click();
    await page.waitForFunction(() => !document.querySelector('#tree').hidden && document.querySelectorAll('#tree .entry').length > 0);
    await settled();
    await page.evaluate(() => {
      window.started = performance.now();
      const input = document.querySelector('#search');
      input.value = 'needle';
      input.dispatchEvent(new Event('input'));
    });
    await page.waitForFunction(() => document.querySelector('#match-info').textContent.includes('/'));
    await settled();
    const result = await page.evaluate(() => ({
      elapsedMs: +(performance.now() - window.started).toFixed(1),
      entries: document.querySelectorAll('#tree .entry').length,
      highlights: document.querySelectorAll('#tree .highlight').length,
      current: document.querySelector('.highlight.current')?.textContent,
    }));
    rows.push({ scenario: `search-${size} (includes 300ms debounce)`, ...result });
    if (verify) {
      assert.equal(result.highlights, 1);
      assert.match(result.current, /needle/);
      assert.ok(result.entries <= 202);
      await page.locator('#tree .more').first().click();
      assert.equal(await page.locator('#tree .entry').count(), 402);
      assert.equal(await page.locator('#tree .highlight').count(), 1);
    }
    await page.locator('#btn-clear').click();
    assert.equal(await page.locator('#tree .entry').count(), 0);
  }

  await page.goto(base + '/compare.html');
  const data = Array(20000).fill('ordinary');
  await page.locator('#input-left').fill(JSON.stringify(data));
  data[data.length - 1] = 'changed';
  await page.locator('#input-right').fill(JSON.stringify(data));
  await page.evaluate(() => { window.started = performance.now(); document.querySelector('#btn-compare').click(); });
  await page.waitForFunction(() => !document.querySelector('#result').hidden);
  await settled();
  const result = await page.evaluate(() => ({
    elapsedMs: +(performance.now() - window.started).toFixed(1),
    entries: document.querySelectorAll('#struct-view .entry').length,
    current: document.querySelectorAll('#struct-view .entry.current').length,
  }));
  rows.push({ scenario: 'compare-20000-one-change', ...result });
  if (verify) {
    assert.equal(result.current, 2);
    assert.equal(result.entries, 404);
    await page.locator('#only-diff').check();
    assert.equal(await page.locator('#struct-view .entry').count(), 4);
    await page.locator('#view-text').click();
    await page.waitForFunction(() => document.querySelectorAll('.tline').length > 0);
    assert.equal(await page.locator('.tline.del').count(), 1);
    assert.equal(await page.locator('.tline.add').count(), 1);
    await page.locator('#btn-clear').click();
    assert.equal(await page.locator('.entry').count(), 0);
    assert.equal(await page.locator('.tline').count(), 0);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: browser.version(), root: pathToFileURL(root).href, verify, results: rows }, null, 2));
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
