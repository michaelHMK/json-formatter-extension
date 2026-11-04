import { appendJsonPath } from './json-path.js';

// 超出明细上限仍继续统计总数；主键配对映射单独限制大小。
const MAX_DIFFS = 5000;
const MAX_PAIRS = 100000;

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
 * 结构 diff：深度优先对齐两棵树，产出 added / removed / changed / typeChanged 四类差异。
 * 数组默认按下标对齐；指定 keyField 且两边元素都是含该字段的对象时按主键配对，
 * 元素换位不算差异；不满足条件则回退下标模式并置 keyFallback。
 * 忽略路径为精确段匹配（* 匹配任意单段），命中即不收录。
 */
export function diffData(left, right, options) {
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

  const ignoreByDepth = new Map();
  for (const pattern of ignoreSegs) {
    const patterns = ignoreByDepth.get(pattern.length);
    if (patterns) patterns.push(pattern);
    else ignoreByDepth.set(pattern.length, [pattern]);
  }
  const ignored = (segs) => {
    const patterns = ignoreByDepth.get(segs.length);
    return patterns ? patterns.some((pattern) => matchSegments(pattern, segs)) : false;
  };

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
      const leftPath = leftSegs ? toPath(leftSegs) : null;
      const rightPath = rightSegs ? toPath(rightSegs) : null;
      diffs.push({
        type,
        leftPath,
        rightPath,
        display: displayPath(rightSegs || leftSegs),
        leftPreview: previewValue(lv, leftPath, leftNumberLiterals),
        rightPreview: previewValue(rv, rightPath, rightNumberLiterals),
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

  // 活动帧按深度复用，不依赖调用栈，也不为每个待访问节点分配任务对象。
  // type: 1=对象，2=按下标对齐的数组，3=按主键配对的数组。
  const frames = [];
  const leftSegs = [];
  const rightSegs = [];

  function enter(lv, rv, depth) {
    if (lv === rv && !keyField) return false;
    const lObj = lv !== null && typeof lv === 'object';
    const rObj = rv !== null && typeof rv === 'object';
    if (!lObj || !rObj) {
      if (lObj !== rObj) record('typeChanged', leftSegs, rightSegs, lv, rv);
      else if (lv !== rv) record('changed', leftSegs, rightSegs, lv, rv);
      return false;
    }
    const lArr = Array.isArray(lv);
    if (lArr !== Array.isArray(rv)) {
      record('typeChanged', leftSegs, rightSegs, lv, rv);
      return false;
    }
    let frame = frames[depth];
    if (!frame) {
      frame = { left: null, right: null, type: 0, index: 0, length: 0, keys: null, rightByKey: null, matched: null };
      frames[depth] = frame;
    }
    frame.left = lv;
    frame.right = rv;
    frame.index = 0;
    if (!lArr) {
      frame.type = 1;
      frame.keys = Object.keys(lv);
    } else if (isKeyed(lv) && isKeyed(rv)) {
      frame.type = 3;
      const rightByKey = new Map();
      for (let j = 0; j < rv.length; j++) {
        const key = String(rv[j][keyField]);
        if (!rightByKey.has(key)) rightByKey.set(key, j);
      }
      frame.rightByKey = rightByKey;
      frame.matched = new Uint8Array(rv.length);
    } else {
      frame.type = 2;
      frame.length = Math.min(lv.length, rv.length);
      if (keyField && (lv.length || rv.length)) keyFallback = true;
    }
    return true;
  }

  let depth = enter(left, right, 0) ? 0 : -1;
  while (depth >= 0) {
    const frame = frames[depth];
    const lv = frame.left;
    const rv = frame.right;
    if (frame.type === 1) {
      if (frame.index < frame.keys.length) {
        const key = frame.keys[frame.index++];
        leftSegs.push(key);
        if (Object.prototype.hasOwnProperty.call(rv, key)) {
          rightSegs.push(key);
          if (enter(lv[key], rv[key], depth + 1)) depth++;
          else { leftSegs.pop(); rightSegs.pop(); }
        } else {
          record('removed', leftSegs, null, lv[key]);
          leftSegs.pop();
        }
        continue;
      }
      for (const key of Object.keys(rv)) {
        if (!Object.prototype.hasOwnProperty.call(lv, key)) {
          rightSegs.push(key);
          record('added', null, rightSegs, undefined, rv[key]);
          rightSegs.pop();
        }
      }
    } else if (frame.type === 2) {
      if (frame.index < frame.length) {
        const i = frame.index++;
        const key = String(i);
        leftSegs.push(key);
        rightSegs.push(key);
        if (enter(lv[i], rv[i], depth + 1)) depth++;
        else { leftSegs.pop(); rightSegs.pop(); }
        continue;
      }
      for (let i = frame.length; i < lv.length; i++) {
        leftSegs.push(String(i));
        record('removed', leftSegs, null, lv[i]);
        leftSegs.pop();
      }
      for (let i = frame.length; i < rv.length; i++) {
        rightSegs.push(String(i));
        record('added', null, rightSegs, undefined, rv[i]);
        rightSegs.pop();
      }
    } else {
      if (frame.index < lv.length) {
        const i = frame.index++;
        const j = frame.rightByKey.get(String(lv[i][keyField]));
        leftSegs.push(String(i));
        if (j !== undefined && !frame.matched[j]) {
          frame.matched[j] = 1;
          rightSegs.push(String(j));
          if (i !== j && pairs.length < MAX_PAIRS) pairs.push([toPath(leftSegs), toPath(rightSegs)]);
          if (enter(lv[i], rv[j], depth + 1)) depth++;
          else { leftSegs.pop(); rightSegs.pop(); }
        } else {
          record('removed', leftSegs, null, lv[i]);
          leftSegs.pop();
        }
        continue;
      }
      for (let j = 0; j < rv.length; j++) {
        if (!frame.matched[j]) {
          rightSegs.push(String(j));
          record('added', null, rightSegs, undefined, rv[j]);
          rightSegs.pop();
        }
      }
    }
    frame.keys = null;
    frame.rightByKey = null;
    frame.matched = null;
    leftSegs.pop();
    rightSegs.pop();
    depth--;
  }

  return {
    diffs,
    pairs,
    stats,
    truncated,
    keyFallback,
    total: stats.added + stats.removed + stats.changed + stats.typeChanged,
  };
}
