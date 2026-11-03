import { appendJsonPath, PATH_SEP } from './json-path.js';

const MAX_MATCHES = 500;

/*
 * 迭代式 DFS 搜索（避免深嵌套爆栈）。
 * 命中规则：对象的 key 包含子串，或基本类型的值包含子串（均忽略大小写）。
 * 数组下标不参与 key 匹配，避免搜 "0" 命中一切。
 * 返回命中路径、需要强制展开的祖先路径、总命中数和截断标记。
 */
export function searchData(data, query) {
  const q = query.toLowerCase();
  const highlights = [];
  const forceExpand = new Set();
  let matchCount = 0;
  let truncated = false;

  const stack = [{ key: null, isIndex: false, value: data, path: '', depth: 0 }];
  const ancestors = [];

  while (stack.length) {
    const item = stack.pop();
    const { value, path, depth } = item;
    ancestors.length = depth;

    let matched = false;
    if (item.key !== null && !item.isIndex && item.key.toLowerCase().includes(q)) {
      matched = true;
    }
    if (!matched && (value === null || typeof value !== 'object')) {
      if (String(value).toLowerCase().includes(q)) matched = true;
    }
    if (matched) {
      matchCount++;
      if (highlights.length < MAX_MATCHES) {
        highlights.push(path);
        for (let i = 0; i < depth; i++) forceExpand.add(ancestors[i]);
      } else {
        truncated = true;
      }
    }

    if (value !== null && typeof value === 'object') {
      ancestors[depth] = path;
      if (Array.isArray(value)) {
        for (let i = value.length - 1; i >= 0; i--) {
          stack.push({
            key: String(i),
            isIndex: true,
            value: value[i],
            path: path + PATH_SEP + i,
            depth: depth + 1,
          });
        }
      } else {
        const keys = Object.keys(value);
        for (let i = keys.length - 1; i >= 0; i--) {
          const k = keys[i];
          stack.push({
            key: k,
            isIndex: false,
            value: value[k],
            path: appendJsonPath(path, k),
            depth: depth + 1,
          });
        }
      }
    }
  }

  return { highlights, forceExpand: [...forceExpand], matchCount, truncated };
}
