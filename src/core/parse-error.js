function computeLineCol(text, pos) {
  const before = text.slice(0, pos);
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

// 从不同版本 V8 的错误信息中提取位置：
//   旧版: "Unexpected token i in JSON at position 1"
//   新版: "Expected property name or '}' in JSON at position 1 (line 1 column 2)"
export function parseErrorLocation(message, text) {
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
