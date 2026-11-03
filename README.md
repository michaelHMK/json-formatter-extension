# JSON 格式化与对比工具

Chrome 扩展（Manifest V3）：零权限、纯本地、无广告的 JSON 工具箱。大文件采用 Web Worker 解析与懒加载渲染，10MB 级 JSON 可较快打开。不收集任何数据，不发起网络请求。

当前版本见 [`manifest.json`](manifest.json) 中的 `version` 字段。

## 功能

| 页面 | 说明 |
| --- | --- |
| **JSON 格式化** | 美化（2 空格 / 4 空格 / Tab）；语法错误精确到行列并跳转；树形折叠、按层级展开、key/值搜索与高亮跳转；一键复制 |
| **JSON 压缩** | 去除空白压缩为单行；无效 JSON 提示行列位置 |
| **JSON 转义 / 去转义** | 文本与 JSON 字符串互转，一键复制 |
| **JSON 对比** | 双 JSON 结构化 diff（新增 / 删除 / 变更 / 类型变化）；数组按下标或主键配对；可忽略指定路径；树形高亮与「只看差异」；文本逐行 diff |

侧边栏可在各工具页之间切换。界面支持中文（简体）与英文（`_locales/`）。

## 本地加载（开发者模式）

1. 打开 Chrome，进入 `chrome://extensions/`
2. 开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本仓库**根目录**（包含 `manifest.json` 的目录，不要选 `dist/` 里的 zip）
5. 点击工具栏中的扩展图标，即可打开 JSON 工具箱

快捷键：多数页面支持 **Cmd/Ctrl + Enter** 执行当前操作。

## 项目结构（简要）

```
manifest.json          # 扩展清单
background.js          # Service Worker（打开工具页）
worker.js              # Web Worker：大 JSON 解析等
formatter.html/js      # 格式化页
minify.html            # 压缩页（逻辑在 transform.js）
escape.html / unescape.html
compare.html / compare.js
navigation.js / i18n.js / transform.js
formatter.css
icons/                 # 扩展图标（manifest 引用）
_locales/              # 国际化文案
gen_icons.py           # 重新生成 icons/ 下 PNG（可选）
STORE_LISTING.md       # Chrome 商店上架文案草稿（勿打进发布 zip）
```

## 重新生成图标

需要 Python 3，无第三方依赖：

```bash
python3 gen_icons.py
```

输出目录为 `icons/`（会覆盖现有 PNG）。

## 打包发布

发布到 Chrome Web Store 时，请打包**源码根目录**下的必要文件（HTML/JS/CSS、`manifest.json`、`icons/`、`_locales/` 等），**不要**包含 `STORE_LISTING.md`、`dist/`、`.git` 或开发用配置。

本地 zip 建议输出到 `dist/`（该目录已在 `.gitignore` 中忽略，不会进入 Git 仓库）。

## 隐私

- 不申请 host、storage 等敏感权限（见 `manifest.json`）
- 所有处理在浏览器本地完成，无第三方 SDK、无遥测
