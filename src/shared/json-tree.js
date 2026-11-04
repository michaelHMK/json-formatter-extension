import { t } from './i18n.js';
import { appendJsonPath } from '../core/json-path.js';

const STRING_PREVIEW = 2000;

export function span(className, text) {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

export function primitiveNode(value, path, numberLiterals) {
  if (value === null) return span('v null', 'null');
  if (typeof value === 'string') {
    let text = JSON.stringify(value);
    if (text.length > STRING_PREVIEW) {
      text = text.slice(0, STRING_PREVIEW) + t('strTruncated', [text.length.toLocaleString()]);
    }
    return span('v string', text);
  }
  if (typeof value === 'number') {
    const literal = numberLiterals && numberLiterals[path];
    return span('v number', literal !== undefined ? literal : String(value));
  }
  return span('v bool', String(value));
}

// 只为命中路径建立祖先索引，宽容器无需为找到一个远端命中渲染全部兄弟。
export function createChildPathIndex(paths) {
  const index = new Map();
  for (let path of paths) {
    while (path !== '') {
      const parent = path.slice(0, path.lastIndexOf('/'));
      let children = index.get(parent);
      if (!children) index.set(parent, children = new Set());
      if (children.has(path)) break;
      children.add(path);
      path = parent;
    }
  }
  return index;
}

// 首屏 + 必需子项保持原顺序；空隙各自分页，远端命中也能立即导航。
// keys 由容器闭包缓存，点击更多时不再枚举整个对象。
export function renderChildPages(container, value, basePath, {
  keys = Array.isArray(value) ? null : Object.keys(value),
  requiredPaths,
  onlyRequired = false,
  chunkSize = 200,
  renderEntry,
}) {
  const isArray = Array.isArray(value);
  const total = isArray ? value.length : keys.length;
  const selected = new Set();
  if (!onlyRequired) {
    for (let i = 0; i < Math.min(chunkSize, total); i++) selected.add(i);
  }
  if (requiredPaths?.size) {
    if (isArray) {
      for (const path of requiredPaths) {
        const key = path.slice(basePath.length + 1);
        const index = Number(key);
        if (Number.isInteger(index) && index >= 0 && index < total && String(index) === key) selected.add(index);
      }
    } else {
      // 一次扫描保留 JSON 对象的原生 key 顺序，避免每个命中都线性 indexOf。
      const wanted = new Set([...requiredPaths].map((path) =>
        path.slice(basePath.length + 1).replace(/~1/g, '/').replace(/~0/g, '~')));
      for (let i = 0; i < keys.length; i++) {
        if (wanted.has(keys[i])) selected.add(i);
      }
    }
  }

  const appendEntry = (parent, index) => {
    const key = isArray ? index : keys[index];
    renderEntry(parent, key, isArray, value[key], appendJsonPath(basePath, key));
  };
  const appendGap = (parent, start, end) => {
    if (onlyRequired || start >= end) return;
    const more = document.createElement('button');
    more.className = 'more';
    const update = () => {
      more.textContent = t('showMoreRange', [
        Math.min(chunkSize, end - start).toLocaleString(), (end - start).toLocaleString(),
      ]);
    };
    more.addEventListener('click', () => {
      const fragment = document.createDocumentFragment();
      const next = Math.min(start + chunkSize, end);
      for (; start < next; start++) appendEntry(fragment, start);
      more.before(fragment);
      if (start === end) more.remove();
      else update();
    });
    update();
    parent.appendChild(more);
  };

  const fragment = document.createDocumentFragment();
  let next = 0;
  for (const index of [...selected].sort((a, b) => a - b)) {
    appendGap(fragment, next, index);
    appendEntry(fragment, index);
    next = index + 1;
  }
  appendGap(fragment, next, total);
  container.appendChild(fragment);
}
