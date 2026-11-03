import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskRunner } from '../src/shared/worker-client.js';

function setup() {
  const busy = [];
  const requests = [];
  const worker = {
    terminated: false,
    postMessage: (message) => requests.push(message),
    terminate() { this.terminated = true; },
  };
  const run = createTaskRunner({ createWorker: () => worker, onBusyChange: (value) => busy.push(value) });
  return { run, worker, busy, requests };
}

test('out-of-order replies reach their callers and busy lasts until all replies arrive', async () => {
  const { run, worker, busy, requests } = setup();
  const first = run('parse', { text: '{}' });
  const second = run('search', { text: 'a' });
  worker.onmessage({ data: { id: 999, ok: true } });
  assert.deepEqual(busy, [true, true]);
  worker.onmessage({ data: { id: requests[1].id, ok: true, result: 'second' } });
  assert.equal((await second).result, 'second');
  assert.equal(busy.at(-1), true);
  worker.onmessage({ data: { id: requests[0].id, ok: true, result: 'first' } });
  assert.equal((await first).result, 'first');
  assert.equal(busy.at(-1), false);
});

test('worker failure settles all pending and future requests', async () => {
  const { run, worker, busy } = setup();
  const first = run('format', { text: '{}' });
  const second = run('parse', { text: '[]' });
  worker.onerror({ message: 'load failed', preventDefault() {} });
  for (const response of await Promise.all([first, second, run('search', { text: 'x' })])) {
    assert.equal(response.ok, false);
    assert.equal(response.error, 'load failed');
  }
  assert.equal(worker.terminated, true);
  assert.equal(busy.at(-1), false);
});

test('worker construction and unreadable responses use the same error contract', async () => {
  const run = createTaskRunner({ createWorker() { throw new Error('cannot create'); } });
  assert.equal((await run('parse')).error, 'cannot create');
  const setupResult = setup();
  const pending = setupResult.run('parse');
  setupResult.worker.onmessageerror();
  assert.equal((await pending).ok, false);
  assert.equal(setupResult.busy.at(-1), false);
});

test('postMessage failure only fails that request and clears busy', async () => {
  const { run, worker, busy } = setup();
  const postMessage = worker.postMessage;
  worker.postMessage = () => { throw new Error('cannot clone'); };
  assert.equal((await run('parse')).error, 'cannot clone');
  assert.equal(busy.at(-1), false);
  worker.postMessage = postMessage;
  const next = run('parse');
  worker.onmessage({ data: { id: 2, ok: true } });
  assert.equal((await next).ok, true);
});
