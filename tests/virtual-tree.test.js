import test from 'node:test';
import assert from 'node:assert/strict';
import { createTreeModel, createVirtualTree } from '../src/shared/virtual-tree.js';
import { createChildPathIndex } from '../src/shared/json-tree.js';
import { Element } from './helpers/page-dom.js';

const rows = (model) => Array.from({ length: model.rowCount }, (_, index) => model.rowAt(index));
const entryPaths = (model) => rows(model).filter((row) => row.kind === 'entry').map((row) => row.path);

function withDom(run) {
  const previous = globalThis.document;
  globalThis.document = {
    createElement: (tag) => new Element(tag),
    createDocumentFragment: () => new Element('#fragment'),
  };
  try { run(); }
  finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}

test('a million-element array is one lazy range with direct access to its final value', () => {
  let reads = 0;
  const data = new Proxy(Array(1_000_000).fill(7), {
    get(target, key) { if (/^\d+$/.test(String(key))) reads++; return target[key]; },
  });
  const model = createTreeModel({ data });
  assert.equal(model.rowCount, 1_000_002);
  assert.equal(reads, 0, 'initial indexing must not read a million children');
  assert.equal(model.indexOf('/999999'), 1_000_000);
  assert.equal(model.rowAt(1_000_000).value, 7);
  assert.equal(reads, 1);
  assert.equal(model.indexOf('/1000000'), -1);
});

test('level expansion and manual overrides preserve DFS rows and closing brackets', () => {
  const model = createTreeModel({ data: { first: { nested: { n: 1 } }, second: [2, 3] }, expandLevel: Infinity });
  assert.deepEqual(entryPaths(model), ['', '/first', '/first/nested', '/first/nested/n', '/second', '/second/0', '/second/1']);
  assert.deepEqual(rows(model).filter((row) => row.kind === 'close').map((row) => row.path), ['/first/nested', '/first', '/second', '']);
  model.setOpen('/first', false);
  assert.deepEqual(entryPaths(model), ['', '/first', '/second', '/second/0', '/second/1']);
  model.update({ expandLevel: 2, expanded: new Set(), collapsed: new Set() });
  assert.deepEqual(entryPaths(model), ['', '/first', '/first/nested', '/second', '/second/0', '/second/1']);
  assert.equal(model.indexOf('/first/nested/n'), -1);
  const index = model.reveal('/first/nested/n');
  assert.equal(model.rowAt(index).value, 1);
  assert.equal(model.reveal('/first/missing'), -1);
});

test('required paths retain object ordering and support escaped, empty and prototype-like keys', () => {
  const data = JSON.parse('{"last":0,"9":9,"2":2,"a/b":{"~1":1,"":2},"__proto__":3}');
  const paths = ['/a~1b/~01', '/a~1b/', '/__proto__', '/9'];
  const model = createTreeModel({ data, onlyRequired: true, requiredChildren: createChildPathIndex(paths), forceExpand: new Set(['/a~1b']) });
  assert.deepEqual(entryPaths(model), ['', '/9', '/a~1b', '/a~1b/~01', '/a~1b/', '/__proto__']);
  for (const path of paths) assert.equal(model.rowAt(model.indexOf(path)).path, path);
  assert.equal(model.indexOf('/last'), -1);
  model.update({ onlyRequired: false });
  assert.deepEqual(entryPaths(model), ['', '/2', '/9', '/last', '/a~1b', '/a~1b/~01', '/a~1b/', '/__proto__']);
});

test('deep automatic expansion and navigation avoid recursive JavaScript calls', () => {
  let data = 'leaf';
  const depth = 3000;
  for (let i = 0; i < depth; i++) data = [data];
  const model = createTreeModel({ data, expandLevel: Infinity });
  assert.equal(model.rowCount, depth * 2 + 1);
  const path = '/0'.repeat(depth);
  assert.equal(model.rowAt(model.indexOf(path)).value, 'leaf');
  model.setOpen('/0', false);
  assert.equal(model.indexOf(path), -1);
  assert.equal(model.rowAt(model.reveal(path)).value, 'leaf');
});

test('cached object keys survive updates, navigation and repeated viewport access', () => {
  let enumerations = 0;
  const data = new Proxy({ a: 1, b: 2 }, { ownKeys(target) { enumerations++; return Reflect.ownKeys(target); } });
  const model = createTreeModel({ data });
  model.rowAt(1);
  model.rowAt(2);
  model.update({ expandLevel: Infinity });
  model.indexOf('/b');
  model.sizeOf(data);
  assert.equal(enumerations, 1);
});

test('virtual rendering bounds DOM and reaches values beyond browser scroll-height limits', () => withDom(() => {
  const container = new Element();
  const tree = createVirtualTree(container, { data: Array(2_000_000).fill(7) });
  assert.ok(container.querySelectorAll('.entry').length <= 45);
  assert.equal(tree.rowCount, 2_000_002);
  assert.equal(tree.reveal('/1999999'), true);
  tree.setCurrent('/1999999');
  const current = container.querySelector('.entry.current');
  assert.equal(current.dataset.path, '/1999999');
  assert.equal(current.querySelector('.v').textContent, '7');
  assert.ok(container.querySelectorAll('.entry').length <= 45);
  assert.ok(Number.parseFloat(container.children[0].style.height) <= 8_000_000);
  const layer = container.children[0].children[0];
  tree.destroy();
  assert.equal(container.children.length, 0);
  assert.equal(layer.children.length, 0, 'destroy must release rows even if a caller keeps the controller');
  assert.equal(tree.rowCount, 0);
  assert.equal(container.events.scroll, undefined);
}));

test('toggles notify once, programmatic synchronization does not recurse, and highlights follow paths', () => withDom(() => {
  const changes = [];
  const container = new Element();
  const tree = createVirtualTree(container, {
    data: { parent: { value: 1 } }, highlights: new Set(['/parent/value']),
    decorations: new Map([['/parent/value', { type: 'changed' }]]),
    onToggle: (path, open) => changes.push([path, open]),
  });
  const parent = container.querySelectorAll('.entry').find((entry) => entry.dataset.path === '/parent');
  parent.querySelector('.toggle').click();
  assert.deepEqual(changes, [['/parent', true]]);
  assert.equal(container.querySelector('.entry.highlight').dataset.path, '/parent/value');
  assert.equal(container.querySelector('.entry.diff-changed').dataset.path, '/parent/value');
  tree.setOpen('/parent', false);
  assert.deepEqual(changes, [['/parent', true]]);
  assert.equal(container.querySelector('.entry.highlight'), null);
  tree.destroy();
}));

test('large string previews and precision-preserving numeric literals stay bounded', () => withDom(() => {
  const container = new Element();
  const tree = createVirtualTree(container, {
    data: ['x'.repeat(10_000_000), 9007199254740992, -0, Infinity],
    numberLiterals: { '/1': '9007199254740993', '/2': '-0', '/3': '9'.repeat(10000) },
  });
  const values = container.querySelectorAll('.v').map((entry) => entry.textContent);
  assert.ok(values[0].length < 2100);
  assert.equal(values[1], '9007199254740993');
  assert.equal(values[2], '-0');
  assert.ok(values[3].endsWith('strTruncated'));
  assert.ok(values[3].length < 2100);
  tree.destroy();
}));

test('string and key previews never leave half of a surrogate pair', () => withDom(() => {
  const container = new Element();
  const value = 'a'.repeat(1998) + '😀' + 'z'.repeat(20);
  const tree = createVirtualTree(container, { data: { [value]: value } });
  for (const element of [...container.querySelectorAll('.key'), ...container.querySelectorAll('.v')]) {
    const text = element.textContent.replace(/strTruncated$/, '');
    assert.ok(!/[\ud800-\udbff]$/.test(text));
  }
  tree.destroy();
}));
