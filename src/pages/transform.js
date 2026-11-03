import { initializePage } from '../shared/page.js';
import { t } from '../shared/i18n.js';
import { createTaskRunner } from '../shared/worker-client.js';
import { createFeedback } from '../shared/feedback.js';
import { copyText } from '../shared/clipboard.js';

initializePage();

const inputEl = document.getElementById('input');
const outputEl = document.getElementById('output-text');
const statusEl = document.getElementById('status');
const busyEl = document.getElementById('busy');
const errorEl = document.getElementById('error');
const action = document.body.dataset.action;

let outputText = '';

const runTask = createTaskRunner({
  onBusyChange: (busy) => { busyEl.hidden = !busy; },
});

const { setStatus, showError, hideError, showParseError } = createFeedback({
  statusEl, errorEl, inputEl,
});

async function runTransform() {
  const text = inputEl.value;
  if (action === 'minify' ? !text.trim() : !text) {
    showError(t(action === 'minify' ? 'errNeedInput' : 'errNeedContent'));
    return;
  }
  hideError();
  const res = await runTask(action, { text });
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
  await copyText(text);
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
