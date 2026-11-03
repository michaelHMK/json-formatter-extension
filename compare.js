'use strict';

/* ================= DOM ================= */
const $ = (id) => document.getElementById(id);

const inputLeft = $('input-left');
const inputRight = $('input-right');
const errorEl = $('error');
const statusEl = $('status');
const busyEl = $('busy');
const resultEl = $('result');
const structView = $('struct-view');
const textView = $('text-view');
const treeLeftEl = $('tree-left');
const treeRightEl = $('tree-right');
const arrayModeSel = $('array-mode');
const keyFieldBox = $('key-field-box');
const keyFieldInput = $('key-field');
const ignoreInput = $('ignore-paths');
const onlyDiffChk = $('only-diff');
const diffNavEl = $('diff-nav');
const diffInfoEl = $('diff-info');

// 与 worker.js 一致：使用 JSON Pointer，转义 key 中的 ~ 和 /，避免路径碰撞
const PATH_SEP = '/';

function appendJsonPath(path, key) {
  key = String(key);
  if (key.includes('~') || key.includes('/')) {
    key = key.replace(/~/g, '~0').replace(/\//g, '~1');
  }
  return path + PATH_SEP + key;
}
const CHUNK = 200;
// 差异祖先路径上的容器，子节点数不超过该值才一次性全量渲染
const FULL_RENDER_LIMIT = 20000;
// 两棵树共享的渲染节点预算
const RENDER_BUDGET = 100000;
const STRING_PREVIEW = 2000;
// 文本 diff 视图渲染的行数预算
const TEXT_ROW_BUDGET = 50000;

const state = {
  view: 'struct',      // 'struct' | 'text'
  result: null,        // 结构 diff 结果
  textResult: null,    // 文本 diff 结果（每次对比后失效重算）
  leftData: undefined,
  rightData: undefined,
  leftNumberLiterals: null,
  rightNumberLiterals: null,
  onlyDiff: false,
  diffIndex: -1,
  renderedCount: 0,
  renderLimited: false,
  expanded: { left: new Set(), right: new Set() },     // 用户手动展开
  force: { left: new Set(), right: new Set() },        // 差异祖先，自动展开
  interesting: { left: new Set(), right: new Set() },  // 差异 ∪ 祖先（只看差异用）
  diffMap: { left: new Map(), right: new Map() },      // path → diff 记录
  pairLR: new Map(),   // 主键配对导致的左路径 → 右路径
  pairRL: new Map(),
  elemMap: { left: new Map(), right: new Map() },      // path → DOM entry
};

/* ================= Worker 通信 ================= */
const worker = new Worker('worker.js');
let taskSeq = 0;
let busyCount = 0;
const pending = new Map();

worker.onmessage = (e) => {
  const msg = e.data;
  const resolve = pending.get(msg.id);
  if (!resolve) return;
  pending.delete(msg.id);
  busyCount = Math.max(0, busyCount - 1);
  if (busyCount === 0) busyEl.hidden = true;
  resolve(msg);
};

function runTask(action, payload) {
  const id = ++taskSeq;
  busyCount++;
  busyEl.hidden = false;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage(Object.assign({ id, action }, payload));
  });
}

/* ================= 状态展示 ================= */
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

/* ================= 对比主流程 ================= */
async function doCompare() {
  const lt = inputLeft.value;
  const rt = inputRight.value;
  if (!lt.trim() || !rt.trim()) {
    showError(t('errNeedBothSides'));
    return;
  }
  hideError();
  const ignorePaths = ignoreInput.value
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const keyField = arrayModeSel.value === 'key' ? keyFieldInput.value.trim() : '';
  const res = await runTask('diff', { text: lt, text2: rt, keyField, ignorePaths });
  if (!res.ok) {
    showError(t('errCompareFailed') + res.error);
    return;
  }
  state.result = res.result;
  state.textResult = null; // 输入变了，文本 diff 需重算
  buildIndexes();
  state.diffIndex = -1;
  resultEl.hidden = false;
  if (state.view === 'text') {
    await loadTextDiff();
  } else {
    refreshTrees();
  }
  updateStatus();
}

function buildIndexes() {
  const r = state.result;
  state.leftData = r.leftData;
  state.rightData = r.rightData;
  state.leftNumberLiterals = r.leftNumberLiterals || null;
  state.rightNumberLiterals = r.rightNumberLiterals || null;
  for (const side of ['left', 'right']) {
    state.diffMap[side] = new Map();
    state.force[side] = new Set();
    state.interesting[side] = new Set();
    state.expanded[side] = new Set();
  }
  state.pairLR = new Map(r.pairs);
  state.pairRL = new Map(r.pairs.map(([l, rr]) => [rr, l]));
  for (const d of r.diffs) {
    addPath('left', d.leftPath, d);
    addPath('right', d.rightPath, d);
  }
}

// 把差异路径及其所有祖先登记到 diffMap / force / interesting
function addPath(side, path, d) {
  if (path === null) return;
  state.diffMap[side].set(path, d);
  state.interesting[side].add(path);
  if (path === '') return;
  const segs = path.split(PATH_SEP);
  let cur = '';
  for (let i = 0; i < segs.length - 1; i++) {
    cur = i === 0 ? segs[i] : cur + PATH_SEP + segs[i];
    state.force[side].add(cur);
    state.interesting[side].add(cur);
  }
}

function updateStatus() {
  if (!state.result) return;
  const s = state.result.stats;
  let text = t('diffStats', [
    String(state.result.total),
    String(s.added),
    String(s.removed),
    String(s.changed),
    String(s.typeChanged),
  ]);
  if (state.result.truncated) text += t('diffStatsTruncated', [String(state.result.diffs.length)]);
  if (state.result.keyFallback) text += t('diffKeyFallback');
  if (state.renderLimited) text += t('diffRenderLimited');
  if (state.result.total === 0) text += t('diffIdenticalNote');
  setStatus(text);
}

/* ================= 双树渲染 ================= */
function span(cls, text) {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
}

function primitiveNode(value, path, side) {
  if (value === null) return span('v null', 'null');
  if (typeof value === 'string') {
    let s = JSON.stringify(value);
    if (s.length > STRING_PREVIEW) {
      s = s.slice(0, STRING_PREVIEW) + t('strTruncated', [s.length.toLocaleString()]);
    }
    return span('v string', s);
  }
  if (typeof value === 'number') {
    const literals = side === 'left' ? state.leftNumberLiterals : state.rightNumberLiterals;
    const lit = literals && literals[path];
    return span('v number', lit !== undefined ? lit : String(value));
  }
  return span('v bool', String(value));
}

function refreshTrees() {
  renderTrees();
  if (state.result && state.result.diffs.length) goToDiff(0);
  else updateDiffInfo();
}

function renderTrees() {
  state.renderedCount = 0;
  state.renderLimited = false;
  state.elemMap.left = new Map();
  state.elemMap.right = new Map();
  treeLeftEl.innerHTML = '';
  treeRightEl.innerHTML = '';
  renderRoot(treeLeftEl, state.leftData, 'left');
  renderRoot(treeRightEl, state.rightData, 'right');
}

function renderRoot(container, data, side) {
  const root = document.createElement('div');
  root.className = 'tree-root';
  renderEntry(root, null, false, data, '', side);
  container.appendChild(root);
}

function renderEntry(parentEl, key, isIndex, value, path, side) {
  state.renderedCount++;
  const entry = document.createElement('div');
  entry.className = 'entry';
  const d = state.diffMap[side].get(path);
  if (d) entry.classList.add('diff-' + d.type);
  state.elemMap[side].set(path, entry);

  const row = document.createElement('div');
  row.className = 'row';
  entry.appendChild(row);

  if (value !== null && typeof value === 'object') {
    renderContainer(entry, row, key, isIndex, value, path, side);
  } else {
    row.appendChild(span('toggle-spacer', ''));
    if (key !== null) {
      row.appendChild(span('key', isIndex ? String(key) : JSON.stringify(key)));
      row.appendChild(span('punct', ': '));
    }
    row.appendChild(primitiveNode(value, path, side));
  }
  parentEl.appendChild(entry);
}

function renderContainer(entry, row, key, isIndex, value, path, side) {
  const isArr = Array.isArray(value);
  const size = isArr ? value.length : Object.keys(value).length;
  const isRoot = path === '';
  const wantOpen = isRoot || state.expanded[side].has(path) || state.force[side].has(path);
  const open = wantOpen && state.renderedCount < RENDER_BUDGET;
  if (wantOpen && !open) state.renderLimited = true;

  const toggle = span('toggle', open ? '▾' : '▸');
  row.appendChild(toggle);
  if (key !== null) {
    row.appendChild(span('key', isIndex ? String(key) : JSON.stringify(key)));
    row.appendChild(span('punct', ': '));
  }
  row.appendChild(span('punct', isArr ? '[' : '{'));
  const summary = span('summary', t(isArr ? 'treeSummaryItems' : 'treeSummaryKeys', [size.toLocaleString()]));
  row.appendChild(summary);
  const closeBracket = span('punct', isArr ? ']' : '}');
  row.appendChild(closeBracket);

  const children = document.createElement('div');
  children.className = 'children';
  entry.appendChild(children);

  // 展开时显示在子节点末尾的闭合括号
  const footer = document.createElement('div');
  footer.className = 'row close-row';
  footer.appendChild(span('toggle-spacer', ''));
  footer.appendChild(span('punct', isArr ? ']' : '}'));
  entry.appendChild(footer);

  const renderKids = () => {
    if (children.dataset.done) return;
    children.dataset.done = '1';
    if (state.onlyDiff) {
      renderChildrenFiltered(children, value, path, side);
    } else {
      // 差异路径上的容器一次性全量渲染，保证差异可见；其余按块懒加载
      const full = state.force[side].has(path) && size <= FULL_RENDER_LIMIT;
      renderChildren(children, value, path, side, 0, full ? Infinity : CHUNK);
    }
  };

  const applyOpen = (o, byUser) => {
    toggle.textContent = o ? '▾' : '▸';
    children.style.display = o ? '' : 'none';
    footer.style.display = o ? '' : 'none';
    summary.style.display = o ? 'none' : '';
    closeBracket.style.display = o ? 'none' : '';
    if (byUser) {
      if (o) state.expanded[side].add(path);
      else state.expanded[side].delete(path);
    }
    if (o) renderKids();
  };

  const flip = () => {
    const nowOpen = children.style.display === 'none';
    applyOpen(nowOpen, true);
    // 同步另一侧的对应容器（主键配对时下标可能不同，走 pair 映射）
    const other = side === 'left' ? 'right' : 'left';
    const pairMap = side === 'left' ? state.pairLR : state.pairRL;
    const otherEntry = state.elemMap[other].get(pairMap.get(path) || path);
    if (otherEntry && otherEntry._setOpen) otherEntry._setOpen(nowOpen);
  };

  // 供另一侧同步 / 差异导航调用，自身不再回传同步
  entry._setOpen = (o) => {
    if ((children.style.display !== 'none') !== o) applyOpen(o, true);
  };

  toggle.addEventListener('click', flip);
  summary.addEventListener('click', flip);
  footer.addEventListener('click', flip);
  row.addEventListener('click', (e) => {
    if (e.target === row || e.target.classList.contains('punct')) flip();
  });

  applyOpen(open, false);
}

function renderChildren(container, obj, basePath, side, start, limit) {
  const isArr = Array.isArray(obj);
  const keys = isArr ? null : Object.keys(obj);
  const total = isArr ? obj.length : keys.length;
  const end = Math.min(total, start + limit);

  const frag = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
    const k = isArr ? i : keys[i];
    renderEntry(frag, k, isArr, obj[k], appendJsonPath(basePath, k), side);
  }
  container.appendChild(frag);

  if (end < total) {
    const more = document.createElement('button');
    more.className = 'more';
    more.textContent = t('showMore', [end.toLocaleString(), total.toLocaleString()]);
    more.addEventListener('click', () => {
      more.remove();
      renderChildren(container, obj, basePath, side, end, CHUNK);
    });
    container.appendChild(more);
  }
}

// 只看差异模式：只渲染差异路径及其祖先
function renderChildrenFiltered(container, obj, basePath, side) {
  const isArr = Array.isArray(obj);
  const keys = isArr ? null : Object.keys(obj);
  const total = isArr ? obj.length : keys.length;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < total; i++) {
    const k = isArr ? i : keys[i];
    const childPath = appendJsonPath(basePath, k);
    if (!state.interesting[side].has(childPath)) continue;
    renderEntry(frag, k, isArr, obj[k], childPath, side);
  }
  container.appendChild(frag);
}

/* ================= 差异导航 ================= */
function ensureVisible(el) {
  let node = el.parentElement;
  while (node) {
    if (node.classList && node.classList.contains('children') && node.style.display === 'none') {
      const entry = node.parentElement;
      if (entry && entry._setOpen) entry._setOpen(true);
    }
    node = node.parentElement;
  }
}

function goToDiff(i) {
  const diffs = state.result ? state.result.diffs : [];
  if (!diffs.length) {
    state.diffIndex = -1;
    updateDiffInfo();
    return;
  }
  state.diffIndex = ((i % diffs.length) + diffs.length) % diffs.length;
  for (const el of [treeLeftEl, treeRightEl]) {
    const prev = el.querySelector('.entry.current');
    if (prev) prev.classList.remove('current');
  }
  const d = diffs[state.diffIndex];
  for (const side of ['left', 'right']) {
    const path = side === 'left' ? d.leftPath : d.rightPath;
    if (path === null) continue;
    const el = state.elemMap[side].get(path);
    if (!el) continue;
    ensureVisible(el);
    el.classList.add('current');
  }
  // 滚动以左侧为准；左侧没有（纯新增）则滚右侧
  const side = d.leftPath !== null ? 'left' : 'right';
  const path = d.leftPath !== null ? d.leftPath : d.rightPath;
  const el = state.elemMap[side].get(path);
  if (el) el.scrollIntoView({ block: 'center' });
  updateDiffInfo();
}

function updateDiffInfo() {
  const total = state.result ? state.result.total : 0;
  if (!total) {
    diffInfoEl.textContent = '';
    return;
  }
  const shown = state.result.diffs.length;
  diffInfoEl.textContent = `${state.diffIndex + 1} / ${shown}${state.result.truncated ? '+' : ''}`;
}

/* ================= 文本 diff 视图 ================= */
async function loadTextDiff() {
  if (!state.textResult) {
    const res = await runTask('textDiff', {
      text: inputLeft.value,
      text2: inputRight.value,
      indent: '2',
    });
    if (!res.ok) {
      showError(t('errTextDiffFailed') + res.error);
      return false;
    }
    state.textResult = res.result;
  }
  renderTextDiff();
  return true;
}

function renderTextDiff() {
  const r = state.textResult;
  textView.innerHTML = '';
  const aLines = r.aText.split('\n');
  const bLines = r.bText.split('\n');
  const frag = document.createDocumentFragment();
  let rows = 0;
  let truncated = false;

  const addRow = (cls, text) => {
    if (rows >= TEXT_ROW_BUDGET) {
      truncated = true;
      return;
    }
    rows++;
    const div = document.createElement('div');
    div.className = 'tline ' + cls;
    div.textContent = text;
    frag.appendChild(div);
  };

  for (const op of r.ops) {
    if (op.type === 'same') {
      // 长相同段折叠展示
      if (op.count > 8) {
        for (let i = 0; i < 3; i++) addRow('same', '  ' + aLines[op.aStart + i]);
        addRow('gap', t('textDiffGap', [String(op.count - 6)]));
        for (let i = op.count - 3; i < op.count; i++) addRow('same', '  ' + aLines[op.aStart + i]);
      } else {
        for (let i = 0; i < op.count; i++) addRow('same', '  ' + aLines[op.aStart + i]);
      }
    } else if (op.type === 'del') {
      for (let i = 0; i < op.count; i++) addRow('del', '- ' + aLines[op.aStart + i]);
    } else {
      for (let i = 0; i < op.count; i++) addRow('add', '+ ' + bLines[op.bStart + i]);
    }
    if (truncated) break;
  }
  if (r.blocky) {
    const note = document.createElement('div');
    note.className = 'tline gap';
    note.textContent = t('textDiffBlockyNote');
    frag.appendChild(note);
  }
  if (truncated) {
    const note = document.createElement('div');
    note.className = 'tline gap';
    note.textContent = t('textDiffTruncatedNote', [TEXT_ROW_BUDGET.toLocaleString()]);
    frag.appendChild(note);
  }
  textView.appendChild(frag);
}

/* ================= 视图切换 ================= */
async function setCompareView(view) {
  state.view = view;
  $('view-struct').classList.toggle('active', view === 'struct');
  $('view-text').classList.toggle('active', view === 'text');
  structView.hidden = view !== 'struct';
  textView.hidden = view !== 'text';
  diffNavEl.style.visibility = view === 'struct' ? '' : 'hidden';
  if (!state.result) return;
  if (view === 'text') await loadTextDiff();
}

/* ================= 其他操作 ================= */
function doSwap() {
  const t2 = inputLeft.value;
  inputLeft.value = inputRight.value;
  inputRight.value = t2;
  if (state.result) doCompare();
}

function doClear() {
  inputLeft.value = '';
  inputRight.value = '';
  state.result = null;
  state.textResult = null;
  state.leftData = undefined;
  state.rightData = undefined;
  state.leftNumberLiterals = null;
  state.rightNumberLiterals = null;
  state.diffIndex = -1;
  resultEl.hidden = true;
  treeLeftEl.innerHTML = '';
  treeRightEl.innerHTML = '';
  textView.innerHTML = '';
  hideError();
  setStatus('');
  updateDiffInfo();
  inputLeft.focus();
}

function fillSample() {
  inputLeft.value = JSON.stringify({
    version: 1,
    users: [
      { id: 1, name: '甲', role: 'admin' },
      { id: 2, name: '乙', role: 'user' },
    ],
    updatedAt: '2026-08-01',
  }, null, 2);
  inputRight.value = JSON.stringify({
    version: 2,
    users: [
      { id: 2, name: '乙', role: 'admin' },
      { id: 3, name: '丙', role: 'user' },
    ],
    updatedAt: '2026-08-24',
  }, null, 2);
  hideError();
  doCompare();
}

/* ================= 滚动同步 ================= */
let scrollSyncing = false;
function syncScroll(from, to) {
  from.addEventListener('scroll', () => {
    if (scrollSyncing) return;
    scrollSyncing = true;
    to.scrollTop = from.scrollTop;
    to.scrollLeft = from.scrollLeft;
    setTimeout(() => { scrollSyncing = false; }, 0);
  });
}
syncScroll(treeLeftEl, treeRightEl);
syncScroll(treeRightEl, treeLeftEl);

/* ================= 事件绑定 ================= */
$('btn-compare').addEventListener('click', doCompare);
$('btn-swap').addEventListener('click', doSwap);
$('btn-sample').addEventListener('click', fillSample);
$('btn-clear').addEventListener('click', doClear);
$('view-struct').addEventListener('click', () => setCompareView('struct'));
$('view-text').addEventListener('click', () => setCompareView('text'));
$('diff-prev').addEventListener('click', () => goToDiff(state.diffIndex - 1));
$('diff-next').addEventListener('click', () => goToDiff(state.diffIndex + 1));

arrayModeSel.addEventListener('change', () => {
  keyFieldBox.hidden = arrayModeSel.value !== 'key';
});

onlyDiffChk.addEventListener('change', () => {
  state.onlyDiff = onlyDiffChk.checked;
  if (state.result && state.view === 'struct') refreshTrees();
});

for (const el of [inputLeft, inputRight]) {
  el.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      doCompare();
    }
  });
}
