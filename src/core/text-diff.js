import { formatJson } from './json.js';

// 中间差异段过大时退化为整块替换，限制时间和内存。
const TEXT_DIFF_MAX_MIDDLE = 3000;

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
export function makeTextDiff(text, text2, indent) {
  const aText = formatJson(text, { indent }).text;
  const bText = text === text2 ? aText : formatJson(text2, { indent }).text;
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
