import { decodeTaskResponse } from './worker-protocol.js';

/**
 * 每个页面拥有独立 Worker；请求按 id 配对，busy 持续到所有请求结束。
 * 任务错误和通信错误都返回 { ok: false, error }，页面只需处理一种失败形式。
 * createWorker 可替换，便于验证并发响应和 Worker 故障。
 */
export function createTaskRunner({
  onBusyChange = () => {},
  createWorker = () => new Worker(new URL('../worker/index.js', import.meta.url), { type: 'module' }),
  serialize = false,
} = {}) {
  let worker;
  let sequence = 0;
  let failure = null;
  const pending = new Map();
  const queued = [];
  let activeId = null;

  function send(request) {
    if (serialize) activeId = request.id;
    try {
      worker.postMessage(request);
    } catch (error) {
      finish({ id: request.id, ok: false, error: error.message || String(error) });
    }
  }

  function pump() {
    if (!serialize || failure !== null || activeId !== null || !queued.length) return;
    send(queued.shift().request);
  }

  function finish(message) {
    const resolve = pending.get(message.id);
    if (!resolve) return;
    pending.delete(message.id);
    if (message.id === activeId) activeId = null;
    onBusyChange(pending.size > 0);
    resolve(decodeTaskResponse(message));
    pump();
  }

  function fail(error) {
    failure = error.message || String(error);
    worker?.terminate();
    queued.length = 0;
    for (const id of pending.keys()) {
      finish({ id, ok: false, error: failure });
    }
  }

  try {
    worker = createWorker();
    worker.onmessage = (event) => finish(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      fail(new Error(event.message || 'Worker error'));
    };
    worker.onmessageerror = () => fail(new Error('Worker message could not be read'));
  } catch (error) {
    fail(error);
  }

  return function runTask(action, payload = {}, { key, discardQueued = false } = {}) {
    const id = ++sequence;
    if (failure !== null) return Promise.resolve({ id, ok: false, error: failure });
    return new Promise((resolve) => {
      pending.set(id, resolve);
      onBusyChange(true);
      const request = { ...payload, id, action };
      if (!serialize) {
        send(request);
        return;
      }
      // Worker 本来逐个执行任务；尚未发送的过期输入无需再克隆、解析或计算。
      for (let i = queued.length - 1; i >= 0; i--) {
        if (!discardQueued && (key === undefined || queued[i].key !== key)) continue;
        const [{ request: cancelled }] = queued.splice(i, 1);
        const settle = pending.get(cancelled.id);
        pending.delete(cancelled.id);
        settle({ id: cancelled.id, ok: false, cancelled: true, error: 'Task superseded' });
      }
      queued.push({ request, key });
      pump();
    });
  };
}
