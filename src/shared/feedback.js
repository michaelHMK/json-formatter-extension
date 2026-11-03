import { t } from './i18n.js';

export function createFeedback({ statusEl, errorEl, inputEl }) {
  function setStatus(text) {
    statusEl.textContent = text;
  }

  function showError(text) {
    errorEl.textContent = text;
    errorEl.hidden = false;
  }

  function hideError() {
    errorEl.hidden = true;
    errorEl.textContent = '';
  }

  function showParseError(text, result) {
    let message = t('errParseFailed') + result.error;
    if (typeof result.line === 'number') {
      message = t('errLineCol', [String(result.line), String(result.column)]) + result.error;
    }
    showError(message);
    if (inputEl && typeof result.position === 'number') {
      inputEl.focus();
      const position = Math.min(result.position, text.length);
      inputEl.setSelectionRange(position, Math.min(position + 1, text.length));
      const lineHeight = parseFloat(getComputedStyle(inputEl).lineHeight) || 21;
      inputEl.scrollTop = Math.max(0, ((result.line || 1) - 3) * lineHeight);
    }
  }

  return { setStatus, showError, hideError, showParseError };
}
