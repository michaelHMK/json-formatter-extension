// 转义：把任意文本变成 JSON 字符串字面量的内容（{"a":1} -> {\"a\":1}）
export function escapeJsonString(s) {
  return JSON.stringify(s).slice(1, -1);
}

/*
 * 去转义：escapeJsonString 的逆操作。
 * 文本里若含原始控制字符（换行、制表符等），直接包引号会解析失败，
 * 先把 charCode < 0x20 的字符统一转成转义序列，再用 JSON.parse 还原。
 * （0x2028/0x2029 在 JSON 字符串里是合法的，无需处理。）
 */
export function unescapeJsonString(s) {
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
