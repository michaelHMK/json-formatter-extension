import { t } from './i18n.js';

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
