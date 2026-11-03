'use strict';

// 点击工具栏图标，在新标签页打开格式化页面
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('formatter.html') });
});
