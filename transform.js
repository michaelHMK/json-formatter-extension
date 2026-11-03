'use strict';

const inputEl = document.getElementById('input');
const outputEl = document.getElementById('output-text');
const statusEl = document.getElementById('status');
const busyEl = document.getElementById('busy');
const errorEl = document.getElementById('error');
const action = document.body.dataset.action;

let outputText = '';

const worker = new Worker('worker.js');
let taskSeq = 0;
const pending = new Map();

worker.onmessage = (e) => {
  const msg = e.data;
  const resolve = pending.get(msg.id);
  if (!resolve) return;
  pending.delete(msg.id);
  busyEl.hidden = true;
  resolve(msg);
};

function runTask(text) {
  const id = ++taskSeq;
  busyEl.hidden = false;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ id, action, text });
  });
}

function setStatus(text) {
  statusEl.textContent = text;
}

function showError(text) {
  errorEl.textContent = text;
  errorEl.hidden = false;
}

function hideError() {
  errorEl.hidden = true;
  errorEl.textContent = '';
}

function showParseError(text, res) {
  let msg = t('errParseFailed') + res.error;
  if (typeof res.line === 'number') {
    msg = t('errLineCol', [String(res.line), String(res.column)]) + res.error;
  }
  showError(msg);
  if (typeof res.position === 'number') {
    inputEl.focus();
    const pos = Math.min(res.position, text.length);
    inputEl.setSelectionRange(pos, Math.min(pos + 1, text.length));
    const lineHeight = parseFloat(getComputedStyle(inputEl).lineHeight) || 21;
    inputEl.scrollTop = Math.max(0, ((res.line || 1) - 3) * lineHeight);
  }
}

async function runTransform() {
  const text = inputEl.value;
  if (action === 'minify' ? !text.trim() : !text) {
    showError(t(action === 'minify' ? 'errNeedInput' : 'errNeedContent'));
    return;
  }
  hideError();
  const res = await runTask(text);
  if (!res.ok) {
    if (action === 'minify') showParseError(text, res);
    else if (action === 'unescape') showError(t('errUnescapeFailed') + res.error);
    else showError(res.error);
    return;
  }
  outputText = res.result.text;
  outputEl.textContent = outputText;
  if (action === 'minify') {
    setStatus(t('statusMinified', [outputText.length.toLocaleString(), String(res.duration)]));
  } else {
    setStatus(t(action === 'escape' ? 'statusEscaped' : 'statusUnescaped', [outputText.length.toLocaleString()]));
  }
}

async function doCopy() {
  const text = outputText || inputEl.value;
  if (!text) {
    showError(t('errNothingToCopy'));
    return;
  }
  hideError();
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const tmp = document.createElement('textarea');
    tmp.value = text;
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand('copy');
    tmp.remove();
  }
  setStatus(t('statusCopied', [text.length.toLocaleString()]));
}

function doClear() {
  inputEl.value = '';
  outputText = '';
  outputEl.textContent = '';
  hideError();
  setStatus('');
  inputEl.focus();
}

function fillSample() {
  const sample = JSON.stringify({
    name: 'JSON 工具箱',
    free: true,
    tags: ['local', 'fast'],
    nested: { id: 1, value: null },
  }, null, 2);
  inputEl.value = action === 'unescape' ? JSON.stringify(sample).slice(1, -1) : sample;
  hideError();
  runTransform();
}

document.getElementById('btn-run').addEventListener('click', runTransform);
document.getElementById('btn-copy').addEventListener('click', doCopy);
document.getElementById('btn-clear').addEventListener('click', doClear);
document.getElementById('btn-sample').addEventListener('click', fillSample);

inputEl.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    runTransform();
  }
});
