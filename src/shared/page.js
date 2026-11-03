import { renderNavigation } from './navigation.js';
import { applyI18n } from './i18n.js';

export function initializePage() {
  // 导航也包含翻译标记，必须先生成再统一翻译。
  renderNavigation();
  applyI18n();
}
