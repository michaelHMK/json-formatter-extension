import test from 'node:test';
import assert from 'node:assert/strict';
import { searchData } from '../src/core/search.js';
import { appendJsonPath } from '../src/core/json-path.js';

function referenceSearch(data, query) {
  const q = query.toLowerCase();
  const highlights = [];
  const forceExpand = new Set();
  let matchCount = 0;
  function visit(value, key, isIndex, path, ancestors) {
    const container = value !== null && typeof value === 'object';
    if ((key !== null && !isIndex && key.toLowerCase().includes(q))
      || (!container && String(value).toLowerCase().includes(q))) {
      matchCount++;
      if (highlights.length < 500) {
        highlights.push(path);
        for (const ancestor of ancestors) forceExpand.add(ancestor);
      }
    }
    if (container) {
      const isArray = Array.isArray(value);
      for (const key of Object.keys(value)) {
        visit(value[key], key, isArray, appendJsonPath(path, key), [...ancestors, path]);
      }
    }
  }
  visit(data, null, false, '', []);
  return { highlights, forceExpand: [...forceExpand], matchCount, truncated: matchCount > 500 };
}

test('search preserves DFS order and ancestor paths across matched keys and siblings', () => {
  const data = JSON.parse('{"a/b":{"~":{"Needle":1},"":"NEEDLE"},"needle":[{"nested":"needle"},"other"],"__proto__":"needle"}');
  assert.deepEqual(searchData(data, 'NeEdLe'), {
    highlights: ['/a~1b/~0/Needle', '/a~1b/', '/needle', '/needle/0/nested', '/__proto__'],
    forceExpand: ['', '/a~1b', '/a~1b/~0', '/needle', '/needle/0'],
    matchCount: 5,
    truncated: false,
  });
});

test('search counts every match after capping details without expanding later branches', () => {
  for (const count of [500, 501, 200_000]) {
    const data = { first: Array(500).fill('needle'), later: Array(count - 500).fill({ nested: 'needle' }) };
    const result = searchData(data, 'needle');
    assert.equal(result.matchCount, count);
    assert.equal(result.highlights.length, 500);
    assert.equal(result.highlights[0], '/first/0');
    assert.equal(result.highlights.at(-1), '/first/499');
    assert.deepEqual(result.forceExpand, ['', '/first']);
    assert.equal(result.truncated, count > 500);
  }
});

test('search handles primitive roots, empty containers and array indexes', () => {
  for (const data of [null, true, false, 12, 'VALUE', [], {}]) {
    for (const query of ['', 'value', 'null', '0', 'true']) {
      assert.deepEqual(searchData(data, query), referenceSearch(data, query));
    }
  }
  assert.equal(searchData(Array(100).fill('value'), '0').matchCount, 0);
  assert.deepEqual(searchData({ 0: 'value' }, '0').highlights, ['/0']);
});

test('search traverses deep containers without a recursive call stack', () => {
  let data = 'needle';
  const depth = 15_000;
  for (let i = 0; i < depth; i++) data = [data];
  assert.equal(searchData(data, 'absent').matchCount, 0);
  const result = searchData(data, 'needle');
  assert.deepEqual(result.highlights, ['/0'.repeat(depth)]);
  assert.equal(result.forceExpand.length, depth);
  assert.equal(result.forceExpand[0], '');
  assert.equal(result.forceExpand.at(-1), '/0'.repeat(depth - 1));
});

test('search agrees with a simple reference traversal for varied JSON values', () => {
  let seed = 0x12345678;
  const random = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  const keys = ['', '0', 'a/b', '~', 'needle', 'MixedCASE', '__proto__'];
  function build(depth) {
    const kind = random(depth ? 7 : 5);
    if (kind < 5) return [null, true, random(1000), 'Needle', 'other'][kind];
    if (kind === 5) return Array.from({ length: random(6) }, () => build(depth - 1));
    return Object.fromEntries(Array.from({ length: random(6) }, () => [keys[random(keys.length)], build(depth - 1)]));
  }
  for (let i = 0; i < 150; i++) {
    const data = build(5);
    for (const query of ['', 'needle', '0', 'true', '/', 'case', 'absent']) {
      assert.deepEqual(searchData(data, query), referenceSearch(data, query));
    }
  }
});
