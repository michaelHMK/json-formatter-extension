/**
 * 每个页面拥有独立 Worker；请求按 id 配对，busy 持续到所有请求结束。
 * 任务错误和通信错误都返回 { ok: false, error }，页面只需处理一种失败形式。
 * createWorker 可替换，便于验证并发响应和 Worker 故障。
 */
export function createTaskRunner({
  onBusyChange = () => {},
  createWorker = () => new Worker(new URL('../worker/index.js', import.meta.url), { type: 'module' }),
} = {}) {
  let worker;
  let sequence = 0;
  let failure = null;
  const pending = new Map();

  function finish(message) {
    const resolve = pending.get(message.id);
    if (!resolve) return;
    pending.delete(message.id);
    onBusyChange(pending.size > 0);
    resolve(message);
  }

  function fail(error) {
    failure = error.message || String(error);
    worker?.terminate();
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

  return function runTask(action, payload = {}) {
    const id = ++sequence;
    if (failure !== null) return Promise.resolve({ id, ok: false, error: failure });
    return new Promise((resolve) => {
      pending.set(id, resolve);
      onBusyChange(true);
      try {
        worker.postMessage({ ...payload, id, action });
      } catch (error) {
        finish({ id, ok: false, error: error.message || String(error) });
      }
    });
  };
}
