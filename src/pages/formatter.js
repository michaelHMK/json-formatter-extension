import { initializePage } from '../shared/page.js';
import { t } from '../shared/i18n.js';
import { createTaskRunner } from '../shared/worker-client.js';
import { createFeedback } from '../shared/feedback.js';
import { copyText } from '../shared/clipboard.js';
import { span, primitiveNode, createChildPathIndex, renderChildPages } from '../shared/json-tree.js';

initializePage();

/* ================= DOM ================= */
const $ = (id) => document.getElementById(id);

const inputEl = $('input');
const outputTextEl = $('output-text');
const treeEl = $('tree');
const statusEl = $('status');
const busyEl = $('busy');
const errorEl = $('error');
const indentSel = $('indent');
const autoFormatChk = $('auto-format');
const searchBox = $('search-box');
const searchInput = $('search');
const matchInfo = $('match-info');
const levelBox = $('level-box');
const levelSelect = $('level-select');

const CHUNK = 200;
// 单次渲染的节点数预算，防止「展开全部」在超大 JSON 上把页面卡死
const RENDER_BUDGET = 100000;

const state = {
  view: 'text',        // 'text' | 'tree'
  outputText: '',      // 最近一次操作产出的文本
  data: undefined,     // 最近一次解析出的对象（树视图/搜索用）
  numberLiterals: null, // 数字在原文中的字面量（path → 文本）
  dataSource: '',      // data 对应的原始文本，用于判断是否需要重新解析
  expanded: new Set(), // 用户手动展开的路径
  collapsed: new Set(), // 用户折叠优先于层级展开
  expandLevel: 1,      // 按需判断可见节点，不预先遍历整棵树
  searchForce: new Set(),  // 搜索命中需要强制展开的祖先路径
  searchChildren: new Map(), // 每个容器必须展示的命中子路径
  highlights: new Set(),   // 搜索命中的路径
  matchCount: 0,
  matchTruncated: false,
  matchIndex: -1,
  searchQuery: '',
  renderedCount: 0,    // 本轮 renderTree 已渲染的节点数
  renderLimited: false, // 是否因触及预算而截断了展开
};

let dataVersion = 0;

const runTask = createTaskRunner({
  onBusyChange: (busy) => { busyEl.hidden = !busy; },
});

/* ================= 状态展示 ================= */
const { setStatus, showError, hideError, showParseError } = createFeedback({
  statusEl, errorEl, inputEl,
});

/* ================= 视图切换 ================= */
function updateViewButtons() {
  $('view-text').classList.toggle('active', state.view === 'text');
  $('view-tree').classList.toggle('active', state.view === 'tree');
  outputTextEl.hidden = state.view !== 'text';
  treeEl.hidden = state.view !== 'tree';
  $('tree-tools').hidden = state.view !== 'tree';
  searchBox.hidden = state.view !== 'tree';
  levelBox.hidden = state.view !== 'tree';
}

function showText(text) {
  state.view = 'text';
  updateViewButtons();
  outputTextEl.textContent = text;
}

function currentText() {
  return state.outputText || inputEl.value;
}

// 树视图需要解析后的数据；若源文本没变则复用
async function ensureTreeData() {
  const text = currentText();
  if (!text.trim()) {
    showError(t('errNothingToParse'));
    return false;
  }
  if (state.data !== undefined && state.dataSource === text) return true;
  hideError();
  const version = dataVersion;
  const res = await runTask('parse', { text });
  if (version !== dataVersion || text !== currentText()) return false;
  if (!res.ok) {
    showParseError(text, res);
    return false;
  }
  state.data = res.result.data;
  state.numberLiterals = res.result.numberLiterals || null;
  state.dataSource = text;
  return true;
}

async function setView(view) {
  if (view === state.view) return;
  if (view === 'tree') {
    if (!(await ensureTreeData())) return;
    state.view = 'tree';
    updateViewButtons();
    if (searchInput.value.trim()) runSearch();
    else renderTree();
  } else {
    showText(state.outputText);
  }
}

/* ================= 操作 ================= */
async function doFormat() {
  const text = inputEl.value;
  if (!text.trim()) {
    showError(t('errNeedInput'));
    return;
  }
  hideError();
  const version = ++dataVersion;
  const res = await runTask('format', { text, indent: indentSel.value, includeData: state.view === 'tree' });
  if (version !== dataVersion) return;
  if (!res.ok) {
    showParseError(text, res);
    return;
  }
  state.outputText = res.result.text;
  state.data = res.result.data;
  state.numberLiterals = res.result.numberLiterals || null;
  state.dataSource = state.data === undefined ? '' : state.outputText;
  state.matchIndex = -1;
  if (state.view === 'tree') {
    if (searchInput.value.trim()) runSearch();
    else renderTree();
  } else {
    showText(state.outputText);
  }
  setStatus(t('statusFormatted', [state.outputText.length.toLocaleString(), String(res.duration)]));
}

async function doCopy() {
  const text = state.outputText || inputEl.value;
  if (!text) {
    showError(t('errNothingToCopy'));
    return;
  }
  hideError();
  await copyText(text);
  setStatus(t('statusCopied', [text.length.toLocaleString()]));
}

function doClear() {
  dataVersion++;
  clearTimeout(searchTimer);
  searchTimer = 0;
  void runTask('clear');
  inputEl.value = '';
  state.outputText = '';
  state.data = undefined;
  state.numberLiterals = null;
  state.dataSource = '';
  state.expanded.clear();
  state.collapsed.clear();
  state.expandLevel = 1;
  state.searchForce.clear();
  state.searchChildren.clear();
  state.highlights.clear();
  state.matchCount = 0;
  state.matchTruncated = false;
  state.matchIndex = -1;
  state.searchQuery = '';
  searchInput.value = '';
  levelSelect.value = '';
  treeEl.innerHTML = '';
  outputTextEl.textContent = '';
  hideError();
  setStatus('');
  updateMatchInfo();
  inputEl.focus();
}

function fillSample() {
  inputEl.value = JSON.stringify({
    name: 'JSON 格式化工具',
    free: true,
    features: ['格式化', '压缩', '转义互转', '树形视图', '搜索', 'JSON 对比'],
    limits: { ads: 0, tracking: null },
    nested: Array.from({ length: 3 }, (_, i) => ({ id: i + 1, done: i % 2 === 0 })),
  }, null, 2);
  hideError();
  doFormat();
}

/* ================= 树形视图 ================= */
function renderTree() {
  treeEl.innerHTML = '';
  state.renderedCount = 0;
  state.renderLimited = false;
  const root = document.createElement('div');
  root.className = 'tree-root';
  renderEntry(root, null, false, state.data, '', 0);
  treeEl.appendChild(root);
  if (state.renderLimited) {
    setStatus(t('renderLimitedTree', [RENDER_BUDGET.toLocaleString()]));
  }
  if (state.searchQuery && state.matchCount > 0) updateMatchNav(0);
  else updateMatchInfo();
}

function renderEntry(parentEl, key, isIndex, value, path, depth) {
  state.renderedCount++;
  const entry = document.createElement('div');
  entry.className = 'entry';
  if (state.highlights.has(path)) entry.classList.add('highlight');

  const row = document.createElement('div');
  row.className = 'row';
  entry.appendChild(row);

  if (value !== null && typeof value === 'object') {
    renderContainer(entry, row, key, isIndex, value, path, depth);
  } else {
    row.appendChild(span('toggle-spacer', ''));
    if (key !== null) {
      row.appendChild(span('key', isIndex ? String(key) : JSON.stringify(key)));
      row.appendChild(span('punct', ': '));
    }
    row.appendChild(primitiveNode(value, path, state.numberLiterals));
  }
  parentEl.appendChild(entry);
}

function renderContainer(entry, row, key, isIndex, value, path, depth) {
  const isArr = Array.isArray(value);
  const keys = isArr ? null : Object.keys(value);
  const size = isArr ? value.length : keys.length;
  const isRoot = path === '';
  const wantOpen = isRoot || state.searchForce.has(path) ||
    (!state.collapsed.has(path) && (state.expanded.has(path) || depth < state.expandLevel));
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

  // 展开时显示在子节点末尾的闭合括号（修复展开后括号丢失的问题）
  const footer = document.createElement('div');
  footer.className = 'row close-row';
  footer.appendChild(span('toggle-spacer', ''));
  footer.appendChild(span('punct', isArr ? ']' : '}'));
  entry.appendChild(footer);

  const renderKids = () => {
    if (children.dataset.done) return;
    children.dataset.done = '1';
    renderChildPages(children, value, path, {
      keys,
      requiredPaths: state.searchChildren.get(path),
      chunkSize: CHUNK,
      renderEntry: (parent, childKey, isIndex, child, childPath) =>
        renderEntry(parent, childKey, isIndex, child, childPath, depth + 1),
    });
  };

  const applyOpen = (o, byUser) => {
    toggle.textContent = o ? '▾' : '▸';
    children.style.display = o ? '' : 'none';
    footer.style.display = o ? '' : 'none';
    summary.style.display = o ? 'none' : '';
    closeBracket.style.display = o ? 'none' : '';
    if (byUser) {
      if (o) {
        state.expanded.add(path);
        state.collapsed.delete(path);
      } else {
        state.expanded.delete(path);
        state.collapsed.add(path);
      }
    }
    if (o) renderKids();
  };

  const flip = () => applyOpen(children.style.display === 'none', true);
  toggle.addEventListener('click', flip);
  summary.addEventListener('click', flip);
  footer.addEventListener('click', flip);
  row.addEventListener('click', (e) => {
    // 点行空白/括号区域也折叠，点 key/值文本不拦截（方便选择复制）
    if (e.target === row || e.target.classList.contains('punct')) flip();
  });

  applyOpen(open, false);
}

/* ================= 层级展开 ================= */
function applyLevel(value) {
  if (state.data === undefined || !value) return;
  const level = value === 'all' ? Infinity : Number(value);
  state.expandLevel = level;
  state.expanded.clear();
  state.collapsed.clear();
  renderTree();
  if (!state.renderLimited) {
    setStatus(level === Infinity ? t('expandedAll') : t('expandedLevel', [String(level)]));
  }
}

/* ================= 搜索 ================= */
let searchTimer = 0;

function scheduleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 300);
}

async function runSearch() {
  const q = searchInput.value.trim();
  state.searchQuery = q;
  state.matchIndex = -1;
  if (state.data === undefined) {
    updateMatchInfo();
    return;
  }
  if (!q) {
    state.highlights = new Set();
    state.searchForce = new Set();
    state.searchChildren = new Map();
    state.matchCount = 0;
    state.matchTruncated = false;
    renderTree();
    return;
  }
  const version = dataVersion;
  const res = await runTask('search', { text: q });
  if (version !== dataVersion || searchInput.value.trim() !== q) return;
  if (!res.ok) {
    showError(t('errSearchFailed') + res.error);
    return;
  }
  state.highlights = new Set(res.result.highlights);
  state.searchForce = new Set(res.result.forceExpand);
  state.searchChildren = createChildPathIndex(res.result.highlights);
  state.matchCount = res.result.matchCount;
  state.matchTruncated = res.result.truncated;
  renderTree();
}

function matchEls() {
  return treeEl.querySelectorAll('.entry.highlight');
}

function updateMatchNav(index) {
  const els = matchEls();
  if (!els.length) {
    state.matchIndex = -1;
    updateMatchInfo();
    return;
  }
  state.matchIndex = ((index % els.length) + els.length) % els.length;
  const prev = treeEl.querySelector('.entry.highlight.current');
  if (prev) prev.classList.remove('current');
  const el = els[state.matchIndex];
  el.classList.add('current');
  el.scrollIntoView({ block: 'center' });
  updateMatchInfo();
}

function updateMatchInfo() {
  if (!state.searchQuery) {
    matchInfo.textContent = '';
    return;
  }
  if (state.matchCount === 0) {
    matchInfo.textContent = t('matchNone');
    return;
  }
  const total = state.matchCount + (state.matchTruncated ? '+' : '');
  matchInfo.textContent = `${Math.max(state.matchIndex, 0) + 1} / ${total}`;
}

/* ================= 事件绑定 ================= */
$('btn-format').addEventListener('click', doFormat);
$('btn-copy').addEventListener('click', doCopy);
$('btn-clear').addEventListener('click', doClear);
$('btn-sample').addEventListener('click', fillSample);
$('view-text').addEventListener('click', () => setView('text'));
$('view-tree').addEventListener('click', () => setView('tree'));
$('match-prev').addEventListener('click', () => updateMatchNav(state.matchIndex - 1));
$('match-next').addEventListener('click', () => updateMatchNav(state.matchIndex + 1));

levelSelect.addEventListener('change', () => {
  applyLevel(levelSelect.value);
  levelSelect.value = ''; // 当作动作菜单用，选完复位到占位项
});

searchInput.addEventListener('input', scheduleSearch);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    updateMatchNav(state.matchIndex + (e.shiftKey ? -1 : 1));
  }
});

inputEl.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    doFormat();
  }
});

inputEl.addEventListener('paste', () => {
  if (autoFormatChk.checked) setTimeout(doFormat, 0);
});
