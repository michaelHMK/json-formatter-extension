# JSON Toolbox — Chrome Web Store 上架信息

> 本文件仅供上架时复制粘贴使用，不要打进 zip 包。

## 中文（简体）

**名称**：JSON Toolbox

**简短描述**（132 字符以内）：
高性能 JSON Toolbox：格式化、压缩、转义与去转义、树形搜索、结构与文本对比。数据仅在本地处理，无广告、无追踪、不收集数据。

**详细描述**：

JSON Toolbox 是一个以性能和隐私为核心的 JSON 工具箱。点击扩展图标即可在独立标签页中格式化、查看和比较 JSON，完全离线运行，无需登录或申请额外权限。通过 Web Worker、树与文本的虚拟显示以及解析结果复用，减少处理大 JSON 时的界面阻塞与重复开销；实际速度取决于设备和数据结构。

格式化页功能：
- 格式化 / 美化，支持 2 空格、4 空格、Tab 缩进
- 提示语法错误；浏览器提供位置信息时显示行列号并定位
- 树形折叠视图：虚拟滚动、按层级展开、key/值搜索高亮并逐条跳转
- 一键复制结果

压缩、转义与去转义页面：
- 每个功能使用独立页面，通过统一侧边导航切换
- 压缩（minify）并提示无效 JSON，显示可用的行列信息
- JSON 字符串转义与去转义互转，一键复制结果

对比页功能：
- 两个 JSON 的结构化对比：按路径展示新增 / 删除 / 值变化 / 类型变化
- 数组支持按下标对比或按主键（如 id）配对
- 可忽略指定路径（如时间戳字段）
- 完整树高亮差异 / 只看差异模式，逐处差异导航
- 文本行级 diff 视图

隐私：所有处理在浏览器本地完成，不收集或上传数据，不发起网络请求，不加载远程代码，无广告或追踪。不保存输入历史，仅在你执行复制时将结果写入系统剪贴板。

大结果使用虚拟显示，浏览器原生查找仅覆盖可见窗口，可使用树搜索或复制完整文本。输入与结果仍完整保留在内存中；较大的文本差异采用整块替换展示。

## English

**Name**: JSON Toolbox

**Short description** (max 132 chars):
High-performance JSON Toolbox: format, minify, escape and compare locally. No ads, tracking or data collection.

**Detailed description**:

JSON Toolbox puts performance and privacy first. Click the extension icon to format, browse and compare JSON in a dedicated tab. It works fully offline, with no account or extra permissions required. Web Workers, virtual tree and text views, and reused parsing results reduce interface blocking and repeated work with large JSON; performance depends on your device and data structure.

Formatter page:
- Beautify with 2-space / 4-space / Tab indent
- Syntax error messages, with line/column and navigation when the browser provides location details
- Collapsible tree view: virtual scrolling, expand-to-level, key/value search with match navigation
- One-click copy

Minify, escape and unescape pages:
- A separate page for each tool, connected by consistent sidebar navigation
- Minify JSON and report invalid input, including error locations when available
- Escape and unescape JSON string content, with one-click copy

Compare page:
- Structural diff between two JSONs: added / removed / changed / type-changed by path
- Arrays compared by index or matched by a key field (e.g. id)
- Optional ignore paths (e.g. timestamp fields)
- Full tree with highlighted diffs, or diffs-only mode, with per-diff navigation
- Line-level text diff view

Privacy: all processing stays in your browser. No data collection or uploads, network requests, remote code, ads or tracking. Input history is not saved, and results are written to the system clipboard only when you copy.

Large results use virtual rendering, so native browser Find covers only the visible window. Tree search and full copying remain available. Complete inputs and results stay in memory; large text diffs use block replacement.

## 上架表单

名称和简短描述来自发布包的 `_locales/*/messages.json`；上方文案与发布包一致。默认语言为 English，另添加简体中文翻译。

| 字段 | 填写内容 |
| --- | --- |
| 类别 | 选择控制台实际提供的 Developer Tools；若在 Productivity 下分组，选择对应的开发工具分类 |
| 单一用途 | 在浏览器本地查看和处理用户主动输入的 JSON，包括格式化、压缩、字符串转义及差异对比。 |
| Single purpose | View and process user-provided JSON locally in the browser, including formatting, minification, string escaping and comparison. |
| 权限理由 | 当前 manifest 未声明权限或主机访问权限；如果没有显示此字段，无需填写。打开工具标签页不需要 tabs 权限。 |
| 远程代码 | 选择 No, I am not using remote code。所有 JavaScript 和 Worker 均包含在扩展包中。 |
| 数据使用 | 不勾选收集数据的类别；核对并确认数据不出售、不用于无关用途、不用于信用或贷款评估的声明。 |
| 隐私政策 | 填写 https://github.com/michaelHMK/json-toolbox/blob/main/PRIVACY.md ，由当前公开项目仓库托管。修改本地政策后通过 PR 合并到 main 分支即可更新。 |
| 网站、支持链接 | 可选；仅填写已经公开可访问、由你维护的项目或支持页面。 |
| 分发 | 当前版本无付费功能。选择需要覆盖的地区；公开可见性用于正式上架。 |

这些隐私填法对应当前版本的实际行为；后续加入统计、联网或存储功能时需重新核对。[官方隐私表单说明](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)。

## 图片材料

- 商店图标：`icons/icon128.png`，128×128 PNG，图案 96×96，四周 16px 透明留白。
- 实际界面截图：`store-assets/en/` 与 `store-assets/zh_CN/`，分别用于英文和简体中文详情页，1280×800。
- 小型宣传图：`store-assets/promo-440x280.png`，440×280。
- 大型宣传图：`store-assets/promo-1400x560.png`，1400×560。
- 截图应展示真实功能，不添加无法验证的速度或排名承诺。尺寸依据[官方图片规范](https://developer.chrome.com/docs/webstore/images)。

修改名称或界面后，可重新生成全部图片。需要本地已有 Playwright 和支持扩展的完整 Chromium（不能使用 `chrome-headless-shell`）：

```bash
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
CHROMIUM_EXECUTABLE=/path/to/full/chromium \
node store-assets/generate.mjs
```

若 Playwright 可直接导入且已安装其完整 Chromium，可省略对应环境变量。脚本加载真实扩展，分别使用中英文界面生成截图，并将 SVG 宣传图源文件渲染为 PNG。

## 审核测试说明

No account, credentials or network connection are needed.

1. Install the extension, then click its toolbar icon to open the JSON Toolbox tab.
2. On JSON Formatter, click Sample and then Format. Switch to Tree to expand nodes and search keys or values.
3. Open JSON Minify, JSON Escape and JSON Unescape from the sidebar. Each page has a Sample button and an action button to produce a local result. Copy writes the result to the clipboard only when clicked.
4. Open JSON Compare and click Sample, then Compare. Inspect the structural differences and switch to the text comparison view. Array key matching and ignored paths are optional controls.
5. All operations run locally. No host permissions, remote code, analytics or user-data uploads are used.
