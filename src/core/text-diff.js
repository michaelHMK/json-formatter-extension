import { formatJson } from './json.js';

// 中间差异段过大时退化为整块替换，限制时间和内存。
const TEXT_DIFF_MAX_MIDDLE = 3000;

// Myers O(ND) 行级 diff，返回 run 序列：{ type: 'same'|'del'|'add', aStart/bStart, count }
function myersOps(a, b) {
  const N = a.length;
  const M = b.length;
  if (!N) return M ? [{ type: 'add', bStart: 0, count: M }] : [];
  if (!M) return [{ type: 'del', aStart: 0, count: N }];

  // 第 d 轮只有 d+1 条有效对角线；无需为每轮复制长度 2*(N+M) 的前沿。
  const trace = [];
  let previous = new Int32Array(1);
  let D = 0;
  search: for (let d = 0; d <= N + M; d++) {
    const current = new Int32Array(d + 1);
    for (let i = 0; i <= d; i++) {
      const k = 2 * i - d;
      let x = (i === 0 || (i !== d && previous[i - 1] < previous[i]))
        ? previous[i] : previous[i - 1] + 1;
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) { x++; y++; }
      current[i] = x;
      if (x >= N && y >= M) { D = d; break search; }
    }
    trace.push(current);
    previous = current;
  }

  // 回溯时直接合并区间，避免为每一行建立临时操作对象。
  const ops = [];
  function appendRun(type, aStart, bStart, count) {
    const last = ops[ops.length - 1];
    if (last && last.type === type) {
      last.count += count;
      if (aStart !== undefined) last.aStart = aStart;
      if (bStart !== undefined) last.bStart = bStart;
    } else {
      const op = { type, count };
      if (aStart !== undefined) op.aStart = aStart;
      if (bStart !== undefined) op.bStart = bStart;
      ops.push(op);
    }
  }
  let x = N;
  let y = M;
  for (let d = D; d >= 1; d--) {
    const previous = trace[d - 1];
    const k = x - y;
    const i = (k + d) / 2;
    const down = i === 0 || (i !== d && previous[i - 1] < previous[i]);
    const prevK = down ? k + 1 : k - 1;
    const prevX = previous[down ? i : i - 1];
    const prevY = prevX - prevK;
    const same = Math.min(x - prevX, y - prevY);
    if (same > 0) {
      x -= same;
      y -= same;
      appendRun('same', x, y, same);
    }
    if (x === prevX) appendRun('add', undefined, --y, 1);
    else appendRun('del', --x, undefined, 1);
  }
  const same = Math.min(x, y);
  if (same > 0) appendRun('same', x - same, y - same, same);
  return ops.reverse();
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
  if (aText === bText) {
    let count = 1;
    let newline = -1;
    while ((newline = aText.indexOf('\n', newline + 1)) !== -1) count++;
    return {
      ops: [{ type: 'same', aStart: 0, bStart: 0, count }],
      aText, bText, blocky: false, totalLines: [count, count],
    };
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
