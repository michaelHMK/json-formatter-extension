# Chrome Web Store 上架信息草稿

> 本文件仅供上架时复制粘贴使用，不要打进 zip 包。

## 中文（简体）

**名称**：JSON 格式化与对比工具

**简短描述**（132 字符以内）：
零权限、纯本地、无广告：10MB 级大文件秒开的格式化/树形搜索，支持主键配对的双 JSON 结构对比，不收集任何数据。

**详细描述**：

一个无广告、完全离线运行的 JSON 工具箱，为处理大 JSON 做了性能优化（Web Worker 解析 + 懒加载渲染，10MB 级秒开）。

格式化页功能：
- 格式化 / 美化，支持 2 空格、4 空格、Tab 缩进
- 语法错误精确到行列号，自动定位到出错位置
- 树形折叠视图：懒加载、按层级展开、key/值搜索高亮并逐条跳转
- 一键复制结果

压缩、转义与去转义页面：
- 每个功能使用独立页面，通过统一侧边导航切换
- 压缩（minify）并定位无效 JSON 的行列号
- JSON 字符串转义与去转义互转，一键复制结果

对比页功能：
- 两个 JSON 的结构化对比：按路径展示新增 / 删除 / 值变化 / 类型变化
- 数组支持按下标对比或按主键（如 id）配对
- 可忽略指定路径（如时间戳字段）
- 完整树高亮差异 / 只看差异模式，逐处差异导航
- 文本行级 diff 视图

隐私承诺：不收集任何数据，不联网，无任何第三方请求。

## English

**Name**: JSON Formatter & Compare

**Short description** (max 132 chars):
Zero-permission, local, ad-free JSON toolbox: fast on 10MB+ files — format, tree search, structural diff with key matching.

**Detailed description**:

An ad-free, fully offline JSON toolbox, optimized for large JSON (Web Worker parsing + lazy rendering; 10MB files open instantly).

Formatter page:
- Beautify with 2-space / 4-space / Tab indent
- Syntax errors reported with line/column and auto-jump to the error position
- Collapsible tree view: lazy loading, expand-to-level, key/value search with match navigation
- One-click copy

Minify, escape and unescape pages:
- A separate page for each tool, connected by consistent sidebar navigation
- Minify JSON with line/column locations for invalid input
- Escape and unescape JSON string content, with one-click copy

Compare page:
- Structural diff between two JSONs: added / removed / changed / type-changed by path
- Arrays compared by index or matched by a key field (e.g. id)
- Optional ignore paths (e.g. timestamp fields)
- Full tree with highlighted diffs, or diffs-only mode, with per-diff navigation
- Line-level text diff view

Privacy: no data collection, no network requests, no third-party calls.

## 上架表单字段建议

- **类别**：开发者工具（Developer Tools）或工作效率（Productivity）
- **语言**：中文（简体）+ English
- **隐私声明**：选择「不收集任何数据」；本扩展不申请任何权限，权限理由留空即可
- **截图**：至少 1 张，1280x800 或 640x400，建议 2-3 张（格式化页树形视图 / 对比页双树高亮 / 文本 diff）
