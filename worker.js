'use strict';

/*
 * Web Worker：负责所有可能阻塞 UI 的重活（大 JSON 的解析、序列化、搜索、对比）。
 * 主线程通过 postMessage({ id, action, text, ... }) 调用，
 * 返回 { id, ok, result, error, position, line, column, duration }。
 *
 * 同时挂载了 module.exports，方便在 node 下直接单测纯函数。
 */

// 最近一次解析出的数据，供 search 复用，避免每次搜索都重新传输/解析
let lastData;

const MAX_MATCHES = 500;
// 树节点路径使用 JSON Pointer：key 中的 ~ 和 / 分别转义为 ~0 和 ~1，避免路径碰撞
const PATH_SEP = '/';
// diff 结果收录上限（超出继续计数但不再收录明细）
const MAX_DIFFS = 5000;
// 主键配对时发出的左右路径映射上限
const MAX_PAIRS = 100000;
// 文本 diff 中间差异段超过该行数时退化为整块替换展示
const TEXT_DIFF_MAX_MIDDLE = 3000;

function computeLineCol(text, pos) {
  const before = text.slice(0, pos);
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

// 从不同版本 V8 的错误信息中提取位置：
//   旧版: "Unexpected token i in JSON at position 1"
//   新版: "Expected property name or '}' in JSON at position 1 (line 1 column 2)"
function parseErrorLocation(message, text) {
  const result = { position: null, line: null, column: null };
  if (!message) return result;
  const posMatch = /position\s+(\d+)/i.exec(message);
  if (posMatch) result.position = Number(posMatch[1]);
  const lcMatch = /line\s+(\d+)\s+column\s+(\d+)/i.exec(message);
  if (lcMatch) {
    result.line = Number(lcMatch[1]);
    result.column = Number(lcMatch[2]);
  } else if (result.position !== null && typeof text === 'string') {
    const lc = computeLineCol(text, result.position);
    result.line = lc.line;
    result.column = lc.column;
  }
  return result;
}

// 转义：把任意文本变成 JSON 字符串字面量的内容（{"a":1} -> {\"a\":1}）
function escapeJsonString(s) {
  return JSON.stringify(s).slice(1, -1);
}

/*
 * 去转义：escapeJsonString 的逆操作。
 * 文本里若含原始控制字符（换行、制表符等），直接包引号会解析失败，
 * 先把 charCode < 0x20 的字符统一转成转义序列，再用 JSON.parse 还原。
 * （0x2028/0x2029 在 JSON 字符串里是合法的，无需处理。）
 */
function unescapeJsonString(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20) {
      if (code === 10) out += '\\n';
      else if (code === 13) out += '\\r';
      else if (code === 9) out += '\\t';
      else out += '\\u' + code.toString(16).padStart(4, '0');
    } else {
      out += s[i];
    }
  }
  return JSON.parse('"' + out + '"');
}

function appendJsonPath(path, key) {
  key = String(key);
  if (key.includes('~') || key.includes('/')) {
    key = key.replace(/~/g, '~0').replace(/\//g, '~1');
  }
  return path + PATH_SEP + key;
}

function skipJsonWhitespace(text, i) {
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) i++;
    else break;
  }
  return i;
}

// 输入必须先通过 JSON.parse；restore=true 时把原生序列化丢失的数字字面量回填
function scanNumberLiterals(text, numberLiterals, restore) {
  const parentDepths = [];
  const containerIsArray = [];
  const arrayIndexes = [];
  const objectKeys = [];
  const objectKeySets = [];
  const pathSegments = [];
  const encodedPaths = [''];
  const chunks = restore ? [] : null;
  let depth = 0;
  let i = 0;
  let state = 0; // 0=值，1=对象 key，2=值结束
  let copyFrom = 0;

  function setSegment(index, value) {
    pathSegments[index] = value;
    pathSegments.length = index + 1;
    encodedPaths.length = Math.min(encodedPaths.length, index + 1);
  }

  function currentPath() {
    const length = pathSegments.length;
    for (let n = encodedPaths.length; n <= length; n++) {
      encodedPaths[n] = appendJsonPath(encodedPaths[n - 1], pathSegments[n - 1]);
    }
    return encodedPaths[length];
  }

  while (true) {
    if (state === 2) {
      if (depth === 0) break;
      i = skipJsonWhitespace(text, i);
      const parentDepth = parentDepths[depth - 1];
      if (text.charCodeAt(i) === 44) {
        i++;
        if (containerIsArray[depth - 1]) {
          setSegment(parentDepth, ++arrayIndexes[depth - 1]);
          state = 0;
        } else {
          state = 1;
        }
      } else {
        i++;
        depth--;
        pathSegments.length = parentDepth;
        encodedPaths.length = Math.min(encodedPaths.length, parentDepth + 1);
      }
      continue;
    }

    i = skipJsonWhitespace(text, i);
    if (state === 1) {
      const keyStart = i;
      let escaped = false;
      i++;
      while (i < text.length) {
        const c = text.charCodeAt(i);
        if (c === 34) break;
        if (c === 92) {
          escaped = true;
          i += 2;
        } else {
          i++;
        }
      }
      let key = text.slice(keyStart + 1, i);
      if (escaped) key = JSON.parse(text.slice(keyStart, i + 1));
      i = skipJsonWhitespace(text, i + 1) + 1;
      const parentDepth = parentDepths[depth - 1];
      setSegment(parentDepth, key);
      if (!restore) {
        const frame = depth - 1;
        const seen = objectKeys[frame];
        const seenSet = objectKeySets[frame];
        const duplicate = seenSet ? seenSet.has(key) : seen.includes(key);
        if (duplicate) {
          const prefix = currentPath();
          const descendants = prefix + PATH_SEP;
          for (const stored in numberLiterals) {
            if (stored === prefix || stored.startsWith(descendants)) delete numberLiterals[stored];
          }
        }
        if (seenSet) {
          seenSet.add(key);
        } else {
          seen.push(key);
          if (seen.length === 16) objectKeySets[frame] = new Set(seen);
        }
      }
      state = 0;
      continue;
    }

    const c = text.charCodeAt(i);
    if (c === 123) {
      i = skipJsonWhitespace(text, i + 1);
      if (text.charCodeAt(i) === 125) {
        i++;
        state = 2;
      } else {
        parentDepths[depth] = pathSegments.length;
        containerIsArray[depth] = false;
        arrayIndexes[depth] = 0;
        if (!restore) {
          const keys = objectKeys[depth] || [];
          keys.length = 0;
          objectKeys[depth] = keys;
          objectKeySets[depth] = null;
        }
        depth++;
        state = 1;
      }
      continue;
    }
    if (c === 91) {
      i = skipJsonWhitespace(text, i + 1);
      if (text.charCodeAt(i) === 93) {
        i++;
        state = 2;
      } else {
        const parentDepth = pathSegments.length;
        parentDepths[depth] = parentDepth;
        containerIsArray[depth] = true;
        arrayIndexes[depth] = 0;
        objectKeys[depth] = null;
        objectKeySets[depth] = null;
        depth++;
        setSegment(parentDepth, 0);
        state = 0;
      }
      continue;
    }
    if (c === 34) {
      i++;
      while (i < text.length) {
        const code = text.charCodeAt(i++);
        if (code === 34) break;
        if (code === 92) i++;
      }
      state = 2;
      continue;
    }
    if (c === 45 || (c >= 48 && c <= 57)) {
      const start = i++;
      let simpleInteger = true;
      while (i < text.length) {
        const code = text.charCodeAt(i);
        if (code === 44 || code === 93 || code === 125 || code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09) break;
        if (!restore && (code === 46 || code === 101 || code === 69)) simpleInteger = false;
        i++;
      }
      const length = i - start;
      if (!restore && simpleInteger && length <= 15 && !(length === 2 && text.charCodeAt(start) === 45)) {
        state = 2;
        continue;
      }
      const raw = text.slice(start, i);
      if (restore) {
        const literal = numberLiterals[currentPath()];
        if (literal !== undefined && literal !== raw) {
          chunks.push(text.slice(copyFrom, start), literal);
          copyFrom = i;
        }
      } else {
        const value = Number(raw);
        if (!Number.isFinite(value) || raw !== String(value)) numberLiterals[currentPath()] = raw;
      }
      state = 2;
      continue;
    }
    if (c === 110) {
      i += 4;
      if (restore) {
        const literal = numberLiterals[currentPath()];
        if (literal !== undefined) {
          chunks.push(text.slice(copyFrom, i - 4), literal);
          copyFrom = i;
        }
      }
    } else {
      i += c === 116 ? 4 : 5;
    }
    state = 2;
  }

  if (!restore) return numberLiterals;
  if (copyFrom === 0) return text;
  chunks.push(text.slice(copyFrom));
  return chunks.join('');
}

/*
 * 原生 JSON.parse 负责完整的语法和对象语义；扫描仅记录原生序列化会改变的数字。
 * 稀疏字面量表既保留尾零/指数/精度，也避免为普通整数重复占用内存。
 */
function parseJsonPreservingNumberLiterals(text) {
  const data = JSON.parse(text);
  const numberLiterals = scanNumberLiterals(text, Object.create(null), false);
  return { data, numberLiterals };
}

function restoreNumberLiterals(text, numberLiterals) {
  if (!numberLiterals) return text;
  for (const path in numberLiterals) return scanNumberLiterals(text, numberLiterals, true);
  return text;
}

function stringifyJsonCompact(value, numberLiterals) {
  return restoreNumberLiterals(JSON.stringify(value), numberLiterals);
}

function stringifyJsonPretty(value, numberLiterals, indentUnit) {
  return restoreNumberLiterals(JSON.stringify(value, null, indentUnit), numberLiterals);
}

function normalizeJsonIndent(indent) {
  if (indent === 'tab') return '\t';
  const value = Number(indent) || 2;
  if (value <= 0) return null;
  return ' '.repeat(Math.min(10, Math.floor(value)));
}

// 常见输入直接生成结果；需要原生 key 排序、去重或字符串规范化时返回 null
function formatJsonTextDirect(text, indentUnit) {
  const pretty = indentUnit !== null;
  const lineIndents = pretty ? ['\n'] : null;
  const parentIsArray = [];
  const objectKeys = [];
  const objectKeySets = [];
  let depth = 0;
  let i = 0;
  let state = 0; // 0=值，1=对象 key，2=值结束
  let output = '';

  function lineIndent(level) {
    if (lineIndents[level] === undefined) lineIndents[level] = '\n' + indentUnit.repeat(level);
    return lineIndents[level];
  }

  while (true) {
    if (state === 2) {
      if (depth === 0) break;
      i = skipJsonWhitespace(text, i);
      if (text.charCodeAt(i) === 44) {
        output += ',';
        i++;
        if (pretty) output += lineIndent(depth);
        state = parentIsArray[depth - 1] ? 0 : 1;
      } else {
        const close = text[i++];
        depth--;
        if (pretty) output += lineIndent(depth);
        output += close;
      }
      continue;
    }

    i = skipJsonWhitespace(text, i);
    if (state === 1) {
      const start = i++;
      let escaped = false;
      while (i < text.length) {
        const c = text.charCodeAt(i);
        if (c === 34) break;
        if (c === 92) {
          const escapedCode = text.charCodeAt(i + 1);
          if (escapedCode === 117 || escapedCode === 47) return null;
          escaped = true;
          i += 2;
        } else {
          if (c >= 0xd800 && c <= 0xdfff) return null;
          i++;
        }
      }
      i++;
      const token = text.slice(start, i);
      const key = escaped ? JSON.parse(token) : token.slice(1, -1);
      const frame = depth - 1;
      const seen = objectKeys[frame];
      const seenSet = objectKeySets[frame];
      if ((key.charCodeAt(0) >= 48 && key.charCodeAt(0) <= 57) || (seenSet ? seenSet.has(key) : seen.includes(key))) return null;
      if (seenSet) {
        seenSet.add(key);
      } else {
        seen.push(key);
        if (seen.length === 16) objectKeySets[frame] = new Set(seen);
      }
      output += token + (pretty ? ': ' : ':');
      i = skipJsonWhitespace(text, i) + 1;
      state = 0;
      continue;
    }

    const c = text.charCodeAt(i);
    if (c === 123 || c === 91) {
      const isArray = c === 91;
      const close = isArray ? ']' : '}';
      const end = skipJsonWhitespace(text, i + 1);
      if (text.charCodeAt(end) === close.charCodeAt(0)) {
        output += text[i] + close;
        i = end + 1;
        state = 2;
        continue;
      }
      parentIsArray[depth] = isArray;
      if (isArray) {
        objectKeys[depth] = null;
        objectKeySets[depth] = null;
      } else {
        const keys = objectKeys[depth] || [];
        keys.length = 0;
        objectKeys[depth] = keys;
        objectKeySets[depth] = null;
      }
      depth++;
      output += text[i];
      if (pretty) output += lineIndent(depth);
      i++;
      state = isArray ? 0 : 1;
      continue;
    }
    if (c === 34) {
      const start = i++;
      while (i < text.length) {
        const code = text.charCodeAt(i++);
        if (code === 34) break;
        if (code === 92) {
          const escapedCode = text.charCodeAt(i++);
          if (escapedCode === 117 || escapedCode === 47) return null;
        } else if (code >= 0xd800 && code <= 0xdfff) {
          return null;
        }
      }
      output += text.slice(start, i);
      state = 2;
      continue;
    }
    const start = i;
    while (i < text.length) {
      const code = text.charCodeAt(i);
      if (code === 44 || code === 93 || code === 125 || code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09) break;
      i++;
    }
    output += text.slice(start, i);
    state = 2;
  }
  return output;
}

/*
 * 迭代式 DFS 搜索（避免深嵌套爆栈）。
 * 命中规则：对象的 key 包含子串，或基本类型的值包含子串（均忽略大小写）。
 * 数组下标不参与 key 匹配，避免搜 "0" 命中一切。
 * 返回命中路径、需要强制展开的祖先路径、总命中数和截断标记。
 */
function searchData(data, query) {
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

/* ================= JSON 结构对比 ================= */

// 解析忽略路径模式：'a.b[0].c' → ['a','b','0','c']；'list[*].x' → ['list','*','x']
function parseIgnorePattern(pattern) {
  const segs = [];
  const re = /[^.[\]]+|\[(?:\*|\d+)\]/g;
  let m;
  while ((m = re.exec(pattern)) !== null) {
    let s = m[0];
    if (s[0] === '[') s = s.slice(1, -1);
    segs.push(s);
  }
  return segs;
}

function matchSegments(patternSegs, segs) {
  if (patternSegs.length !== segs.length) return false;
  for (let i = 0; i < segs.length; i++) {
    if (patternSegs[i] !== '*' && patternSegs[i] !== segs[i]) return false;
  }
  return true;
}

// 段数组 → 展示用路径，如 a.b[0].c / a["weird key"]
function displayPath(segs) {
  if (!segs.length) return '(根)';
  let out = '';
  for (const s of segs) {
    if (/^\d+$/.test(s)) out += '[' + s + ']';
    else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s)) out += (out ? '.' : '') + s;
    else out += '[' + JSON.stringify(s) + ']';
  }
  return out;
}

function previewValue(v, path, numberLiterals) {
  if (v === undefined) return '';
  if (v === null || typeof v !== 'object') {
    let s;
    if (typeof v === 'number' && numberLiterals && path != null && Object.prototype.hasOwnProperty.call(numberLiterals, path)) {
      s = numberLiterals[path];
    } else {
      s = JSON.stringify(v);
    }
    return s.length > 80 ? s.slice(0, 80) + '…' : s;
  }
  if (Array.isArray(v)) return '[' + v.length + ' 项]';
  return '{' + Object.keys(v).length + ' 键}';
}

/*
 * 结构 diff：递归对齐两棵树，产出 added / removed / changed / typeChanged 四类差异。
 * 数组默认按下标对齐；指定 keyField 且两边元素都是含该字段的对象时按主键配对，
 * 元素换位不算差异；不满足条件则回退下标模式并置 keyFallback。
 * 忽略路径为精确段匹配（* 匹配任意单段），命中即不收录。
 */
function diffData(left, right, options) {
  const keyField = (options && options.keyField) || '';
  const leftNumberLiterals = (options && options.leftNumberLiterals) || null;
  const rightNumberLiterals = (options && options.rightNumberLiterals) || null;
  const ignoreSegs = ((options && options.ignorePaths) || [])
    .map(parseIgnorePattern)
    .filter((s) => s.length > 0);
  const diffs = [];
  const pairs = [];
  const stats = { added: 0, removed: 0, changed: 0, typeChanged: 0 };
  let truncated = false;
  let keyFallback = false;

  const ignored = (segs) => ignoreSegs.some((p) => matchSegments(p, segs));

  // 与树渲染共用 JSON Pointer 路径，任意 key 都能无损编码
  function toPath(segs) {
    let path = '';
    for (const seg of segs) path = appendJsonPath(path, seg);
    return path;
  }

  function record(type, leftSegs, rightSegs, lv, rv) {
    if (leftSegs && ignored(leftSegs)) return;
    if (rightSegs && ignored(rightSegs)) return;
    stats[type]++;
    if (diffs.length < MAX_DIFFS) {
      diffs.push({
        type,
        leftPath: leftSegs ? toPath(leftSegs) : null,
        rightPath: rightSegs ? toPath(rightSegs) : null,
        display: displayPath(rightSegs || leftSegs),
        leftPreview: previewValue(lv, leftSegs ? toPath(leftSegs) : null, leftNumberLiterals),
        rightPreview: previewValue(rv, rightSegs ? toPath(rightSegs) : null, rightNumberLiterals),
      });
    } else {
      truncated = true;
    }
  }

  // 数组元素是否都可用主键配对
  function isKeyed(arr) {
    if (!keyField) return false;
    for (const item of arr) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) return false;
      const kv = item[keyField];
      const t = typeof kv;
      if (kv === null || (t !== 'string' && t !== 'number' && t !== 'boolean')) return false;
    }
    return true;
  }

  function walk(lv, rv, leftSegs, rightSegs) {
    const lObj = lv !== null && typeof lv === 'object';
    const rObj = rv !== null && typeof rv === 'object';
    if (!lObj || !rObj) {
      if (lObj !== rObj) record('typeChanged', leftSegs, rightSegs, lv, rv);
      else if (lv !== rv) record('changed', leftSegs, rightSegs, lv, rv);
      return;
    }
    const lArr = Array.isArray(lv);
    const rArr = Array.isArray(rv);
    if (lArr !== rArr) {
      record('typeChanged', leftSegs, rightSegs, lv, rv);
      return;
    }
    if (!lArr) {
      for (const k of Object.keys(lv)) {
        const ls = leftSegs.concat(k);
        if (Object.prototype.hasOwnProperty.call(rv, k)) {
          walk(lv[k], rv[k], ls, rightSegs.concat(k));
        } else {
          record('removed', ls, null, lv[k]);
        }
      }
      for (const k of Object.keys(rv)) {
        if (!Object.prototype.hasOwnProperty.call(lv, k)) {
          record('added', null, rightSegs.concat(k), undefined, rv[k]);
        }
      }
      return;
    }
    // 数组
    if (isKeyed(lv) && isKeyed(rv)) {
      const rightByKey = new Map();
      for (let j = 0; j < rv.length; j++) {
        const k = String(rv[j][keyField]);
        if (!rightByKey.has(k)) rightByKey.set(k, j);
      }
      const matched = new Set();
      for (let i = 0; i < lv.length; i++) {
        const k = String(lv[i][keyField]);
        const ls = leftSegs.concat(String(i));
        if (rightByKey.has(k) && !matched.has(rightByKey.get(k))) {
          const j = rightByKey.get(k);
          matched.add(j);
          const rs = rightSegs.concat(String(j));
          if (i !== j && pairs.length < MAX_PAIRS) {
            pairs.push([toPath(ls), toPath(rs)]);
          }
          walk(lv[i], rv[j], ls, rs);
        } else {
          record('removed', ls, null, lv[i]);
        }
      }
      for (let j = 0; j < rv.length; j++) {
        if (!matched.has(j)) record('added', null, rightSegs.concat(String(j)), undefined, rv[j]);
      }
    } else {
      if (keyField && (lv.length || rv.length)) keyFallback = true;
      const n = Math.min(lv.length, rv.length);
      for (let i = 0; i < n; i++) {
        const s = String(i);
        walk(lv[i], rv[i], leftSegs.concat(s), rightSegs.concat(s));
      }
      for (let i = n; i < lv.length; i++) record('removed', leftSegs.concat(String(i)), null, lv[i]);
      for (let i = n; i < rv.length; i++) {
        record('added', null, rightSegs.concat(String(i)), undefined, rv[i]);
      }
    }
  }

  walk(left, right, [], []);
  return {
    diffs,
    pairs,
    stats,
    truncated,
    keyFallback,
    total: stats.added + stats.removed + stats.changed + stats.typeChanged,
  };
}

/* ================= 文本行 diff ================= */

// Myers O(ND) 行级 diff，返回 run 序列：{ type: 'same'|'del'|'add', aStart/bStart, count }
function myersOps(a, b) {
  const N = a.length;
  const M = b.length;
  const MAX = N + M;
  const off = MAX + 1;
  const V = new Int32Array(2 * MAX + 3);
  V[off + 1] = 0;
  const trace = [];
  let D = -1;
  for (let d = 0; d <= MAX; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && V[off + k - 1] < V[off + k + 1])) x = V[off + k + 1];
      else x = V[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) { x++; y++; }
      V[off + k] = x;
      if (x >= N && y >= M) { D = d; break; }
    }
    trace.push(V.slice(0));
    if (D >= 0) break;
  }
  // 回溯生成点操作（t: 0=same 1=add 2=del）
  const points = [];
  let x = N;
  let y = M;
  for (let d = D; d >= 1; d--) {
    const v = trace[d - 1];
    const k = x - y;
    const prevK = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? k + 1 : k - 1;
    const prevX = v[off + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { points.push({ t: 0, a: x - 1, b: y - 1 }); x--; y--; }
    if (x === prevX) { points.push({ t: 1, b: y - 1 }); y--; }
    else { points.push({ t: 2, a: x - 1 }); x--; }
  }
  while (x > 0 && y > 0) { points.push({ t: 0, a: x - 1, b: y - 1 }); x--; y--; }
  points.reverse();
  // 合并成 runs
  const ops = [];
  for (const p of points) {
    const last = ops[ops.length - 1];
    if (p.t === 0) {
      if (last && last.type === 'same') last.count++;
      else ops.push({ type: 'same', aStart: p.a, bStart: p.b, count: 1 });
    } else if (p.t === 1) {
      if (last && last.type === 'add') last.count++;
      else ops.push({ type: 'add', bStart: p.b, count: 1 });
    } else {
      if (last && last.type === 'del') last.count++;
      else ops.push({ type: 'del', aStart: p.a, count: 1 });
    }
  }
  return ops;
}

/*
 * 文本对比：两边用相同缩进格式化后做行级 diff。
 * 先削掉头尾公共行，中间段 ≤ TEXT_DIFF_MAX_MIDDLE 行时跑 Myers，
 * 否则退化为整块 del+add（blocky=true），避免超大 diff 的内存/时间爆炸。
 * ops 只存行区间，行内容由主线程从 aText/bText 里取。
 */
function makeTextDiff(text, text2, indent) {
  const indentUnit = normalizeJsonIndent(indent);
  const same = text === text2;
  const leftData = JSON.parse(text);
  const rightData = same ? leftData : JSON.parse(text2);
  let aText = formatJsonTextDirect(text, indentUnit);
  let bText = same ? null : formatJsonTextDirect(text2, indentUnit);
  if (aText === null) {
    const literals = scanNumberLiterals(text, Object.create(null), false);
    aText = stringifyJsonPretty(leftData, literals, indentUnit);
  }
  if (same) {
    bText = aText;
  } else if (bText === null) {
    const literals = scanNumberLiterals(text2, Object.create(null), false);
    bText = stringifyJsonPretty(rightData, literals, indentUnit);
  }
  const a = aText.split('\n');
  const b = bText.split('\n');

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }

  const midA = a.slice(start, endA + 1);
  const midB = b.slice(start, endB + 1);
  const ops = [];
  let blocky = false;

  if (start > 0) ops.push({ type: 'same', aStart: 0, bStart: 0, count: start });
  if (midA.length + midB.length > TEXT_DIFF_MAX_MIDDLE) {
    blocky = true;
    if (midA.length) ops.push({ type: 'del', aStart: start, count: midA.length });
    if (midB.length) ops.push({ type: 'add', bStart: start, count: midB.length });
  } else {
    for (const op of myersOps(midA, midB)) {
      const shifted = { type: op.type, count: op.count };
      if (op.aStart !== undefined) shifted.aStart = op.aStart + start;
      if (op.bStart !== undefined) shifted.bStart = op.bStart + start;
      ops.push(shifted);
    }
  }
  const suffix = a.length - 1 - endA;
  if (suffix > 0) ops.push({ type: 'same', aStart: endA + 1, bStart: endB + 1, count: suffix });

  return { ops, aText, bText, blocky, totalLines: [a.length, b.length] };
}

/* ================= 入口 ================= */

function runAction(action, text, indent, extra) {
  switch (action) {
    case 'format': {
      const data = JSON.parse(text);
      lastData = data;
      const includeData = !extra || extra.includeData !== false;
      const indentUnit = normalizeJsonIndent(indent);
      let output = formatJsonTextDirect(text, indentUnit);
      let numberLiterals = null;
      if (output === null || includeData) {
        numberLiterals = scanNumberLiterals(text, Object.create(null), false);
      }
      if (output === null) output = stringifyJsonPretty(data, numberLiterals, indentUnit);
      const result = { text: output };
      if (includeData) {
        result.data = data;
        result.numberLiterals = numberLiterals;
      }
      return result;
    }
    case 'minify': {
      const data = JSON.parse(text);
      lastData = data;
      let output = formatJsonTextDirect(text, null);
      if (output === null) {
        const literals = scanNumberLiterals(text, Object.create(null), false);
        output = stringifyJsonCompact(data, literals);
      }
      return { text: output };
    }
    case 'parse': {
      const parsed = parseJsonPreservingNumberLiterals(text);
      lastData = parsed.data;
      return { data: parsed.data, numberLiterals: parsed.numberLiterals };
    }
    case 'escape':
      return { text: escapeJsonString(text) };
    case 'unescape':
      return { text: unescapeJsonString(text) };
    case 'search':
      if (lastData === undefined) throw new Error('请先解析 JSON');
      return searchData(lastData, text); // text 这里是查询词
    case 'diff': {
      let leftParsed;
      let rightParsed;
      try {
        leftParsed = parseJsonPreservingNumberLiterals(text);
      } catch (e) {
        throw new Error('左侧 JSON 无效：' + e.message);
      }
      if (extra && extra.text2 === text) {
        rightParsed = leftParsed;
      } else {
        try {
          rightParsed = parseJsonPreservingNumberLiterals(extra && extra.text2);
        } catch (e) {
          throw new Error('右侧 JSON 无效：' + e.message);
        }
      }
      const diffOpts = Object.assign({}, extra, {
        leftNumberLiterals: leftParsed.numberLiterals,
        rightNumberLiterals: rightParsed.numberLiterals,
      });
      const result = diffData(leftParsed.data, rightParsed.data, diffOpts);
      result.leftData = leftParsed.data;
      result.rightData = rightParsed.data;
      result.leftNumberLiterals = leftParsed.numberLiterals;
      result.rightNumberLiterals = rightParsed.numberLiterals;
      return result;
    }
    case 'textDiff':
      return makeTextDiff(text, extra && extra.text2, indent);
    default:
      throw new Error('未知操作: ' + action);
  }
}

// ---- Worker 环境：消息循环 ----
if (typeof self !== 'undefined' && typeof importScripts === 'function') {
  self.onmessage = (e) => {
    const { id, action, text, indent } = e.data;
    const started = Date.now();
    try {
      const result = runAction(action, text, indent, e.data);
      self.postMessage({ id, ok: true, result, duration: Date.now() - started });
    } catch (err) {
      const loc = parseErrorLocation(err.message, text);
      self.postMessage({
        id,
        ok: false,
        error: err.message,
        position: loc.position,
        line: loc.line,
        column: loc.column,
        duration: Date.now() - started,
      });
    }
  };
}

// ---- node 环境：导出纯函数用于测试 ----
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    runAction,
    escapeJsonString,
    unescapeJsonString,
    searchData,
    computeLineCol,
    parseErrorLocation,
    parseIgnorePattern,
    matchSegments,
    displayPath,
    previewValue,
    diffData,
    myersOps,
    makeTextDiff,
    parseJsonPreservingNumberLiterals,
    stringifyJsonCompact,
    stringifyJsonPretty,
    PATH_SEP,
  };
}
