import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './helpers/page-dom.js';

// Hidden data getters detect accidental whole-document walks without timing tests.
function loadFormatter(runTask) {
  return loadPage('formatter', {
    runTask,
    expose: '{ state, renderTree, applyLevel, doClear, doFormat, ensureTreeData, runSearch, createChildPathIndex }',
  });
}

function rootChildren(page) {
  return page.get('tree').children[0].children[0].children[1];
}

function entryChildren(entry) {
  return entry.children.find((child) => child.className === 'children');
}

test('expand all only visits the current page, and later pages inherit the depth', () => {
  const page = loadFormatter();
  const data = Array.from({ length: 201 }, (_, id) => ({ id, profile: { name: 'user' } }));
  let allowLast = false;
  Object.defineProperty(data, 200, {
    get() {
      assert.ok(allowLast, 'the hidden page must not be traversed during expand all');
      return { id: 200, profile: { name: 'last' } };
    },
  });
  page.state.data = data;
  page.applyLevel('all');
  assert.equal(page.state.expanded.size, 0);
  const children = rootChildren(page);
  assert.equal(children.children.length, 201); // 200 entries and the next-page button
  assert.equal(entryChildren(children.children[0]).style.display, '');
  assert.equal(entryChildren(entryChildren(children.children[0]).children[1]).style.display, '');
  allowLast = true;
  children.children.at(-1).click();
  assert.equal(children.children.length, 201);
  assert.equal(entryChildren(children.children.at(-1)).style.display, '');
});

test('manual collapse overrides expand all across rerenders and a new level resets it', () => {
  const page = loadFormatter();
  page.state.data = { first: { nested: { value: 1 } } };
  page.applyLevel('all');
  let entry = rootChildren(page).children[0];
  entry.children[0].children[0].click();
  assert.equal(entryChildren(entry).style.display, 'none');
  page.renderTree();
  entry = rootChildren(page).children[0];
  assert.equal(entryChildren(entry).style.display, 'none');
  page.applyLevel('2');
  entry = rootChildren(page).children[0];
  assert.equal(entryChildren(entry).style.display, '');
  assert.equal(entryChildren(entryChildren(entry).children[0]).style.display, 'none');
  page.doClear();
  assert.equal(page.state.expandLevel, 1);
  assert.equal(page.state.collapsed.size, 0);
});

test('search exposes a distant match without rendering every earlier sibling', () => {
  const page = loadFormatter();
  page.state.data = Array.from({ length: 25001 }, (_, id) => id);
  page.state.highlights = new Set(['/25000']);
  page.state.searchForce = new Set(['']);
  page.state.searchChildren = page.createChildPathIndex(page.state.highlights);
  page.state.searchQuery = '25000';
  page.state.matchCount = 1;
  page.renderTree();
  const children = rootChildren(page);
  assert.equal(children.querySelectorAll('.entry').length, 201);
  assert.equal(children.querySelectorAll('.entry.highlight').length, 1);
  assert.equal(children.children.at(-1).classList.contains('current'), true);
  assert.equal(page.state.matchIndex, 0);
});

test('paging around distant search hits preserves source order and emits every child once', () => {
  const page = loadFormatter();
  page.state.data = Array.from({ length: 601 }, (_, id) => id);
  page.state.highlights = new Set(['/400', '/500']);
  page.state.searchForce = new Set(['']);
  page.state.searchChildren = page.createChildPathIndex(page.state.highlights);
  page.renderTree();
  const children = rootChildren(page);
  while (children.querySelector('.more')) children.querySelector('.more').click();
  const keys = children.children.map((entry) => Number(entry.querySelector('.key').textContent));
  assert.deepEqual(keys, Array.from({ length: 601 }, (_, id) => id));
});

test('clear releases the Worker cache and ignores an outstanding format response', async () => {
  let finishFormat;
  const actions = [];
  const page = loadFormatter((action) => {
    actions.push(action);
    if (action === 'format') return new Promise((resolve) => { finishFormat = resolve; });
    return Promise.resolve({ ok: true, result: {} });
  });
  page.get('input').value = '{"old":1}';
  const pending = page.doFormat();
  page.doClear();
  finishFormat({ ok: true, result: { text: '{"old":1}', data: { old: 1 } }, duration: 1 });
  await pending;
  assert.deepEqual(actions, ['format', 'clear']);
  assert.equal(page.state.data, undefined);
  assert.equal(page.state.outputText, '');
  assert.equal(page.get('tree').children.length, 0);
});

test('clear invalidates pending parsing and search results', async () => {
  for (const action of ['parse', 'search']) {
    let finishTask;
    const page = loadFormatter((requested) => requested === action
      ? new Promise((resolve) => { finishTask = resolve; })
      : Promise.resolve({ ok: true, result: {} }));
    page.get('input').value = '{"old":1}';
    page.get('search').value = 'old';
    if (action === 'search') page.state.data = { old: 1 };
    const pending = action === 'parse' ? page.ensureTreeData() : page.runSearch();
    page.doClear();
    finishTask({ ok: true, result: action === 'parse'
      ? { data: { old: 1 }, numberLiterals: {} }
      : { highlights: ['/old'], forceExpand: [''], matchCount: 1, truncated: false } });
    await pending;
    assert.equal(page.state.data, undefined);
    assert.equal(page.state.highlights.size, 0);
    assert.equal(page.get('tree').children.length, 0);
  }
});
