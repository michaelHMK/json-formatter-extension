// Regenerate existing promo PNGs and real extension screenshots, without image editing.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
// CHROMIUM_EXECUTABLE=/path/to/full/chromium node store-assets/generate.mjs
// Omit either variable to use locally importable Playwright / its full Chromium channel.
// Extension loading requires full Chromium, not chrome-headless-shell.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assets = dirname(fileURLToPath(import.meta.url));
const root = resolve(assets, '..');
const executablePath = process.env.CHROMIUM_EXECUTABLE;
const output = [];

async function capture(page, name, width, height) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.mouse.move(0, 0);
  const path = join(assets, name);
  await page.screenshot({ path, animations: 'disabled', caret: 'hide' });
  const png = await readFile(path);
  assert.equal(png.readUInt32BE(16), width, `${name}: width`);
  assert.equal(png.readUInt32BE(20), height, `${name}: height`);
  output.push({ file: name, width, height });
}

for (const [locale, directory] of [['en-US', 'en'], ['zh-CN', 'zh_CN']]) {
  const brand = directory === 'zh_CN' ? 'JSON 工具箱' : 'JSON Toolbox';
  const profile = await mkdtemp(join(tmpdir(), 'json-toolbox-store-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      ...(executablePath ? { executablePath } : { channel: 'chromium' }),
      headless: true,
      locale,
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      env: { ...process.env, LANG: locale.replace('-', '_') + '.UTF-8', LANGUAGE: locale.replace('-', '_') },
      args: [`--lang=${locale}`, `--disable-extensions-except=${root}`, `--load-extension=${root}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10000 });
    const extensionId = new URL(worker.url()).hostname;
    const base = `chrome-extension://${extensionId}`;
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const promos = directory === 'en' ? [
      ['promo.svg', 'promo-440x280.png', 440, 280],
      ['promo-1400x560.svg', 'promo-1400x560.png', 1400, 560],
    ] : [
      ['zh_CN/promo-440x280.svg', 'zh_CN/promo-440x280.png', 440, 280],
      ['zh_CN/promo-1400x560.svg', 'zh_CN/promo-1400x560.png', 1400, 560],
    ];
    for (const [svg, png, width, height] of promos) {
      await page.setViewportSize({ width, height });
      await page.goto(pathToFileURL(join(assets, svg)).href);
      await capture(page, png, width, height);
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto(base + '/formatter.html');
    const branding = await page.evaluate(() => ({
      language: chrome.i18n.getUILanguage(),
      extensionName: chrome.i18n.getMessage('extName'),
      appName: document.querySelector('.brand-name').textContent,
    }));
    assert.equal(branding.language, locale);
    assert.equal(branding.extensionName, brand);
    assert.equal(branding.appName, brand);
    await page.locator('#btn-sample').click();
    await page.waitForFunction(() => document.querySelector('#busy').hidden && document.querySelector('#output-text').textContent);
    assert.equal(JSON.parse(await page.locator('#input').inputValue()).name, brand);
    const formatterData = {
      project: brand, version: 1, local: true,
      features: directory === 'en' ? ['Format', 'Search', 'Compare'] : ['格式化', '搜索', '对比'],
      limits: { ads: 0, tracking: null }, users: ['Alex', 'Sam'],
    };
    await page.locator('#input').fill(JSON.stringify(formatterData, null, 2));
    await page.locator('#btn-format').click();
    await page.waitForFunction(() => document.querySelector('#busy').hidden && document.querySelector('#status').textContent);
    await page.locator('#view-tree').click();
    await page.waitForSelector('#tree.virtual-tree');
    await page.locator('#level-select').selectOption('3');
    await page.locator('h1').click();
    assert.equal(await page.locator('#error').isVisible(), false);
    await capture(page, `${directory}/01-formatter-tree.png`, 1280, 800);

    await page.goto(base + '/compare.html');
    const left = {
      version: 1,
      users: [{ id: 1, name: 'Alex', role: 'admin' }, { id: 2, name: 'Sam', role: 'user' }],
      updatedAt: '2026-11-01',
    };
    const right = {
      version: 2,
      users: [{ id: 2, name: 'Sam', role: 'admin' }, { id: 3, name: 'Lee', role: 'user' }],
      updatedAt: '2026-11-03',
    };
    await page.locator('#input-left').fill(JSON.stringify(left, null, 2));
    await page.locator('#input-right').fill(JSON.stringify(right, null, 2));
    await page.locator('#input-left').press('Control+Home');
    await page.locator('#input-right').press('Control+Home');
    await page.locator('#array-mode').selectOption('key');
    await page.locator('#key-field').fill('id');
    await page.locator('#ignore-paths').fill('updatedAt');
    await page.locator('#btn-compare').click();
    await page.waitForFunction(() => !document.querySelector('#result').hidden && document.querySelector('#busy').hidden);
    await page.locator('h1').click();
    assert.equal(await page.locator('#error').isVisible(), false);
    await capture(page, `${directory}/02-compare-structure.png`, 1280, 800);
    await page.locator('#view-text').click();
    await page.waitForFunction(() => !document.querySelector('#text-view').hidden && document.querySelector('#text-view .tline'));
    await page.locator('h1').click();
    await capture(page, `${directory}/03-compare-text.png`, 1280, 800);
    for (const action of ['minify', 'escape', 'unescape']) {
      await page.goto(base + `/${action}.html`);
      await page.locator('#btn-sample').click();
      await page.waitForFunction(() => document.querySelector('#busy').hidden && document.querySelector('#output-text').textContent);
      const input = await page.locator('#input').inputValue();
      const sample = action === 'unescape' ? JSON.parse('"' + input + '"') : input;
      assert.equal(JSON.parse(sample).name, brand, `${locale}: ${action} sample brand`);
      assert.equal(await page.locator('#error').isVisible(), false);
    }
    assert.deepEqual(errors, [], `${locale}: browser errors`);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({ generated: output }, null, 2));
