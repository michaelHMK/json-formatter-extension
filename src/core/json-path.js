// JSON Pointer：根路径为空字符串，key 中的 ~ 和 / 必须转义。
export const PATH_SEP = '/';

export function appendJsonPath(path, key) {
  key = String(key);
  if (key.includes('~') || key.includes('/')) {
    key = key.replace(/~/g, '~0').replace(/\//g, '~1');
  }
  return path + PATH_SEP + key;
}
