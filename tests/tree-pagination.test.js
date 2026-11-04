import test from 'node:test';
import assert from 'node:assert/strict';
import { createChildPathIndex, renderChildPages } from '../src/shared/json-tree.js';

class Node {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
  }
  appendChild(child) {
    if (child.tagName === '#fragment') {
      for (const item of [...child.children]) this.appendChild(item);
    } else {
      child.remove();
      child.parentNode = this;
      this.children.push(child);
    }
    return child;
  }
  before(child) {
    if (child.tagName === '#fragment') {
      for (const item of [...child.children]) this.before(item);
    } else {
      child.remove();
      child.parentNode = this.parentNode;
      this.parentNode.children.splice(this.parentNode.children.indexOf(this), 0, child);
    }
  }
  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  click() { this.listeners.get('click')?.(); }
}

function withDom(run) {
  const previous = globalThis.document;
  globalThis.document = {
    createElement: (tag) => new Node(tag),
    createDocumentFragment: () => new Node('#fragment'),
  };
  try {
    run();
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}

function renderEntry(parent, key, isArray, value, path) {
  const entry = new Node('entry');
  Object.assign(entry, { key, isArray, value, path });
  parent.appendChild(entry);
}

const entries = (container) => container.children.filter((child) => child.tagName === 'entry');
const buttons = (container) => container.children.filter((child) => child.tagName === 'button');
function revealAll(container) {
  for (let clicks = 0; buttons(container).length; clicks++) {
    assert.ok(clicks < 100, 'pagination must finish');
    // Deliberately fill gaps from right to left rather than document order.
    buttons(container).at(-1).click();
  }
}

test('child-path index preserves encoded keys and deduplicates shared ancestors', () => {
  const index = createChildPathIndex([
    '', '/a~1b', '/a~1b/~0/x', '/a~1b/~0', '/a~1b/other', '/', '/~01', '/a~1b/~0/x',
  ]);
  assert.deepEqual([...index.get('')], ['/a~1b', '/', '/~01']);
  assert.deepEqual([...index.get('/a~1b')], ['/a~1b/~0', '/a~1b/other']);
  assert.deepEqual([...index.get('/a~1b/~0')], ['/a~1b/~0/x']);
  assert.equal(index.size, 3);
  assert.equal(createChildPathIndex(['']).size, 0);
});

test('sparse remote matches stay ordered and independent gaps reveal each entry once', () => withDom(() => {
  const container = new Node('div');
  const reads = Array(21).fill(0);
  const data = Array.from({ length: 21 }, (_, i) => i);
  for (let i = 0; i < data.length; i++) {
    Object.defineProperty(data, i, { get() { reads[i]++; return i; } });
  }
  renderChildPages(container, data, '/list', {
    requiredPaths: new Set(['/list/20', '/list/15', '/list/7']),
    chunkSize: 3,
    renderEntry,
  });
  assert.deepEqual(entries(container).map((entry) => entry.key), [0, 1, 2, 7, 15, 20]);
  assert.deepEqual(reads.flatMap((count, i) => count ? [i] : []), [0, 1, 2, 7, 15, 20]);
  assert.equal(buttons(container).length, 3);
  const middleGap = buttons(container)[1];
  middleGap.click();
  assert.deepEqual(entries(container).map((entry) => entry.key), [0, 1, 2, 7, 8, 9, 10, 15, 20]);
  buttons(container).at(-1).click();
  middleGap.click();
  revealAll(container);
  assert.deepEqual(entries(container).map((entry) => entry.key), Array.from({ length: 21 }, (_, i) => i));
  assert.deepEqual(reads, Array(21).fill(1));
  for (const entry of entries(container)) {
    assert.equal(entry.path, `/list/${entry.key}`);
    assert.equal(entry.value, entry.key);
    assert.equal(entry.isArray, true);
  }
}));

test('object pagination uses native key order, escaped paths and one key enumeration', () => withDom(() => {
  const object = Object.fromEntries([
    ['last', 1], ['9', 9], ['2', 2], ['a/b', 3], ['~1', 4], ['', 5], ['__proto__', 6], ['tail', 7],
  ]);
  let enumerations = 0;
  const data = new Proxy(object, { ownKeys(target) { enumerations++; return Reflect.ownKeys(target); } });
  const container = new Node('div');
  renderChildPages(container, data, '/parent~1key', {
    requiredPaths: new Set(['/parent~1key/__proto__', '/parent~1key/~01', '/parent~1key/a~1b', '/parent~1key/']),
    chunkSize: 1,
    renderEntry,
  });
  assert.deepEqual(entries(container).map((entry) => entry.key), ['2', 'a/b', '~1', '', '__proto__']);
  assert.deepEqual(entries(container).map((entry) => entry.path), [
    '/parent~1key/2', '/parent~1key/a~1b', '/parent~1key/~01', '/parent~1key/', '/parent~1key/__proto__',
  ]);
  assert.equal(enumerations, 1);
  revealAll(container);
  assert.equal(enumerations, 1);
  assert.deepEqual(entries(container).map((entry) => entry.key), Object.keys(object));
  assert.deepEqual(entries(container).map((entry) => entry.value), Object.values(object));
  assert.ok(entries(container).every((entry) => !entry.isArray));

  const keys = Object.keys(data);
  assert.equal(enumerations, 2);
  const second = new Node('div');
  renderChildPages(second, data, '', { keys, chunkSize: 2, renderEntry });
  revealAll(second);
  assert.equal(enumerations, 2, 'provided cached keys must be reused');
}));

test('onlyRequired omits unrelated entries and all pagination gaps', () => withDom(() => {
  const data = Array.from({ length: 30 }, (_, i) => i);
  const requiredPaths = createChildPathIndex(['/items/29/x', '/items/3', '/items/12/x']).get('/items');
  const container = new Node('div');
  renderChildPages(container, data, '/items', { onlyRequired: true, requiredPaths, chunkSize: 2, renderEntry });
  assert.deepEqual(entries(container).map((entry) => entry.key), [3, 12, 29]);
  assert.equal(buttons(container).length, 0);

  const object = new Node('div');
  renderChildPages(object, { unrelated: 1, 'a/b': 2, '~': 3 }, '', {
    onlyRequired: true, requiredPaths: new Set(['/~0', '/a~1b']), renderEntry,
  });
  assert.deepEqual(entries(object).map((entry) => entry.key), ['a/b', '~']);
  assert.equal(buttons(object).length, 0);

  for (const value of [data, { field: 1 }, [], {}]) {
    const empty = new Node('div');
    renderChildPages(empty, value, '', { onlyRequired: true, renderEntry });
    assert.equal(empty.children.length, 0);
  }
}));
